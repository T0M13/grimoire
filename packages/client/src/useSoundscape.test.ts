import { describe, expect, it } from "vitest";
import { MOODS } from "@grimoire/shared";
import { MUSIC_PROFILES } from "./useSoundscape";

describe("soundscape profiles", () => {
  it("covers every scene mood", () => {
    expect(Object.keys(MUSIC_PROFILES)).toEqual([...MOODS]);
  });

  it("gives combat states a distinct percussive arrangement", () => {
    expect(MUSIC_PROFILES.combat.percussion).toBe(true);
    expect(MUSIC_PROFILES.boss.percussion).toBe(true);
    expect(MUSIC_PROFILES.combat.tempo).toBeGreaterThan(MUSIC_PROFILES.mystery.tempo);
    expect(MUSIC_PROFILES.boss.intensity).toBeGreaterThan(MUSIC_PROFILES.tavern.intensity);
  });

  it("uses a named track for every profile", () => {
    const labels = MOODS.map(mood => MUSIC_PROFILES[mood].label);
    expect(new Set(labels).size).toBe(MOODS.length);
  });
});
