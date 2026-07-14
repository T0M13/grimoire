import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ArtStyle, NpcSpeaker, Scene } from "@grimoire/shared";
import { AUDIO_DIR, CONFIG, IMG_DIR } from "./config.js";

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ---------- Scene art (ComfyUI, fully async, cached by scene signature) ----------

export function sceneSignature(
  s: Pick<Scene, "name" | "kind" | "timeOfDay" | "weather" | "mood" | "imagePrompt">,
  artStyle: ArtStyle = "painting",
): string {
  // must stay a valid Windows filename: lowercase alnum and dashes only
  const slug = [s.name, s.kind, s.timeOfDay, s.weather, s.mood]
    .map(part => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32))
    .join("--");
  // "v3" = all living subjects are separate portraits, including creatures.
  const composition = crypto.createHash("sha256").update(`v3|${s.imagePrompt}|${artStyle}`).digest("hex").slice(0, 10);
  return `${slug}--${artStyle}--${composition}`;
}

const LIVING_SUBJECT_CLAUSE = /\b(?:people|person|human|figure|silhouette|crowd|character|npc|innkeeper|bartender|guard|merchant|villager|warrior|mage|wizard|woman|women|man|men|child|children|creature|monster|animal|beast|dragon|goblin|orc|elf|dwarf)\b/i;

/**
 * Old saves may contain positive prompts that explicitly request figures. Strip those clauses and
 * reinforce the current policy before ComfyUI sees them; portraits carry every living subject.
 */
export function environmentScenePrompt(
  scene: Pick<Scene, "name" | "kind" | "timeOfDay" | "weather" | "imagePrompt">,
): string {
  const safeClauses = scene.imagePrompt
    .split(/[,;]+/)
    .map(clause => clause.trim())
    .filter(clause => clause.length > 0 && !LIVING_SUBJECT_CLAUSE.test(clause));
  const evidence = safeClauses.join(", ") || `${scene.kind} architecture, terrain, and signs of recent activity`;
  return `unoccupied environment-only establishing view of ${scene.name}, ${evidence}, ${scene.timeOfDay}, ${scene.weather} weather, ` +
    "coherent architecture, terrain, objects, and physical story evidence, quiet empty setting";
}

// Quality scene art: generation is fully async and never blocks the story, so we can afford
// the same proper sampler as portraits (~4 s) instead of the 6-step LCM draft that made
// people and creatures come out washed-out or glitchy.
function sceneWorkflow(scene: Scene, seed: number, artStyle: ArtStyle) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CONFIG.checkpoint } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: `${environmentScenePrompt(scene)}, ${CONFIG.sceneStyles[artStyle]}` } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: CONFIG.imageNegative } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 896, height: 512, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed, steps: 24, cfg: 6.0, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire" } },
  };
}

/**
 * Returns a cached image immediately if we've painted this kind of scene before;
 * otherwise generates in the background and resolves with the URL when done.
 * NEVER await this in the narration path — subscribe to the promise instead.
 */
export function getSceneImage(scene: Scene, artStyle: ArtStyle = "painting"): { cached: string | null; pending: Promise<string> | null } {
  const sig = sceneSignature(scene, artStyle);
  const file = path.join(IMG_DIR, `${sig}.png`);
  if (fs.existsSync(file)) return { cached: `/assets/img/${sig}.png`, pending: null };
  return { cached: null, pending: generateSceneImage(scene, sig, file, artStyle) };
}

