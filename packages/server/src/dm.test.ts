import { describe, expect, it } from "vitest";
import { viewpointInstruction } from "./dm.js";

describe("narration viewpoint", () => {
  it("forces the active player character into second person", () => {
    const instruction = viewpointInstruction("Cedric");
    expect(instruction).toContain('Refer to their character ONLY as "you" or "your"');
    expect(instruction).toContain("Do not output their character name");
    expect(instruction).toContain('"Cedric"');
  });
});
