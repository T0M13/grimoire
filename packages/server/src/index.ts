import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  ClientMessageSchema, HERO_EXPORT_FORMAT, JOURNEY_EXPORT_FORMAT, JourneyExportSchema,
  PortraitRequestSchema, type PublicState,
} from "@grimoire/shared";
import { ASSET_DIR, CONFIG } from "./config.js";
import { GameRoom } from "./game.js";
import { warmUp } from "./ollama.js";
import { comfyAvailable, generatePortrait } from "./media.js";
import { loadSlot, saveSlot } from "./db.js";
import type { ChatMessage } from "./ollama.js";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".json": "application/json",
};

let shuttingDown = false;

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, activeClients: room?.clientCount ?? 0 }));
    return;
  }
  if (url === "/shutdown" && req.method === "POST") {
    const expected = process.env.GRIMOIRE_SHUTDOWN_TOKEN;
    const supplied = req.headers["x-grimoire-token"];
    if (!expected || supplied !== expected || !isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    setImmediate(() => shutdown("manual stop"));
    return;
  }
  if (url === "/portrait") {
    // custom avatar generation at character creation
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end(); return; }
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on("end", async () => {
      try {
        const parsed = PortraitRequestSchema.parse(JSON.parse(body));
        const url = await generatePortrait(parsed);
        res.writeHead(200, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ url }));
      } catch (err) {
        console.error("[portrait]", (err as Error).message);
        res.writeHead(500, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "portrait generation failed" }));
      }
    });
    return;
  }
  if (url === "/export/journey" || url.startsWith("/export/journey/")) {
    // download the live journey, or a saved slot: /export/journey/<saveId>
    const idPart = url.split("/")[3];
    let name: string, snapshot: { state: PublicState; history: unknown } | null;
    if (idPart) {
      const id = Number(idPart);
      const loaded = Number.isInteger(id) ? loadSlot(id) : null;
      if (!loaded) { res.writeHead(404); res.end("No such saved journey."); return; }
      snapshot = loaded;
      name = loaded.state.campaignName || "journey";
    } else {
      snapshot = room.getExportSnapshot();
      name = snapshot.state.campaignName || "journey";
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "journey";
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "content-disposition": `attachment; filename="grimoire-journey-${slug}.json"`,
    });
    res.end(JSON.stringify({
      format: JOURNEY_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      name,
      state: snapshot.state,
      history: snapshot.history,
    }, null, 1));
    return;
  }
  if (url.startsWith("/export/hero/")) {
    // download one hero from the live party: /export/hero/<characterId>
    const id = decodeURIComponent(url.slice("/export/hero/".length));
    const character = room.getExportSnapshot().state.party.find(c => c.id === id);
    if (!character) { res.writeHead(404); res.end("No such hero at this table."); return; }
    const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "hero";
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "content-disposition": `attachment; filename="grimoire-hero-${slug}.json"`,
    });
    res.end(JSON.stringify({
      format: HERO_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      character,
    }, null, 1));
    return;
  }
  if (url === "/import/journey") {
    // upload a previously exported journey; it lands as a new save slot to load from the chooser
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405, cors); res.end(); return; }
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 5_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const journey = JourneyExportSchema.parse(JSON.parse(body));
        const slotName = `Imported - ${journey.name}`.slice(0, 40);
        saveSlot(slotName, journey.state as unknown as PublicState, journey.history as ChatMessage[]);
        room.notifySavesChanged();
        res.writeHead(200, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true, name: slotName }));
      } catch (err) {
        console.error("[import journey]", (err as Error).message);
        res.writeHead(400, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "That file is not a valid Grimoire journey." }));
      }
    });
    return;
  }
  if (url.startsWith("/assets/")) {
    // static generated media (scene art, narration audio, music)
    const rel = path.normalize(url.slice("/assets/".length)).replace(/^([.][.][\\/])+/, "");
    const file = path.join(ASSET_DIR, rel);
    if (!file.startsWith(ASSET_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=31536000, immutable",
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`Grimoire game server. Connect the client to ws://<host>:${CONFIG.port}/ws`);
});

const idleShutdownMs = Number(process.env.GRIMOIRE_IDLE_SHUTDOWN_MS ?? "15000");
const autoShutdown = process.env.GRIMOIRE_AUTO_SHUTDOWN !== "0";
const bindHost = process.env.GRIMOIRE_BIND_HOST ?? "0.0.0.0";
const room = new GameRoom({
  idleShutdownMs: Number.isFinite(idleShutdownMs) ? Math.max(1_000, idleShutdownMs) : 15_000,
  onIdle: autoShutdown ? () => shutdown("last browser disconnected") : undefined,
});
const wss = new WebSocketServer({ server, path: "/ws" });

function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[host] shutting down: ${reason}`);
  room.shutdown();
  for (const ws of wss.clients) ws.close(1001, "Host session ended");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000);
}

wss.on("connection", ws => {
  room.addClient(ws);
  ws.on("message", data => {
    let parsed;
    try {
      parsed = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
    } catch {
      parsed = { success: false as const, error: null };
    }
    if (!parsed.success) {
      ws.send(JSON.stringify({ type: "error", message: "Bad message." }));
      return;
    }
    room.handle(ws, parsed.data).catch(err => console.error("[handle]", err));
  });
  ws.on("close", () => room.removeClient(ws));
});

server.listen(CONFIG.port, bindHost, async () => {
  console.log(`Grimoire server on http://${bindHost}:${CONFIG.port} (ws path /ws)`);
  console.log(`- Lifecycle: ${autoShutdown ? "stop after final browser disconnect" : "persistent server"}`);
  console.log(`- Ollama model: ${CONFIG.dmModel} (preloading...)`);
  void warmUp().then(() => console.log("- DM brain warm"));
  console.log(`- ComfyUI: ${(await comfyAvailable()) ? "connected" : "NOT RUNNING (scene art disabled)"}`);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
