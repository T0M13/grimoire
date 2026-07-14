import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, PartyPresence, PublicState, ServerMessage } from "@grimoire/shared";
import type { WebSocket } from "ws";

vi.mock("./db.js", () => ({
  deleteSlot: vi.fn(), listSaves: vi.fn(() => []), loadCampaign: vi.fn(() => null),
  loadSlot: vi.fn(() => null), logEvent: vi.fn(), saveCampaign: vi.fn(), saveSlot: vi.fn(),
}));
vi.mock("./dm.js", () => ({
  decideMove: vi.fn(), narrate: vi.fn(async () => "Test narration."),
  sanitizePlayerFacingText: vi.fn((text: string) =>
    text.replace(/\s*Visible living subjects:.*$/i, "").trimEnd()),
}));
vi.mock("./media.js", () => ({
  generatePortrait: vi.fn(async () => "/assets/img/test-avatar.png"),
  getNpcPortrait: vi.fn(() => ({ cached: null, pending: null })),
  getSceneImage: vi.fn(() => ({ cached: null, pending: null })),
  sceneSignature: vi.fn(() => "test-scene-signature"),
  SentenceStream: class {
    push(): void { /* no-op */ }
    flush(): void { /* no-op */ }
  },
  synthesize: vi.fn(async () => null),
}));

import { applyRelationshipEvent, castNpcVoice, GameRoom } from "./game.js";
import { decideMove } from "./dm.js";
import { getNpcPortrait } from "./media.js";
import { loadCampaign, loadSlot } from "./db.js";

class FakeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly messages: ServerMessage[] = [];

  send(raw: string): void {
    this.messages.push(JSON.parse(raw) as ServerMessage);
  }
}

const joinMessage = (playerName: string): ClientMessage => ({
  type: "join", playerName, characterId: "fighter", sex: "male", age: "adult",
  bio: "multiplayer test hero", portraitUrl: "/assets/img/test-avatar.png",
});

const latestState = (socket: FakeSocket) => {
  const states = socket.messages.filter((message): message is Extract<ServerMessage, { type: "state" }> => message.type === "state");
  return states.at(-1)?.state;
};

const latestPresence = (socket: FakeSocket): PartyPresence[] =>
  socket.messages.filter((message): message is Extract<ServerMessage, { type: "party_presence" }> => message.type === "party_presence").at(-1)?.members ?? [];

