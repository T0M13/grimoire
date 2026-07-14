import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Scene } from "@grimoire/shared";
import { AUDIO_DIR, CONFIG, IMG_DIR } from "./config.js";

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ---------- Scene art (ComfyUI, fully async, cached by scene signature) ----------

export function sceneSignature(
  s: Pick<Scene, "name" | "kind" | "timeOfDay" | "weather" | "mood" | "imagePrompt">,
): string {
  // must stay a valid Windows filename: lowercase alnum and dashes only
  const slug = [s.name, s.kind, s.timeOfDay, s.weather, s.mood]
    .map(part => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32))
    .join("--");
  const composition = crypto.createHash("sha256").update(s.imagePrompt).digest("hex").slice(0, 10);
  return `${slug}--${composition}`;
}

// Quality scene art: generation is fully async and never blocks the story, so we can afford
// the same proper sampler as portraits (~4 s) instead of the 6-step LCM draft that made
// people and creatures come out washed-out or glitchy.
function sceneWorkflow(prompt: string, seed: number) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CONFIG.checkpoint } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: `${prompt}, ${CONFIG.imageStyle}` } },
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
export function getSceneImage(scene: Scene): { cached: string | null; pending: Promise<string> | null } {
  const sig = sceneSignature(scene);
  const file = path.join(IMG_DIR, `${sig}.png`);
  if (fs.existsSync(file)) return { cached: `/assets/img/${sig}.png`, pending: null };
  return { cached: null, pending: generateSceneImage(scene, sig, file) };
}

async function generateSceneImage(scene: Scene, sig: string, file: string): Promise<string> {
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  const res = await fetch(`${CONFIG.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: sceneWorkflow(scene.imagePrompt, seed) }),
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
): Promise<string | null> {
  const clean = text.replace(/\*[^*]*\*/g, "").trim(); // strip stage directions
  if (!clean) return null;
  const voiceId = voice === "male" || voice === "female" ? CONFIG.narratorVoices[voice] : voice;
  try {
    const res = await fetch(`${CONFIG.ttsUrl}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: clean, voice: voiceId }),
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
