import crypto from "node:crypto";
import type { WebSocket } from "ws";
import {
  type Character, type CheckRequest, type ClientMessage, type NarrationSpeaker,
  type NpcSpeaker, type NpcVoiceProfile, type PublicState, type QuestUpdate, type ServerMessage,
} from "@grimoire/shared";
import {
  backgroundRulesById, buildLevelOneCharacter, buildLevelThreeCharacter, classRulesById,
  checkRequestFromIntent, raceRulesById, resolveCheck, seededRng, validateBuildChoices,
  validateCharacterChoices, type CharacterBuildChoices, type Rng,
} from "@grimoire/rules";
import { decideMove, narrate } from "./dm.js";
import { generatePortrait, getSceneImage, SentenceStream, synthesize } from "./media.js";
import { deleteSlot, listSaves, loadCampaign, loadSlot, logEvent, saveCampaign, saveSlot } from "./db.js";
import type { ChatMessage } from "./ollama.js";
import { IdleShutdown } from "./lifecycle.js";
import { CONFIG } from "./config.js";

const OPENING_INSTRUCTION = (premise: string, party: string) =>
  `ENGINE: Begin a brand-new adventure for this party: ${party}.
Premise wish from the players: "${premise || "surprise us"}".
Your move MUST be "change_scene" - invent an evocative opening location where the adventure hooks the party immediately.
Also start one concise main quest for that hook using the structured "quest" field.
The scene image must visibly include the location and the NPC, creature, or event delivering that hook.`;

