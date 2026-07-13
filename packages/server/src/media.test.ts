import { describe, expect, it, vi } from "vitest";
import { SentenceStream, sceneSignature, synthesize } from "./media.js";

function collect(chunks: string[]): string[] {
  const out: string[] = [];
  const s = new SentenceStream(x => out.push(x));
  for (const c of chunks) s.push(c);
  s.flush();
  return out;
}

describe("SentenceStream", () => {
  it("emits the first clause early so the narrator starts fast", () => {
    const out = collect(["Rain hammers the shutters of the inn, ", "and every head turns as you enter. The barkeep freezes."]);
    expect(out[0]).toBe("Rain hammers the shutters of the inn,");
    expect(out.join(" ")).toContain("The barkeep freezes.");
  });

  it("splits on sentence boundaries across chunk breaks", () => {
    const out = collect(["The door creaks open. Some", "thing moves in the dark! You reach for", " your blade."]);
    expect(out).toEqual([
      "The door creaks open.",
      "Something moves in the dark!",
      "You reach for your blade.",
    ]);
  });

  it("handles quotes and flushes trailing text", () => {
    const out = collect([`"Stay back," she warns. He does not`]);
    expect(out[out.length - 1]).toBe("He does not");
  });

  it("emits nothing for empty input", () => {
    expect(collect([""])).toEqual([]);
  });
});

describe("sceneSignature", () => {
  it("is stable and filesystem-safe on Windows", () => {
    const sig = sceneSignature({ kind: "Rainy Tavern!", timeOfDay: "night", weather: "rain", mood: "tavern" });
    expect(sig).toBe("rainy-tavern--night--rain--tavern");
    expect(sig).toMatch(/^[a-z0-9-]+$/); // no |, /, \, : - all illegal in filenames
  });
  it("differs when any component differs", () => {
    const a = sceneSignature({ kind: "tavern", timeOfDay: "night", weather: "rain", mood: "tavern" });
    const b = sceneSignature({ kind: "tavern", timeOfDay: "day", weather: "rain", mood: "tavern" });
    expect(a).not.toBe(b);
  });
});

describe("synthesize", () => {
  it("returns promptly when the final listener cancels an in-flight request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const controller = new AbortController();
    const result = synthesize("The room falls silent.", "male", controller.signal);

    controller.abort();

    await expect(result).resolves.toBeNull();
    fetchMock.mockRestore();
  });
});
