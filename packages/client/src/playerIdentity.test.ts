import { describe, expect, it } from "vitest";
import { readPlayerIdentity, writePlayerIdentity } from "./playerIdentity";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
    value: () => value,
  };
}

describe("remembered player identity", () => {
  it("hydrates defaults for an older valid identity", () => {
    const storage = memoryStorage(JSON.stringify({ playerName: "Kira", characterId: "druid" }));
    expect(readPlayerIdentity(storage)).toMatchObject({
      playerName: "Kira", characterId: "druid", sex: "male", age: "adult", bio: "", portraitUrl: null,
    });
  });

  it("clears corrupt identity data instead of throwing", () => {
    const storage = memoryStorage("{not-json");
    expect(readPlayerIdentity(storage)).toBeNull();
    expect(storage.value()).toBeNull();
  });

  it("writes a validated join identity payload", () => {
    const storage = memoryStorage();
    writePlayerIdentity({
      playerName: "Kira", characterId: "fighter", sex: "female", age: "adult",
      bio: "", portraitUrl: null,
    }, storage);
    expect(JSON.parse(storage.value()!)).toMatchObject({ playerName: "Kira", characterId: "fighter" });
  });
});