function hydrateState(state: PublicState): PublicState {
  state.quests ??= [];
  state.npcVoices ??= {};
  state.pendingNpc ??= null;
  return state;
}

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
    pendingNpc: null,
    dmBusy: false,
    narratorVoice: "male",
    quests: [],
    npcVoices: {},
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
  private idleShutdown: IdleShutdown;

  get clientCount(): number {
    return this.clients.size;
  }

  constructor(options: { rng?: Rng; onIdle?: () => void; idleShutdownMs?: number } = {}) {
    this.rng = options.rng ?? seededRng(crypto.randomBytes(4).readUInt32LE(0));
    this.idleShutdown = new IdleShutdown(options.idleShutdownMs ?? 15_000, options.onIdle ?? (() => {}));
    const saved = loadCampaign();
    this.state = hydrateState(saved?.state ?? defaultState());
    this.history = saved?.history ?? [];
    this.state.dmBusy = false; // never resume mid-generation
    this.state.narratorVoice ??= "male"; // older saves may predate this field
    this.state.saves = listSaves();
    this.refreshSceneImage();
  }

  // ---------- connection lifecycle ----------

  addClient(ws: WebSocket): void {
    this.idleShutdown.clientConnected();
    this.clients.set(ws, "");
    this.send(ws, { type: "state", state: this.state });
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0) {
      // Stop an in-flight sidecar request as well as skipping anything still queued.
      this.cancelAudio(false);
      this.idleShutdown.roomBecameEmpty();
    }
    // autosave the moment someone leaves; nothing is ever lost to a closed tab
    this.persist();
  }

  async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "join": return this.onJoin(ws, msg);
      case "action": return this.onAction(ws, msg.text, msg.mode);
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
    this.state = hydrateState(loaded.state);
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
    const existing = this.state.party.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      // Mechanics come only from validated SRD choices; bio/looks remain flavor.
      const rules = classRulesById(msg.characterId) ?? classRulesById("fighter")!;
      const abilities = msg.abilities ?? rules.recommendedAbilities;
      let base: Character;
      if (msg.raceId && msg.abilityMethod && msg.backgroundId && msg.equipmentPackageId) {
        const raceRules = raceRulesById(msg.raceId);
        const backgroundRules = backgroundRulesById(msg.backgroundId);
        if (!raceRules || !backgroundRules)
          return this.send(ws, { type: "error", message: "That character option is not part of the SRD ruleset." });
        const choices: CharacterBuildChoices = {
          classRules: rules, raceRules, subraceId: msg.subraceId,
          abilityMethod: msg.abilityMethod, abilities,
          racialAbilityChoices: msg.racialAbilityChoices ?? [],
          classSkills: msg.proficientSkills ?? [], racialSkills: msg.racialSkills ?? [],
          backgroundRules, backgroundName: msg.backgroundName ?? backgroundRules.label,
          backgroundSkills: msg.backgroundSkills ?? [], alignment: msg.alignment ?? "Neutral",
          personalityTraits: msg.personalityTraits ?? [], ideal: msg.ideal ?? "",
          bond: msg.bond ?? "", flaw: msg.flaw ?? "", extraLanguages: msg.languages ?? [],
          equipmentPackageId: msg.equipmentPackageId,
        };
        const validationError = validateBuildChoices(choices);
        if (validationError) return this.send(ws, { type: "error", message: validationError });
        base = buildLevelOneCharacter(crypto.randomUUID(), name, choices);
      } else {
        // Reconnect/script compatibility for identities created before the full 2014 builder.
        const proficientSkills = msg.proficientSkills ?? [...rules.recommendedSkills];
        const validationError = validateCharacterChoices(rules, abilities, proficientSkills);
        if (validationError) return this.send(ws, { type: "error", message: validationError });
        base = buildLevelThreeCharacter(crypto.randomUUID(), name, rules, abilities, proficientSkills);
      }
      const character: Character = structuredClone({
        ...base,
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
    this.clients.set(ws, name);
    this.persist();
    this.broadcastState();
  }

  private async onAction(ws: WebSocket, text: string, mode: "act" | "speak" | "ask_dm"): Promise<void> {
    const player = this.clients.get(ws);
    if (!player) return this.send(ws, { type: "error", message: "Join the game first." });
    if (this.state.dmBusy) return this.send(ws, { type: "error", message: "The storyteller is speaking..." });
    if (this.state.pendingCheck)
      return this.send(ws, { type: "error", message: `Waiting for ${this.state.pendingCheck.playerName} to roll.` });
    if (this.state.party.length === 0 || this.state.scene.kind === "fireside")
      return this.send(ws, { type: "error", message: "Begin the campaign first." });

    const playerLine = mode === "speak"
      ? `${player} says to an NPC: "${text}"`
      : mode === "ask_dm"
        ? `${player} asks the Storyteller out of character: "${text}"`
        : `${player}: ${text}`;
    this.pushLog(player, mode === "ask_dm" ? `Ask DM: ${text}` : text, "player");
    this.history.push({ role: "user", content: playerLine });
    this.setBusy(true);

    try {
      if (mode === "ask_dm") {
        await this.narrateAndSpeak(
          `ENGINE: Answer the player's question directly as the Storyteller/DM in 2-4 concise sentences.
Clarify established world facts, the active main quest, and genuinely available options. You may
establish a small missing personal-world fact (such as whether the hero has a home) when it does not
contradict state. Do not advance time or perform the action for them; if they want to do it, tell them
to choose Act next. Do not put the answer in quotation marks.`,
          player,
          { speaker: { kind: "dm", name: "Storyteller / DM" }, logKind: "dm" },
        );
        return;
      }

      const modeInstruction = mode === "speak"
        ? `\nINTERACTION MODE: SPEAK. The player is deliberately addressing an NPC. Fill "npc" with
the responding NPC's stable name, sex, and a few personality adjectives. Let the NPC answer
substantively unless refusal is an intentional character choice; even a refusal should expose a
motive, boundary, clue, or next conversational opening. Ordinary conversation needs no roll, but
attempts to persuade, deceive, intimidate, or perform under meaningful stakes should request the
appropriate check.`
        : "\nINTERACTION MODE: ACT.";
      const move = await decideMove(this.state, this.history, `${playerLine}${modeInstruction}`);
      this.state.suggestedActions = move.suggestedActions;
      if (move.mood && move.move !== "change_scene") this.state.scene.mood = move.mood;
      if (move.quest) this.applyQuestUpdate(move.quest);
      this.state.pendingNpc = null;
      let instruction = "ENGINE: Narrate the next story beat reacting to the last player action (2-4 sentences).";
      let presentation: { speaker: NarrationSpeaker; voice?: string; logKind: "dm" | "npc" } | undefined;

      if (move.move === "request_check" && move.check) {
        const request = checkRequestFromIntent(move.check);
        this.state.pendingCheck = request;
        this.state.pendingNpc = mode === "speak" ? move.npc ?? null : null;
        instruction = `ENGINE: ${request.playerName} must attempt a ${request.skill} check (${request.reason}). Narrate a brief, tense lead-in (1-2 sentences) that ends at the moment of uncertainty. Do NOT reveal any outcome.`;
      } else if (move.move === "change_scene" && move.scene) {
        this.applyScene(move.scene);
        instruction = `ENGINE: The party arrives at ${move.scene.name}. Establish the new scene in 3-4 sentences: atmosphere, one sensory detail, and two things worth investigating.`;
      } else if (move.move === "give_item" && move.item) {
        const c = this.state.party.find(p => p.name.toLowerCase() === move.item!.playerName.toLowerCase());
        if (c) {
          c.inventory.push(move.item.item);
          this.pushLog("system", `${c.name} received ${move.item.item}.`);
        }
        instruction = `ENGINE: ${move.item.playerName} obtains: ${move.item.item}. Weave it into the narration naturally (1-2 sentences).`;
      }

      if (mode === "speak" && move.move !== "request_check" && move.npc) {
        const profile = this.npcVoice(move.npc);
        instruction = `ENGINE: Reply only as ${JSON.stringify(profile.name)} in direct spoken dialogue.
Give a substantial 2-4 sentence response consistent with this personality: ${profile.personality}.
Do not add storyteller narration, headings, or quotation marks. Do not speak or decide for the player.`;
        presentation = {
          speaker: { kind: "npc", name: profile.name }, voice: profile.voice, logKind: "npc",
        };
      }

      const narration = await this.narrateAndSpeak(instruction, player, presentation);
      if (move.move === "change_scene") this.state.scene.description = narration.slice(0, 500);
      if (move.move === "request_check" && this.state.pendingCheck)
        this.broadcast({ type: "roll_request", check: this.state.pendingCheck });
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
    const pendingNpc = this.state.pendingNpc;
    this.state.pendingNpc = null;
    this.broadcast({ type: "roll_result", result });
    const summary = `${result.playerName} rolled ${result.skill}: d20=${result.die}${result.modifier >= 0 ? "+" : ""}${result.modifier} = ${result.total} vs DC ${result.dc} -> ${result.success ? "SUCCESS" : "FAILURE"}${result.critical !== "none" ? ` (natural ${result.die}!)` : ""}`;
    this.pushLog("system", summary);
    this.history.push({ role: "user", content: `ENGINE RESULT: ${summary}` });

    this.setBusy(true);
    try {
      if (pendingNpc) {
        const profile = this.npcVoice(pendingNpc);
        await this.narrateAndSpeak(
          `ENGINE: Reply only as ${JSON.stringify(profile.name)} in direct dialogue after the resolved
social check. Honor the mechanical result exactly. On failure, preserve the active quest by offering
a cost, complication, alternative route, or new requirement instead of a dead end. Use 2-4 concise
sentences, no headings, narration, quotation marks, or player dialogue.`,
          player,
          { speaker: { kind: "npc", name: profile.name }, voice: profile.voice, logKind: "npc" },
        );
      } else {
        await this.narrateAndSpeak(
          "ENGINE: Narrate what happens given that mechanical result (2-4 sentences). Honor it exactly - do not soften a failure or cheapen a success. A failure changes the cost, danger, or available route instead of erasing the active quest. Natural 1/20 do not automatically change an ability check result.",
          player,
        );
      }
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
      this.applyQuestUpdate(move.quest ?? {
        action: "start",
        title: "Follow The First Lead",
        objective: `Investigate the immediate hook at ${this.state.scene.name}.`,
        summary: "The opening event points toward a larger problem that needs an adventurer.",
        isMain: true,
      });
      const narration = await this.narrateAndSpeak(
        `ENGINE: Open the adventure. Establish where you are and why the adventure starts here, ending on an immediate hook (3-5 sentences). Never describe a solo player as traveling with their own character.`,
        party.length === 1 ? party[0]!.name : undefined,
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
  private async narrateAndSpeak(
    instruction: string,
    viewpointName?: string,
    presentation: {
      speaker: NarrationSpeaker;
      voice?: string;
      logKind: "dm" | "npc";
    } = { speaker: { kind: "dm", name: "Storyteller" }, logKind: "dm" },
  ): Promise<string> {
    this.broadcast({ type: "narration_start", speaker: presentation.speaker });
    const voice = presentation.voice ?? this.state.narratorVoice;
    const sentences = new SentenceStream(s => this.queueAudio(s, voice));
    const full = await narrate(this.state, this.history, instruction, chunk => {
      this.broadcast({ type: "narration_chunk", text: chunk });
      sentences.push(chunk);
    }, viewpointName);
    sentences.flush();
    this.broadcast({ type: "narration_end" });
    this.history.push({ role: "assistant", content: full });
    if (this.history.length > 40) this.history = this.history.slice(-30);
    this.pushLog(presentation.logKind === "dm" ? "dm" : presentation.speaker.name, full, presentation.logKind);
    this.broadcastState();
    return full;
  }

  /** Voice synthesis runs strictly in order but never blocks narration. */
  private queueAudio(sentence: string, voice: string = this.state.narratorVoice): void {
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

  /** Graceful host shutdown: persist the final snapshot and stop optional media work. */
  shutdown(): void {
    this.idleShutdown.cancel();
    this.cancelAudio(false);
    this.persist();
  }

  private applyScene(scene: NonNullable<import("@grimoire/shared").DmMove["scene"]>): void {
    this.state.scene = {
      ...scene,
      description: "",
      imageUrl: null,
    };
    this.refreshSceneImage();
  }

  private npcVoice(npc: NpcSpeaker): NpcVoiceProfile {
    const key = npc.name.trim().toLowerCase();
    const existing = this.state.npcVoices[key];
    if (existing) return existing;
    const voices = CONFIG.npcVoices[npc.sex];
    const personality = npc.personality.toLowerCase();
    let index: number;
    if (/fierce|gruff|rough|stern|angry|bold/.test(personality)) index = 0;
    else if (/warm|kind|gentle|soft|patient|calm/.test(personality)) index = 1;
    else if (/playful|sly|quick|young|mischievous|cheerful/.test(personality)) index = 2;
    else if (/formal|cold|reserved|solemn|precise|noble/.test(personality)) index = 3;
    else index = crypto.createHash("sha256").update(key).digest()[0]! % voices.length;
    const profile: NpcVoiceProfile = { ...npc, name: npc.name.trim(), voice: voices[index % voices.length]! };
    this.state.npcVoices[key] = profile;
    return profile;
  }

  private applyQuestUpdate(update: QuestUpdate): void {
    const key = update.title.trim().toLowerCase();
    let quest = this.state.quests.find(candidate => candidate.title.trim().toLowerCase() === key);
    if (!quest) {
      quest = {
        id: crypto.randomUUID(),
        title: update.title.trim(),
        objective: update.objective.trim(),
        summary: update.summary.trim(),
        status: update.action === "complete" ? "completed" : update.action === "fail" ? "failed" : "active",
        isMain: update.isMain,
        updatedAt: new Date().toISOString(),
      };
      this.state.quests.unshift(quest);
    } else {
      quest.objective = update.objective.trim();
      quest.summary = update.summary.trim();
      quest.isMain ||= update.isMain;
      quest.status = update.action === "complete" ? "completed" : update.action === "fail" ? "failed" : "active";
      quest.updatedAt = new Date().toISOString();
    }
    const verb = update.action === "start" ? "Quest Started" : update.action === "advance" ? "Quest Updated" : update.action === "complete" ? "Quest Completed" : "Quest Failed";
    this.pushLog("system", `${verb}: ${quest.title} — ${quest.objective}`, "system");
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

  private pushLog(who: string, text: string, kind?: "dm" | "player" | "npc" | "system"): void {
    const resolvedKind = kind ?? (who === "dm" ? "dm" : who === "system" ? "system" : "player");
    this.state.log.push({ who, text, kind: resolvedKind });
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
