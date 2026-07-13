import { z } from "zod";

// ---------- Core enums ----------

export const SKILLS = [
  "Athletics", "Acrobatics", "Sleight of Hand", "Stealth",
  "Arcana", "History", "Investigation", "Nature", "Religion",
  "Animal Handling", "Insight", "Medicine", "Perception", "Survival",
  "Deception", "Intimidation", "Performance", "Persuasion",
] as const;
export const SkillSchema = z.enum(SKILLS);
export type Skill = z.infer<typeof SkillSchema>;

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export const AbilitySchema = z.enum(ABILITIES);
export type Ability = z.infer<typeof AbilitySchema>;
export const AbilityScoresSchema = z.object({
  STR: z.number().int().min(8).max(15),
  DEX: z.number().int().min(8).max(15),
  CON: z.number().int().min(8).max(15),
  INT: z.number().int().min(8).max(15),
  WIS: z.number().int().min(8).max(15),
  CHA: z.number().int().min(8).max(15),
});
export type AbilityScores = z.infer<typeof AbilityScoresSchema>;

export const SKILL_ABILITY: Record<Skill, Ability> = {
  Athletics: "STR",
  Acrobatics: "DEX", "Sleight of Hand": "DEX", Stealth: "DEX",
  Arcana: "INT", History: "INT", Investigation: "INT", Nature: "INT", Religion: "INT",
  "Animal Handling": "WIS", Insight: "WIS", Medicine: "WIS", Perception: "WIS", Survival: "WIS",
  Deception: "CHA", Intimidation: "CHA", Performance: "CHA", Persuasion: "CHA",
};

export const MOODS = [
  "tavern", "town", "travel", "forest", "dungeon", "night",
  "tension", "mystery", "combat", "boss", "sorrow", "victory",
] as const;
export const MoodSchema = z.enum(MOODS);
export type Mood = z.infer<typeof MoodSchema>;

// ---------- Character ----------

export const SexSchema = z.enum(["male", "female"]);
export type Sex = z.infer<typeof SexSchema>;

export const AgeSchema = z.enum(["young", "adult", "elder"]);
export type Age = z.infer<typeof AgeSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  sex: SexSchema.default("male"),
  age: AgeSchema.default("adult"),
  /** Player-written flavor: looks, vibe, past. NEVER grants mechanical advantages. */
  bio: z.string().max(300).default(""),
  className: z.enum(["Fighter", "Rogue", "Cleric", "Wizard"]),
  level: z.number().int().min(1).max(20),
  abilities: z.record(AbilitySchema, z.number().int().min(1).max(30)),
  proficientSkills: z.array(SkillSchema),
  proficiencyBonus: z.number().int().min(2).max(6),
  maxHp: z.number().int().min(1),
  hp: z.number().int().min(0),
  ac: z.number().int().min(1),
  inventory: z.array(z.string()),
  portraitUrl: z.string().nullable().default(null),
});
export type Character = z.infer<typeof CharacterSchema>;

// ---------- Scene / world ----------

