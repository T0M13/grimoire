import crypto from "node:crypto";
import type { WebSocket } from "ws";
import {
  type Character, type CheckRequest, type ClientMessage, type PublicState,
  type ServerMessage,
} from "@grimoire/shared";
import { PREGEN_CHARACTERS, resolveCheck, seededRng, type Rng } from "@grimoire/rules";
import { decideMove, narrate } from "./dm.js";
import { generatePortrait, getSceneImage, SentenceStream, synthesize } from "./media.js";
import { deleteSlot, listSaves, loadCampaign, loadSlot, logEvent, saveCampaign, saveSlot } from "./db.js";
import type { ChatMessage } from "./ollama.js";

const OPENING_INSTRUCTION = (premise: string, party: string) =>
  `ENGINE: Begin a brand-new adventure for this party: ${party}.
Premise wish from the players: "${premise || "surprise us"}".
Your move MUST be "change_scene" - invent an evocative opening location where the adventure hooks the party immediately.`;

function defaultState(): PublicState {
  return {
    campaignName: "A New Tale",
    scene: {
      name: "The Fireside",
      kind: "fireside",
      timeOfDay: "night",
      weather: "clear",
      mood: "mystery",
      description: "Embers crackle. Your tale has not yet begun.",
      exits: [],
      imagePrompt: "glowing fireplace embers in a dark room, warm light on an old open book",
      imageUrl: null,
    },
    party: [],
    log: [],
    suggestedActions: [],
    pendingCheck: null,
    dmBusy: false,
    narratorVoice: "male",
    saves: [],
  };
}

export class GameRoom {
  state: PublicState;
  history: ChatMessage[];
  private clients = new Map<WebSocket, string>(); // socket -> player name ("" until joined)
  private audioChain: Promise<void> = Promise.resolve();
  private audioAbort: AbortController | null = null;
  private audioEpoch = 0;
  private audioSeq = 0;
  private rng: Rng;

  constructor(rng?: Rng) {
    this.rng = rng ?? seededRng(crypto.randomBytes(4).readUInt32LE(0));
    const saved = loadCampaign();
    this.state = saved?.state ?? defaultState();
    this.history = saved?.history ?? [];
    this.state.dmBusy = false; // never resume mid-generation
    this.state.narratorVoice ??= "male"; // older saves may predate this field
    this.state.saves = listSaves();
    this.refreshSceneImage();
  }

  // ---------- connection lifecycle ----------

