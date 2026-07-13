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
| [.claude/skills/grimoire/SKILL.md](.claude/skills/grimoire/SKILL.md) | Claude Code skill: how to work on this project |

## Quickstart (host)

```powershell
.\start.ps1     # first run installs dependencies/models, then boots the full stack
# then open http://localhost:5173 — friends join via your LAN/Tailscale IP
```

The Windows bootstrap installs missing Git, Node.js, Python, and Ollama through winget; runs
`npm ci`; creates the local ComfyUI/Kokoro environment; and downloads the required AI models.
It is idempotent, so later starts skip completed work. Expect roughly 10 GB of local downloads
on the first run. Use `.\setup.ps1 -Check` for a read-only readiness report.

`npm test` runs the rules-engine/media suite;
`node spikes/e2e-smoke.mjs` drives a full game turn against the live stack.
Reset the campaign by deleting `var/grimoire.db`.

## Target hardware (host)

Designed around the host machine: **NVIDIA RTX 4070 (12 GB VRAM)**, Windows 11.
All model choices in the architecture doc are sized to fit this card with headroom.
Full stack measured at ~7.8 GB VRAM. Don't host while running a GPU-heavy game —
the storyteller gets starved (it aborts gracefully rather than hanging).
