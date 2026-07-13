import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = path.resolve(process.argv[2] ?? process.cwd());
const isWindows = process.platform === "win32";
const varDir = path.join(root, "var");
const logDir = path.join(varDir, "logs");
const statePath = path.join(varDir, "grimoire-host.json");
const python = isWindows
  ? path.join(root, "vendor", "ComfyUI", "venv", "Scripts", "python.exe")
  : path.join(root, "vendor", "ComfyUI", "venv", "bin", "python");
const token = randomUUID().replaceAll("-", "");
const bindHost = process.env.GRIMOIRE_BIND_HOST ?? "0.0.0.0";
const gamePort = Number(process.env.GRIMOIRE_GAME_PORT ?? "8787");
const ttsPort = Number(process.env.GRIMOIRE_TTS_PORT ?? "8765");
const managed = [];

fs.mkdirSync(logDir, { recursive: true });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function healthy(url, timeoutMs = 2_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function saveState() {
  fs.writeFileSync(statePath, `${JSON.stringify({
    supervisorPid: process.pid,
    startedAt: new Date().toISOString(),
    shutdownToken: token,
    gamePort,
    processes: managed.map(({ name, processId }) => ({ name, processId })),
  }, null, 2)}\n`);
}

async function startManaged(name, healthUrl, command, args) {
  if (await healthy(healthUrl)) {
    console.log(`[KEEP]  ${name} was already running outside Grimoire`);
    return;
  }
  const safeName = name.toLowerCase().replaceAll(" ", "-");
  const stdout = fs.openSync(path.join(logDir, `${safeName}.log`), "w");
  const stderr = fs.openSync(path.join(logDir, `${safeName}.error.log`), "w");
  const child = spawn(command, args, {
    cwd: root,
    env: {
      ...process.env,
      GRIMOIRE_SHUTDOWN_TOKEN: token,
      GRIMOIRE_IDLE_SHUTDOWN_MS: process.env.GRIMOIRE_IDLE_SHUTDOWN_MS ?? "15000",
      GRIMOIRE_GAME_PORT: String(gamePort),
      GRIMOIRE_TTS_PORT: String(ttsPort),
      VITE_GAME_PORT: String(gamePort),
    },
    detached: !isWindows,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  child.on("error", error => console.error(`[FAIL]  ${name}: ${error.message}`));
  managed.push({ name, processId: child.pid });
  saveState();
  console.log(`[BOOT]  ${name} (PID ${child.pid})`);
}

async function waitFor(name, url, seconds, required = false) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    if (await healthy(url)) return true;
    await sleep(1_000);
  }
  const message = `${name} did not become ready`;
  if (required) throw new Error(message);
  console.warn(`[WARN]  ${message}; continuing in degraded mode`);
  return false;
}

function stopTree(pid, force = false) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (isWindows) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") console.error(`[STOP]  PID ${pid}: ${error.message}`);
  }
}

let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  console.log("[STOP]  Cleaning up Grimoire services");
  for (const item of [...managed].reverse()) stopTree(item.processId);
  if (!isWindows) {
    await sleep(2_000);
    for (const item of [...managed].reverse()) stopTree(item.processId, true);
  }
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (state.supervisorPid === process.pid) fs.rmSync(statePath, { force: true });
  } catch {
    fs.rmSync(statePath, { force: true });
  }
}

async function main() {
  saveState();
  const ollama = process.env.GRIMOIRE_OLLAMA_COMMAND ?? "ollama";
  await startManaged("Ollama", "http://127.0.0.1:11434/api/tags", ollama, ["serve"]);
  await waitFor("Ollama", "http://127.0.0.1:11434/api/tags", 30);

  await startManaged("ComfyUI", "http://127.0.0.1:8188/system_stats", python, [
    path.join(root, "vendor", "ComfyUI", "main.py"),
    "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch",
  ]);
  await waitFor("ComfyUI", "http://127.0.0.1:8188/system_stats", 60);

  await startManaged("Narrator", `http://127.0.0.1:${ttsPort}/health`, python, [
    path.join(root, "tools", "tts-sidecar", "server.py"),
  ]);
  await waitFor("Narrator", `http://127.0.0.1:${ttsPort}/health`, 60);

  await startManaged("Game server", `http://127.0.0.1:${gamePort}/health`, process.execPath, [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "packages", "server", "src", "index.ts"),
  ]);
  await startManaged("Web client", "http://127.0.0.1:5173", process.execPath, [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    path.join(root, "packages", "client"), "--host", bindHost,
  ]);
  await Promise.all([
    waitFor("Game server", `http://127.0.0.1:${gamePort}/health`, 120, true),
    waitFor("Web client", "http://127.0.0.1:5173", 120, true),
  ]);
  console.log("[READY] Grimoire is running in the background");
  while (await healthy(`http://127.0.0.1:${gamePort}/health`)) await sleep(2_000);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => cleanup().finally(() => process.exit(0)));
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(cleanup);
