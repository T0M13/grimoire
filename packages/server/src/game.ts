import crypto from "node:crypto";
import type { WebSocket } from "ws";
import {
  npcKey, RelationshipUpdateSchema, type Character, type CheckRequest, type ClientMessage,
  type NarrationSpeaker, type NpcRelationship, type NpcSpeaker, type NpcVoiceProfile,
  type PartyActivity, type PartyPresence, type PublicState, type QuestUpdate,
  type RelationshipEvent, type RelationshipStatus, type RelationshipUpdate, type ServerMessage,
} from "@grimoire/shared";
import {
  backgroundRulesById, buildLevelOneCharacter, buildLevelThreeCharacter, classRulesById,
  checkRequestFromIntent, raceRulesById, resolveCheck, seededRng, validateBuildChoices,
  validateCharacterChoices, type CharacterBuildChoices, type Rng,
} from "@grimoire/rules";
import { decideMove, narrate, sanitizePlayerFacingText } from "./dm.js";
import { assetImageExists, generatePortrait, getNpcPortrait, getSceneImage, sceneSignature, SentenceStream, synthesize } from "./media.js";
import { deleteSlot, listSaves, loadCampaign, loadSlot, logEvent, saveCampaign, saveSlot } from "./db.js";
import type { ChatMessage } from "./ollama.js";
import { IdleShutdown } from "./lifecycle.js";
import { CONFIG } from "./config.js";

// Random campaign seeds keep every run fresh - the model left alone gravitates to the same
// few motifs (mysterious whispers, market stalls). Players' own premise always wins.
const SEED_PLACES = [
  "a mountain fortress-monastery", "a smugglers' port at low tide", "a mining town dug too deep",
  "a river barge convoy", "a frontier fort at the edge of a cursed forest", "a grand wizard academy",
  "a drowned coastal ruin at low tide", "a desert caravanserai", "a besieged castle",
  "an underground dwarven highway", "a masquerade in a noble palace", "a prison carved into a cliff",
  "a whaling village under a frozen sun", "a tournament ground between kingdoms", "a plague-quarantined district",
  "an ancient battlefield full of scavengers", "a swamp hermitage", "a windmill-dotted farmland in revolt",
];
const SEED_THREATS = [
  "a cult trying to wake something under the earth", "a doppelganger replacing town leaders",
  "a dragon demanding an impossible tribute", "a necromancer recruiting the recently dead",
  "a devil buying memories with contracts", "a war band gathering under a new warlord",
  "a thieves' guild civil war", "a rot that turns crops and animals wrong",
  "a mad inventor's constructs slipping out of control", "a noble family hiding a monstrous heir",
  "a mercenary company switching sides mid-war", "a fey bargain gone sour for a whole village",
];
const SEED_TWISTS = [
  "the obvious villain is protecting everyone from something worse",
  "a party member is carrying the thing everyone wants without knowing it",
  "the victim staged everything", "the authority who hired help is the traitor",
  "two enemies must be helped at the same time", "the monster wants to surrender",
  "the treasure is alive", "someone the party trusts lies from the first scene",
];
const pickSeed = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

const OPENING_INSTRUCTION = (premise: string, party: string) =>
  `ENGINE: Begin a brand-new adventure for this party: ${party}.
${premise
    ? `Premise wish from the players (this wins over everything below): "${premise}".`
    : `Campaign seed - build the opening from these three ingredients:
- place: ${pickSeed(SEED_PLACES)}
- threat: ${pickSeed(SEED_THREATS)}
- hidden twist (keep secret, reveal later): ${pickSeed(SEED_TWISTS)}`}
BANNED cliches (overused - do not use): mysterious whispers, whispering voices, market stalls,
abandoned markets, hooded strangers in corners, "strange thefts in the area".
Your move MUST be "change_scene" - invent a clear opening location where the adventure hooks the party immediately.
Also start one concise main quest for that hook using the structured "quest" field.
List every named non-player person or creature currently visible in scene.occupants; never include
party members there. The scene image must show the location itself and physical evidence of that
hook - never living subjects.`;

type NpcVoiceTone = "forceful" | "warm" | "lively" | "formal" | "neutral";

