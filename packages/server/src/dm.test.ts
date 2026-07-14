import { describe, expect, it } from "vitest";
import type { PublicState } from "@grimoire/shared";
import {
  buildMessages, MOVE_INSTRUCTION, PlayerFacingTextStream, sanitizePlayerFacingText,
  semanticallyValid, viewpointInstruction,
} from "./dm.js";

function promptState(contentTone: PublicState["contentTone"]): PublicState {
  return {
    campaignName: "Test Tale",
    scene: {
      name: "Test Room", kind: "room", timeOfDay: "day", weather: "clear", mood: "mystery",
      description: "A plain room.", exits: [], occupants: [], imagePrompt: "plain empty room", imageUrl: null,
    },
    party: [], log: [], suggestedActions: [], pendingCheck: null, pendingNpc: null,
    pendingRelationship: null, dmBusy: false, narratorVoice: "male", artStyle: "painting",
    contentTone, quests: [], npcVoices: {}, npcRelationships: {}, saves: [],
  };
}

describe("narration viewpoint", () => {
  it("forces the active player character into second person", () => {
    const instruction = viewpointInstruction("Cedric");
    expect(instruction).toContain('Refer to their character ONLY as "you" or "your"');
    expect(instruction).toContain("Do not output their character name");
    expect(instruction).toContain('"Cedric"');
  });
});

describe("table content policy", () => {
  it("selects the default and mature policies while retaining absolute boundaries", () => {
    const standard = buildMessages(promptState("standard"), [], "Continue.")[0]!.content;
    const mature = buildMessages(promptState("mature"), [], "Continue.")[0]!.content;

    expect(standard).toContain("TABLE CONTENT MODE: STANDARD");
    expect(standard).not.toContain("TABLE CONTENT MODE: MATURE");
    expect(mature).toContain("TABLE CONTENT MODE: MATURE");
    expect(mature).toContain("permission, not a command");
    expect(mature).toContain("Intimacy always fades to black");
    expect(mature).toContain("Never produce explicit pornography");
    expect(mature).toContain("social roll can change trust or affection, but it can never manufacture consent");
  });

  it("requires meaningful checks and consequences for resisting capture", () => {
    expect(MOVE_INSTRUCTION).toContain("Capturing an alert, resisting enemy");
    expect(MOVE_INSTRUCTION).toContain("Athletics for physical restraint");
    expect(MOVE_INSTRUCTION).toContain("Failure must create escape, alarm, injury, hostility");
  });

  it("never lets a social roll decide mutual romance or a breakup", () => {
    const state = promptState("mature");
    state.party = [{ name: "Alice" } as PublicState["party"][number]];
    state.npcVoices.mara = {
      name: "Mara", sex: "female", entityType: "person", adult: true,
      personality: "careful", appearance: "adult ferryman", voice: "af_bella",
    };
    for (const consentEvent of ["mutual_romance", "romance_ended"] as const) {
      expect(semanticallyValid({
        move: "request_check",
        check: { playerName: "Alice", skill: "Persuasion", difficulty: "hard", reason: "Ask for a date" },
        relationship: {
          playerName: "Alice", npcName: "Mara", reason: "Alice asked Mara for a date.",
          immediate: "none", onSuccess: consentEvent, onFailure: "none",
        },
        suggestedActions: [],
      }, state, "Alice asks Mara for a date.")).toBe(false);
    }
  });

  it("validates scene occupants with the same adult metadata rules as speaking NPCs", () => {
    const state = promptState("mature");
    state.npcVoices.nell = {
      name: "Nell", sex: "female", entityType: "person", adult: false,
      personality: "quiet", appearance: "a child in a red cloak", voice: "af_bella",
    };
    expect(semanticallyValid({
      move: "change_scene",
      scene: {
        name: "The Lane", kind: "street", timeOfDay: "day", weather: "clear", mood: "town",
        exits: [], imagePrompt: "empty village lane",
        occupants: [{
          name: "Nell", sex: "female", entityType: "person", adult: true,
          personality: "quiet", appearance: "a little girl in a red cloak",
        }],
      },
      suggestedActions: [],
    }, state, "You enter the lane.")).toBe(false);
  });

  it("rejects contradictory adult metadata before it can enter relationship state", () => {
    const state = promptState("mature");
    expect(semanticallyValid({
      move: "narrate",
      npc: {
        name: "Nell", sex: "female", entityType: "person", adult: true,
        personality: "quiet", appearance: "a little girl in a red cloak",
      },
      suggestedActions: [],
    }, state, "You greet Nell.")).toBe(false);
  });
});

describe("player-facing narration guard", () => {
  it("removes private occupant metadata from completed and legacy narration", () => {
    expect(sanitizePlayerFacingText(
      "You find a wet market stall and hear a noise behind it. Visible living subjects: Kael (you)",
    )).toBe("You find a wet market stall and hear a noise behind it.");
    expect(sanitizePlayerFacingText("The note reads \"visible living subjects: none.\""))
      .toBe("The note reads \"visible living subjects: none.\"");
  });

  it("emits normal chunks immediately but suppresses a label split across chunks", () => {
    const chunks: string[] = [];
    const stream = new PlayerFacingTextStream(chunk => chunks.push(chunk));
    stream.push("The door opens.");
    expect(chunks.join("")).toBe("The door opens.");

    stream.push(" Vis");
    stream.push("ible living sub");
    stream.push("jects: Kael (you)");
    expect(stream.flush()).toBe("The door opens.");
    expect(chunks.join("")).not.toMatch(/visible|subjects|Kael/i);
  });

  it("keeps an inline phrase that begins in a later model chunk", () => {
    const chunks: string[] = [];
    const stream = new PlayerFacingTextStream(chunk => chunks.push(chunk));
    stream.push("The chalk note reads ");
    stream.push("visible subjects: none.");
    expect(stream.flush()).toBe("The chalk note reads visible subjects: none.");
  });

  it("normalizes a non-player label split at its separator", () => {
    const chunks: string[] = [];
    const stream = new PlayerFacingTextStream(chunk => chunks.push(chunk));
    stream.push("You stop. Visible non ");
    stream.push("player characters: Mara");
    expect(stream.flush()).toBe("You stop.");
  });

  it("still catches a real suffix after harmless inline label text crosses the context window", () => {
    const stream = new PlayerFacingTextStream(() => {});
    stream.push("A");
    stream.push(" long ordinary sentence continues with enough words to cross the context window and the chalk note reads visible subjects: none while you keep walking without stopping.");
    stream.push(" Visible living subjects: Kael");
    expect(stream.flush()).toBe("A long ordinary sentence continues with enough words to cross the context window and the chalk note reads visible subjects: none while you keep walking without stopping.");
  });

  it("drops an unfinished private label at end of generation", () => {
    const stream = new PlayerFacingTextStream(() => {});
    stream.push("You stop. Visible living subjects");
    expect(stream.flush()).toBe("You stop.");
  });

  it("holds label whitespace until a separator arrives", () => {
    const stream = new PlayerFacingTextStream(() => {});
    stream.push("You stop. Visible living subjects ");
    stream.push(": Kael");
    expect(stream.flush()).toBe("You stop.");
  });
});
