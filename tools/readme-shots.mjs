// Take real UI screenshots for the README using the installed Edge browser (headless)
// plus the public WebSocket API to stage an actual played game.
//   node tools/readme-shots.mjs
// Prereq: the stack is running. Output: docs/media/screenshot-*.png
// NOTE: resets the table before and after - do not run against a campaign you care about.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "media");
const APP = `http://127.0.0.1:${process.env.GRIMOIRE_WEB_PORT ?? "8786"}`;
const WS_URL = `ws://127.0.0.1:${process.env.GRIMOIRE_GAME_PORT ?? "8787"}/ws`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const HERO = {
  playerName: "Aria", characterId: "rogue", sex: "female", age: "young",
  bio: "black hair, sharp green eyes, grew up on the docks and trusts nobody twice",
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One-shot ws helper: connect, run a driver function with send/next, close. */
function playSession(driver) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const queue = [];
    let waiter = null;
    ws.on("message", raw => {
      const msg = JSON.parse(raw.toString());
      if (waiter) { const w = waiter; waiter = null; w(msg); } else queue.push(msg);
    });
    const next = () => new Promise(res => {
      if (queue.length) return res(queue.shift());
      waiter = res;
    });
    const send = obj => ws.send(JSON.stringify(obj));
    ws.on("open", async () => {
      try { resolve(await driver({ send, next, ws })); } catch (err) { reject(err); }
      finally { try { ws.close(); } catch { /* done */ } }
    });
    ws.on("error", reject);
  });
}

async function waitState(next, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("timed out waiting for state");
    const msg = await next();
    if (msg.type === "state" && predicate(msg.state)) return msg.state;
  }
}

// stage 1: make sure the table is empty so the journey gate shows its fresh face
await playSession(async ({ send, next }) => {
  const first = await waitState(next, () => true);
  if (first.party.length > 0 || first.scene.kind !== "fireside") {
    send({ type: "new_game" });
    await waitState(next, s => s.party.length === 0 && s.scene.kind === "fireside");
  }
});
console.log("table reset");

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "shell",
  args: ["--window-size=1440,900", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900 },
});

const freeze = async page => {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; } .ember span { opacity: 1 !important; }" });
};

async function shot(page, name) {
  await freeze(page);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`saved ${name}`);
}

try {
  // shot 1: the journey chooser
  const page = await browser.newPage();
  await page.goto(APP, { waitUntil: "networkidle2" });
  await page.waitForSelector("::-p-text(New Journey)", { timeout: 30_000 });
  await sleep(600);
  await shot(page, "screenshot-journeys.png");

  // shot 2: the character creator (click New Journey, confirm nothing is lost - table is empty)
  page.on("dialog", d => void d.accept());
  await page.click("::-p-text(New Journey)");
  await page.waitForSelector("::-p-text(Back To Journeys)", { timeout: 30_000 });
  await sleep(600);
  await shot(page, "screenshot-creator.png");
  await page.close();

  // stage 2: a real played campaign via the API - hero, opening, scene art, then a
  // pending dice roll left on the table for the camera
  await playSession(async ({ send, next }) => {
    send({ type: "join", ...HERO, portraitUrl: null });
    await waitState(next, s => s.party.some(c => c.name === HERO.playerName));
    send({ type: "new_campaign", premise: "a mystery in a small harbor town" });
    console.log("campaign starting; waiting for narration + scene art...");
    await waitState(next, s => !s.dmBusy && s.scene.kind !== "fireside" && !!s.scene.imageUrl, 180_000);
    send({ type: "action", text: "I try to quietly pick the lock on the harbormaster's office door.", mode: "act" });
    const staged = await waitState(next, s => !s.dmBusy && !!s.pendingCheck, 120_000)
      .catch(() => null);
    console.log(staged?.pendingCheck
      ? `roll staged: ${staged.pendingCheck.skill} for ${staged.pendingCheck.playerName}`
      : "no check requested this time - gameplay shot will show narration instead");
  });

  // shot 3: gameplay as Aria (identity injected so the browser owns the staged roll)
  const game = await browser.newPage();
  await game.evaluateOnNewDocument(identity => {
    localStorage.setItem("grimoire.player", JSON.stringify(identity));
    localStorage.setItem("grimoire.muted", "1"); // no audio in headless
  }, { ...HERO, portraitUrl: null });
  await game.goto(APP, { waitUntil: "networkidle2" });
  await game.waitForSelector("img[src*='/assets/img/']", { timeout: 60_000 });
  await sleep(1500); // let the crossfade land and portraits arrive
  await shot(game, "screenshot-gameplay.png");

  // shot 4: quest journal docked over the game
  await game.click("::-p-text(Quests)").catch(() => console.log("quests button not found"));
  await sleep(800);
  await shot(game, "screenshot-quests.png");
  await game.close();
} finally {
  await browser.close();
}

// stage 3: leave the table clean again
await playSession(async ({ send, next }) => {
  await waitState(next, () => true);
  send({ type: "new_game" });
  await waitState(next, s => s.party.length === 0);
});
console.log("table reset clean - done");
