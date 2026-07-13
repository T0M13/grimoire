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
      description: state.scene.description.slice(0, 400), exits: state.scene.exits,
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
      name: npc.name, sex: npc.sex, personality: npc.personality,
    })),
  };
  return `CAMPAIGN STATE (authoritative - do not contradict):\n${JSON.stringify(compact, null, 1)}`;
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
- "narrate": normal storytelling beat (default).
- "request_check": the last player action has an uncertain, consequential outcome. Fill "check"
  with a difficulty category; never calculate or output a numerical DC. Use this whenever success
  is genuinely uncertain, failure has a meaningful consequence, and an ability or trained skill
  matters. Do not roll for routine conversation, automatic success, or impossible actions.
- "change_scene": the party moved to a genuinely new location. Fill "scene" fully. Its
  "imagePrompt" must be a concrete camera composition: say interior/exterior, architecture and
  terrain, time/weather/lighting, and the visible NPCs plus what they are physically doing. Show
  the current story hook rather than an empty generic landscape. Use physical descriptions, not
  character names, and include no signs, captions, or written text.
- "give_item": a player just legitimately obtained a specific item. Fill "item".
When an NPC is directly responding, fill optional "npc" with their stable name, sex, and concise
personality. Reuse established NPC facts from state.
Use optional "quest" only for a real objective transition: start a main/side quest, advance its
current objective, complete it, or fail it. Preserve the main quest through setbacks; failure in a
check should create a cost, complication, or alternate route rather than strand the story.
Set optional "mood" when the scene's emotional state changes. Use "combat" when a fight
starts, "boss" for a climactic enemy, "victory" when a major encounter ends, and return to the
best fitting ambient mood after danger passes. Omit it when the mood has not changed.
Always fill "suggestedActions" with 3 short, distinct things players could plausibly try next (imperative, max 6 words each).`;

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
  return generateStream(buildMessages(state, history, instruction, viewpointName), onChunk);
}
