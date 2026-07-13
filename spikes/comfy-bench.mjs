// Phase 0 spike: scene art generation (SD1.5 DreamShaper 8 + LCM-LoRA via ComfyUI API)
// WHILE the 8B DM model stays loaded in Ollama — validates Profile A VRAM co-residency.
// Prereq: ComfyUI running headless on :8188  (see spikes/run-comfy.ps1)
// Run: node spikes/comfy-bench.mjs

const COMFY = "http://127.0.0.1:8188";
const OLLAMA = "http://localhost:11434";

const SCENE_PROMPT =
  "fantasy tavern interior at night, rain against windows, warm candlelight, wooden beams, " +
  "hooded stranger in corner booth, cinematic, painterly, atmospheric, detailed digital painting, " +
  "artstation, moody lighting";
const NEGATIVE = "photo, photorealistic, modern, text, watermark, low quality, blurry, deformed";

function lcmWorkflow(seed) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "DreamShaper_8_pruned.safetensors" } },
    "2": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["1", 1], lora_name: "lcm-lora-sdv15.safetensors", strength_model: 1.0, strength_clip: 1.0 } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: SCENE_PROMPT } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: NEGATIVE } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 512, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["2", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed, steps: 6, cfg: 1.5, sampler_name: "lcm", scheduler: "sgm_uniform", denoise: 1.0 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "grimoire_spike" } },
  };
}

async function vram() {
  const { execSync } = await import("node:child_process");
  return execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader").toString().trim();
}

// 1) make sure the DM brain is resident (Profile A co-residency test)
console.log("loading llama3.1:8b into VRAM (keep_alive)...");
await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify({ model: "llama3.1:8b", messages: [{ role: "user", content: "ready?" }], stream: false, keep_alive: "30m", options: { num_ctx: 8192 } }) });
console.log(`VRAM with LLM loaded: ${await vram()}`);

// 2) generate images (first = cold model load, then 3 warm runs)
for (let i = 0; i < 4; i++) {
  const t0 = performance.now();
  const res = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: lcmWorkflow(1000 + i) }) });
  const { prompt_id, error } = await res.json();
  if (error) { console.error("ComfyUI rejected workflow:", JSON.stringify(error)); process.exit(1); }
  // poll history until done
  for (;;) {
    await new Promise(r => setTimeout(r, 250));
    const h = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
    if (h[prompt_id]?.status?.completed) break;
    if (h[prompt_id]?.status?.status_str === "error") { console.error("generation error", JSON.stringify(h[prompt_id].status)); process.exit(1); }
  }
  const s = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`image ${i === 0 ? "1 (cold, model load)" : i + 1}: ${s}s   VRAM: ${await vram()}`);
}

// 3) prove the LLM still responds fast with SD resident
const t0 = performance.now();
const r = await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify({ model: "llama3.1:8b", messages: [{ role: "user", content: "In one sentence: describe a rainy tavern." }], stream: false, options: { num_ctx: 8192 } }) });
const j = await r.json();
console.log(`\nLLM turnaround with SD loaded: ${((performance.now() - t0) / 1000).toFixed(2)}s (${(j.eval_count / (j.eval_duration / 1e9)).toFixed(1)} tok/s)`);
console.log(`final VRAM: ${await vram()}`);
console.log("images saved under vendor/ComfyUI/output/");
