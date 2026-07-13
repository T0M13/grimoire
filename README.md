# Grimoire

**A self-hosted, AI-Dungeon-Mastered D&D web game for 1–6 players.**

One player (the host) runs the whole stack on their gaming PC. The AI is the Dungeon Master:
it narrates with a spoken storyteller voice, generates the story on the spot, shows cinematic
scene art, plays mood music, asks for dice rolls, runs rules-correct combat, and remembers
everything — characters, inventory, story beats — across sessions.

Playable **solo**, or friends join the host's game from their browser. No accounts, no cloud,
no per-message API costs.

## The pitch in one paragraph

It's a text-adventure-meets-tabletop hybrid: a beautiful web UI where a Storyteller voice reads
the scene aloud over generated artwork and ambient music, players type or click what they do,
the AI DM resolves it using a real 5e SRD rules engine (it never "makes up" math), calls for
rolls with juicy 3D dice, and streams the next story beat within a second. Everything is saved:
the campaign continues next weekend exactly where it stopped.

## Core design pillars

1. **Fast beats fancy.** Narration starts streaming in under ~1 second. Nothing ever blocks
   the game waiting for a picture or a song. Slow AI = dead game.
2. **The LLM narrates, code adjudicates.** All dice, DCs, HP, combat math and rules live in a
   deterministic TypeScript rules engine (5e SRD). The LLM decides *what happens narratively*
   and *which rule to invoke* — never the arithmetic. This is what keeps combat balanced.
3. **One host, zero friction for friends.** Host clicks "Start", shares a link, friends open a
   browser. Works for 1 player exactly like for 6.
4. **Everything persists.** Characters, inventory, quest log, world facts, NPC relationships,
   session recaps. Long-term memory via summarization + vector recall.
5. **In the moment, always.** No cutscenes, no interruptions: scene art crossfades in behind
   the story while it's being told, the narrator voice and mood-matched music follow the
   action live. Filmic feel, zero waiting, players can always act.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/01-game-design.md](docs/01-game-design.md) | The game itself: loop, storyteller, movement, combat, multiplayer UX, cutscenes |
| [docs/02-research.md](docs/02-research.md) | Existing tools/repos surveyed, what we reuse vs. build |
| [docs/03-architecture.md](docs/03-architecture.md) | Tech stack, AI models for a 12 GB GPU, latency budget, data model |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Phased build plan, MVP definition |
| [docs/05-handoff.md](docs/05-handoff.md) | Exact implemented state, setup, code map, and continuation checklist |
| [docs/06-open-world-multiplayer.md](docs/06-open-world-multiplayer.md) | Parallel NPC dialogue, world events, quest scopes, and persistent scene-shot plan |
| [docs/07-srd-rules-coverage.md](docs/07-srd-rules-coverage.md) | Exact implemented 2014 SRD boundary, character creation, omissions, and LLM/rules contract |
| [docs/08-progression-and-content.md](docs/08-progression-and-content.md) | Leveling, class choices, inventory assets, NPC voices, and quest delivery plan |
| [.claude/skills/grimoire/SKILL.md](.claude/skills/grimoire/SKILL.md) | Claude Code skill: how to work on this project |

## Quickstart (Windows host)

```powershell
npm start        # when Node/npm is already installed
# or .\start.ps1 # also bootstraps missing prerequisites on a fresh Windows machine
# then open http://localhost:5173 — friends join via your LAN/Tailscale IP
```

The Windows bootstrap installs missing Git, Node.js, Python, and Ollama through winget; runs
`npm ci`; creates the local ComfyUI/Kokoro environment; and downloads the required AI models.
It is idempotent, so later starts skip completed work. Expect roughly 10 GB of local downloads
on the first run. Use `.\setup.ps1 -Check` for a read-only readiness report.

Use `npm stop` (or `.\stop.ps1`) for an immediate manual stop. All game services run without
visible console windows and write diagnostics to `var/logs/`.
After the final browser tab disconnects, a 15-second reconnect grace period expires and the
Grimoire-owned processes shut down automatically. Run `.\stop.ps1` for an immediate manual stop.
An Ollama instance that was already running before Grimoire is deliberately left alone.

Music and effects are generated locally by the browser after the first click (required by browser
autoplay policy). Settings has independent narrator, music, and effects mute/volume controls.
The soundtrack crossfades across all scene moods, with distinct combat and boss arrangements;
closing the tab destroys its audio graph. No music files, audio service, or extra server package
is required.

During play, choose **Act**, **Speak**, or **Ask DM** above the input. Speak forces a direct NPC
conversation and keeps a stable voice for each named NPC. Ask DM gives a labeled Storyteller/DM
answer about established world facts or available options without silently taking an action.
The Quest Journal tracks structured main and side objectives; inventory is grouped into visual
item cards on the character sheet.

## Quickstart (Linux host/server)

The Linux bootstrap supports current Debian/Ubuntu, Fedora, and Arch-family distributions on
x86-64 or ARM64. It installs a local Node.js 22 runtime when needed, installs Ollama, creates
the Python/ComfyUI/Kokoro environment, verifies downloaded model checksums, and runs `npm ci`.

```bash
chmod +x setup.sh start.sh stop.sh
./start.sh                         # desktop/session mode; stops after the last tab closes
./start.sh --persistent            # always-on server mode
./stop.sh
```

The web UI listens on `0.0.0.0:5173` and the game API/WebSocket listens on `0.0.0.0:8787`.
Share `http://<server-ip>:5173`; Ollama, ComfyUI, and Kokoro remain bound to loopback. For a
boot-managed host, first run `./setup.sh`, then adapt `deploy/grimoire.service` to your user and
install path before enabling it with systemd.

Grimoire currently has no login screen or built-in TLS. Do not expose ports 5173/8787 directly
to the public internet. Use a trusted LAN, Tailscale/WireGuard, or an authenticated HTTPS reverse
proxy, and firewall the two public-facing ports to that trusted network. Use
`GRIMOIRE_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu ./setup.sh` to force CPU PyTorch;
without that override, setup selects CUDA 12.6 when `nvidia-smi` is available and CPU otherwise.
When TLS terminates at a separate public game endpoint, set its origin before starting Vite, for
example `VITE_GAME_ORIGIN=https://game.example.com ./start.sh --persistent`; the client then uses
HTTPS assets and secure WebSockets automatically. `GRIMOIRE_BIND_HOST` can restrict both public
listeners to a particular local interface instead of the default `0.0.0.0`.

`npm test` runs the rules-engine/media suite;
`node spikes/e2e-smoke.mjs` drives a full game turn against the live stack.
Reset the campaign by deleting `var/grimoire.db`.

Rules attribution is recorded in [NOTICE.md](NOTICE.md). Grimoire is currently a partial SRD
engine; the exact implemented and pending mechanics are tracked in
[docs/07-srd-rules-coverage.md](docs/07-srd-rules-coverage.md).

## Target hardware (host)

Designed around the host machine: **NVIDIA RTX 4070 (12 GB VRAM)**, Windows 11.
All model choices in the architecture doc are sized to fit this card with headroom.
Full stack measured at ~7.8 GB VRAM. Don't host while running a GPU-heavy game —
the storyteller gets starved (it aborts gracefully rather than hanging).
