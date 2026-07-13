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
      npc: { name: "Mara", sex: "female", personality: "wary but warm" },
      quest: {
        action: "advance", title: "The Missing Bell", objective: "Search the old belfry.",
        summary: "Mara heard the bell beneath the hill.", isMain: true,
      },
      suggestedActions: ["Question Mara further"],
    });
    expect(result.npc?.name).toBe("Mara");
    expect(result.quest?.action).toBe("advance");
  });
});
