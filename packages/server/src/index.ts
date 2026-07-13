import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { ClientMessageSchema, PortraitRequestSchema } from "@grimoire/shared";
import { ASSET_DIR, CONFIG } from "./config.js";
import { GameRoom } from "./game.js";
import { warmUp } from "./ollama.js";
import { comfyAvailable, generatePortrait } from "./media.js";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".json": "application/json",
};

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true }));
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
  res.end("Grimoire game server. Connect the client to ws://<host>:7777/ws");
});

const room = new GameRoom();
const wss = new WebSocketServer({ server, path: "/ws" });

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

server.listen(CONFIG.port, async () => {
  console.log(`Grimoire server on http://localhost:${CONFIG.port} (ws path /ws)`);
  console.log(`- Ollama model: ${CONFIG.dmModel} (preloading...)`);
  void warmUp().then(() => console.log("- DM brain warm"));
  console.log(`- ComfyUI: ${(await comfyAvailable()) ? "connected" : "NOT RUNNING (scene art disabled)"}`);
});
