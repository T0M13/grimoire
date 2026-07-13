// Phase 0 spike: Kokoro TTS — time-to-first-audio for sentence-streamed narration.
// Simulates the real pipeline: narration arrives sentence by sentence; we synth each
// sentence as it "arrives" and measure when the first audio would start playing.
// Run: node kokoro-bench.mjs
import { KokoroTTS } from "kokoro-js";
import fs from "node:fs";

const SENTENCES = [
  "The hooded stranger's eyes snap to yours as you slide into the booth.",
  "For a long moment, only the rain speaks, drumming its cold fingers against the shutters of the Gilded Griffin.",
  "Then he leans forward, and you catch the glint of a soldier's brand on his wrist.",
  "Trouble, he says quietly, has a way of finding men who carry other people's secrets.",
];

console.log("loading model (first run downloads ~90 MB)...");
const t0 = performance.now();
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8", // CPU-friendly; keeps all VRAM for the LLM + image gen
});
console.log(`model ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const voice = "am_michael"; // deep male narrator; en-US
let firstAudioMs = null;
let totalAudioSec = 0;
let totalSynthMs = 0;

for (let i = 0; i < SENTENCES.length; i++) {
  const s0 = performance.now();
  const audio = await tts.generate(SENTENCES[i], { voice });
  const ms = performance.now() - s0;
  const audioSec = audio.audio.length / audio.sampling_rate;
  if (firstAudioMs === null) firstAudioMs = ms;
  totalAudioSec += audioSec;
  totalSynthMs += ms;
  console.log(`sentence ${i + 1}: synth ${(ms / 1000).toFixed(2)}s -> ${audioSec.toFixed(1)}s of audio (RTF ${(ms / 1000 / audioSec).toFixed(2)})`);
  if (i === 0) await audio.save("first-sentence.wav");
}

console.log(`\nTIME TO FIRST AUDIO (after first sentence text is ready): ${(firstAudioMs / 1000).toFixed(2)}s`);
console.log(`total: ${(totalSynthMs / 1000).toFixed(1)}s synth for ${totalAudioSec.toFixed(1)}s of narration (overall RTF ${(totalSynthMs / 1000 / totalAudioSec).toFixed(2)})`);
console.log(`RTF < 1.0 means synthesis keeps ahead of playback => seamless streaming`);
console.log(fs.existsSync("first-sentence.wav") ? "sample saved: first-sentence.wav" : "");
