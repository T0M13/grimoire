import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DM_MOVE_JSON_SCHEMA, DmMoveSchema, type DmMove, type PublicState } from "@grimoire/shared";
import { generateJson, generateStream, type ChatMessage } from "./ollama.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(here, "..", "prompts", "dm-system.md"), "utf8");
const STANDARD_CONTENT_PROMPT = fs.readFileSync(path.join(here, "..", "prompts", "content-standard.md"), "utf8");
const MATURE_CONTENT_PROMPT = fs.readFileSync(path.join(here, "..", "prompts", "content-mature.md"), "utf8");

function stateBlock(state: PublicState): string {
  const partyById = new Map(state.party.map(character => [character.id, character.name]));
  const relationships = Object.entries(state.npcRelationships ?? {})
    .flatMap(([characterId, byNpc]) => Object.values(byNpc).map(relationship => ({
      player: partyById.get(characterId) ?? characterId,
      npc: relationship.npcName,
      trust: relationship.trust,
      affection: relationship.affection,
      status: relationship.status,
      note: relationship.note,
      updatedAt: relationship.updatedAt,
    })))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 40);
  const compact = {
    contentTone: state.contentTone ?? "standard",
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
      name: npc.name, sex: npc.sex, entityType: npc.entityType, adult: npc.adult ?? "unknown",
      personality: npc.personality, appearance: npc.appearance,
    })),
    relationships,
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * NPC narration already carries authoritative speaker metadata. Small models sometimes repeat that
 * same speaker as a prose label ("Guard Edwin: ..."), which made the UI and TTS say the name twice.
 * Probe the short leading buffer until it is clear whether a label is present, then remove only an
 * exact name-plus-separator prefix. Natural sentences that merely begin similarly are preserved.
 */