describe("shared-room multiplayer foundation", () => {
  const rooms: GameRoom[] = [];
  afterEach(() => {
    for (const room of rooms) room.shutdown();
    rooms.length = 0;
    vi.mocked(decideMove).mockReset();
    vi.mocked(getNpcPortrait).mockReturnValue({ cached: null, pending: null });
    vi.mocked(loadCampaign).mockReset().mockReturnValue(null);
    vi.mocked(loadSlot).mockReset().mockReturnValue(null);
  });

  it("broadcasts one authoritative party snapshot to two isolated clients", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);

    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));

    expect(room.clientCount).toBe(2);
    expect(latestState(alice)?.party.map(hero => hero.name)).toEqual(["Alice", "Borin"]);
    expect(latestState(borin)?.party.map(hero => hero.name)).toEqual(["Alice", "Borin"]);
    expect(latestPresence(alice).map(member => [member.playerName, member.online, member.activity])).toEqual([
      ["Alice", true, "ready"], ["Borin", true, "ready"],
    ]);
  });

  it("lets a joined hero set the shared content tone but rejects outsiders and mid-turn changes", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const outsider = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(outsider as unknown as WebSocket);

    await room.handle(outsider as unknown as WebSocket, { type: "set_content_tone", tone: "mature" });
    expect(outsider.messages.at(-1)).toEqual({
      type: "error", message: "Join the table before changing shared content settings.",
    });

    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(alice as unknown as WebSocket, { type: "set_content_tone", tone: "mature" });
    expect(room.state.contentTone).toBe("mature");
    expect(latestState(outsider)?.contentTone).toBe("mature");

    room.state.dmBusy = true;
    await room.handle(alice as unknown as WebSocket, { type: "set_content_tone", tone: "standard" });
    expect(alice.messages.at(-1)).toEqual({ type: "error", message: "Wait for the storyteller to finish." });
    expect(room.state.contentTone).toBe("mature");
  });

  it("hydrates old saves with safe content and relationship defaults", () => {
    const seed = new GameRoom();
    const legacy = structuredClone(seed.state) as Partial<PublicState>;
    seed.shutdown();
    delete legacy.contentTone;
    delete legacy.pendingRelationship;
    delete legacy.npcRelationships;
    vi.mocked(loadCampaign).mockReturnValue({ state: legacy as PublicState, history: [] });

    const room = new GameRoom();
    rooms.push(room);
    expect(room.state.contentTone).toBe("standard");
    expect(room.state.pendingRelationship).toBeNull();
    expect(room.state.npcRelationships).toEqual({});
  });

  it("keeps the roster visible and marks a hero offline after their last tab leaves", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));
    const stableLogLength = room.state.log.length;

    room.removeClient(borin as unknown as WebSocket);

    expect(latestPresence(alice).find(member => member.playerName === "Borin")).toMatchObject({ online: false, activity: "ready" });
    expect(latestState(alice)?.party.map(hero => hero.name)).toContain("Borin");
    expect(room.state.log).toHaveLength(stableLogLength);

    const borinReturn = new FakeSocket();
    room.addClient(borinReturn as unknown as WebSocket);
    await room.handle(borinReturn as unknown as WebSocket, joinMessage("Borin"));
    expect(latestPresence(alice).find(member => member.playerName === "Borin")?.online).toBe(true);
    expect(room.state.log).toHaveLength(stableLogLength);
  });

  it("does not mark a hero offline while another tab is still attached", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borinOne = new FakeSocket();
    const borinTwo = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borinOne as unknown as WebSocket);
    room.addClient(borinTwo as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borinOne as unknown as WebSocket, joinMessage("Borin"));
    await room.handle(borinTwo as unknown as WebSocket, joinMessage("Borin"));

    room.removeClient(borinOne as unknown as WebSocket);

    expect(latestPresence(alice).find(member => member.playerName === "Borin")?.online).toBe(true);
    expect(latestState(alice)?.log).toHaveLength(2);
  });

  it("broadcasts the active hero and followers while a shared action resolves", async () => {
    let resolveMove!: (move: Awaited<ReturnType<typeof decideMove>>) => void;
    vi.mocked(decideMove).mockImplementation(() => new Promise(resolve => { resolveMove = resolve; }));
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));
    room.state.scene.kind = "forest";

    const turn = room.handle(alice as unknown as WebSocket, { type: "action", mode: "act", text: "Search the ruined shrine" });
    await vi.waitFor(() => expect(latestPresence(borin).find(member => member.playerName === "Alice")?.activity).toBe("acting"));
    expect(latestPresence(borin).find(member => member.playerName === "Alice")?.detail).toBe("Search the ruined shrine");
    expect(latestPresence(borin).find(member => member.playerName === "Borin")).toMatchObject({ activity: "following", detail: "Following Alice" });

    resolveMove({ move: "narrate", suggestedActions: [] });
    await turn;

    expect(latestPresence(borin).map(member => member.activity)).toEqual(["ready", "ready"]);
  });

  it("acknowledges a loaded journey and clears stale socket identities", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));
    const loadedState = structuredClone(room.state);
    loadedState.party = loadedState.party.filter(hero => hero.name === "Alice");
    loadedState.contentTone = "mature";
    loadedState.npcRelationships[loadedState.party[0]!.id] = {
      mara: {
        npcName: "Mara", trust: 24, affection: 8, status: "friend",
        note: "Alice helped Mara twice.", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    vi.mocked(loadSlot).mockReturnValue({ state: loadedState, history: [] });

    await room.handle(borin as unknown as WebSocket, { type: "load_slot", id: 7 });

    expect(borin.messages).toContainEqual({ type: "journey_ready", action: "load", saveId: 7 });
    expect(latestState(alice)?.contentTone).toBe("mature");
    expect(latestState(alice)?.npcRelationships[loadedState.party[0]!.id]?.mara?.status).toBe("friend");
    expect(latestPresence(alice).map(member => member.playerName)).toEqual(["Alice"]);
    await room.handle(borin as unknown as WebSocket, { type: "action", mode: "act", text: "Keep acting as Borin" });
    expect(borin.messages.at(-1)).toEqual({ type: "error", message: "Join the game first." });
  });

  it("lets the pre-character chooser load a save while the table is pristine", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const chooser = new FakeSocket();
    room.addClient(chooser as unknown as WebSocket);
    const savedState = structuredClone(room.state);
    savedState.campaignName = "The Saved Road";
    vi.mocked(loadSlot).mockReturnValue({ state: savedState, history: [] });

    await room.handle(chooser as unknown as WebSocket, { type: "load_slot", id: 9 });

    expect(latestState(chooser)?.campaignName).toBe("The Saved Road");
    expect(chooser.messages.at(-1)).toEqual({ type: "journey_ready", action: "load", saveId: 9 });
  });

  it("acknowledges a new journey only after the shared table is reset", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    room.state.contentTone = "mature";

    await room.handle(alice as unknown as WebSocket, { type: "new_game" });

    expect(latestState(alice)).toMatchObject({
      party: [], scene: { kind: "fireside" }, contentTone: "standard", npcRelationships: {},
    });
    expect(latestPresence(alice)).toEqual([]);
    expect(alice.messages.at(-1)).toEqual({ type: "journey_ready", action: "new" });
  });

  it("does not let an unjoined newcomer replace an active shared table", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const newcomer = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    room.addClient(newcomer as unknown as WebSocket);

    await room.handle(newcomer as unknown as WebSocket, { type: "load_slot", id: 4 });
    expect(newcomer.messages.at(-1)).toEqual({
      type: "error", message: "Join the current party before replacing its shared journey.",
    });
    await room.handle(newcomer as unknown as WebSocket, { type: "new_game" });
    expect(newcomer.messages.at(-1)).toEqual({
      type: "error", message: "Join the current party before replacing its shared journey.",
    });
    expect(room.state.party.map(hero => hero.name)).toEqual(["Alice"]);
  });

  it("lets only the named player resolve a shared pending check", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));
    room.state.pendingCheck = {
      playerName: "Alice", skill: "Athletics", dc: 10, reason: "Lift the fallen beam",
    };

    await room.handle(borin as unknown as WebSocket, { type: "roll" });

    expect(borin.messages.at(-1)).toEqual({ type: "error", message: "This roll belongs to Alice." });
    expect(room.state.pendingCheck?.playerName).toBe("Alice");
  });

  it("registers a speaking creature, applies its cached portrait, and broadcasts it", async () => {
    vi.mocked(decideMove).mockResolvedValue({
      move: "narrate",
      npc: {
        name: "Mossback", sex: "male", entityType: "creature",
        personality: "ancient and patient", appearance: "antlered guardian covered in moss",
      },
      suggestedActions: [],
    });
    vi.mocked(getNpcPortrait).mockReturnValue({
      cached: "/assets/img/npc-mossback--painting--test.png", pending: null,
    });
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    room.state.scene.kind = "forest";

    await room.handle(alice as unknown as WebSocket, {
      type: "action", mode: "speak", text: "Who are you?",
    });

    expect(room.state.scene.occupants.map(subject => subject.name)).toContain("Mossback");
    expect(room.state.npcVoices.mossback?.entityType).toBe("creature");
    expect(room.state.npcVoices.mossback?.portraitUrls?.painting)
      .toBe("/assets/img/npc-mossback--painting--test.png");
    expect(latestState(alice)?.npcVoices.mossback?.portraitUrls?.painting)
      .toBe("/assets/img/npc-mossback--painting--test.png");
  });

  it("tracks one hero's immediate NPC relationship without changing a teammate's", async () => {
    vi.mocked(decideMove).mockResolvedValue({
      move: "narrate",
      npc: {
        name: "Mara", sex: "female", entityType: "person", adult: true,
        personality: "wary but warm", appearance: "weathered ferryman in a moss-green coat",
      },
      relationship: {
        playerName: "Alice", npcName: "Mara", reason: "Alice returned Mara's stolen compass.",
        immediate: "helped", onSuccess: "none", onFailure: "none",
      },
      suggestedActions: [],
    });
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    const borin = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    room.addClient(borin as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    await room.handle(borin as unknown as WebSocket, joinMessage("Borin"));
    room.state.scene.kind = "road";

    await room.handle(alice as unknown as WebSocket, { type: "action", mode: "speak", text: "I found your compass." });

    const aliceId = room.state.party.find(hero => hero.name === "Alice")!.id;
    const borinId = room.state.party.find(hero => hero.name === "Borin")!.id;
    expect(room.state.npcRelationships[aliceId]?.mara).toMatchObject({
      npcName: "Mara", trust: 12, affection: 4, status: "acquaintance",
    });
    expect(room.state.npcRelationships[borinId]).toBeUndefined();
  });

  it("defers a check-dependent relationship outcome until the deterministic roll", async () => {
    vi.mocked(decideMove).mockResolvedValue({
      move: "request_check",
      npc: {
        name: "Mara", sex: "female", entityType: "person", adult: true,
        personality: "wary but warm", appearance: "weathered ferryman in a moss-green coat",
      },
      check: {
        playerName: "Alice", skill: "Athletics", difficulty: "nearly_impossible",
        reason: "Stop Mara from escaping",
      },
      relationship: {
        playerName: "Alice", npcName: "Mara", reason: "Alice tried to restrain Mara.",
        immediate: "none", onSuccess: "threatened", onFailure: "offended",
      },
      suggestedActions: [],
    });
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    room.state.scene.kind = "road";
    const aliceId = room.state.party[0]!.id;

    await room.handle(alice as unknown as WebSocket, { type: "action", mode: "speak", text: "You are not leaving." });
    expect(room.state.pendingRelationship?.onFailure).toBe("offended");
    expect(latestState(alice)?.pendingRelationship).toBeNull();
    expect(room.state.npcRelationships[aliceId]).toBeUndefined();

    await room.handle(alice as unknown as WebSocket, { type: "roll" });
    expect(room.state.pendingRelationship).toBeNull();
    expect(room.state.npcRelationships[aliceId]?.mara).toMatchObject({
      trust: -8, affection: -8, status: "acquaintance",
    });
  });

  it("gates mutual romance on mature mode, established bonds, and clearly adult people", async () => {
    const room = new GameRoom();
    rooms.push(room);
    const alice = new FakeSocket();
    room.addClient(alice as unknown as WebSocket);
    await room.handle(alice as unknown as WebSocket, joinMessage("Alice"));
    const aliceHero = room.state.party[0]!;
    room.state.npcVoices.mara = {
      name: "Mara", sex: "female", entityType: "person", adult: true,
      personality: "wary but warm", appearance: "weathered ferryman",
      voice: "af_bella", portraitUrls: {},
    };
    room.state.npcRelationships[aliceHero.id] = {
      mara: {
        npcName: "Mara", trust: 20, affection: 25, status: "friend",
        note: "They trust each other.", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const update = {
      playerName: "Alice", npcName: "Mara", reason: "They both freely admitted their feelings.",
      immediate: "mutual_romance", onSuccess: "none", onFailure: "none",
    } as const;

    expect(applyRelationshipEvent(room.state, update, "mutual_romance")).toBe(false);
    room.state.contentTone = "mature";
    aliceHero.age = "young";
    expect(applyRelationshipEvent(room.state, update, "mutual_romance")).toBe(false);
    aliceHero.age = "adult";
    expect(applyRelationshipEvent(room.state, update, "mutual_romance", "2026-01-02T00:00:00.000Z")).toBe(true);
    expect(room.state.npcRelationships[aliceHero.id]?.mara).toMatchObject({
      trust: 25, affection: 35, status: "romantic",
    });

    expect(applyRelationshipEvent(room.state, {
      ...update,
      reason: "Alice threatened to hold Mara captive.",
      immediate: "threatened",
    }, "threatened", "2026-01-03T00:00:00.000Z")).toBe(true);
    expect(room.state.npcRelationships[aliceHero.id]?.mara).toMatchObject({
      trust: 10, affection: 25, status: "friend",
    });
  });

  it("cleans legacy DM text while preserving legacy player text", () => {
    const seed = new GameRoom();
    const state = structuredClone(seed.state);
    seed.shutdown();
    state.scene.description = "Rain falls. Visible living subjects: Kael (you)";
    state.log = [
      { who: "dm", kind: "dm", text: "Rain falls. Visible living subjects: Kael (you)" },
      { who: "Kael", text: "Visible living subjects: is that an engine label?" },
    ];
    vi.mocked(loadCampaign).mockReturnValue({
      state,
      history: [
        { role: "assistant", content: "Rain falls. Visible living subjects: Kael (you)" },
        { role: "user", content: "Visible living subjects: is that an engine label?" },
      ],
    });

    const room = new GameRoom();
    rooms.push(room);
    expect(room.state.scene.description).toBe("Rain falls.");
    expect(room.state.log.map(entry => entry.text)).toEqual([
      "Rain falls.", "Visible living subjects: is that an engine label?",
    ]);
    expect(room.history.map(message => message.content)).toEqual([
      "Rain falls.", "Visible living subjects: is that an engine label?",
    ]);
  });

  it("casts stable voices and pacing from identity, sex, personality, and creature type", () => {
    const warm = castNpcVoice({
      name: "Mara", sex: "female", entityType: "person",
      personality: "warm and patient", appearance: "middle-aged innkeeper",
    });
    const forceful = castNpcVoice({
      name: "Captain Voss", sex: "male", entityType: "person",
      personality: "stern and commanding", appearance: "scarred guard captain",
    });
    const ancientCreature = castNpcVoice({
      name: "Mossback", sex: "male", entityType: "creature",
      personality: "ancient and patient", appearance: "huge moss-covered guardian",
    });

    expect(warm.voice).toBe("af_bella");
    expect(forceful.voice).toBe("am_onyx");
    expect(ancientCreature.speed).toBeLessThan(warm.speed);
    expect(warm.speed).toBeGreaterThanOrEqual(0.5);
    expect(warm.speed).toBeLessThanOrEqual(2);
    expect(castNpcVoice({
      name: "Mara", sex: "female", entityType: "person",
      personality: "warm and patient", appearance: "middle-aged innkeeper",
    })).toEqual(warm);
  });
});
