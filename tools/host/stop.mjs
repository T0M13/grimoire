import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? process.cwd());
const statePath = path.join(root, "var", "grimoire-host.json");
const isWindows = process.platform === "win32";
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function running(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function stopTree(pid, force = false) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (isWindows) {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try { process.kill(-pid, force ? "SIGKILL" : "SIGTERM"); }
  catch (error) { if (error.code !== "ESRCH") console.error(`Could not stop PID ${pid}: ${error.message}`); }
}

if (!fs.existsSync(statePath)) {
  console.log("Grimoire is not running under the background host.");
  process.exit(0);
}
const state = JSON.parse(fs.readFileSync(statePath, "utf8").replace(/^\uFEFF/, ""));
const gamePort = Number(state.gamePort ?? 8786);
console.log("Stopping Grimoire...");
try {
  await fetch(`http://127.0.0.1:${gamePort}/shutdown`, {
    method: "POST",
    headers: { "x-grimoire-token": state.shutdownToken },
    signal: AbortSignal.timeout(3_000),
  });
} catch {
  // The server may already be down; the process-tree fallback still cleans up.
}
for (let attempt = 0; attempt < 15 && running(state.supervisorPid); attempt += 1) await sleep(1_000);
if (running(state.supervisorPid)) {
  for (const item of [...(state.processes ?? [])].reverse()) stopTree(item.processId);
  if (!isWindows) await sleep(2_000);
  for (const item of [...(state.processes ?? [])].reverse()) stopTree(item.processId, true);
  try { process.kill(state.supervisorPid, "SIGTERM"); } catch { /* Already stopped. */ }
  if (isWindows && running(state.supervisorPid)) stopTree(state.supervisorPid, true);
}
fs.rmSync(statePath, { force: true });
console.log("Grimoire stopped.");
