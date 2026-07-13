// End-to-end smoke test: connects as a player, starts a campaign, takes an action,
// answers a roll request if one comes, and reports every latency that matters.
// Prereqs: ollama running, ComfyUI on :8188, TTS sidecar on :7861, game server on :7777.
// Run: node spikes/e2e-smoke.mjs
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:7777/ws");
const t = () => performance.now();
let phase = "connect";
let phaseStart = t();
let narrationStart = null;
let firstChunk = null;
let firstAudio = null;
let sceneImage = null;
let audioCount = 0;
let done = false;

function mark(name) {
  console.log(`[${((t() - phaseStart) / 1000).toFixed(2)}s] ${name}`);
}

const timeout = setTimeout(() => { console.error("TIMEOUT in phase: " + phase); process.exit(1); }, 180000);

ws.on("open", () => {
  mark("connected; joining as Smokey the Rogue");
  ws.send(JSON.stringify({ type: "join", playerName: "Smokey", characterId: "rogue" }));
});

let joined = false;
let acted = false;
let rolled = false;

ws.on("message", async data => {
  const msg = JSON.parse(data.toString());
  switch (msg.type) {
    case "state": {
      if (!joined && msg.state.party.some(c => c.name === "Smokey")) {
        joined = true;
        mark("joined; starting new campaign");
        phase = "opening"; phaseStart = t(); narrationStart = null; firstChunk = null; firstAudio = null;
        ws.send(JSON.stringify({ type: "new_campaign", premise: "a mystery in a rainy port town" }));
      } else if (joined && !acted && !msg.state.dmBusy && msg.state.scene.kind !== "fireside" && phase === "opening") {
        acted = true;
        console.log(`\n  scene: "${msg.state.scene.name}" (${msg.state.scene.kind}, ${msg.state.scene.mood})`);
        console.log(`  suggested: ${msg.state.suggestedActions.join(" | ") || "(none)"}`);
        mark("opening complete; sending player action");
        phase = "action"; phaseStart = t(); narrationStart = null; firstChunk = null; firstAudio = null;
        ws.send(JSON.stringify({ type: "action", text: "I duck into the nearest alley and look for anything suspicious." }));
      } else if (phase === "action" && acted && !msg.state.dmBusy && !msg.state.pendingCheck && narrationStart !== null && !done) {
        done = true;
        mark("action turn complete");
        finish(msg.state);
      }
      break;
    }
    case "narration_start": narrationStart = t(); break;
    case "narration_chunk":
      if (firstChunk === null && narrationStart !== null) {
        firstChunk = t();
        mark(`first narration text (+${((firstChunk - narrationStart) / 1000).toFixed(2)}s after gen start)`);
      }
      break;
    case "narration_end": mark("narration finished"); break;
    case "audio":
      audioCount++;
      if (firstAudio === null) { firstAudio = t(); mark(`FIRST AUDIO ready: ${msg.url}`); }
      break;
    case "scene_image":
      sceneImage = msg.url;
      mark(`scene image ready: ${msg.url}`);
      break;
    case "roll_request": {
      mark(`roll requested: ${msg.check.skill} DC ${msg.check.dc} (${msg.check.reason})`);
      if (!rolled) { rolled = true; setTimeout(() => ws.send(JSON.stringify({ type: "roll" })), 500); }
      break;
    }
    case "roll_result":
      mark(`rolled: d20=${msg.result.die}+${msg.result.modifier}=${msg.result.total} vs DC ${msg.result.dc} -> ${msg.result.success ? "SUCCESS" : "FAIL"}`);
      break;
    case "error": console.log(`  (server said: ${msg.message})`); break;
  }
});

function finish(state) {
  clearTimeout(timeout);
  console.log("\n=== SMOKE TEST SUMMARY ===");
  console.log(`audio sentences delivered: ${audioCount}`);
  console.log(`scene image: ${sceneImage ?? "NOT GENERATED"}`);
  console.log(`log entries: ${state.log.length}`);
  console.log(`party: ${state.party.map(c => `${c.name} (${c.hp}/${c.maxHp})`).join(", ")}`);
  const ok = audioCount > 0 && state.log.length >= 3;
  console.log(ok ? "\nSMOKE TEST PASSED" : "\nSMOKE TEST INCOMPLETE");
  process.exit(ok ? 0 : 1);
}
