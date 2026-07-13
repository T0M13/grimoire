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
      hp: `${c.hp}/${c.maxHp}`, bio: c.bio.slice(0, 200) || undefined,
      inventory: c.inventory,
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
- "request_check": the last player action has an uncertain, consequential outcome. Fill "check" with a fair DC.
- "change_scene": the party moved to a genuinely new location. Fill "scene" fully. Its
  "imagePrompt" must be a concrete camera composition: say interior/exterior, architecture and
  terrain, time/weather/lighting, and the visible NPCs plus what they are physically doing. Show
  the current story hook rather than an empty generic landscape. Use physical descriptions, not
  character names, and include no signs, captions, or written text.
- "give_item": a player just legitimately obtained a specific item. Fill "item".
Always fill "suggestedActions" with 3 short, distinct things players could plausibly try next (imperative, max 6 words each).`;

/** Pass 1: constrained decision. Guaranteed-parseable; one retry on semantic invalidity. */
export async function decideMove(state: PublicState, history: ChatMessage[], playerAction: string): Promise<DmMove> {
  const messages = buildMessages(state, history, `${playerAction}\n\n${MOVE_INSTRUCTION}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateJson(messages, DM_MOVE_JSON_SCHEMA);
    const parsed = DmMoveSchema.safeParse(JSON.parse(raw));
    if (parsed.success && semanticallyValid(parsed.data, state)) return parsed.data;
  }
  // graceful fallback: plain narration beat
  return { move: "narrate", suggestedActions: [] };
}

function semanticallyValid(move: DmMove, state: PublicState): boolean {
  const partyNames = new Set(state.party.map(c => c.name.toLowerCase()));
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
