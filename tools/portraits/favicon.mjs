// Regenerate just the app icon: a book EMBLEM, no people.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMFY = "http://127.0.0.1:8188";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "..", "packages", "client", "public", "favicon.png");

const wf = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "DreamShaper_8_pruned.safetensors" } },
  "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text:
    "fantasy game app icon, single closed ancient leather grimoire book, glowing amber arcane rune emblem on the cover, brass corner fittings, centered, symmetrical, front view, dark charcoal background, dramatic warm glow, emblem logo style, clean composition" } },
  "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text:
    "person, human, face, woman, man, character, hands, open book, text, letters, words, watermark, photo, blurry, cluttered" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
  "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed: 77042, steps: 30, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
  "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
  "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire_icon" } },
};

const { prompt_id, error } = await (await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: wf }) })).json();
if (error) throw new Error(JSON.stringify(error));
for (let i = 0; i < 240; i++) {
  await new Promise(r => setTimeout(r, 250));
  const h = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
  if (h[prompt_id]?.status?.completed) {
    const img = h[prompt_id].outputs["8"].images[0];
    const bytes = await (await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer();
    fs.writeFileSync(OUT, Buffer.from(bytes));
    console.log("favicon.png regenerated");
    process.exit(0);
  }
}
throw new Error("timed out");
