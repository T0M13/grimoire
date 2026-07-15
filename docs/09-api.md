# 09 — The Grimoire API (play without the browser)

Grimoire's web client has no private magic: everything it does goes through one WebSocket and
two small HTTP endpoints. Anything that speaks JSON can join the table — a script, a bot,
another AI, or a test harness.

The authoritative message contract is `packages/shared/src/index.ts`
(`ClientMessageSchema` for what you may send, `ServerMessage` for what you receive).
This page is the practical summary.

## Try it in one command

With a host running (`.\start.ps1` / `./start.sh`):

```
npm run demo               # a bot joins, starts a campaign, and plays for 2 minutes
node tools/api/autoplay.mjs --minutes 5 --name Botrick
node tools/api/autoplay.mjs --url ws://<host-ip>:8786/ws   # against a remote host
```

The bot prints every DM beat, dice roll, and scene-art URL, then a summary. Exit code 0 means
a healthy host.

## Endpoints

| What | Where |
|---|---|
| Game (WebSocket) | `ws://<host>:8786/ws` |
| Health check | `GET http://<host>:8786/health` |
| Custom portrait | `POST http://<host>:8786/portrait` (`PortraitRequestSchema` body) |
| Generated media | `GET http://<host>:8786/assets/...` (URLs arrive in messages) |
| Web client | `http://<host>:5173` |

## Client → server messages (JSON over the socket)

| type | Purpose |
|---|---|
| `join` | Enter the table. Minimal: `{type:"join", playerName, characterId:"fighter\|rogue\|cleric\|wizard", sex, age, bio}`. The browser's SRD creator sends the full build (race, abilities, background, equipment); omitted fields fall back to a legal class template. |
| `new_campaign` | `{type:"new_campaign", premise?}` — begin the adventure from the Fireside. |
| `action` | `{type:"action", text, mode:"act"\|"speak"\|"ask_dm"}` — do/say/ask something. |
| `roll` | Answer the pending check that names your character. |
| `set_voice` | `{voice:"male"\|"female"}` — table-wide narrator. |
| `set_art_style` | `{style:"painting"\|"sketch"\|"cinematic"}` — table-wide scene and subject style. |
| `set_content_tone` | `{tone:"standard"\|"mature"}` — joined-player, table-wide story mode; rejected while the DM is busy. |
| `save_slot` / `load_slot` / `delete_slot` / `new_game` | Host-local save management. |

## Server → client messages

| type | Meaning |
|---|---|
| `state` | Full authoritative snapshot (`PublicState`): scene and visible occupants, party, NPC voice/portrait profiles, per-hero NPC relationships, shared content tone, quests, log, pending check, and saves. Sent on connect and after every change. |
| `party_presence` | Transient online/activity roster (`Ready`, `Acting`, `Speaking`, `Asking DM`, `Rolling`, `Following`). It is not written into campaign saves. |
| `journey_ready` | Direct acknowledgement after the requesting socket successfully resets or loads the shared table. |
| `narration_start` / `narration_chunk` / `narration_end` | The DM's beat, streamed token-by-token, with the active speaker (storyteller or a named NPC). |
| `audio` / `audio_stop` | Narration voice, one WAV URL per sentence, in order — and the signal to drop stale audio when the table moves on. |
| `roll_request` / `roll_result` | The engine wants a d20 / what the engine rolled. |
| `scene_image` | New scene art is ready (crossfade it in). |
| `error` | Human-readable rejection ("The storyteller is speaking..."). |

## Rules for well-behaved clients

- You send **intents**, never state. The server owns all mechanics.
- Wait for `state.dmBusy === false` before acting; respect `pendingCheck` turn order.
- Everything is Zod-validated server-side; malformed messages get an `error`.
- Media URLs are relative — resolve them against `http://<host>:8786`.

## Current multiplayer and trust boundary

- One singleton room serves one sequential party. `dmBusy` serializes all actions and a pending
  check blocks the room until its named player rolls.
- `state.party` is the saved campaign roster, not proof that a hero is online. Use
  `party_presence` for current connections and activity. Multiple tabs claiming one hero remain one
  online presence until the final tab closes.
- There is no fixed out-of-combat turn order: the first valid intent sent while idle owns the next
  shared beat. Everyone receives the same actor-relative narration and audio.
- Identity is currently the claimed character name plus browser local storage, not an authenticated
  seat token. Two ordinary tabs in one profile attach to the same hero.
- Save/delete, narrator, art-style, and content-tone controls are not host-authorized yet. Load/reset requires a
  joined party member once the table is active, but this is still not a real host role.
- Every narration, NPC conversation, audio sentence, scene, and log entry is public to the room.
- Mature mode affects the shared text and audio for every tab. Clients should require table agreement
  before sending it; the browser UI warns the toggling player but cannot verify agreement, and a real
  host-only permission is not built yet.
- Do not expose the API directly to the internet. Use a trusted LAN/VPN while invite codes, host
  authorization, seat tokens, and recipient-scoped feeds remain Phase 3 work.
