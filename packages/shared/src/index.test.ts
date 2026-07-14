import { describe, expect, it } from "vitest";
import { ClientMessageSchema, DmMoveSchema } from "./index";

describe("interaction protocol", () => {
  it("keeps older action clients compatible by defaulting to Act", () => {
    expect(ClientMessageSchema.parse({ type: "action", text: "Open the door." })).toMatchObject({
      type: "action", mode: "act",
    });
  });

  it("accepts a structured NPC and quest transition", () => {
    const result = DmMoveSchema.parse({
      move: "narrate",
      npc: {
        name: "Mara", sex: "female", entityType: "person", adult: true, personality: "wary but warm",
        appearance: "weathered ferryman in a moss-green coat",
      },
      quest: {
        action: "advance", title: "The Missing Bell", objective: "Search the old belfry.",
        summary: "Mara heard the bell beneath the hill.", isMain: true,
      },
      suggestedActions: ["Question Mara further"],
    });
    expect(result.npc?.name).toBe("Mara");
    expect(result.quest?.action).toBe("advance");
  });

  it("validates shared content tone changes", () => {
    expect(ClientMessageSchema.parse({ type: "set_content_tone", tone: "mature" }))
      .toEqual({ type: "set_content_tone", tone: "mature" });
    expect(ClientMessageSchema.safeParse({ type: "set_content_tone", tone: "explicit" }).success)
      .toBe(false);
  });

  it("accepts fixed relationship outcomes instead of model-authored numbers", () => {
    const result = DmMoveSchema.parse({
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
    expect(result.relationship?.immediate).toBe("helped");
    const stripped = DmMoveSchema.parse({
      ...result,
      relationship: { ...result.relationship, immediate: "helped", trustDelta: 99 },
    });
    expect(stripped.relationship).not.toHaveProperty("trustDelta");
  });
});