async function generateSceneImage(scene: Scene, sig: string, file: string, artStyle: ArtStyle): Promise<string> {
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  const res = await fetch(`${CONFIG.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: sceneWorkflow(scene, seed, artStyle) }),
  });
  const { prompt_id, error } = (await res.json()) as { prompt_id?: string; error?: unknown };
  if (error || !prompt_id) throw new Error(`comfyui rejected workflow: ${JSON.stringify(error)}`);

  // poll history until the job completes
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 250));
    const h = (await (await fetch(`${CONFIG.comfyUrl}/history/${prompt_id}`)).json()) as Record<string, any>;
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("comfyui generation failed");
    if (entry.status?.completed) {
      const images = entry.outputs?.["8"]?.images as { filename: string; subfolder: string; type: string }[];
      const img = images?.[0];
      if (!img) throw new Error("comfyui returned no image");
      const bytes = await (await fetch(
        `${CONFIG.comfyUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`,
      )).arrayBuffer();
      fs.writeFileSync(file, Buffer.from(bytes));
      return `/assets/img/${sig}.png`;
    }
  }
  throw new Error("comfyui generation timed out");
}

// ---------- Custom avatar portraits (quality workflow, on demand at character creation) ----------

const AGE_WORDS = {
  young: "young adult, youthful smooth face",
  adult: "adult in their thirties",
  elder: "wise elder with weathered features",
} as const;

const CLASS_LOOK = {
  Barbarian: "barbarian in rugged hide armor with a heavy fur mantle",
  Bard: "bard in practical travel clothes carrying a well-worn instrument",
  Fighter: "fighter wearing a steel breastplate",
  Rogue: "rogue in a dark hooded cloak",
  Cleric: "cleric in chainmail under white-and-gold vestments",
  Druid: "druid in weathered leather and layered natural fabrics",
  Monk: "monk in simple travel robes with wrapped forearms",
  Paladin: "paladin in polished mail with a plain heraldic mantle",
  Ranger: "ranger in a forest-green cloak over practical leather armor",
  Sorcerer: "sorcerer in elegant travel clothes touched by subtle arcane light",
  Warlock: "warlock in dark layered robes bearing a small occult talisman",
  Wizard: "wizard in deep blue robes with faint embroidered stars",
} as const;

const PORTRAIT_STYLE =
  "head and shoulders portrait, stylized storybook fantasy illustration, hand-painted, gently exaggerated " +
  "features, painterly brushstrokes, muted earthy palette, soft rim light, dark atmospheric background, " +
  "detailed symmetrical face, clear focused eyes, concept art";

const PORTRAIT_NEG =
  "cross-eyed, misaligned eyes, lazy eye, asymmetric eyes, deformed face, bad anatomy, extra fingers, " +
  "photo, photorealistic, 3d render, plastic skin, oversaturated, text, watermark, signature, logo, " +
  "frame, border, blurry, nsfw, revealing clothing";

export interface PortraitRequestInput {
  sex: "male" | "female";
  age: keyof typeof AGE_WORDS;
  className: keyof typeof CLASS_LOOK;
  description: string;
}

/** Generate a one-off custom avatar. ~4 s on the 4070; only used at character creation. */
export async function generatePortrait(req: PortraitRequestInput): Promise<string> {
  const desc = req.description.replace(/[\r\n]+/g, ", ").slice(0, 200).trim();
  const ageNeg = req.age === "young" ? "old, elderly, wrinkles, gray hair, " : "";
  const prompt =
    `${AGE_WORDS[req.age]} ${req.sex} ${CLASS_LOOK[req.className]}` +
    (desc ? `, ${desc}` : "") +
    `, ${PORTRAIT_STYLE}`;
  const seed = crypto.randomBytes(4).readUInt32LE(0);

  const wf = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CONFIG.checkpoint } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: ageNeg + PORTRAIT_NEG } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 768, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed, steps: 30, cfg: 6.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire_avatar" } },
  };

  const res = await fetch(`${CONFIG.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
  });
  const { prompt_id, error } = (await res.json()) as { prompt_id?: string; error?: unknown };
  if (error || !prompt_id) throw new Error(`comfyui rejected portrait: ${JSON.stringify(error)}`);

  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 250));
    const h = (await (await fetch(`${CONFIG.comfyUrl}/history/${prompt_id}`)).json()) as Record<string, any>;
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("portrait generation failed");
    if (entry.status?.completed) {
      const img = entry.outputs?.["8"]?.images?.[0] as { filename: string; subfolder: string; type: string };
      if (!img) throw new Error("comfyui returned no portrait");
      const bytes = await (await fetch(
        `${CONFIG.comfyUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`,
      )).arrayBuffer();
      const name = `avatar-${crypto.randomBytes(6).toString("hex")}.png`;
      fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(bytes));
      return `/assets/img/${name}`;
    }
  }
  throw new Error("portrait generation timed out");
}

