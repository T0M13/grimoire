import { afterEach, describe, expect, it, vi } from "vitest";
import { MOODS } from "@grimoire/shared";
import {
  CLEAN_MIX,
  MOVEMENT_ROTATION_MS,
  MUSIC_PROFILES,
  MUSIC_VARIANTS,
  parseStoredVolume,
  percussionBeatsForMood,
  sceneSoundscapeKey,
  scheduleMovementRotation,
  selectSoundscape,
  stableSoundscapeHash,
  type SoundscapeScene,
} from "./useSoundscape";

const TAVERN: SoundscapeScene = {
  name: "The Copper Cup",
  kind: "tavern",
  timeOfDay: "day",
  weather: "clear",
  mood: "tavern",
};

describe("soundscape profiles", () => {
  it("covers every scene mood", () => {
    expect(Object.keys(MUSIC_PROFILES)).toEqual([...MOODS]);
    expect(Object.keys(MUSIC_VARIANTS)).toEqual([...MOODS]);
  });

  it("provides three distinct named movements for every mood", () => {
    for (const mood of MOODS) {
      const variants = MUSIC_VARIANTS[mood];
      expect(variants).toHaveLength(3);
      expect(new Set(variants.map(variant => variant.label)).size).toBe(3);
      expect(new Set(variants.map(variant => `${variant.root}:${variant.tempo}:${variant.pulseEvery}`)).size).toBe(3);
    }
  });

  it("keeps every generated parameter inside safe audio bounds", () => {
    for (const mood of MOODS) {
      for (const variant of MUSIC_VARIANTS[mood]) {
        expect(variant.tempo).toBeGreaterThanOrEqual(38);
        expect(variant.tempo).toBeLessThanOrEqual(148);
        expect(variant.brightness).toBeGreaterThanOrEqual(360);
        expect(variant.brightness).toBeLessThanOrEqual(2400);
        expect(variant.intensity).toBeGreaterThan(0);
        expect(variant.intensity).toBeLessThanOrEqual(1);
        expect(variant.scale.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses restrained timbres, brightness, and melodic density", () => {
    for (const mood of MOODS) {
      for (const variant of MUSIC_VARIANTS[mood]) {
        expect(["sine", "triangle"]).toContain(variant.waveform);
        expect(variant.brightness).toBeLessThanOrEqual(1_500);
        if (variant.percussion) expect(variant.pulseEvery).toBeGreaterThanOrEqual(2);
      }
    }

    expect(CLEAN_MIX.trackPeak).toBeLessThanOrEqual(.5);
    expect(CLEAN_MIX.chordUpper).toBeLessThan(CLEAN_MIX.chordFundamental);
    expect(CLEAN_MIX.pulsePeak).toBeLessThan(CLEAN_MIX.chordFundamental);
    expect(CLEAN_MIX.percussionPeak).toBeLessThanOrEqual(.055);
    expect(CLEAN_MIX.filterResonance).toBeLessThanOrEqual(.4);
  });

  it("keeps percussion sparse while giving combat a steady half-bar pulse", () => {
    expect(percussionBeatsForMood("combat")).toEqual([0, 2]);
    for (const mood of MOODS.filter(mood => mood !== "combat"))
      expect(percussionBeatsForMood(mood)).toEqual([0]);
  });
});

describe("scene-aware selection", () => {
  it("is deterministic and normalizes cosmetic scene-name whitespace", () => {
    const first = selectSoundscape(TAVERN, 0);
    const repeated = selectSoundscape({ ...TAVERN }, 0);
    const normalized = sceneSoundscapeKey({ ...TAVERN, name: "  THE   COPPER CUP " });

    expect(repeated).toEqual(first);
    expect(normalized).toBe(sceneSoundscapeKey(TAVERN));
    expect(stableSoundscapeHash(first.sceneKey)).toBe(1_442_874_966);
  });

  it("rotates through every movement before returning to the first", () => {
    const selections = [0, 1, 2, 3].map(index => selectSoundscape(TAVERN, index));
    expect(new Set(selections.slice(0, 3).map(selection => selection.variantIndex)).size).toBe(3);
    expect(selections[3]!.variantIndex).toBe(selections[0]!.variantIndex);
    expect(selectSoundscape(TAVERN, -9).movementIndex).toBe(0);
    expect(selectSoundscape(TAVERN, Number.NaN).movementIndex).toBe(0);
  });

  it("re-scores when location, time, weather, or mood changes", () => {
    const baseline = selectSoundscape(TAVERN);
    const changes = [
      selectSoundscape({ ...TAVERN, name: "The Silver Cup" }),
      selectSoundscape({ ...TAVERN, timeOfDay: "night" }),
      selectSoundscape({ ...TAVERN, weather: "fog" }),
      selectSoundscape({ ...TAVERN, mood: "mystery" }),
    ];

    for (const changed of changes) expect(changed.id).not.toBe(baseline.id);
  });

  it("colors ambient music by time and weather", () => {
    const clearDay = selectSoundscape(TAVERN);
    const clearNight = selectSoundscape({ ...TAVERN, timeOfDay: "night" });
    const foggyDay = selectSoundscape({ ...TAVERN, weather: "fog" });

    expect(clearNight.profile.brightness).toBeLessThan(clearDay.profile.brightness);
    expect(clearNight.profile.tempo).toBeLessThan(clearDay.profile.tempo);
    expect(foggyDay.profile.brightness).toBeLessThan(clearDay.profile.brightness);
  });

  it("preserves combat and boss identity in hostile night weather", () => {
    const hostile = { ...TAVERN, kind: "dungeon", timeOfDay: "night", weather: "snow" } as const;
    const combat = selectSoundscape({ ...hostile, mood: "combat" });
    const boss = selectSoundscape({ ...hostile, mood: "boss" });

    expect(combat.profile.percussion).toBe(true);
    expect(combat.profile.tempo).toBeGreaterThanOrEqual(112);
    expect(combat.profile.intensity).toBeGreaterThanOrEqual(.82);
    expect(boss.profile.percussion).toBe(true);
    expect(boss.profile.tempo).toBeGreaterThanOrEqual(98);
    expect(boss.profile.intensity).toBeGreaterThanOrEqual(.9);
  });
});

describe("soundscape lifecycle and settings helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("rotates slowly and cleanup stops the tab-local clock exactly once", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const cleanup = scheduleMovementRotation(advance, 1_000);

    vi.advanceTimersByTime(3_100);
    expect(advance).toHaveBeenCalledTimes(3);
    cleanup();
    cleanup();
    vi.advanceTimersByTime(3_000);
    expect(advance).toHaveBeenCalledTimes(3);
    expect(MOVEMENT_ROTATION_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("clamps stored volumes and recovers malformed values", () => {
    expect(parseStoredVolume(null, .32)).toBe(.32);
    expect(parseStoredVolume("", .7)).toBe(.7);
    expect(parseStoredVolume("not-a-number", .32)).toBe(.32);
    expect(parseStoredVolume("Infinity", .7)).toBe(.7);
    expect(parseStoredVolume("-0.4", .32)).toBe(0);
    expect(parseStoredVolume("1.4", .7)).toBe(1);
    expect(parseStoredVolume("0.45", .7)).toBe(.45);
  });
});