/** Deterministic local casting: no extra LLM/model call, and the saved profile remains authoritative. */
export function castNpcVoice(npc: NpcSpeaker): { voice: string; speed: number; tone: NpcVoiceTone } {
  const cues = `${npc.personality} ${npc.appearance}`.toLowerCase();
  let tone: NpcVoiceTone;
  if (/fierce|gruff|rough|stern|angry|bold|harsh|commanding|massive|brutal/.test(cues)) tone = "forceful";
  else if (/warm|kind|gentle|soft|patient|calm|friendly|caring/.test(cues)) tone = "warm";
  else if (/playful|sly|quick|young|mischievous|cheerful|bright|excited|nervous/.test(cues)) tone = "lively";
  else if (/formal|cold|reserved|solemn|precise|noble|scholarly|measured/.test(cues)) tone = "formal";
  else tone = "neutral";

  const cast = CONFIG.npcVoices[npc.sex];
  let voice = cast[tone];
  if (tone === "neutral") {
    const pool = Object.values(cast);
    const slot = crypto.createHash("sha256").update(npcKey(npc.name)).digest()[0]! % pool.length;
    voice = pool[slot]!;
  }

  let speed = tone === "lively" ? 1.07 : tone === "forceful" ? 0.94 : tone === "formal" ? 0.96 : 0.99;
  if (/ancient|very old|slow|weary|tired|deliberate|sleepy/.test(cues)) speed = 0.88;
  else if (/hurried|rapid|energetic|excited|nervous/.test(cues)) speed = 1.09;
  if (npc.entityType === "creature" && !/small|quick|young|tiny/.test(cues)) speed -= 0.03;
  const identityJitter = (crypto.createHash("sha256").update(`pace:${npcKey(npc.name)}`).digest()[0]! % 5 - 2) / 100;
  speed = Math.min(1.12, Math.max(0.82, speed + identityJitter));
  return { voice, speed: Number(speed.toFixed(2)), tone };
}

const RELATIONSHIP_EFFECTS: Record<Exclude<RelationshipEvent, "none">, readonly [number, number]> = {
  met: [0, 0],
  helped: [12, 4],
  bonded: [5, 12],
  offended: [-8, -8],
  threatened: [-15, -10],
  harmed: [-25, -15],
  betrayed: [-35, -25],
  mutual_romance: [5, 10],
  romance_ended: [0, -15],
};

const clampRelationship = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));

export function relationshipStatus(trust: number, affection: number): RelationshipStatus {
  if (trust <= -50) return "hostile";
  if (trust <= -20) return "rival";
  if (trust >= 55) return "trusted";
  if (trust >= 20 || affection >= 25) return "friend";
  return "acquaintance";
}

/** Apply a model-selected event through fixed server-owned rules. */
export function applyRelationshipEvent(
  state: PublicState,
  update: RelationshipUpdate,
  event: RelationshipEvent,
  updatedAt = new Date().toISOString(),
): boolean {
  if (event === "none") return false;
  const character = state.party.find(candidate => npcKey(candidate.name) === npcKey(update.playerName));
  const targetKey = npcKey(update.npcName);
  const npc = state.npcVoices[targetKey];
  if (!character || !npc || npcKey(npc.name) === npcKey(character.name)) return false;

  state.npcRelationships ??= {};
  const byNpc = state.npcRelationships[character.id] ??= {};
  const previous = byNpc[targetKey];
  if (event === "mutual_romance") {
    const eligible = state.contentTone === "mature"
      && character.age !== "young"
      && npc.entityType === "person"
      && npc.adult === true
      && (previous?.trust ?? 0) >= 20
      && (previous?.affection ?? 0) >= 25;
    if (!eligible) return false;
  }

  const [trustDelta, affectionDelta] = RELATIONSHIP_EFFECTS[event];
  const trust = clampRelationship((previous?.trust ?? 0) + trustDelta);
  const affection = clampRelationship((previous?.affection ?? 0) + affectionDelta);
  const endsRomance = event === "romance_ended" || event === "threatened"
    || event === "harmed" || event === "betrayed" || trust <= -20 || affection <= 0;
  const status = event === "mutual_romance"
    ? "romantic"
    : previous?.status === "romantic" && !endsRomance
      ? "romantic"
      : relationshipStatus(trust, affection);
  byNpc[targetKey] = {
    npcName: npc.name,
    trust,
    affection,
    status,
    note: update.reason.trim().slice(0, 160),
    updatedAt,
  };
  return true;
}

