// Grimoire autoplay bot: joins the running game over the public WebSocket API and plays
// by itself for a few minutes - useful for smoke-testing a host, demoing the game, or
// letting another AI drive a session.
//
//   node tools/api/autoplay.mjs                 # play 2 minutes on localhost
//   node tools/api/autoplay.mjs --minutes 5
//   node tools/api/autoplay.mjs --url ws://192.168.1.20:8787/ws --name Botrick
//
// The bot speaks the same protocol as the browser client (packages/shared/src/index.ts):
// join -> new_campaign -> action/roll loop. It never needs the web UI.
import WebSocket from "ws";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MINUTES = Number(arg("minutes", "2"));
const URL = arg("url", `ws://127.0.0.1:${process.env.GRIMOIRE_GAME_PORT ?? "8787"}/ws`);
const NAME = arg("name", `Wanderer${Math.floor(Math.random() * 900 + 100)}`);
const CLASSES = ["fighter", "rogue", "cleric", "wizard"];

const GENERIC_ACTIONS = [
  "I look around carefully for anything unusual.",
  "I press onward along the most promising path.",
  "I search the area for something useful.",
  "I approach the nearest person or creature cautiously.",
  "I try to find another way forward.",
];

const deadline = Date.now() + MINUTES * 60_000;
let beats = 0, rolls = 0, scenes = new Set();
let joined = false, began = false, acting = false;
let narration = "";

const ws = new WebSocket(URL);
const say = (tag, text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${tag} ${text}`);

function finish(reason) {
  say("DONE", `${reason} - ${beats} beats, ${rolls} rolls, ${scenes.size} scene(s): ${[...scenes].join(" | ")}`);
  process.exit(0);
}

function pickAction(state) {
  const pool = state.suggestedActions.length ? state.suggestedActions : GENERIC_ACTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

ws.on("open", () => {
  say("JOIN", `${NAME} connecting to ${URL}`);
  ws.send(JSON.stringify({
    type: "join", playerName: NAME,
    characterId: CLASSES[Math.floor(Math.random() * CLASSES.length)],
    sex: Math.random() < 0.5 ? "male" : "female", age: "adult",
    bio: "a curious traveler eager to test fate",
  }));
});

ws.on("error", err => { console.error("connection failed:", err.message); process.exit(1); });
ws.on("close", () => finish("server closed the connection"));

ws.on("message", data => {
  const msg = JSON.parse(data.toString());
  if (Date.now() > deadline && msg.type === "state" && !msg.state.dmBusy) finish("time is up");

  switch (msg.type) {
    case "state": {
      const s = msg.state;
      scenes.add(s.scene.name);
      const me = s.party.find(c => c.name === NAME);
      if (me && !joined) { joined = true; say("OK", `joined as ${NAME} the ${me.className}`); }
      if (!joined || s.dmBusy) return;

      if (!began && s.scene.kind === "fireside" && me) {
        began = true;
        say("GO", "beginning a new campaign");
        ws.send(JSON.stringify({ type: "new_campaign", premise: "a short, fast-moving test adventure" }));
        return;
      }
      if (s.pendingCheck && s.pendingCheck.playerName.toLowerCase() === NAME.toLowerCase()) {
        say("ROLL", `${s.pendingCheck.skill} (DC ${s.pendingCheck.dc ?? "?"}) - rolling`);
        setTimeout(() => ws.send(JSON.stringify({ type: "roll" })), 400);
        return;
      }
      if (!s.pendingCheck && s.scene.kind !== "fireside" && !acting) {
        acting = true;
        const action = pickAction(s);
        setTimeout(() => {
          say("ACT", action);
          ws.send(JSON.stringify({ type: "action", text: action, mode: "act" }));
          acting = false;
        }, 800);
      }
      return;
    }
    case "narration_start": narration = ""; return;
    case "narration_chunk": narration += msg.text; return;
    case "narration_end":
      beats++;
      say("DM", narration.replace(/\s+/g, " ").slice(0, 160));
      return;
    case "roll_result":
      rolls++;
      say("DICE", `d20=${msg.result.die}+${msg.result.modifier} = ${msg.result.total} vs DC ${msg.result.dc} -> ${msg.result.success ? "SUCCESS" : "FAILURE"}`);
      return;
    case "scene_image": say("ART", msg.url); return;
    case "error": say("ERR", msg.message); return;
  }
});

setTimeout(() => finish("hard time limit"), MINUTES * 60_000 + 60_000);
