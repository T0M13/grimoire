import { describe, expect, it } from "vitest";
import { PlayerFacingTextStream, sanitizePlayerFacingText, viewpointInstruction } from "./dm.js";

describe("narration viewpoint", () => {
  it("forces the active player character into second person", () => {
    const instruction = viewpointInstruction("Cedric");
    expect(instruction).toContain('Refer to their character ONLY as "you" or "your"');
    expect(instruction).toContain("Do not output their character name");
    expect(instruction).toContain('"Cedric"');
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
