// Phase 0 spike: DM-brain latency benchmark against local Ollama.
// Measures: time-to-first-token (TTFT), generation speed (tok/s), and
// schema-constrained tool-call latency + validity.
// Run: node spikes/llm-bench.mjs [model ...]

const OLLAMA = "http://localhost:11434";
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["llama3.1:8b"];

const SYSTEM = `You are the Dungeon Master for a Dungeons & Dragons 5e (SRD) campaign played by 1-6 players.
You narrate vividly but concisely (2-5 sentences per beat), in second person, present tense.
You NEVER perform game math, never roll dice, never decide damage numbers yourself - the game
engine does that. You respect the campaign state JSON exactly: never contradict established
facts, inventory, HP, or NPC attitudes. Keep every player involved; if one player has acted
several times in a row, turn the spotlight to another. Match the tone settings. When a player
attempts something with uncertain outcome, you will request an ability check from the engine
rather than deciding success yourself. Stay in the fantasy world; never mention being an AI.`;

const STATE = {
  location: { name: "The Gilded Griffin", kind: "tavern", time: "night", weather: "rain", exits: ["market square", "upstairs rooms", "back alley"] },
  party: [
    { name: "Kira", class: "Rogue", level: 3, hp: "21/24", notable: ["thieves' tools", "hooded lantern"] },
    { name: "Bram", class: "Cleric", level: 3, hp: "27/27", notable: ["mace", "holy symbol of Pelor"] },
  ],
  npcsPresent: [
    { name: "Marla", role: "barkeep", attitude: "friendly" },
    { name: "the hooded stranger", role: "unknown", attitude: "wary", secret: "he is a deserter carrying a stolen ledger" },
  ],
  activeQuests: [{ title: "Find who is poisoning the town well", status: "investigating" }],
  worldFlags: ["town guard is on edge", "festival of lanterns in 2 days"],
  mood: "mystery",
};

const HISTORY = [
  { role: "user", content: "Kira: I scan the room for anyone acting suspicious." },
  { role: "assistant", content: "Rain hammers the shutters of the Gilded Griffin. Most patrons huddle over their cups - but the hooded figure in the corner booth hasn't touched his drink since you arrived, and his eyes keep flicking to the door." },
];

const ACTION = "Kira: I walk over, sit down across from the stranger, and quietly say: 'You look like a man who's waiting for trouble. Maybe I can be the better kind.'";

function buildMessages() {
  return [
    { role: "system", content: SYSTEM + "\n\nCAMPAIGN STATE (authoritative):\n" + JSON.stringify(STATE, null, 1) },
    ...HISTORY,
    { role: "user", content: ACTION },
  ];
}

async function streamBench(model) {
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model, messages: buildMessages(), stream: true, options: { num_ctx: 8192, temperature: 0.8 } }),
  });
  let ttft = null, text = "", evalCount = 0, evalNs = 0, promptNs = 0, promptCount = 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.message?.content && ttft === null) ttft = performance.now() - t0;
      text += j.message?.content ?? "";
      if (j.done) { evalCount = j.eval_count; evalNs = j.eval_duration; promptCount = j.prompt_eval_count; promptNs = j.prompt_eval_duration; }
    }
  }
  const total = performance.now() - t0;
  return { ttft, total, tokPerSec: evalCount / (evalNs / 1e9), promptTokPerSec: promptCount / (promptNs / 1e9), promptCount, evalCount, text };
}

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    move: { type: "string", enum: ["narrate", "request_check", "start_combat", "give_item", "move_party", "npc_dialogue"] },
    check: {
      type: "object",
      properties: {
        player: { type: "string" },
        skill: { type: "string", enum: ["Athletics","Acrobatics","Stealth","Sleight of Hand","Arcana","History","Investigation","Nature","Religion","Animal Handling","Insight","Medicine","Perception","Survival","Deception","Intimidation","Performance","Persuasion"] },
        dc: { type: "integer", minimum: 5, maximum: 30 },
        hidden: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["player", "skill", "dc", "hidden", "reason"],
    },
    mood: { type: "string", enum: ["tavern","travel","forest","dungeon","tension","combat","boss","sorrow","victory","mystery","town","night"] },
  },
  required: ["move"],
};

async function toolCallBench(model) {
  const messages = buildMessages();
  messages.push({
    role: "user",
    content: "ENGINE: Decide the DM move for the last player action. If the outcome is uncertain, request the appropriate ability check with a fair SRD DC. Respond ONLY with the JSON move object.",
  });
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model, messages, stream: false, format: TOOL_SCHEMA, options: { num_ctx: 8192, temperature: 0.2 } }),
  });
  const j = await res.json();
  const ms = performance.now() - t0;
  let parsed = null, valid = false;
  try {
    parsed = JSON.parse(j.message.content);
    valid = typeof parsed.move === "string";
  } catch { /* invalid */ }
  return { ms, valid, parsed };
}

for (const model of models) {
  console.log(`\n=== ${model} ===`);
  // warm-up (loads model into VRAM; not counted)
  process.stdout.write("warm-up load... ");
  const w0 = performance.now();
  await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], stream: false, options: { num_ctx: 8192 } }) });
  console.log(`${((performance.now() - w0) / 1000).toFixed(1)}s`);

  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await streamBench(model));
  const avg = (k) => runs.reduce((s, r) => s + r[k], 0) / runs.length;
  console.log(`narration  TTFT: ${runs.map(r => (r.ttft/1000).toFixed(2)).join(" / ")} s   (prompt ~${runs[0].promptCount} tok)`);
  console.log(`narration  speed: ${avg("tokPerSec").toFixed(1)} tok/s   total ${ (avg("total")/1000).toFixed(1)}s for ~${Math.round(avg("evalCount"))} tok`);
  console.log(`sample: ${runs[0].text.slice(0, 220).replace(/\s+/g, " ")}...`);

  const tools = [];
  for (let i = 0; i < 3; i++) tools.push(await toolCallBench(model));
  console.log(`tool-call  latency: ${tools.map(t => (t.ms/1000).toFixed(2)).join(" / ")} s   valid: ${tools.filter(t => t.valid).length}/3`);
  console.log(`tool-call  sample: ${JSON.stringify(tools[0].parsed)}`);
}

// VRAM snapshot at the end
try {
  const { execSync } = await import("node:child_process");
  console.log("\nVRAM: " + execSync("nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader").toString().trim());
} catch {}
