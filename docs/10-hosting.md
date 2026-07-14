# 10 — Hosting details

Everything operational that doesn't belong in the front-page README.

## Windows host

```powershell
.\start.ps1     # bootstraps everything, then runs quietly in the background
.\stop.ps1      # immediate manual stop
npm start / npm stop   # same thing once Node exists
```

The bootstrap (`setup.ps1`, idempotent) installs missing Git, Node.js, Python, and Ollama
through winget; runs `npm ci`; creates the local ComfyUI/Kokoro environment; downloads the
image/voice models; detects your GPU and pulls the right DM model tier. Expect roughly 10 GB
of downloads on the first run. `.\setup.ps1 -Check` gives a read-only readiness report.

All services run without visible console windows and log to `var/logs/`. After the final
browser tab disconnects, a 15-second grace period expires and the Grimoire-owned processes
shut down automatically. An Ollama instance that was already running is deliberately left alone.

## Hardware tiers (runs on a toaster)

Setup measures your GPU and writes `var/host-config.json`:

| Hardware | DM model | Experience |
|---|---|---|
| NVIDIA GPU with >= 7 GB VRAM | `llama3.1:8b` | Full: fast narration, scene art, GPU voice |
| Weaker GPU / no NVIDIA GPU | `llama3.2:3b` | Still fully playable — faster small model, CPU-friendly; art and voice degrade gracefully if their sidecars can't run |

Override anytime with the `GRIMOIRE_DM_MODEL` env var (any Ollama model tag) and re-run setup.
The tiers were chosen by benchmark (`spikes/model-shootout.mjs`): llama3.1:8b beat qwen3:8b on
constrained tool-call latency (0.89 s vs 1.85 s) at equal narration speed, and llama3.2:3b runs
at 100+ tok/s with valid structured output.

## Linux host / server

```bash
chmod +x setup.sh start.sh stop.sh
./start.sh                 # desktop mode; stops after the last tab closes
./start.sh --persistent    # always-on server mode
./stop.sh
```

Supports current Debian/Ubuntu, Fedora, and Arch-family distributions on x86-64 or ARM64.
Installs a local Node.js 22 runtime when needed, installs Ollama, creates the Python/ComfyUI/
Kokoro environment, verifies model checksums, and runs `npm ci`. Setup selects CUDA 12.6
PyTorch when `nvidia-smi` is available and CPU wheels otherwise; force CPU with
`GRIMOIRE_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu ./setup.sh`.

For a boot-managed host, run `./setup.sh` once, adapt `deploy/grimoire.service`, and enable it
with systemd.

## Network & security

- The web UI listens on `0.0.0.0:5173`; the game API/WebSocket on `0.0.0.0:8787`.
  Ollama, ComfyUI, and Kokoro stay on loopback.
- **No login screen or built-in TLS.** Do not expose 5173/8787 to the public internet.
  Use a trusted LAN, Tailscale/WireGuard, or an authenticated HTTPS reverse proxy.
- Behind TLS with a separate game endpoint: `VITE_GAME_ORIGIN=https://game.example.com` before
  starting Vite; the client switches to HTTPS assets and secure WebSockets.
- `GRIMOIRE_BIND_HOST` restricts the two public listeners to one interface.
- `GRIMOIRE_GAME_PORT` / `GRIMOIRE_TTS_PORT` override the Grimoire-owned backend ports.

## Test multiplayer today

Use persistent mode so closing a test window does not tear down the host between steps:

```powershell
npm run start:persistent
```

On one PC, open the game in two isolated storage contexts: normal Chrome plus InPrivate Edge, or
two browser profiles. Two ordinary tabs share `grimoire.player` and therefore attach to the same
hero. Create a different hero in each context and verify:

1. Both party badges appear in both windows.
2. Starting or acting in either window updates the same scene, quest, log, and art in both.
3. Acting from the second window while `dmBusy` is true receives the busy message.
4. Only the character named by a pending check sees and can use the Roll button.
5. Narrator/art-style choices synchronize, while voice/music/effects volume remains per tab.
6. Refresh reattaches the correct hero; closing one window leaves the other session running.

For a LAN test, find the host's private IPv4 address with `ipconfig`, allow Node on Windows
**Private** networks if prompted, and open `http://HOST-IP:5173` from the second device. Verify
`http://HOST-IP:8787/health` there as well; both ports must be reachable. Finish with `npm stop`.

This is currently a sequential shared table, not split-party multiplayer: one scene, one global
DM lock, public dialogue/audio, no lobby/invite code, and no authenticated host controls. Use only
a trusted LAN or VPN.

## Maintenance

- `npm test` — rules/media/lifecycle suite. `npm run typecheck` — strict TS across the repo.
- `node spikes/e2e-smoke.mjs` — drives a full game turn against the live stack.
- `npm run smoke:visual` — isolated environment/person/creature ComfyUI QA; does not touch SQLite.
- `packages/server/src/game.multiplayer.test.ts` — two isolated sockets converge on one party and
  enforce named roll ownership without touching a live campaign.
- `npm run demo` — autoplay bot plays for 2 minutes (see `docs/09-api.md`).
- Reset the campaign: delete `var/grimoire.db`. Generated art/audio cache: `var/assets/`.
- Rules attribution: `NOTICE.md`; exact SRD coverage: `docs/07-srd-rules-coverage.md`.
