import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const VAR_DIR = path.join(REPO_ROOT, "var");

/** setup.ps1/setup.sh writes the hardware-detected model tier here. */
function detectedDmModel(): string | null {
  try {
    const raw = fs.readFileSync(path.join(VAR_DIR, "host-config.json"), "utf8");
    const parsed = JSON.parse(raw) as { dmModel?: unknown };
    return typeof parsed.dmModel === "string" && parsed.dmModel.length > 0 ? parsed.dmModel : null;
  } catch {
    return null;
  }
}
export const ASSET_DIR = path.join(VAR_DIR, "assets");
export const IMG_DIR = path.join(ASSET_DIR, "img");
export const AUDIO_DIR = path.join(ASSET_DIR, "audio");
export const MUSIC_DIR = path.join(ASSET_DIR, "music");
export const DB_PATH = path.join(VAR_DIR, "grimoire.db");

export const CONFIG = {
  port: Number(process.env.GRIMOIRE_GAME_PORT ?? "8787"),
  ollamaUrl: "http://127.0.0.1:11434",
  // priority: explicit env override > hardware tier picked by setup > full-tier default
  dmModel: process.env.GRIMOIRE_DM_MODEL ?? detectedDmModel() ?? "llama3.1:8b",
  numCtx: 4096, // our prompts are ~1-2k tokens; smaller KV cache = ~0.6 GB VRAM saved
  comfyUrl: "http://127.0.0.1:8188",
  ttsUrl: `http://127.0.0.1:${process.env.GRIMOIRE_TTS_PORT ?? "8765"}`,
  // best-in-class Kokoro narrators: af_heart is the only grade-A voice;
  // bm_fable is the warm British "storyteller" voice
  narratorVoices: { male: "bm_fable", female: "af_heart" } as Record<"male" | "female", string>,
  // High-quality American-English Kokoro voices reserved for persistent NPC identities.
  npcVoices: {
    female: ["af_bella", "af_nicole", "af_kore", "af_sarah", "af_aoede"],
    male: ["am_fenrir", "am_michael", "am_puck", "am_eric", "am_onyx"],
  } as Record<"male" | "female", readonly string[]>,
  checkpoint: "DreamShaper_8_pruned.safetensors",
  lcmLora: "lcm-lora-sdv15.safetensors",
  /** Table-selectable scene-art styles. Each is locked so a campaign reads as one artist's work. */
  sceneStyles: {
    painting:
      "classical oil painting, visible expressive brushstrokes, dramatic chiaroscuro lighting, rich muted palette, " +
      "atmospheric environmental storytelling, coherent architecture, unoccupied architecture-and-landscape composition, " +
      "wide composition, old-master fantasy artwork, canvas texture",
    sketch:
      "aged hand-drawn ink illustration on weathered parchment, fine crosshatching and expressive linework, " +
      "sepia and faded earth tones, subtle watercolor wash accents, storybook plate from an ancient tome, " +
      "atmospheric environmental storytelling, unoccupied architecture-and-landscape composition, wide composition",
    cinematic:
      "cinematic storybook fantasy illustration, painterly environmental storytelling, coherent architecture, " +
      "clear indoor or outdoor spatial context, wide cinematic composition, unoccupied architecture-and-landscape composition, " +
      "dramatic motivated lighting, consistent muted color palette, detailed concept art",
  } as Record<"painting" | "sketch" | "cinematic", string>,
  // Scenes contain no living subjects by design: SD1.5 renders small faces/anatomy badly, so
  // environments carry the story and named people/creatures get dedicated close-up portraits.
  imageNegative:
    "people, person, human, figure, silhouette, face, portrait, crowd, character, hands, " +
    "animal, creature, monster, beast, dragon, bird, horse, dog, cat, living subject, " +
    "photo, photorealistic, modern, empty generic landscape, unrelated scenery, character lineup, " +
    "text, letters, sign, caption, watermark, signature, low quality, blurry, " +
    "deformed, bad anatomy, washed out, faded colors, hazy, overexposed",
};
