// Focused test of the check/roll path: sends actions that should demand a skill check,
// rolls when asked, and verifies the result narration arrives.
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:7777/ws");
const ATTEMPTS = [
  "I try to silently pick the lock on the warehouse door before anyone notices me.",
  "I attempt to climb the drainpipe up to the second-floor window without being seen.",
  "I try to sneak past the guard while staying in the shadows.",
];
let attempt = 0;
let rolled = false;
let resultSeen = false;
let busy = false;

const timeout = setTimeout(() => { console.error(`TIMEOUT (attempt ${attempt}, rolled=${rolled})`); process.exit(1); }, 240000);

function tryNextAction() {
  if (rolled || attempt >= ATTEMPTS.length) return;
  console.log(`action ${attempt + 1}: ${ATTEMPTS[attempt]}`);
  ws.send(JSON.stringify({ type: "action", text: ATTEMPTS[attempt++] }));
}

ws.on("open", () => ws.send(JSON.stringify({ type: "join", playerName: "Smokey", characterId: "rogue" })));

ws.on("message", data => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "state") {
    const wasBusy = busy;
    busy = msg.state.dmBusy;
    if (attempt === 0 && !busy && msg.state.scene.kind !== "fireside") tryNextAction();
    else if (wasBusy && !busy && !msg.state.pendingCheck && !rolled) setTimeout(tryNextAction, 300);
    else if (wasBusy && !busy && resultSeen) {
      clearTimeout(timeout);
      console.log("\nROLL PATH TEST PASSED");
      process.exit(0);
    }
  }
  if (msg.type === "roll_request") {
    console.log(`  -> check requested: ${msg.check.skill} DC ${msg.check.dc} for ${msg.check.playerName} (${msg.check.reason})`);
  }
  if (msg.type === "state" && msg.state.pendingCheck && !rolled && !msg.state.dmBusy) {
    rolled = true;
    console.log("  -> clicking roll");
    ws.send(JSON.stringify({ type: "roll" }));
  }
  if (msg.type === "roll_result") {
    resultSeen = true;
    console.log(`  -> result: d20=${msg.result.die} +${msg.result.modifier} = ${msg.result.total} vs DC ${msg.result.dc}: ${msg.result.success ? "SUCCESS" : "FAILURE"}`);
  }
  if (msg.type === "error") console.log(`  (server: ${msg.message})`);
});
