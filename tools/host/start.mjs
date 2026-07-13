import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const persistent = process.argv.slice(2).includes("--persistent");
const isWindows = process.platform === "win32";
const command = isWindows ? "powershell.exe" : "bash";
const args = isWindows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "start.ps1"), ...(persistent ? ["-Persistent"] : [])]
  : [path.join(root, "start.sh"), ...(persistent ? ["--persistent"] : [])];

const result = spawnSync(command, args, {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Could not start Grimoire: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
