import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const VAR_DIR = path.join(REPO_ROOT, "var");
export const ASSET_DIR = path.join(VAR_DIR, "assets");
export const IMG_DIR = path.join(ASSET_DIR, "img");
export const AUDIO_DIR = path.join(ASSET_DIR, "audio");
export const MUSIC_DIR = path.join(ASSET_DIR, "music");
export const DB_PATH = path.join(VAR_DIR, "grimoire.db");

export const CONFIG = {
  port: Number(process.env.GRIMOIRE_GAME_PORT ?? "8787"),
  ollamaUrl: "http://127.0.0.1:11434",
  dmModel: "llama3.1:8b",
  numCtx: 4096, // our prompts are ~1-2k tokens; smaller KV cache = ~0.6 GB VRAM saved
  comfyUrl: "http://127.0.0.1:8188",
  ttsUrl: `http://127.0.0.1:${process.env.GRIMOIRE_TTS_PORT ?? "8765"}`,
  // best-in-class Kokoro narrators: af_heart is the only grade-A voice;
  // bm_fable is the warm British "storyteller" voice
  narratorVoices: { male: "bm_fable", female: "af_heart" } as Record<"male" | "female", string>,
  checkpoint: "DreamShaper_8_pruned.safetensors",
  lcmLora: "lcm-lora-sdv15.safetensors",
  /** Locked style so every scene reads as one artist's work. */
  imageStyle:
    "cinematic, painterly, atmospheric, detailed digital painting, dramatic lighting, fantasy concept art",
  imageNegative:
    "photo, photorealistic, modern, text, letters, watermark, signature, low quality, blurry, deformed",
};
