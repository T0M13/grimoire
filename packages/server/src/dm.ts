import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DM_MOVE_JSON_SCHEMA, DmMoveSchema, type DmMove, type PublicState } from "@grimoire/shared";
import { generateJson, generateStream, type ChatMessage } from "./ollama.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(here, "..", "prompts", "dm-system.md"), "utf8");

function stateBlock(state: PublicState): string {
  const compact = {
    scene: {
      name: state.scene.name, kind: state.scene.kind, timeOfDay: state.scene.timeOfDay,
      weather: state.scene.weather, mood: state.scene.mood,
      description: sanitizePlayerFacingText(state.scene.description).slice(0, 400), exits: state.scene.exits,
      presentNpcNames: state.scene.occupants.map(npc => npc.name),
    },
    party: state.party.map(c => ({
      name: c.name, sex: c.sex, age: c.age, class: c.className, level: c.level,
      race: c.subrace ?? c.raceName ?? "Human", background: c.background ?? "Acolyte",
      alignment: c.alignment ?? "Neutral", hp: `${c.hp}/${c.maxHp}`, ac: c.ac,
      speed: c.speed ?? 30, abilities: c.abilities,
      proficientSkills: c.proficientSkills,
      savingThrowProficiencies: c.savingThrowProficiencies ?? [],
      racialAndBackgroundTraits: c.traits ?? [], classFeatures: c.classFeatures ?? [],
      spells: c.spells ?? [], languages: c.languages ?? ["Common"],
      tools: c.toolProficiencies ?? [], bio: c.bio.slice(0, 200) || undefined,
      personalityTraits: c.personalityTraits ?? [], ideal: c.ideal || undefined,
      bond: c.bond || undefined, flaw: c.flaw || undefined, inventory: c.inventory,
    })),
    quests: state.quests.map(q => ({
      title: q.title, objective: q.objective, summary: q.summary, status: q.status, isMain: q.isMain,
    })),
    knownNpcs: Object.values(state.npcVoices).map(npc => ({
      name: npc.name, sex: npc.sex, entityType: npc.entityType,
      personality: npc.personality, appearance: npc.appearance,
    })),
  };
  return `PRIVATE CAMPAIGN STATE (authoritative - do not contradict or quote field names):\n${JSON.stringify(compact, null, 1)}`;
}

/**
 * Structured visual data belongs in state messages, never in prose shown to players. Small local
 * models occasionally echo a prompt label, so this is also enforced after generation rather than
 * trusting prompt compliance alone.
 */
const INTERNAL_LABELS = [
  "visible living subjects", "visible subjects", "visible non-player people",
  "visible non-player characters", "visible non-player creatures", "scene occupants",
  "scene image prompt", "image prompt", "portrait subjects", "present npc names",
  "non-player characters here", "presentnpcnames", "nonplayercharactershere",
] as const;
const NORMALIZED_INTERNAL_LABELS = INTERNAL_LABELS.map(label => label.replaceAll("-", " "));
const INTERNAL_PROSE_MARKER = new RegExp(
  `(?:${INTERNAL_LABELS.map(label => label.replaceAll(" ", "\\s+").replace("-", "[- ]"))
    .join("|")})\\s*(?::|\\u2014|-|\\r?\\n)`,
  "ig",
);

