// Head-to-head DM-model shootout: TTFT, tok/s, constrained-JSON validity, and a
// narration sample per model. qwen3 runs with thinking disabled (a thinking DM is a slow DM).
// Run: node spikes/model-shootout.mjs qwen3:8b llama3.1:8b llama3.2:3b
const OLLAMA = "http://127.0.0.1:11434";
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["qwen3:8b", "llama3.1:8b", "llama3.2:3b"];

const SYSTEM = `You are the Dungeon Master of a D&D 5e (SRD) campaign. Narrate in second person,
present tense. CONCISE: 1-3 sentences per beat. Never do game math. End beats on something to react to.`;
const STATE = `CAMPAIGN STATE: {"scene":{"name":"Rainy Dockside Alley","kind":"alley","mood":"tension","exits":["warehouse","tavern"]},"party":[{"name":"Kira","class":"Rogue","level":3,"hp":"21/24"}]}`;
const ACTION = "Kira: I try to pick the warehouse lock before the patrol comes back.";

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    move: { type: "string", enum: ["narrate", "request_check", "change_scene", "give_item"] },
    check: {
      type: "object",
      properties: {
        playerName: { type: "string" },
        skill: { type: "string", enum: ["Stealth", "Sleight of Hand", "Perception", "Athletics", "Investigation"] },
        difficulty: { type: "string", enum: ["very easy", "easy", "moderate", "hard", "very hard", "nearly impossible"] },
        reason: { type: "string" },
      },
      required: ["playerName", "skill", "difficulty", "reason"],
    },
    suggestedActions: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["move", "suggestedActions"],
};

function body(model, extra) {
  const b = { model, keep_alive: "5m", options: { num_ctx: 4096, temperature: 0.8 }, ...extra };
  if (model.startsWith("qwen3")) b.think = false;
  return JSON.stringify(b);
}

async function bench(model) {
  console.log(`\n=== ${model} ===`);
  // warm-up load
  const w0 = performance.now();
  await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: body(model, { messages: [{ role: "user", content: "hi" }], stream: false }) });
  console.log(`load: ${((performance.now() - w0) / 1000).toFixed(1)}s`);

  // streamed narration x2
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      body: body(model, {
        messages: [
          { role: "system", content: `${SYSTEM}\n${STATE}` },
          { role: "user", content: `${ACTION}\nENGINE RESULT: Kira rolled Sleight of Hand 17 vs DC 13 -> SUCCESS.\nNarrate the outcome (1-3 sentences).` },
        ],
        stream: true,
      }),
    });
    let ttft = null, text = "", evalCount = 0, evalNs = 1;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.message?.content && ttft === null) ttft = performance.now() - t0;
        text += j.message?.content ?? "";
        if (j.done) { evalCount = j.eval_count; evalNs = j.eval_duration; }
      }
    }
    console.log(`narration ${i + 1}: TTFT ${(ttft / 1000).toFixed(2)}s, ${(evalCount / (evalNs / 1e9)).toFixed(1)} tok/s`);
    if (i === 0) console.log(`  sample: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  // constrained tool-call x3
  let valid = 0, checks = 0, ms = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      body: body(model, {
        messages: [
          { role: "system", content: `${SYSTEM}\n${STATE}` },
          { role: "user", content: `${ACTION}\nENGINE: choose the DM move as JSON only.` },
        ],
        stream: false, format: TOOL_SCHEMA,
      }),
    });
    const j = await res.json();
    ms += performance.now() - t0;
    try {
      const p = JSON.parse(j.message.content);
      if (typeof p.move === "string") valid++;
      if (p.move === "request_check") checks++;
    } catch { /* invalid */ }
  }
  console.log(`tool-calls: ${valid}/3 valid, ${checks}/3 chose request_check, avg ${(ms / 3000).toFixed(2)}s`);
}

for (const m of models) await bench(m);