export const SceneSchema = z.object({
  name: z.string(),
  kind: z.string(),               // "tavern", "forest road", ...
  timeOfDay: z.enum(["day", "dusk", "night", "dawn"]),
  weather: z.enum(["clear", "rain", "storm", "snow", "fog"]),
  mood: MoodSchema,
  description: z.string(),
  exits: z.array(z.string()).max(6),
  imagePrompt: z.string(),
  imageUrl: z.string().nullable().default(null),
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------- DM moves (LLM structured output) ----------

export const CheckRequestSchema = z.object({
  playerName: z.string(),
  skill: SkillSchema,
  dc: z.number().int().min(5).max(30),
  reason: z.string(),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const DmMoveSchema = z.object({
  move: z.enum(["narrate", "request_check", "change_scene", "give_item"]),
  check: CheckRequestSchema.optional(),
  scene: z
    .object({
      name: z.string(),
      kind: z.string(),
      timeOfDay: z.enum(["day", "dusk", "night", "dawn"]),
      weather: z.enum(["clear", "rain", "storm", "snow", "fog"]),
      mood: MoodSchema,
      exits: z.array(z.string()).max(6),
      imagePrompt: z.string(),
    })
    .optional(),
  item: z.object({ playerName: z.string(), item: z.string() }).optional(),
  suggestedActions: z.array(z.string()).max(3).default([]),
});
export type DmMove = z.infer<typeof DmMoveSchema>;

// JSON schema handed to Ollama's `format` for constrained decoding.
export const DM_MOVE_JSON_SCHEMA = {
  type: "object",
  properties: {
    move: { type: "string", enum: ["narrate", "request_check", "change_scene", "give_item"] },
    check: {
      type: "object",
      properties: {
        playerName: { type: "string" },
        skill: { type: "string", enum: [...SKILLS] },
        dc: { type: "integer", minimum: 5, maximum: 30 },
        reason: { type: "string" },
      },
      required: ["playerName", "skill", "dc", "reason"],
    },
    scene: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string" },
        timeOfDay: { type: "string", enum: ["day", "dusk", "night", "dawn"] },
        weather: { type: "string", enum: ["clear", "rain", "storm", "snow", "fog"] },
        mood: { type: "string", enum: [...MOODS] },
        exits: { type: "array", items: { type: "string" }, maxItems: 6 },
        imagePrompt: { type: "string" },
      },
      required: ["name", "kind", "timeOfDay", "weather", "mood", "exits", "imagePrompt"],
    },
    item: {
      type: "object",
      properties: { playerName: { type: "string" }, item: { type: "string" } },
      required: ["playerName", "item"],
    },
    suggestedActions: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["move", "suggestedActions"],
} as const;

// ---------- Roll results ----------

export const RollResultSchema = z.object({
  playerName: z.string(),
  skill: SkillSchema,
  dc: z.number().int(),
  die: z.number().int().min(1).max(20),
  modifier: z.number().int(),
  total: z.number().int(),
  success: z.boolean(),
  critical: z.enum(["none", "success", "failure"]),
});
export type RollResult = z.infer<typeof RollResultSchema>;

// ---------- Wire protocol ----------

/** Client -> server */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    playerName: z.string().min(1).max(30),
    characterId: z.string(),
    sex: SexSchema.default("male"),
    age: AgeSchema.default("adult"),
    bio: z.string().max(300).default(""),
    portraitUrl: z.string().max(300).nullable().default(null),
    /** Optional for reconnect compatibility with identities saved before the guided builder. */
    abilities: AbilityScoresSchema.optional(),
    proficientSkills: z.array(SkillSchema).max(4).optional(),
  }),
  z.object({ type: z.literal("action"), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal("roll") }), // respond to a pending roll request
  z.object({ type: z.literal("new_campaign"), premise: z.string().max(300).optional() }),
  z.object({ type: z.literal("set_voice"), voice: SexSchema }),
  z.object({ type: z.literal("save_slot"), name: z.string().min(1).max(40) }),
  z.object({ type: z.literal("load_slot"), id: z.number().int() }),
  z.object({ type: z.literal("delete_slot"), id: z.number().int() }),
  z.object({ type: z.literal("new_game") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** POST /portrait request body (custom avatar generation) */
export const PortraitRequestSchema = z.object({
  sex: SexSchema,
  age: AgeSchema,
  className: z.enum(["Fighter", "Rogue", "Cleric", "Wizard"]),
  description: z.string().max(200).default(""),
});
export type PortraitRequest = z.infer<typeof PortraitRequestSchema>;

/** Server -> client (broadcast) */
export type ServerMessage =
  | { type: "state"; state: PublicState }
  | { type: "narration_start"; speaker: "dm" }
  | { type: "narration_chunk"; text: string }
  | { type: "narration_end" }
  | { type: "audio"; url: string; seq: number }
  | { type: "audio_stop" }
  | { type: "roll_request"; check: CheckRequest }
  | { type: "roll_result"; result: RollResult }
  | { type: "scene_image"; url: string }
  | { type: "error"; message: string };

export interface LogEntry {
  who: string; // "dm" | player name
  text: string;
}

export interface SaveMeta {
  id: number;
  name: string;
  savedAt: string;
}

export interface PublicState {
  campaignName: string;
  scene: Scene;
  party: Character[];
  log: LogEntry[];
  suggestedActions: string[];
  pendingCheck: CheckRequest | null;
  dmBusy: boolean;
  narratorVoice: Sex;
  saves: SaveMeta[];
}