// ---------- NPC/creature portraits (large subjects render well; scenes stay subject-free) ----------

const NPC_PORTRAIT_STYLES: Record<ArtStyle, string> = {
  painting:
    "head and shoulders portrait, classical oil painting, visible brushstrokes, dramatic soft lighting, " +
    "rich muted palette, clearly painted skin and canvas texture, detailed symmetrical face, clear focused eyes, dark atmospheric background",
  sketch:
    "head and shoulders portrait, aged hand-drawn ink illustration on weathered parchment, fine crosshatching, " +
    "sepia tones, subtle watercolor wash, detailed symmetrical face, clear focused eyes, storybook plate from an ancient tome",
  cinematic:
    "head and shoulders portrait, stylized storybook fantasy illustration, hand-painted, painterly brushstrokes, " +
    "muted earthy palette, soft rim light, dark atmospheric background, detailed symmetrical face, clear focused eyes",
};

const CREATURE_PORTRAIT_STYLES: Record<ArtStyle, string> = {
  painting:
    "single non-humanoid bestiary subject, animalistic head and upper body portrait, classical oil painting, " +
    "visible brushstrokes, coherent creature anatomy, clear focused eyes, dark forest background, old-master fantasy bestiary plate",
  sketch:
    "single non-humanoid bestiary subject, animalistic head and upper body, aged ink illustration on parchment, " +
    "fine crosshatching, coherent creature anatomy, clear focused eyes, antique fantasy bestiary plate",
  cinematic:
    "single non-humanoid bestiary subject, animalistic head and upper body portrait, stylized hand-painted fantasy concept art, " +
    "coherent creature anatomy, clear focused eyes, dramatic rim light, dark atmospheric background",
};

const CREATURE_PORTRAIT_NEG =
  "human, humanoid, person, woman, man, girl, boy, elf, faun, satyr, human face, human skin, " +
  "human hair, human clothing, jewelry, pretty woman, antlered woman, ";

const npcPortraitJobs = new Map<string, Promise<string>>();

export function npcPortraitSignature(npc: NpcSpeaker, artStyle: ArtStyle): string {
  const slug = npc.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "entity";
  const visual = crypto.createHash("sha256")
    .update(`v2|${npc.name}|${npc.sex}|${npc.entityType}|${npc.appearance}|${npc.personality}|${artStyle}`)
    .digest("hex")
    .slice(0, 12);
  return `npc-${slug}--${artStyle}--${visual}`;
}

/** Return immediately from cache or share one background ComfyUI job for this exact look/style. */
export function getNpcPortrait(
  npc: NpcSpeaker,
  artStyle: ArtStyle,
): { cached: string | null; pending: Promise<string> | null } {
  const signature = npcPortraitSignature(npc, artStyle);
  const file = path.join(IMG_DIR, `${signature}.png`);
  if (fs.existsSync(file)) return { cached: `/assets/img/${signature}.png`, pending: null };
  const existing = npcPortraitJobs.get(signature);
  if (existing) return { cached: null, pending: existing };
  const pending = generateNpcPortrait(npc, artStyle, signature, file)
    .finally(() => npcPortraitJobs.delete(signature));
  npcPortraitJobs.set(signature, pending);
  return { cached: null, pending };
}

/**
 * Paint one named subject. The caller owns persistence/broadcast and must never await this on the
 * narration path.
 */