/** Find a private label only where a new sentence/line or Markdown label can begin. */
function internalMarkerIndex(text: string, minimumIndex = 0): number {
  INTERNAL_PROSE_MARKER.lastIndex = 0;
  let marker: RegExpExecArray | null;
  while ((marker = INTERNAL_PROSE_MARKER.exec(text))) {
    if (marker.index < minimumIndex) continue;
    const before = text.slice(0, marker.index);
    if (/(?:^|[.!?]["')\]]?|\r?\n)\s*(?:[*_#>`-]+\s*)*$/u.test(before)) return marker.index;
  }
  return -1;
}

/** Return where a chunk suffix that could grow into a private label begins, or -1. */
function canStartLabelAfter(text: string): boolean {
  return !text || /(?:[.!?]["')\]]?|\r?\n)\s*(?:[*_#>`-]+\s*)*$/u.test(text);
}

function possibleMarkerSuffix(text: string, mayStartAtZero: boolean): number {
  const first = Math.max(0, text.length - 48);
  for (let index = first; index < text.length; index++) {
    const before = text.slice(0, index);
    if (!before ? !mayStartAtZero : !/(?:[.!?]["')\]]?|\r?\n)$/u.test(before)) continue;
    const suffix = text.slice(index);
    const words = suffix.replace(/^[\s*_#>`-]+/u, "").toLowerCase()
      .replaceAll("-", " ").replace(/\s+/g, " ").trimEnd();
    if (NORMALIZED_INTERNAL_LABELS.some(label => label.startsWith(words))) return index;
  }
  return -1;
}

function safePrefix(text: string): string {
  const marker = internalMarkerIndex(text);
  if (marker < 0) return text;
  // Remove a dangling Markdown heading/bullet and whitespace immediately before the private label.
  return text.slice(0, marker).replace(/[\s*_#>`-]+$/u, "").trimEnd();
}

/** Markdown symbols read as noise in the story band and would be spoken by TTS. */
function stripMarkdownSymbols(text: string): string {
  return text.replace(/[*_#`]/g, "");
}

/** Remove a leaked private scene/portrait label from persisted or completed narration. */
export function sanitizePlayerFacingText(text: string): string {
  return stripMarkdownSymbols(safePrefix(text));
}

/**
 * Streaming equivalent of sanitizePlayerFacingText. It holds only a short tail so a label split
 * across model chunks is caught before any part of it reaches the UI, log, or TTS queue.
 */
export class PlayerFacingTextStream {
  private pending = "";
  private complete = "";
  private stopped = false;

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string): void {
    if (this.stopped || !chunk) return;
    this.pending += chunk;
    const context = this.complete.slice(-64);
    const marker = internalMarkerIndex(context + this.pending, context.length);
    if (marker >= context.length) {
      this.publish(this.pending.slice(0, marker - context.length).replace(/[\s*_#>`-]+$/u, "").trimEnd());
      this.pending = "";
      this.stopped = true;
      return;
    }
    const heldAt = possibleMarkerSuffix(this.pending, canStartLabelAfter(this.complete));
    if (heldAt < 0) {
      this.publish(this.pending);
      this.pending = "";
    } else if (heldAt > 0) {
      this.publish(this.pending.slice(0, heldAt));
      this.pending = this.pending.slice(heldAt);
    }
  }

  flush(): string {
    if (!this.stopped) {
      const heldAt = possibleMarkerSuffix(this.pending, canStartLabelAfter(this.complete));
      this.publish(heldAt >= 0 ? this.pending.slice(0, heldAt) : safePrefix(this.pending));
    }
    this.pending = "";
    return this.complete;
  }

  private publish(text: string): void {
    if (!text) return;
    const clean = stripMarkdownSymbols(text);
    this.complete += clean;
    if (clean) this.emit(clean);
  }
}

export function viewpointInstruction(playerName: string): string {
  return `ACTIVE PLAYER VIEWPOINT (absolute): The player character is ${JSON.stringify(playerName)}.
Tell this beat directly to that player. Refer to their character ONLY as "you" or "your".
Do not output their character name or third-person pronouns for them, even if earlier history did.`;
}

export function buildMessages(
  state: PublicState,
  history: ChatMessage[],
  instruction: string,
  viewpointName?: string,
): ChatMessage[] {
  const viewpoint = viewpointName ? `\n\n${viewpointInstruction(viewpointName)}` : "";
  return [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${stateBlock(state)}` },
    ...history.slice(-20),
    { role: "user", content: `${instruction}${viewpoint}` },
  ];
}

const MOVE_INSTRUCTION = `ENGINE: Choose your next DM move for the situation above. Respond ONLY with the JSON object.
- "request_check": the player is ATTEMPTING something - climbing, sneaking, forcing, persuading,
  deceiving, searching, recalling lore, noticing danger, crossing a threshold like a portal, or
  anything else where an ability could matter and failure would cost something. PREFER this move:
  when torn between narrate and request_check, request the check - rolls are the heartbeat of the
  game and their outcomes may bend the story. Fill "check" with a difficulty category; never
  calculate or output a numerical DC. Skip rolls only for ordinary conversation, obvious facts,
  truly automatic tasks, and impossible attempts.
- "change_scene": MOVEMENT IS SACRED. If the last player action states or implies going somewhere
  (enter, leave, go through, step in, follow, travel, descend, flee), you MUST choose change_scene
  NOW and put them in the new place - never answer movement with more description of the current
  location. Also use it for any genuinely new location. Fill "scene" fully. Its
  "imagePrompt" is an EMPTY-STAGE camera composition: NO people, NO faces, NO figures, NO crowds,
  NO animals, and NO monsters or creatures. Put every named visible NON-PLAYER person or creature
  in "occupants" instead, with a stable appearance description reused from state whenever possible.
  Never list party members there; their portraits already come from the character sheet.
  Describe interior/exterior, architecture and terrain, time/weather/lighting, and physical
  EVIDENCE of the story hook - an overturned cart, a smashed door, claw marks, an abandoned meal,
  a glowing rune. The place must tell the story by itself. No signs, captions, or written text.
- "give_item": a player just legitimately obtained a specific item. Fill "item".
- "narrate": plain storytelling beat - only when nothing above applies.
When an NPC or named creature is directly responding, fill optional "npc" with their stable name,
voice-family sex, entity type, concise personality, and concrete physical appearance. Reuse every
established NPC fact from state; never casually redesign a known subject.
Use optional "quest" only for a real objective transition: start a main/side quest, advance its
current objective, complete it, or fail it. Preserve the main quest through setbacks; failure in a
check should create a cost, complication, or alternate route rather than strand the story.
Quest text must be SIMPLE enough for a child or a non-native English speaker:
- "title": 2-4 everyday words ("The Missing Girl", "Rats in the Cellar").
- "objective": ONE short sentence that tells the players exactly what to DO next, starting with
  a verb ("Find out who broke into the stall.", "Talk to the captain at the docks.").
- "summary": ONE short plain sentence about why it matters ("A thief is stealing from the market.").
Never use abstract words like "hook", "lead", "immediate", "investigate the situation".
Set optional "mood" when the scene's emotional state changes. Use "combat" when a fight
starts, "boss" for a climactic enemy, "victory" when a major encounter ends, and return to the
best fitting ambient mood after danger passes. Omit it when the mood has not changed.
Always fill "suggestedActions" with 3 short, distinct things players could plausibly try next (imperative, max 6 words each).
This JSON is private engine data. Never plan to repeat its field names or subject lists in narration.`;

/** Pass 1: constrained decision. Guaranteed-parseable; one retry on semantic invalidity. */
export async function decideMove(state: PublicState, history: ChatMessage[], playerAction: string): Promise<DmMove> {
  const messages = buildMessages(state, history, `${playerAction}\n\n${MOVE_INSTRUCTION}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateJson(messages, DM_MOVE_JSON_SCHEMA);
    const parsed = DmMoveSchema.safeParse(JSON.parse(raw));
    if (parsed.success && semanticallyValid(parsed.data, state, playerAction)) return parsed.data;
  }
  // graceful fallback: plain narration beat
  return { move: "narrate", suggestedActions: [] };
}

function semanticallyValid(move: DmMove, state: PublicState, playerAction: string): boolean {
  const partyNames = new Set(state.party.map(c => c.name.toLowerCase()));
  if (move.npc && partyNames.has(move.npc.name.toLowerCase())) return false;
  if (playerAction.includes("INTERACTION MODE: SPEAK") && !move.npc) return false;
  if (move.move === "request_check")
    return !!move.check && partyNames.has(move.check.playerName.toLowerCase());
  if (move.move === "change_scene") return !!move.scene;
  if (move.move === "give_item")
    return !!move.item && partyNames.has(move.item.playerName.toLowerCase());
  return true;
}

/** Pass 2: streamed narration of the chosen move / mechanical result. */
export async function narrate(
  state: PublicState,
  history: ChatMessage[],
  instruction: string,
  onChunk: (text: string) => void,
  viewpointName?: string,
): Promise<string> {
  const visible = new PlayerFacingTextStream(onChunk);
  await generateStream(buildMessages(state, history, instruction, viewpointName), chunk => visible.push(chunk));
  return visible.flush();
}