function leadingSpeakerProbe(text: string, speakerName: string): { ready: boolean; text: string } {
  const name = speakerName.trim();
  if (!name) return { ready: true, text };
  const wrappers = "[*_#`]+";
  const quotes = "[\"'“”‘’]";
  const label = new RegExp(
    `^\\s*(?:${quotes}\\s*)?(?:${wrappers}\\s*)*${escapeRegExp(name)}`
      + `\\s*(?:${wrappers}\\s*)*(?::|[-–—])\\s*(?:${wrappers}\\s*)*(?:${quotes}\\s*)?`,
    "iu",
  );
  const match = label.exec(text);
  if (match) return { ready: true, text: text.slice(match[0].length) };

  const comparable = text
    .replace(/^\s*(?:["'“”‘’]\s*)?(?:[*_#`]+\s*)*/u, "")
    .toLocaleLowerCase();
  const expected = name.toLocaleLowerCase();
  if (comparable.length <= expected.length && expected.startsWith(comparable))
    return { ready: false, text };
  if (comparable.startsWith(expected)) {
    const tail = comparable.slice(expected.length);
    if (/^\s*(?:[*_#`]+\s*)*$/u.test(tail)) return { ready: false, text };
  }
  return { ready: true, text };
}

/**
 * Streaming equivalent of sanitizePlayerFacingText. It holds only a short tail so a label split
 * across model chunks is caught before any part of it reaches the UI, log, or TTS queue.
 */
export class PlayerFacingTextStream {
  private pending = "";
  private complete = "";
  private stopped = false;
  private speakerPending = "";
  private speakerResolved: boolean;

  constructor(private readonly emit: (text: string) => void, private readonly speakerName?: string) {
    this.speakerResolved = !speakerName?.trim();
  }

  push(chunk: string): void {
    if (this.stopped || !chunk) return;
    if (!this.speakerResolved && this.speakerName) {
      this.speakerPending += chunk;
      const probe = leadingSpeakerProbe(this.speakerPending, this.speakerName);
      if (!probe.ready) return;
      this.speakerPending = "";
      this.speakerResolved = true;
      chunk = probe.text;
      if (!chunk) return;
    }
    this.pushSanitized(chunk);
  }

  private pushSanitized(chunk: string): void {
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
    if (!this.speakerResolved && this.speakerName) {
      const buffered = this.speakerPending;
      this.speakerPending = "";
      this.speakerResolved = true;
      const probe = leadingSpeakerProbe(buffered, this.speakerName);
      this.pushSanitized(probe.ready ? probe.text : buffered);
    }
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
  const contentPrompt = state.contentTone === "mature" ? MATURE_CONTENT_PROMPT : STANDARD_CONTENT_PROMPT;
  return [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${contentPrompt}\n\n${stateBlock(state)}` },
    ...history.slice(-20),
    { role: "user", content: `${instruction}${viewpoint}` },
  ];
}

export const MOVE_INSTRUCTION = `ENGINE: Choose your next DM move for the situation above. Respond ONLY with the JSON object.
- "request_check": ONLY for a real gamble - the attempt must have (1) genuine opposition, danger,
  or time pressure AND (2) an interesting consequence on failure. Climbing a crumbling wall while
  guards approach: roll. Persuading a hostile jailer: roll. Sneaking past a sentry: roll.
  EXPLORATION IS FREE: looking around, listening, reading, examining an object the story just
  pointed at, searching a room with no danger, opening an ordinary door - just narrate what they
  find, no roll. If a player needs a piece of information for the story to move, GIVE it to them.
  Never ask to re-roll the same failed attempt; the failure already changed the situation.
  Fill "check" with a difficulty category; never calculate or output a numerical DC.
- VIOLENCE IS A GAMBLE: attacking, killing, restraining, kidnapping, robbing, or otherwise
  overcoming an active resisting target normally requires "request_check". Never declare a hit,
  capture, serious wound, or death before that roll. Skip the roll only when the attempt is plainly
  impossible, the target is already helpless, or the target freely allows it; narrate that truth
  without pretending an uncertain contest was settled automatically.
- ENTERTAIN CREATIVE PLANS, including odd, funny, criminal, or dark plans, when they are physically
  possible. Do not refuse merely because a plan is unusual or morally dubious. The world reacts.
  An actually impossible attempt fails plainly without a roll; do not pretend dice can break reality.
  Capturing an alert, resisting enemy has real opposition and normally needs an approach-matching
  check: Athletics for physical restraint, Stealth for an unseen abduction, or a social skill to lure
  or secure surrender. Choose hard or very hard when the opposition truly warrants it, but lower it
  for strong leverage and skip a redundant roll for a helpless or freely surrendering target.
  Failure must create escape, alarm, injury, hostility, lost position, or another playable route.
  Interrogation itself is conversation; request a social check only when a lie, threat, or bargain has
  meaningful stakes. Never hide a required main-quest clue behind the roll.
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
Use optional "relationship" only when the ACTIVE player's interaction meaningfully changes one
named NPC's attitude. The server owns the numbers; choose only these events:
- met: first meaningful exchange; helped: useful or kind act; bonded: earned personal closeness;
- offended: insult or broken boundary; threatened: credible intimidation or captivity;
- harmed: direct harm; betrayed: serious broken trust;
- mutual_romance: both clearly adult people freely reciprocate after an established bond;
- romance_ended: either person ends it; none: no change.
For a move with no check, set "immediate" and set both roll outcomes to none. For request_check,
set immediate to none and choose onSuccess/onFailure; the server waits for the real roll. Never use
mutual_romance in Standard mode, for a young player character, for a creature, for an NPC whose
adult status is unknown/false, or to override refusal. Do not reward repetitive small talk. Keep the
reason to one short established fact. Relationship changes are per player, not party-wide.
Mutual romance and ending romance are free consent decisions: emit them only as immediate events,
never as the success or failure result of a die roll.
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

export function semanticallyValid(move: DmMove, state: PublicState, playerAction: string): boolean {
  const partyNames = new Set(state.party.map(c => c.name.toLowerCase()));
  const interactionMode = /INTERACTION MODE:\s*(ACT|SPEAK)/i.exec(playerAction)?.[1]?.toLowerCase();
  if (move.npc && !npcMetadataValid(move.npc, state, partyNames)) return false;
  if (move.scene?.occupants.some(subject => !npcMetadataValid(subject, state, partyNames))) return false;
  if (playerAction.includes("INTERACTION MODE: SPEAK") && !move.npc) return false;
  if (move.move === "change_scene" && interactionMode === "speak") return false;
  if (move.move === "change_scene" && interactionMode === "act" && !playerActionRequestsMovement(playerAction))
    return false;
  if (move.relationship) {
    const playerKnown = partyNames.has(move.relationship.playerName.toLowerCase());
    const targetKey = npcKeyForValidation(move.relationship.npcName);
    const moveNpcMatches = move.npc && npcKeyForValidation(move.npc.name) === targetKey;
    if (!playerKnown || partyNames.has(move.relationship.npcName.toLowerCase())
      || (!moveNpcMatches && !state.npcVoices[targetKey])) return false;
    if (move.move === "request_check" && move.check
      && move.relationship.playerName.toLowerCase() !== move.check.playerName.toLowerCase()) return false;
    if (move.move === "request_check" && [move.relationship.onSuccess, move.relationship.onFailure]
      .some(event => event === "mutual_romance" || event === "romance_ended"))
      return false;
    if (move.move === "request_check" ? move.relationship.immediate !== "none"
      : move.relationship.onSuccess !== "none" || move.relationship.onFailure !== "none") return false;
  }
  if (move.move === "request_check")
    return !!move.check && partyNames.has(move.check.playerName.toLowerCase());
  if (move.move === "change_scene") return !!move.scene;
  if (move.move === "give_item")
    return !!move.item && partyNames.has(move.item.playerName.toLowerCase());
  return true;
}

/** Only explicit player travel may replace the current scene during a normal Act turn. */
export function playerActionRequestsMovement(playerAction: string): boolean {
  const action = playerAction
    .split(/\n\s*INTERACTION MODE:/i, 1)[0]!
    .replace(/^[^:\n]{1,40}:\s*/, "")
    .trim();
  return /^(?:(?:i|we)\s+)?(?:(?:try|decide|want|start|begin)\s+to\s+)?(?:go|head|walk|run|travel|enter|leave|exit|follow|descend|climb|flee|step|move|cross|return)\b/i.test(action)
    || /\b(?:i|we)\s+(?:(?:try|decide|want|start|begin)\s+to\s+)?(?:go|head|walk|run|travel|enter|leave|exit|follow|descend|climb|flee|step|move|cross|return)\b/i.test(action);
}

function npcKeyForValidation(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function npcMetadataValid(
  subject: NonNullable<DmMove["npc"]>,
  state: PublicState,
  partyNames: Set<string>,
): boolean {
  if (partyNames.has(subject.name.toLowerCase())) return false;
  const known = state.npcVoices[npcKeyForValidation(subject.name)];
  if (known?.adult !== undefined && subject.adult !== undefined && known.adult !== subject.adult)
    return false;
  return !(subject.adult === true
    && /\b(child|minor|teenager|adolescent|young boy|young girl|little boy|little girl)\b/i.test(subject.appearance));
}

/** Pass 2: streamed narration of the chosen move / mechanical result. */
export async function narrate(
  state: PublicState,
  history: ChatMessage[],
  instruction: string,
  onChunk: (text: string) => void,
  viewpointName?: string,
  speakerName?: string,
): Promise<string> {
  const visible = new PlayerFacingTextStream(onChunk, speakerName);
  await generateStream(buildMessages(state, history, instruction, viewpointName), chunk => visible.push(chunk));
  return visible.flush();
}