async function generateNpcPortrait(
  npc: NpcSpeaker,
  artStyle: ArtStyle,
  signature: string,
  file: string,
): Promise<string> {
  const subject = npc.entityType === "creature"
    ? `animalistic fantasy guardian, ${npc.appearance}, species-defining features fully visible`
    : `${npc.sex} person, ${npc.appearance}`;
  const stylePrompt = npc.entityType === "creature" ? CREATURE_PORTRAIT_STYLES[artStyle] : NPC_PORTRAIT_STYLES[artStyle];
  const negativePrompt = (npc.entityType === "creature" ? CREATURE_PORTRAIT_NEG : "") + PORTRAIT_NEG;
  const prompt = `${subject}, ${npc.personality} expression and posture, one subject only, ${stylePrompt}`;
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  const wf = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CONFIG.checkpoint } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed, steps: 28, cfg: 6.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire_npc" } },
  };

  const res = await fetch(`${CONFIG.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
    signal: AbortSignal.timeout(10_000),
  });
  const { prompt_id, error } = (await res.json()) as { prompt_id?: string; error?: unknown };
  if (error || !prompt_id) throw new Error(`comfyui rejected npc portrait: ${JSON.stringify(error)}`);

  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 250));
    const h = (await (await fetch(`${CONFIG.comfyUrl}/history/${prompt_id}`, {
      signal: AbortSignal.timeout(5_000),
    })).json()) as Record<string, any>;
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("npc portrait generation failed");
    if (entry.status?.completed) {
      const img = entry.outputs?.["8"]?.images?.[0] as { filename: string; subfolder: string; type: string };
      if (!img) throw new Error("comfyui returned no npc portrait");
      const bytes = await (await fetch(
        `${CONFIG.comfyUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`,
        { signal: AbortSignal.timeout(15_000) },
      )).arrayBuffer();
      fs.writeFileSync(file, Buffer.from(bytes));
      return `/assets/img/${signature}.png`;
    }
  }
  throw new Error("npc portrait generation timed out");
}

export async function comfyAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${CONFIG.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// ---------- Narrator voice (Kokoro sidecar, sentence-streamed) ----------

let ttsSeq = 0;

/** Synthesize one sentence; returns the served URL, or null if the sidecar is down (text-only mode). */
export async function synthesize(
  text: string,
  voice: "male" | "female" | string = "male",
  cancel?: AbortSignal,
  speed = 1,
): Promise<string | null> {
  const clean = text.replace(/\*[^*]*\*/g, "").trim(); // strip stage directions
  if (!clean) return null;
  const voiceId = voice === "male" || voice === "female" ? CONFIG.narratorVoices[voice] : voice;
  const speakingRate = Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1;
  try {
    const res = await fetch(`${CONFIG.ttsUrl}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: clean, voice: voiceId, speed: speakingRate }),
      signal: cancel
        ? AbortSignal.any([cancel, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const wav = Buffer.from(await res.arrayBuffer());
    const name = `n${Date.now()}_${ttsSeq++}.wav`;
    fs.writeFileSync(path.join(AUDIO_DIR, name), wav);
    return `/assets/audio/${name}`;
  } catch {
    return null; // voice is atmosphere — never break the game over it
  }
}

/**
 * Incremental sentence splitter for streamed narration.
 * Feed chunks; it emits complete sentences (first clause of the very first
 * sentence is emitted early so the narrator starts speaking sooner).
 */
export class SentenceStream {
  private buf = "";
  private emittedFirstClause = false;

  constructor(private emit: (sentence: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    // early first clause: get the narrator talking ASAP
    if (!this.emittedFirstClause) {
      const m = /^(.{15,90}?[,;:])\s/.exec(this.buf);
      if (m) {
        this.emittedFirstClause = true;
        this.emit(m[1]!);
        this.buf = this.buf.slice(m[0].length);
        return;
      }
    }
    let m: RegExpExecArray | null;
    while ((m = /[.!?]["')\]]?\s/.exec(this.buf))) {
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end);
      this.emittedFirstClause = true;
      if (sentence) this.emit(sentence);
    }
  }

  flush(): void {
    const rest = this.buf.trim();
    this.buf = "";
    if (rest) this.emit(rest);
  }
}