  addClient(ws: WebSocket): void {
    this.clients.set(ws, "");
    this.send(ws, { type: "state", state: this.state });
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0) {
      // Stop an in-flight sidecar request as well as skipping anything still queued.
      this.cancelAudio(false);
    }
    // autosave the moment someone leaves; nothing is ever lost to a closed tab
    this.persist();
  }

  async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "join": return this.onJoin(ws, msg);
      case "action": return this.onAction(ws, msg.text);
      case "roll": return this.onRoll(ws);
      case "new_campaign": return this.onNewCampaign(ws, msg.premise ?? "");
      case "set_voice":
        this.state.narratorVoice = msg.voice;
        this.persist();
        this.broadcastState();
        return;
      case "save_slot":
        saveSlot(msg.name.trim(), this.state, this.history);
        this.state.saves = listSaves();
        this.broadcastState();
        return;
      case "load_slot": return this.onLoadSlot(ws, msg.id);
      case "delete_slot":
        deleteSlot(msg.id);
        this.state.saves = listSaves();
        this.broadcastState();
        return;
      case "new_game": return this.onNewGame(ws);
    }
  }

  private onLoadSlot(ws: WebSocket, id: number): void {
    if (this.state.dmBusy)
      return this.send(ws, { type: "error", message: "Wait for the storyteller to finish." });
    const loaded = loadSlot(id);
    if (!loaded) return this.send(ws, { type: "error", message: "That save no longer exists." });
    this.state = loaded.state;
    this.history = loaded.history;
    this.state.dmBusy = false;
    this.state.narratorVoice ??= "male";
    this.state.saves = listSaves();
    this.persist();
    this.cancelAudio(true);
    this.broadcastState();
  }

  private onNewGame(ws: WebSocket): void {
    if (this.state.dmBusy)
      return this.send(ws, { type: "error", message: "Wait for the storyteller to finish." });
    const voice = this.state.narratorVoice;
    this.state = defaultState();
    this.state.narratorVoice = voice;
    this.state.saves = listSaves();
    this.history = [];
    this.persist();
    this.cancelAudio(true);
    this.broadcastState(); // everyone falls back to the join screen (their hero is gone)
  }

  // ---------- message handlers ----------

  private onJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: "join" }>): void {
    const name = msg.playerName.trim();
    this.clients.set(ws, name);
    const existing = this.state.party.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      // stats come from the class template ONLY - bio/looks are flavor and can't buff you
      const pregen = PREGEN_CHARACTERS.find(c => c.id === msg.characterId) ?? PREGEN_CHARACTERS[0]!;
      const character: Character = structuredClone({
        ...pregen,
        id: crypto.randomUUID(),
        name,
        sex: msg.sex,
        age: msg.age,
        bio: msg.bio,
        portraitUrl: msg.portraitUrl,
      });
      this.state.party.push(character);
      this.pushLog("system", `${name} the ${character.className} joins the tale.`);
      // paint their portrait in the background - the game never waits for it
      if (!character.portraitUrl) {
        generatePortrait({
          sex: character.sex, age: character.age,
          className: character.className, description: character.bio,
        })
          .then(url => {
            const c = this.state.party.find(p => p.id === character.id);
            if (c) {
              c.portraitUrl = url;
              this.persist();
              this.broadcastState();
            }
          })
          .catch(err => console.warn("[portrait failed]", (err as Error).message));
      }
    }
    this.persist();
    this.broadcastState();
  }

  private async onAction(ws: WebSocket, text: string): Promise<void> {
    const player = this.clients.get(ws);
    if (!player) return this.send(ws, { type: "error", message: "Join the game first." });
    if (this.state.dmBusy) return this.send(ws, { type: "error", message: "The storyteller is speaking..." });
    if (this.state.pendingCheck)
      return this.send(ws, { type: "error", message: `Waiting for ${this.state.pendingCheck.playerName} to roll.` });
    if (this.state.party.length === 0 || this.state.scene.kind === "fireside")
      return this.send(ws, { type: "error", message: "Begin the campaign first." });

    const playerLine = `${player}: ${text}`;
    this.pushLog(player, text);
    this.history.push({ role: "user", content: playerLine });
    this.setBusy(true);

    try {
      const move = await decideMove(this.state, this.history, playerLine);
      this.state.suggestedActions = move.suggestedActions;
      let instruction = "ENGINE: Narrate the next story beat reacting to the last player action (2-4 sentences).";

      if (move.move === "request_check" && move.check) {
        this.state.pendingCheck = move.check;
        instruction = `ENGINE: ${move.check.playerName} must attempt a ${move.check.skill} check (${move.check.reason}). Narrate a brief, tense lead-in (1-2 sentences) that ends at the moment of uncertainty. Do NOT reveal any outcome.`;
      } else if (move.move === "change_scene" && move.scene) {
        this.applyScene(move.scene);
        instruction = `ENGINE: The party arrives at ${move.scene.name}. Establish the new scene in 3-4 sentences: atmosphere, one sensory detail, and two things worth investigating.`;
      } else if (move.move === "give_item" && move.item) {
        const c = this.state.party.find(p => p.name.toLowerCase() === move.item!.playerName.toLowerCase());
        if (c) c.inventory.push(move.item.item);
        instruction = `ENGINE: ${move.item.playerName} obtains: ${move.item.item}. Weave it into the narration naturally (1-2 sentences).`;
      }

      const narration = await this.narrateAndSpeak(instruction);
      if (move.move === "change_scene") this.state.scene.description = narration.slice(0, 500);
      if (move.move === "request_check" && move.check) this.broadcast({ type: "roll_request", check: move.check });
    } catch (err) {
      this.broadcast({ type: "error", message: "The storyteller lost the thread. Try again." });
      console.error("[dm turn failed]", err);
    } finally {
      this.setBusy(false);
      this.persist();
    }
  }

  private async onRoll(ws: WebSocket): Promise<void> {
    const player = this.clients.get(ws);
    const check = this.state.pendingCheck;
    if (!player || !check) return;
    if (this.state.dmBusy)
      return this.send(ws, { type: "error", message: "Let the storyteller finish..." });
    if (player.toLowerCase() !== check.playerName.toLowerCase())
      return this.send(ws, { type: "error", message: `This roll belongs to ${check.playerName}.` });
    const character = this.state.party.find(c => c.name.toLowerCase() === player.toLowerCase());
    if (!character) return;

    const result = resolveCheck(character, check, this.rng);
    this.state.pendingCheck = null;
    this.broadcast({ type: "roll_result", result });
    const summary = `${result.playerName} rolled ${result.skill}: d20=${result.die}${result.modifier >= 0 ? "+" : ""}${result.modifier} = ${result.total} vs DC ${result.dc} -> ${result.success ? "SUCCESS" : "FAILURE"}${result.critical !== "none" ? ` (natural ${result.die}!)` : ""}`;
    this.pushLog("system", summary);
    this.history.push({ role: "user", content: `ENGINE RESULT: ${summary}` });

    this.setBusy(true);
    try {
      await this.narrateAndSpeak(
        "ENGINE: Narrate what happens given that mechanical result (2-4 sentences). Honor it exactly - do not soften a failure or cheapen a success. A natural 20/1 deserves extra drama.",
      );
    } catch (err) {
      this.broadcast({ type: "error", message: "The storyteller lost the thread. Try again." });
      console.error("[roll narration failed]", err);
    } finally {
      this.setBusy(false);
      this.persist();
    }
  }

  private async onNewCampaign(ws: WebSocket, premise: string): Promise<void> {
    if (this.state.dmBusy) return;
    if (this.state.party.length === 0)
      return this.send(ws, { type: "error", message: "Join with a character first." });

    const party = this.state.party;
    const voice = this.state.narratorVoice;
    this.state = defaultState();
    this.state.party = party;
    this.state.narratorVoice = voice;
    this.state.saves = listSaves();
    this.history = [];
    this.setBusy(true);

    try {
      const partyDesc = party.map(c => `${c.name} the level-${c.level} ${c.className}`).join(", ");
      const move = await decideMove(this.state, this.history, OPENING_INSTRUCTION(premise, partyDesc));
      this.state.suggestedActions = move.suggestedActions;
      // an opening MUST produce a scene - fall back to a generic one so the game never sticks at the fireside
      this.applyScene(
        move.move === "change_scene" && move.scene
          ? move.scene
          : {
              name: "The Crossroads", kind: "crossroads", timeOfDay: "dusk", weather: "clear",
              mood: "travel", exits: ["the road north", "the road south"],
              imagePrompt: "lonely crossroads at dusk with an old wooden signpost, rolling hills, long shadows",
            },
      );
      const narration = await this.narrateAndSpeak(
        `ENGINE: Open the adventure. Establish where the party is and why they are together, ending on an immediate hook (3-5 sentences).`,
      );
      this.state.scene.description = narration.slice(0, 500);
      this.state.campaignName = this.state.scene.name;
    } catch (err) {
      this.broadcast({ type: "error", message: "Could not begin the tale. Is Ollama running?" });
      console.error("[new campaign failed]", err);
    } finally {
      this.setBusy(false);
      this.persist();
    }
  }

  // ---------- shared plumbing ----------

  /** Streamed narration + sentence-streamed voice. Returns the full text. */
  private async narrateAndSpeak(instruction: string): Promise<string> {
    this.broadcast({ type: "narration_start", speaker: "dm" });
    const sentences = new SentenceStream(s => this.queueAudio(s));
    const full = await narrate(this.state, this.history, instruction, chunk => {
      this.broadcast({ type: "narration_chunk", text: chunk });
      sentences.push(chunk);
    });
    sentences.flush();
    this.broadcast({ type: "narration_end" });
    this.history.push({ role: "assistant", content: full });
    if (this.history.length > 40) this.history = this.history.slice(-30);
    this.pushLog("dm", full);
    this.broadcastState();
    return full;
  }

  /** Voice synthesis runs strictly in order but never blocks narration. */
  private queueAudio(sentence: string): void {
    const voice = this.state.narratorVoice;
    const epoch = this.audioEpoch;
    this.audioChain = this.audioChain
      .then(async () => {
        // the speaker only exists where there are ears: skip synthesis for an empty room
        if (this.clients.size === 0 || epoch !== this.audioEpoch) return;
        const controller = new AbortController();
        this.audioAbort = controller;
        try {
          const url = await synthesize(sentence, voice, controller.signal);
          if (url && this.clients.size > 0 && epoch === this.audioEpoch)
            this.broadcast({ type: "audio", url, seq: this.audioSeq++ });
        } finally {
          if (this.audioAbort === controller) this.audioAbort = null;
        }
      })
      .catch(() => { /* voice is optional */ });
  }

  private cancelAudio(notifyClients: boolean): void {
    this.audioEpoch++;
    this.audioAbort?.abort();
    this.audioAbort = null;
    if (notifyClients) this.broadcast({ type: "audio_stop" });
  }

  private applyScene(scene: NonNullable<import("@grimoire/shared").DmMove["scene"]>): void {
    this.state.scene = {
      ...scene,
      description: "",
      imageUrl: null,
    };
    this.refreshSceneImage();
  }

  /** Cache hit shows instantly; a miss paints in the background while the DM keeps talking. */
  private refreshSceneImage(): void {
    const scene = this.state.scene;
    const { cached, pending } = getSceneImage(scene);
    if (cached) {
      scene.imageUrl = cached;
      this.broadcast({ type: "scene_image", url: cached });
    } else if (pending) {
      pending
        .then(url => {
          // only apply if we're still in the same scene by the time the paint dries
          if (this.state.scene.name === scene.name) {
            this.state.scene.imageUrl = url;
            this.broadcast({ type: "scene_image", url });
            this.persist();
          }
        })
        .catch(err => console.warn("[scene image failed]", (err as Error).message));
    }
  }

  private pushLog(who: string, text: string): void {
    this.state.log.push({ who, text });
    if (this.state.log.length > 200) this.state.log = this.state.log.slice(-150);
    logEvent(who, text);
  }

  private setBusy(busy: boolean): void {
    this.state.dmBusy = busy;
    this.broadcastState();
  }

  private persist(): void {
    saveCampaign(this.state, this.history);
  }

  private broadcastState(): void {
    this.broadcast({ type: "state", state: this.state });
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
