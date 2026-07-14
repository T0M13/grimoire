import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@grimoire/shared";
import type { WebSocket } from "ws";

vi.mock("./db.js", () => ({
  deleteSlot: vi.fn(), listSaves: vi.fn(() => []), loadCampaign: vi.fn(() => null),
  loadSlot: vi.fn(() => null), logEvent: vi.fn(), saveCampaign: vi.fn(), saveSlot: vi.fn(),
}));
vi.mock("./dm.js", () => ({
  decideMove: vi.fn(), narrate: vi.fn(async () => "Test narration."),
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

import { GameRoom } from "./game.js";
import { decideMove } from "./dm.js";
import { getNpcPortrait } from "./media.js";

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

describe("shared-room multiplayer foundation", () => {
  const rooms: GameRoom[] = [];
  afterEach(() => {
    for (const room of rooms) room.shutdown();
    rooms.length = 0;
    vi.mocked(decideMove).mockReset();
    vi.mocked(getNpcPortrait).mockReturnValue({ cached: null, pending: null });
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
});
