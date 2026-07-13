// One-shot generator: class portraits + app icon via ComfyUI (quality workflow, no LCM).
// Output goes to packages/client/public/ (static assets, shipped with the client).
// Run: node tools/portraits/generate.mjs   (ComfyUI must be up on :8188)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMFY = "http://127.0.0.1:8188";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "..", "packages", "client", "public");
fs.mkdirSync(path.join(OUT, "portraits"), { recursive: true });

const STYLE =
  "painterly fantasy character portrait, oil painting style, muted earthy palette, soft rim light, " +
  "dark atmospheric background, detailed face, concept art, artstation quality";
const NEG =
  "photo, photorealistic, 3d render, plastic skin, oversaturated, text, watermark, signature, " +
  "logo, frame, border, blurry, deformed, extra fingers, bad anatomy, nsfw, revealing clothing, cleavage";

const P = (file, seed, prompt) => ({ file: `portraits/${file}.png`, w: 512, h: 768, seed, prompt });

const JOBS = [
  P("fighter-male", 1101,
    "battle-worn human male fighter, short dark hair and stubble, dented steel breastplate, sword hilt over shoulder, calm determined expression, faint scar on brow"),
  P("fighter-female", 1108,
    "battle-worn human female fighter, auburn hair tied back, dented steel breastplate with leather straps, sword hilt over shoulder, fierce determined gaze, small scar on cheek"),
  P("rogue-male", 2207,
    "male half-elf rogue in a dark hooded cloak, sharp jawline, sly half-smile, dagger at the collarbone, shadowed eyes catching lantern light"),
  P("rogue-female", 2202,
    "young female half-elf rogue in a dark hooded cloak, sly half-smile, dagger at the collarbone, shadowed eyes catching lantern light"),
  P("cleric-male", 3303,
    "kind middle-aged human male cleric with a short beard, chainmail under white-and-gold vestments, holy sun amulet glowing faintly, serene confident gaze, warm candlelight"),
  P("cleric-female", 3309,
    "kind human female cleric with braided hair, chainmail under white-and-gold vestments, holy sun amulet glowing faintly, serene confident gaze, warm candlelight"),
  P("wizard-male", 4404,
    "elderly male wizard with silver beard and keen eyes, deep blue robes with faint embroidered stars, holding an ancient tome, motes of arcane light"),
  P("wizard-female", 4411,
    "wise elderly female wizard with long silver hair in a loose braid, keen bright eyes, deep blue robes with faint embroidered stars, holding an ancient tome, motes of arcane light"),
];

function workflow({ prompt, w, h, seed }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "DreamShaper_8_pruned.safetensors" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: `${prompt}, ${STYLE}` } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEG } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed, steps: 30, cfg: 6.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire_portrait" } },
  };
}

async function generate(job) {
  const t0 = performance.now();
  const res = await fetch(`${COMFY}/prompt`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow(job) }),
  });
  const { prompt_id, error } = await res.json();
  if (error || !prompt_id) throw new Error(`rejected: ${JSON.stringify(error)}`);
  for (let i = 0; i < 480; i++) {
    await new Promise(r => setTimeout(r, 250));
    const h = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
    const entry = h[prompt_id];
    if (entry?.status?.status_str === "error") throw new Error("generation failed");
    if (entry?.status?.completed) {
      const img = entry.outputs?.["8"]?.images?.[0];
      const bytes = await (await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer();
      fs.writeFileSync(path.join(OUT, job.file), Buffer.from(bytes));
      console.log(`${job.file}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      return;
    }
  }
  throw new Error("timed out");
}

for (const job of JOBS) await generate(job);
console.log(`\nall assets written to ${OUT}`);