function hydrateRelationships(state: PublicState): void {
  const partyById = new Map(state.party.map(character => [character.id, character]));
  const normalized: Record<string, Record<string, NpcRelationship>> = {};
  for (const [characterId, rawByNpc] of Object.entries(state.npcRelationships ?? {})) {
    const character = partyById.get(characterId);
    if (!character || !rawByNpc || typeof rawByNpc !== "object") continue;
    const byNpc: Record<string, NpcRelationship> = {};
    for (const rawRelationship of Object.values(rawByNpc)) {
      if (!rawRelationship || typeof rawRelationship !== "object") continue;
      const relationship = rawRelationship as Partial<NpcRelationship>;
      const npcName = typeof relationship.npcName === "string" ? relationship.npcName.trim().slice(0, 60) : "";
      if (!npcName) continue;
      const trust = clampRelationship(Number.isFinite(relationship.trust) ? relationship.trust! : 0);
      const affection = clampRelationship(Number.isFinite(relationship.affection) ? relationship.affection! : 0);
      const knownNpc = state.npcVoices[npcKey(npcName)];
      const canPreserveRomance = character.age !== "young"
        && knownNpc?.entityType === "person"
        && knownNpc.adult === true;
      const status = relationship.status === "romantic" && canPreserveRomance
        ? "romantic"
        : relationshipStatus(trust, affection);
      byNpc[npcKey(npcName)] = {
        npcName,
        trust,
        affection,
        status,
        note: typeof relationship.note === "string" ? relationship.note.trim().slice(0, 160) : "",
        updatedAt: typeof relationship.updatedAt === "string"
          ? relationship.updatedAt
          : new Date(0).toISOString(),
      };
    }
    if (Object.keys(byNpc).length > 0) normalized[characterId] = byNpc;
  }
  state.npcRelationships = normalized;

  const pending = RelationshipUpdateSchema.safeParse(state.pendingRelationship);
  state.pendingRelationship = state.pendingCheck && pending.success ? pending.data : null;
}

function hydrateState(state: PublicState): PublicState {
  state.quests ??= [];
  state.npcVoices ??= {};
  state.pendingNpc ??= null;
  state.artStyle ??= "painting";
  state.contentTone ??= "standard";
  state.pendingRelationship ??= null;
  state.npcRelationships ??= {};
  state.scene.occupants ??= [];
  state.scene.description = sanitizePlayerFacingText(state.scene.description);
  state.log = state.log
    .map(entry => {
      const legacyPlayer = !entry.kind && !["dm", "system", "storyteller", "storyteller / dm"]
        .includes(entry.who.trim().toLowerCase());
      return entry.kind === "player" || legacyPlayer
        ? entry
        : { ...entry, text: sanitizePlayerFacingText(entry.text) };
    })
    .filter(entry => entry.text.length > 0);
  const hydrateSubject = (subject: NpcSpeaker) => {
    subject.entityType ??= "person";
    subject.appearance ||= subject.entityType === "creature"
      ? "distinctive fantasy creature with a recognizable silhouette"
      : "distinctive fantasy local in practical clothing";
  };
  for (const occupant of state.scene.occupants) hydrateSubject(occupant);
  if (state.pendingNpc) hydrateSubject(state.pendingNpc);
  for (const [key, profile] of Object.entries(state.npcVoices)) {
    hydrateSubject(profile);
    const delivery = castNpcVoice(profile);
    profile.voice ||= delivery.voice;
    profile.voiceSpeed ??= delivery.speed;
    profile.portraitUrls ??= profile.portraitUrl
      ? { [state.artStyle]: profile.portraitUrl }
      : {};
    if (key !== npcKey(profile.name)) {
      state.npcVoices[npcKey(profile.name)] ??= profile;
      delete state.npcVoices[key];
    }
  }
  hydrateRelationships(state);
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
      occupants: [],
      imagePrompt: "cozy stone hearth with a crackling warm fire, worn leather armchairs, thick blankets, steaming mugs on a small wooden table, book-lined walls, soft golden firelight, gentle snowy night visible through a small window, inviting and peaceful",
      imageUrl: null,
    },
    party: [],
    log: [],
    suggestedActions: [],
    pendingCheck: null,
    pendingNpc: null,
    pendingRelationship: null,
    dmBusy: false,
    narratorVoice: "male",
    artStyle: "painting",
    contentTone: "standard",
    quests: [],
    npcVoices: {},
    npcRelationships: {},
    saves: [],
  };
}

