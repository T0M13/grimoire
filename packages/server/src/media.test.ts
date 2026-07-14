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
  const scene = {
    name: "The Copper Cup", kind: "Rainy Tavern!", timeOfDay: "night" as const,
    weather: "rain" as const, mood: "tavern" as const,
    imagePrompt: "warm tavern interior where a worried innkeeper leans across the bar",
  };

  it("is stable and filesystem-safe on Windows", () => {
    const sig = sceneSignature(scene);
    expect(sig).toMatch(/^the-copper-cup--rainy-tavern--night--rain--tavern--painting--[a-f0-9]{10}$/);
    expect(sig).toMatch(/^[a-z0-9-]+$/); // no |, /, \, : - all illegal in filenames
  });
  it("differs when any component differs", () => {
    const a = sceneSignature(scene);
    const b = sceneSignature({ ...scene, timeOfDay: "day" });
    expect(a).not.toBe(b);
  });
  it("keeps a consistent cached shot but distinguishes a new composition", () => {
    expect(sceneSignature(scene)).toBe(sceneSignature({ ...scene }));
    expect(sceneSignature(scene)).not.toBe(sceneSignature({ ...scene, imagePrompt: "empty tavern" }));
  });
  it("caches each art style separately", () => {
    expect(sceneSignature(scene, "painting")).not.toBe(sceneSignature(scene, "sketch"));
    expect(sceneSignature(scene, "sketch")).toBe(sceneSignature(scene, "sketch"));
  });
});

describe("synthesize", () => {
  it("passes a persistent NPC voice through unchanged", async () => {
    let requestedVoice = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requestedVoice = JSON.parse(String(init?.body)).voice as string;
      return { ok: false } as Response;
    });
    await expect(synthesize("Welcome back.", "af_bella")).resolves.toBeNull();
    expect(requestedVoice).toBe("af_bella");
    fetchMock.mockRestore();
  });

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