export class GameRoom {
  state: PublicState;
  history: ChatMessage[];
  private clients = new Map<WebSocket, string>(); // socket -> player name ("" until joined)
  private activities = new Map<string, { playerName: string; activity: PartyActivity; detail?: string }>();
  private audioChain: Promise<void> = Promise.resolve();
  private audioAbort: AbortController | null = null;
  private audioEpoch = 0;
  private audioSeq = 0;
  private paintingScene: string | null = null; // in-flight scene-art guard
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
    this.history = (saved?.history ?? []).map(message => message.role === "assistant"
      ? { ...message, content: sanitizePlayerFacingText(message.content) }
      : message);
    this.state.dmBusy = false; // never resume mid-generation
    this.state.narratorVoice ??= "male"; // older saves may predate this field
    this.state.saves = listSaves();
    this.refreshSceneImage();
    this.refreshVisiblePortraits();
  }

  // ---------- connection lifecycle ----------

  addClient(ws: WebSocket): void {
    this.idleShutdown.clientConnected();
    this.clients.set(ws, "");
    this.send(ws, { type: "state", state: this.publicStateSnapshot() });
    this.sendPresence(ws);
    // safety net: if the current scene has no art (e.g. ComfyUI was still booting when we
    // asked, or an earlier attempt failed), retry now that someone is looking at it
    if (!this.state.scene.imageUrl) this.refreshSceneImage();
  }

  removeClient(ws: WebSocket): void {
    const playerName = this.clients.get(ws) ?? "";
    this.clients.delete(ws);
    if (playerName && !this.isPlayerOnline(playerName)
      && this.state.party.some(character => npcKey(character.name) === npcKey(playerName))) {
      this.clearActivity(playerName);
      this.broadcastPresence();
    }
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
      case "set_art_style":
        this.state.artStyle = msg.style;
        this.state.scene.imageUrl = null;
        this.refreshSceneImage(); // repaint the current scene in the chosen style
        this.refreshVisiblePortraits();
        this.persist();
        this.broadcastState();
        return;
      case "set_content_tone": {
        const player = this.clients.get(ws);
        if (!player || !this.state.party.some(character => npcKey(character.name) === npcKey(player)))
          return this.send(ws, { type: "error", message: "Join the table before changing shared content settings." });
        if (this.state.dmBusy)
          return this.send(ws, { type: "error", message: "Wait for the storyteller to finish." });
        this.state.contentTone = msg.tone;
        this.persist();
        this.broadcastState();
        return;
      }
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
      case "join_hero": return this.onJoinHero(ws, msg.character);
      case "presence_hint": {
        const player = this.clients.get(ws);
        if (!player) return;
        const key = npcKey(player);
        const currentActivity = this.activities.get(key)?.activity;
        // only toggle between idle-ish states; never clobber a real in-flight activity
        if (msg.writing && (currentActivity === undefined || currentActivity === "ready"))
          this.setActivity(player, "writing");
        else if (!msg.writing && currentActivity === "writing")
          this.clearActivity(player);
        else return;
        this.broadcastPresence();
        return;
      }
    }
  }

  /** Join with an exported hero file: same hero id/name continues, a new hero enters this world. */
  private onJoinHero(ws: WebSocket, imported: Character): void {
    const name = imported.name.trim();
    if (!name) return this.send(ws, { type: "error", message: "That hero file has no name." });
    const existing = this.state.party.find(
      c => c.id === imported.id || npcKey(c.name) === npcKey(name),
    );
    if (existing) {
      // the same hero returns to this journey and simply continues
      this.clients.set(ws, existing.name);
    } else {
      if (imported.hp <= 0)
        return this.send(ws, { type: "error", message: "This hero is dead. Dead is dead - create a new hero." });
      const character: Character = structuredClone({
        ...imported,
        name,
        hp: Math.min(imported.hp, imported.maxHp),
        // portraits from another host do not exist here; repaint in the background
        portraitUrl: assetImageExists(imported.portraitUrl) ? imported.portraitUrl : null,
      });
      this.state.party.push(character);
      this.pushLog("system", `${name} the ${character.className} arrives from another tale.`, "system");
      if (!character.portraitUrl) this.paintHeroPortrait(character);
      this.clients.set(ws, name);
    }
    this.persist();
    this.broadcastState();
    this.broadcastPresence();
  }

  private paintHeroPortrait(character: Character): void {
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

  /** Snapshot for journey export downloads. */
  getExportSnapshot(): { state: PublicState; history: ChatMessage[] } {
    return { state: this.state, history: this.history };
  }

  /** Called after an out-of-band save-slot change (e.g. HTTP journey import). */
  notifySavesChanged(): void {
    this.state.saves = listSaves();
    this.broadcastState();
  }

  private onLoadSlot(ws: WebSocket, id: number): void {
    if (this.state.dmBusy)
      return this.send(ws, { type: "error", message: "Wait for the storyteller to finish." });
    if (!this.canReplaceJourney(ws))
      return this.send(ws, { type: "error", message: "Join the current party before replacing its shared journey." });
    const loaded = loadSlot(id);
    if (!loaded) return this.send(ws, { type: "error", message: "That save no longer exists." });
    this.state = hydrateState(loaded.state);
    this.history = loaded.history.map(message => message.role === "assistant"
      ? { ...message, content: sanitizePlayerFacingText(message.content) }
      : message);
    this.state.dmBusy = false;
    this.state.narratorVoice ??= "male";
    this.state.saves = listSaves();
    this.reconcileClientIdentities();
    this.persist();
    this.cancelAudio(true);
    this.refreshSceneImage(); // repaint if the loaded scene's art is missing
    this.refreshVisiblePortraits();
    this.broadcastState();
    this.broadcastPresence();
    this.send(ws, { type: "journey_ready", action: "load", saveId: id });
  }

  private onNewGame(ws: WebSocket): void {
    if (this.state.dmBusy)
      return this.send(ws, { type: "error", message: "Wait for the storyteller to finish." });
    if (!this.canReplaceJourney(ws))
      return this.send(ws, { type: "error", message: "Join the current party before replacing its shared journey." });
    const voice = this.state.narratorVoice;
    const artStyle = this.state.artStyle;
    this.state = defaultState();
    this.state.narratorVoice = voice;
    this.state.artStyle = artStyle;
    this.state.saves = listSaves();
    this.history = [];
    this.reconcileClientIdentities();
    this.persist();
    this.cancelAudio(true);
    this.refreshSceneImage(); // the fresh fireside needs its art painted
    this.broadcastState(); // everyone falls back to the join screen (their hero is gone)
    this.broadcastPresence();
    this.send(ws, { type: "journey_ready", action: "new" });
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
      this.pushLog("system", `${name} the ${character.className} joined the party.`, "system");
      // paint their portrait in the background - the game never waits for it
      if (!character.portraitUrl) this.paintHeroPortrait(character);
    }
    this.clients.set(ws, name);
    this.persist();
    this.broadcastState();
    this.broadcastPresence();
  }

  private async onAction(ws: WebSocket, text: string, mode: "act" | "speak" | "ask_dm"): Promise<void> {
    const player = this.clients.get(ws);
    if (!player) return this.send(ws, { type: "error", message: "Join the game first." });
    if (!this.state.party.some(character => npcKey(character.name) === npcKey(player))) {
      this.clients.set(ws, "");
      this.broadcastPresence();
      return this.send(ws, { type: "error", message: "Your hero is not part of this journey. Join again first." });
    }
    if (this.state.dmBusy) return this.send(ws, { type: "error", message: "The storyteller is speaking..." });
    if (this.state.pendingCheck)
      return this.send(ws, { type: "error", message: `Waiting for ${this.state.pendingCheck.playerName} to roll.` });
    if (this.state.party.length === 0 || this.state.scene.kind === "fireside")
      return this.send(ws, { type: "error", message: "Begin the campaign first." });

    // the table has moved on - stop reading stale narration and start fresh with this turn
    this.cancelAudio(true);

    const playerLine = mode === "speak"
      ? `${player} says to an NPC: "${text}"`
      : mode === "ask_dm"
        ? `${player} asks the Storyteller out of character: "${text}"`
        : `${player}: ${text}`;
    this.pushLog(player, mode === "ask_dm" ? `Ask DM: ${text}` : text, "player");
    this.history.push({ role: "user", content: playerLine });
    this.setActivity(player, mode === "speak" ? "speaking" : mode === "ask_dm" ? "asking_dm" : "acting", text);
    this.setBusy(true);

    try {
      if (mode === "ask_dm") {
        await this.narrateAndSpeak(
          `ENGINE: Answer the player's question directly as the Storyteller/DM in 1-3 short sentences.
Clarify established world facts, the active main quest, and genuinely available options. You may
establish a small missing personal-world fact (such as whether the hero has a home) when it does not
contradict state. Do not advance time or perform the action for them; if they want to do it, tell them
to choose Act next. Use plain words and no decorative description. Do not put the answer in quotation marks.`,
          player,
          { speaker: { kind: "dm", name: "Storyteller / DM" }, logKind: "dm" },
        );
        return;
      }

      const modeInstruction = mode === "speak"
        ? `\nINTERACTION MODE: SPEAK. The player is deliberately addressing an NPC. Fill "npc" with
the responding subject's stable name, voice-family sex, person/creature type, a concrete physical
appearance, and a few personality adjectives. Reuse known appearance exactly. Let the NPC answer
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
      this.state.pendingRelationship = null;
      const moveNpc = move.npc ? this.npcVoice(move.npc) : null;
      const relationship = move.relationship
        && npcKey(move.relationship.playerName) === npcKey(player)
        ? move.relationship
        : null;
      let instruction = "ENGINE: Narrate the next story beat in 1-3 short, plain sentences; prefer 1-2. Use direct words, few modifiers, and no metaphor. Move the story forward without repeating known details. Never mention private scene fields, visual prompts, or occupant lists.";
      let presentation: { speaker: NarrationSpeaker; voice?: string; voiceSpeed?: number; logKind: "dm" | "npc" } | undefined;

      if (move.move === "request_check" && move.check) {
        const request = checkRequestFromIntent(move.check);
        this.state.pendingCheck = request;
        if (relationship && npcKey(relationship.playerName) === npcKey(request.playerName))
          this.state.pendingRelationship = relationship;
        if (mode === "speak" && moveNpc) {
          this.state.pendingNpc = moveNpc;
        } else {
          this.state.pendingNpc = null;
        }
        instruction = `ENGINE: ${request.playerName} must attempt a ${request.skill} check (${request.reason}). Give a clear lead-in of 1-2 short sentences that stops at the uncertain moment. Do NOT reveal any outcome.`;
      } else if (move.move === "change_scene" && move.scene) {
        this.applyScene(move.scene);
        instruction = `ENGINE: The party arrives at ${move.scene.name}. Use 1-3 short, plain sentences: say where you are, give one useful detail, and show what needs attention. Do not summarize the journey or list occupants.`;
      } else if (move.move === "give_item" && move.item) {
        const c = this.state.party.find(p => p.name.toLowerCase() === move.item!.playerName.toLowerCase());
        if (c) {
          c.inventory.push(move.item.item);
          this.pushLog("system", `${c.name} received ${move.item.item}.`);
        }
        instruction = `ENGINE: ${move.item.playerName} obtains: ${move.item.item}. Weave it into the narration naturally (1-2 sentences).`;
      }

      if (move.move !== "request_check" && relationship)
        applyRelationshipEvent(this.state, relationship, relationship.immediate);

      if (mode === "speak" && move.move !== "request_check" && moveNpc) {
        instruction = `ENGINE: Reply only as ${JSON.stringify(moveNpc.name)} in direct spoken dialogue.
Give a useful 1-3 sentence response consistent with this personality: ${moveNpc.personality}.
Use short, natural spoken language. Do not add storyteller narration, headings, stage directions,
or quotation marks. Do not speak or decide for the player.`;
        presentation = {
          speaker: { kind: "npc", name: moveNpc.name }, voice: moveNpc.voice,
          voiceSpeed: moveNpc.voiceSpeed, logKind: "npc",
        };
      }

      if (move.npc) this.broadcastState(); // show the portrait placeholder while dialogue streams

      const narration = await this.narrateAndSpeak(instruction, player, presentation);
      if (move.move === "change_scene") this.state.scene.description = narration.slice(0, 500);
      if (move.move === "request_check" && this.state.pendingCheck)
        this.broadcast({ type: "roll_request", check: this.state.pendingCheck });
    } catch (err) {
      this.broadcast({ type: "error", message: "The storyteller lost the thread. Try again." });
      console.error("[dm turn failed]", err);
    } finally {
      this.clearActivity(player);
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

    this.setActivity(player, "resolving_roll", `${check.skill} Check`);
    this.broadcastPresence();
    // players decided - skip whatever the narrator was still reading
    this.cancelAudio(true);

    const result = resolveCheck(character, check, this.rng);
    this.state.pendingCheck = null;
    const pendingNpc = this.state.pendingNpc;
    this.state.pendingNpc = null;
    const pendingRelationship = this.state.pendingRelationship;
    this.state.pendingRelationship = null;
    if (pendingRelationship && npcKey(pendingRelationship.playerName) === npcKey(player))
      applyRelationshipEvent(
        this.state,
        pendingRelationship,
        result.success ? pendingRelationship.onSuccess : pendingRelationship.onFailure,
      );
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
a cost, complication, alternative route, or new requirement instead of a dead end. Use 1-3 short,
natural spoken sentences, no headings, narration, stage directions, quotation marks, or player dialogue.`,
          player,
          { speaker: { kind: "npc", name: profile.name }, voice: profile.voice,
            voiceSpeed: profile.voiceSpeed, logKind: "npc" },
        );
      } else {
        await this.narrateAndSpeak(
          "ENGINE: Narrate the result in 1-3 short, plain sentences. Honor it exactly: do not soften failure or cheapen success. Failure changes the cost, danger, or route instead of erasing the main quest. If the attempt moved the player through a door or portal, the next beat happens on the other side. Natural 1/20 do not automatically change an ability check result.",
          player,
        );
      }
    } catch (err) {
      this.broadcast({ type: "error", message: "The storyteller lost the thread. Try again." });
      console.error("[roll narration failed]", err);
    } finally {
      this.clearActivity(player);
      this.setBusy(false);
      this.persist();
    }
  }

  private async onNewCampaign(ws: WebSocket, premise: string): Promise<void> {
    if (this.state.dmBusy) return;
    const player = this.clients.get(ws);
    if (!player || !this.state.party.some(character => npcKey(character.name) === npcKey(player)))
      return this.send(ws, { type: "error", message: "Join with a character first." });
    if (this.state.party.length === 0)
      return this.send(ws, { type: "error", message: "Join with a character first." });

    const party = this.state.party;
    const voice = this.state.narratorVoice;
    const artStyle = this.state.artStyle;
    const contentTone = this.state.contentTone;
    this.state = defaultState();
    this.state.party = party;
    this.state.narratorVoice = voice;
    this.state.artStyle = artStyle;
    this.state.contentTone = contentTone;
    this.state.saves = listSaves();
    this.history = [];
    this.setActivity(player, "starting_journey", premise || "A Surprise Adventure");
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
              occupants: [],
              imagePrompt: "lonely crossroads at dusk with an old wooden signpost, rolling hills, long shadows",
            },
      );
      this.applyQuestUpdate(move.quest ?? {
        action: "start",
        title: "The First Clue",
        objective: `Look around ${this.state.scene.name} and find out what happened here.`,
        summary: "Something strange happened here. Follow what you find.",
        isMain: true,
      });
      const narration = await this.narrateAndSpeak(
        `ENGINE: Open the adventure in 2-3 short, plain sentences. Say where you are, why the adventure starts now, and end on one immediate hook. Never describe a solo player as traveling with their own character. Never list visible subjects or other private scene data.`,
        party.length === 1 ? party[0]!.name : undefined,
      );
      this.state.scene.description = narration.slice(0, 500);
      this.state.campaignName = this.state.scene.name;
    } catch (err) {
      this.broadcast({ type: "error", message: "Could not begin the tale. Is Ollama running?" });
      console.error("[new campaign failed]", err);
    } finally {
      this.clearActivity(player);
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
      voiceSpeed?: number;
      logKind: "dm" | "npc";
    } = { speaker: { kind: "dm", name: "Storyteller" }, logKind: "dm" },
  ): Promise<string> {
    this.broadcast({ type: "narration_start", speaker: presentation.speaker });
    const voice = presentation.voice ?? this.state.narratorVoice;
    const voiceSpeed = presentation.voiceSpeed ?? 1;
    const sentences = new SentenceStream(s => this.queueAudio(s, voice, voiceSpeed));
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
  private queueAudio(sentence: string, voice: string = this.state.narratorVoice, speed = 1): void {
    const epoch = this.audioEpoch;
    this.audioChain = this.audioChain
      .then(async () => {
        // the speaker only exists where there are ears: skip synthesis for an empty room
        if (this.clients.size === 0 || epoch !== this.audioEpoch) return;
        const controller = new AbortController();
        this.audioAbort = controller;
        try {
          const url = await synthesize(sentence, voice, controller.signal, speed);
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
    const partyNames = new Set(this.state.party.map(character => npcKey(character.name)));
    this.state.scene = {
      ...scene,
      occupants: (scene.occupants ?? []).filter(subject => !partyNames.has(npcKey(subject.name))),
      description: "",
      imageUrl: null,
    };
    // Queue the wide establishing image first; subject portraits follow without delaying it.
    this.refreshSceneImage();
    this.state.scene.occupants = this.state.scene.occupants.map(occupant => {
      const profile = this.npcVoice(occupant, false);
      return {
        name: profile.name, sex: profile.sex, entityType: profile.entityType, adult: profile.adult,
        personality: profile.personality, appearance: profile.appearance,
      };
    });
  }

  private npcVoice(npc: NpcSpeaker, markVisible = true): NpcVoiceProfile {
    const key = npcKey(npc.name);
    const existing = this.state.npcVoices[key];
    if (existing) {
      existing.voiceSpeed ??= castNpcVoice(existing).speed;
      if (existing.adult === undefined && npc.adult !== undefined) existing.adult = npc.adult;
      if (existing.appearance.startsWith("distinctive fantasy") && npc.appearance.trim()) {
        existing.appearance = npc.appearance.trim();
        existing.portraitUrl = null;
        existing.portraitUrls = {};
      }
      existing.entityType ??= npc.entityType;
      if (markVisible) this.markNpcVisible(existing);
      this.ensureNpcPortrait(existing);
      return existing;
    }
    const delivery = castNpcVoice(npc);
    const profile: NpcVoiceProfile = {
      ...npc,
      name: npc.name.trim(),
      appearance: npc.appearance.trim(),
      voice: delivery.voice,
      voiceSpeed: delivery.speed,
      portraitUrl: null,
      portraitUrls: {},
    };
    this.state.npcVoices[key] = profile;
    if (markVisible) this.markNpcVisible(profile);
    this.ensureNpcPortrait(profile);
    return profile;
  }

  private markNpcVisible(npc: NpcSpeaker): void {
    const key = npcKey(npc.name);
    const index = this.state.scene.occupants.findIndex(candidate => npcKey(candidate.name) === key);
    const visible: NpcSpeaker = {
      name: npc.name.trim(), sex: npc.sex, entityType: npc.entityType,
      adult: npc.adult,
      personality: npc.personality, appearance: npc.appearance,
    };
    if (index === -1) {
      if (this.state.scene.occupants.length >= 8) this.state.scene.occupants.shift();
      this.state.scene.occupants.push(visible);
    }
    else this.state.scene.occupants[index] = visible;
  }

  private refreshVisiblePortraits(): void {
    for (const occupant of this.state.scene.occupants) this.npcVoice(occupant, false);
  }

  private ensureNpcPortrait(profile: NpcVoiceProfile): void {
    const style = this.state.artStyle ?? "painting";
    profile.portraitUrls ??= {};
    const ready = profile.portraitUrls[style];
    if (ready) {
      profile.portraitUrl = ready;
      return;
    }
    const expectedKey = npcKey(profile.name);
    const expectedAppearance = profile.appearance;
    const { cached, pending } = getNpcPortrait(profile, style);
    const apply = (url: string) => {
      const current = this.state.npcVoices[expectedKey];
      if (!current || current.appearance !== expectedAppearance || this.state.artStyle !== style) return;
      current.portraitUrls ??= {};
      current.portraitUrls[style] = url;
      current.portraitUrl = url;
      this.persist();
      this.broadcastState();
    };
    if (cached) apply(cached);
    else pending?.then(apply).catch(err => console.warn("[npc portrait failed]", (err as Error).message));
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

  // ---------- transient party presence ----------

  private canReplaceJourney(ws: WebSocket): boolean {
    const claimedName = this.clients.get(ws) ?? "";
    const joined = claimedName.length > 0
      && this.state.party.some(character => npcKey(character.name) === npcKey(claimedName));
    const tableIsPristine = this.state.party.length === 0
      && this.state.scene.kind === "fireside"
      && this.state.log.length === 0;
    return joined || tableIsPristine;
  }

  private isPlayerOnline(playerName: string): boolean {
    const key = npcKey(playerName);
    return [...this.clients.values()].some(name => name && npcKey(name) === key);
  }

  private setActivity(playerName: string, activity: PartyActivity, detail?: string): void {
    const compact = detail?.replace(/\s+/g, " ").trim();
    const clipped = compact && compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
    this.activities.set(npcKey(playerName), {
      playerName,
      activity,
      ...(clipped ? { detail: clipped } : {}),
    });
  }

  private clearActivity(playerName: string): void {
    this.activities.delete(npcKey(playerName));
  }

  private buildPartyPresence(): PartyPresence[] {
    const active = [...this.activities.values()].find(entry => entry.activity !== "ready");
    return this.state.party.map(character => {
      const key = npcKey(character.name);
      const online = this.isPlayerOnline(character.name);
      if (this.state.pendingCheck && npcKey(this.state.pendingCheck.playerName) === key) {
        return {
          characterId: character.id,
          playerName: character.name,
          online,
          activity: "waiting_for_roll",
          detail: `${this.state.pendingCheck.skill} Check`,
        };
      }
      const ownActivity = this.activities.get(key);
      if (online && ownActivity) {
        return {
          characterId: character.id,
          playerName: character.name,
          online: true,
          activity: ownActivity.activity,
          ...(ownActivity.detail ? { detail: ownActivity.detail } : {}),
        };
      }
      if (online && this.state.dmBusy && active && npcKey(active.playerName) !== key) {
        return {
          characterId: character.id,
          playerName: character.name,
          online: true,
          activity: "following",
          detail: `Following ${active.playerName}`,
        };
      }
      return {
        characterId: character.id,
        playerName: character.name,
        online,
        activity: "ready",
      };
    });
  }

  private reconcileClientIdentities(): void {
    const partyNames = new Set(this.state.party.map(character => npcKey(character.name)));
    for (const [ws, name] of this.clients) {
      if (name && !partyNames.has(npcKey(name))) this.clients.set(ws, "");
    }
    this.activities.clear();
  }

  private sendPresence(ws: WebSocket): void {
    this.send(ws, { type: "party_presence", members: this.buildPartyPresence() });
  }

  private broadcastPresence(): void {
    this.broadcast({ type: "party_presence", members: this.buildPartyPresence() });
  }

  /** Cache hit shows instantly; a miss paints in the background while the DM keeps talking. */
  private refreshSceneImage(): void {
    const scene = this.state.scene;
    const artStyle = this.state.artStyle ?? "painting";
    const signature = sceneSignature(scene, artStyle);
    if (this.paintingScene === signature) return; // already painting this exact scene
    const { cached, pending } = getSceneImage(scene, artStyle);
    if (cached) {
      scene.imageUrl = cached;
      this.broadcast({ type: "scene_image", url: cached });
    } else if (pending) {
      this.paintingScene = signature;
      pending
        .finally(() => { if (this.paintingScene === signature) this.paintingScene = null; })
        .then(url => {
          // only apply if we're still in the same scene by the time the paint dries
          if (sceneSignature(this.state.scene, this.state.artStyle ?? "painting") === signature) {
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
    this.broadcastPresence();
  }

  private persist(): void {
    saveCampaign(this.state, this.history);
  }

  private broadcastState(): void {
    this.broadcast({ type: "state", state: this.publicStateSnapshot() });
  }

  /** Roll-branch relationship intents persist for recovery but are private until resolved. */
  private publicStateSnapshot(): PublicState {
    return this.state.pendingRelationship
      ? { ...this.state, pendingRelationship: null }
      : this.state;
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
