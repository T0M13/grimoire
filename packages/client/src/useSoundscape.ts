import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mood, PublicState, RollResult, Scene } from "@grimoire/shared";

export type SoundEffect = "ui" | "choice" | "scene" | "roll" | "success" | "failure" | "combat" | "event";

export interface MusicProfile {
  label: string;
  root: number;
  chord: readonly number[];
  scale: readonly number[];
  tempo: number;
  pulseEvery: number;
  waveform: OscillatorType;
  brightness: number;
  intensity: number;
  percussion: boolean;
}

export const MUSIC_PROFILES: Record<Mood, MusicProfile> = {
  tavern: { label: "Warm Hearth", root: 48, chord: [0, 4, 7], scale: [0, 2, 4, 7, 9], tempo: 88, pulseEvery: 2, waveform: "triangle", brightness: 1500, intensity: .75, percussion: false },
  town: { label: "Market Roads", root: 50, chord: [0, 4, 7], scale: [0, 2, 4, 5, 7, 9], tempo: 96, pulseEvery: 2, waveform: "triangle", brightness: 1800, intensity: .7, percussion: false },
  travel: { label: "Open Road", root: 45, chord: [0, 4, 7], scale: [0, 2, 4, 7, 9], tempo: 82, pulseEvery: 2, waveform: "triangle", brightness: 1350, intensity: .72, percussion: false },
  forest: { label: "Ancient Canopy", root: 43, chord: [0, 3, 7], scale: [0, 2, 3, 7, 10], tempo: 68, pulseEvery: 3, waveform: "sine", brightness: 950, intensity: .62, percussion: false },
  dungeon: { label: "Below The Stone", root: 38, chord: [0, 1, 7], scale: [0, 1, 3, 6, 7], tempo: 54, pulseEvery: 3, waveform: "sine", brightness: 620, intensity: .68, percussion: false },
  night: { label: "Under Stars", root: 45, chord: [0, 3, 7], scale: [0, 2, 3, 7, 10], tempo: 58, pulseEvery: 4, waveform: "sine", brightness: 900, intensity: .5, percussion: false },
  tension: { label: "Held Breath", root: 40, chord: [0, 1, 6], scale: [0, 1, 3, 6, 8], tempo: 76, pulseEvery: 1, waveform: "sawtooth", brightness: 760, intensity: .6, percussion: true },
  mystery: { label: "Veiled Secret", root: 42, chord: [0, 3, 8], scale: [0, 1, 3, 7, 8], tempo: 64, pulseEvery: 3, waveform: "sine", brightness: 1100, intensity: .56, percussion: false },
  combat: { label: "Battle Rhythm", root: 38, chord: [0, 3, 7], scale: [0, 3, 5, 7, 10], tempo: 124, pulseEvery: 1, waveform: "sawtooth", brightness: 1250, intensity: .9, percussion: true },
  boss: { label: "Final Adversary", root: 35, chord: [0, 1, 7], scale: [0, 1, 3, 6, 7, 10], tempo: 108, pulseEvery: 1, waveform: "sawtooth", brightness: 1050, intensity: 1, percussion: true },
  sorrow: { label: "Ashes And Memory", root: 45, chord: [0, 3, 7], scale: [0, 2, 3, 7, 8], tempo: 48, pulseEvery: 4, waveform: "sine", brightness: 780, intensity: .45, percussion: false },
  victory: { label: "The Road Won", root: 48, chord: [0, 4, 7, 11], scale: [0, 2, 4, 7, 9, 11], tempo: 98, pulseEvery: 2, waveform: "triangle", brightness: 1900, intensity: .85, percussion: true },
};

const variantPattern = (scale: readonly number[], movement: 1 | 2): readonly number[] => {
  if (scale.length < 3) return scale;
  if (movement === 1) return [scale[0]!, ...scale.slice(2), scale[1]!];
  return [scale[0]!, ...scale.slice(1).reverse()];
};

function musicVariants(base: MusicProfile, labels: readonly [string, string]): readonly MusicProfile[] {
  return [
    base,
    {
      ...base,
      label: labels[0],
      root: base.root + 5,
      scale: variantPattern(base.scale, 1),
      tempo: Math.round(base.tempo * .94),
      pulseEvery: Math.min(5, base.pulseEvery + 1),
      brightness: Math.round(base.brightness * .88),
      intensity: Math.min(1, base.intensity * .92),
    },
    {
      ...base,
      label: labels[1],
      root: base.root - 2,
      scale: variantPattern(base.scale, 2),
      tempo: Math.round(base.tempo * 1.06),
      pulseEvery: Math.max(1, base.pulseEvery - 1),
      brightness: Math.round(base.brightness * 1.08),
      intensity: Math.min(1, base.intensity * .96),
    },
  ];
}

/** Three related movements per mood. Scene identity chooses the opening movement deterministically. */
export const MUSIC_VARIANTS: Record<Mood, readonly MusicProfile[]> = {
  tavern: musicVariants(MUSIC_PROFILES.tavern, ["Last Lantern", "Stories By Firelight"]),
  town: musicVariants(MUSIC_PROFILES.town, ["Lantern Market", "Streets Awakening"]),
  travel: musicVariants(MUSIC_PROFILES.travel, ["Beyond The Milestone", "Wind At Our Backs"]),
  forest: musicVariants(MUSIC_PROFILES.forest, ["Moss And Moonlight", "Whispers In The Boughs"]),
  dungeon: musicVariants(MUSIC_PROFILES.dungeon, ["Forgotten Corridors", "The Deep Remembers"]),
  night: musicVariants(MUSIC_PROFILES.night, ["Moonlit Watch", "Before The Dawn"]),
  tension: musicVariants(MUSIC_PROFILES.tension, ["Footsteps Behind", "The Narrowing Path"]),
  mystery: musicVariants(MUSIC_PROFILES.mystery, ["Unwritten Runes", "A Door Unanswered"]),
  combat: musicVariants(MUSIC_PROFILES.combat, ["Steel In Motion", "No Ground Given"]),
  boss: musicVariants(MUSIC_PROFILES.boss, ["Crown Of Dread", "The Last Threshold"]),
  sorrow: musicVariants(MUSIC_PROFILES.sorrow, ["Names In The Ash", "What We Carry"]),
  victory: musicVariants(MUSIC_PROFILES.victory, ["Banner At Sunrise", "Homeward With Honor"]),
};

export type SoundscapeScene = Pick<Scene, "name" | "kind" | "timeOfDay" | "weather" | "mood">;

export interface SoundscapeSelection {
  id: string;
  sceneKey: string;
  mood: Mood;
  variantIndex: number;
  movementIndex: number;
  label: string;
  profile: MusicProfile;
}

interface ProfileModifier {
  root: number;
  tempo: number;
  brightness: number;
  intensity: number;
}

const NEUTRAL_MODIFIER: ProfileModifier = { root: 0, tempo: 1, brightness: 1, intensity: 1 };
const TIME_MODIFIERS: Record<Scene["timeOfDay"], ProfileModifier> = {
  day: { root: 0, tempo: 1.02, brightness: 1.06, intensity: 1 },
  dawn: { root: 2, tempo: .96, brightness: 1.12, intensity: .9 },
  dusk: { root: -1, tempo: .94, brightness: .86, intensity: .88 },
  night: { root: -3, tempo: .88, brightness: .68, intensity: .8 },
};
const WEATHER_MODIFIERS: Record<Scene["weather"], ProfileModifier> = {
  clear: NEUTRAL_MODIFIER,
  rain: { root: 0, tempo: .94, brightness: .82, intensity: .86 },
  storm: { root: -2, tempo: 1.04, brightness: .72, intensity: 1 },
  snow: { root: 2, tempo: .86, brightness: .76, intensity: .74 },
  fog: { root: -2, tempo: .9, brightness: .58, intensity: .76 },
};

const kindModifier = (kind: string): ProfileModifier => {
  const normalized = kind.toLowerCase();
  if (/dungeon|crypt|cave|cellar|sewer|catacomb/.test(normalized))
    return { root: -2, tempo: .94, brightness: .84, intensity: .95 };
  if (/forest|wood|grove|swamp|wild/.test(normalized))
    return { root: 0, tempo: .96, brightness: .9, intensity: .94 };
  if (/tavern|inn|hearth|hall/.test(normalized))
    return { root: 0, tempo: 1, brightness: 1.06, intensity: 1 };
  if (/town|city|market|village/.test(normalized))
    return { root: 0, tempo: 1.04, brightness: 1.05, intensity: .96 };
  if (/temple|shrine|spire|cathedral|sanctum/.test(normalized))
    return { root: 2, tempo: .94, brightness: .92, intensity: .92 };
  return NEUTRAL_MODIFIER;
};

const clampRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A stable, platform-independent FNV-1a hash for repeatable per-scene scoring. */
export function stableSoundscapeHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function sceneSoundscapeKey(scene: SoundscapeScene): string {
  return [scene.name, scene.kind, scene.mood, scene.timeOfDay, scene.weather]
    .map(part => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function applySceneModifiers(base: MusicProfile, scene: SoundscapeScene): MusicProfile {
  const time = TIME_MODIFIERS[scene.timeOfDay];
  const weather = WEATHER_MODIFIERS[scene.weather];
  const kind = kindModifier(scene.kind);
  let tempo = Math.round(base.tempo * time.tempo * weather.tempo * kind.tempo);
  let brightness = Math.round(base.brightness * time.brightness * weather.brightness * kind.brightness);
  let intensity = base.intensity * time.intensity * weather.intensity * kind.intensity;

  // Context colors dramatic music without erasing its mechanical identity.
  if (scene.mood === "combat") {
    tempo = Math.max(112, tempo);
    brightness = Math.max(900, brightness);
    intensity = Math.max(.82, intensity);
  } else if (scene.mood === "boss") {
    tempo = Math.max(98, tempo);
    brightness = Math.max(780, brightness);
    intensity = Math.max(.9, intensity);
  } else if (scene.mood === "victory") {
    tempo = Math.max(88, tempo);
    intensity = Math.max(.72, intensity);
  }

  return {
    ...base,
    root: clampRange(base.root + time.root + weather.root + kind.root, 28, 64),
    tempo: clampRange(tempo, 38, 148),
    brightness: clampRange(brightness, 360, 2400),
    intensity: clampRange(intensity, .28, 1),
  };
}

/** Selects one repeatable movement and applies audible scene/time/weather color. */
export function selectSoundscape(scene: SoundscapeScene, movementIndex = 0): SoundscapeSelection {
  const sceneKey = sceneSoundscapeKey(scene);
  const variants = MUSIC_VARIANTS[scene.mood];
  const normalizedMovement = Number.isFinite(movementIndex) ? Math.max(0, Math.trunc(movementIndex)) : 0;
  const variantIndex = (stableSoundscapeHash(sceneKey) + normalizedMovement) % variants.length;
  const variant = variants[variantIndex]!;
  return {
    id: `${sceneKey}|movement:${variantIndex}`,
    sceneKey,
    mood: scene.mood,
    variantIndex,
    movementIndex: normalizedMovement,
    label: variant.label,
    profile: applySceneModifiers(variant, scene),
  };
}

export const MOVEMENT_ROTATION_MS = 150_000;

/** Starts the tab-local movement clock and returns an idempotent cleanup function. */
export function scheduleMovementRotation(advance: () => void, intervalMs = MOVEMENT_ROTATION_MS): () => void {
  const timer = globalThis.setInterval(advance, intervalMs);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    globalThis.clearInterval(timer);
  };
}

export function parseStoredVolume(raw: string | null, fallback: number): number {
  const safeFallback = Number.isFinite(fallback) ? clampRange(fallback, 0, 1) : 0;
  if (raw === null || raw.trim() === "") return safeFallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampRange(parsed, 0, 1) : safeFallback;
}

const DEFAULT_SCENE: SoundscapeScene = {
  name: "The Fireside",
  kind: "fireside",
  timeOfDay: "night",
  weather: "clear",
  mood: "mystery",
};

interface Track {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer: number;
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const normalizeVolume = (value: number, fallback: number) =>
  Number.isFinite(value) ? clampRange(value, 0, 1) : fallback;

class SoundscapeEngine {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private track: Track | null = null;
  private selection = selectSoundscape(DEFAULT_SCENE);
  private musicVolume = .32;
  private effectsVolume = .7;
  private musicMuted = false;
  private effectsMuted = false;
  private beat = 0;
  private noiseBuffer: AudioBuffer | null = null;

  configure(settings: { musicVolume: number; effectsVolume: number; musicMuted: boolean; effectsMuted: boolean }): void {
    this.musicVolume = normalizeVolume(settings.musicVolume, .32);
    this.effectsVolume = normalizeVolume(settings.effectsVolume, .7);
    this.musicMuted = settings.musicMuted;
    this.effectsMuted = settings.effectsMuted;
    this.updateBuses();
  }

  async unlock(): Promise<void> {
    if (!this.context) this.createContext();
    if (this.context?.state === "suspended") await this.context.resume();
  }

  setSoundscape(selection: SoundscapeSelection): void {
    const changed = selection.id !== this.selection.id;
    this.selection = selection;
    if (this.context && (changed || !this.track)) this.startTrack(selection);
  }

  setMusicVolume(value: number): void {
    this.musicVolume = normalizeVolume(value, .32);
    this.updateBuses();
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = normalizeVolume(value, .7);
    this.updateBuses();
  }

  setMusicMuted(value: boolean): void {
    this.musicMuted = value;
    this.updateBuses();
  }

  setEffectsMuted(value: boolean): void {
    this.effectsMuted = value;
    this.updateBuses();
  }

  play(effect: SoundEffect): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.effectsMuted || !this.effectsBus) return;
    switch (effect) {
      case "ui": this.tone(520, .035, "sine", .055, 650); break;
      case "choice": this.tone(430, .07, "triangle", .08, 620); break;
      case "scene":
        this.tone(330, .38, "sine", .11, 494, 0);
        this.tone(494, .42, "sine", .08, 659, .11);
        this.noise(.28, .035, 900, .03);
        break;
      case "roll":
        this.noise(.07, .16, 2400, 0);
        this.noise(.06, .13, 1900, .075);
        this.noise(.05, .1, 1500, .14);
        break;
      case "success":
        this.tone(392, .18, "triangle", .12, 523, 0);
        this.tone(523, .22, "triangle", .1, 659, .12);
        this.tone(659, .3, "sine", .08, 784, .24);
        break;
      case "failure":
        this.tone(294, .24, "triangle", .13, 220, 0);
        this.tone(220, .36, "sine", .1, 147, .16);
        break;
      case "combat":
        this.noise(.32, .28, 180, 0);
        this.tone(82, .55, "sine", .2, 48, 0);
        this.tone(165, .28, "sawtooth", .06, 110, .08);
        break;
      case "event":
        this.tone(587, .2, "sine", .09, 740, 0);
        this.tone(880, .34, "sine", .065, 988, .14);
        break;
    }
  }

  close(): void {
    this.stopTrack(0.08);
    void this.context?.close();
    this.context = null;
    this.musicBus = null;
    this.effectsBus = null;
    this.noiseBuffer = null;
  }

  private createContext(): void {
    const context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = .008;
    compressor.release.value = .24;
    compressor.connect(context.destination);
    this.musicBus = context.createGain();
    this.effectsBus = context.createGain();
    this.musicBus.connect(compressor);
    this.effectsBus.connect(compressor);
    this.context = context;
    this.updateBuses();
    this.startTrack(this.selection);
  }

  private updateBuses(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.musicBus?.gain.setTargetAtTime(this.musicMuted ? 0 : this.musicVolume, now, .08);
    this.effectsBus?.gain.setTargetAtTime(this.effectsMuted ? 0 : this.effectsVolume, now, .025);
  }

  private startTrack(selection: SoundscapeSelection): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
    const profile = selection.profile;
    this.stopTrack(2.2);
    const now = context.currentTime;
    const trackGain = context.createGain();
    trackGain.gain.setValueAtTime(0, now);
    trackGain.gain.linearRampToValueAtTime(.72 * profile.intensity, now + 2.4);
    trackGain.connect(this.musicBus);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = profile.brightness;
    filter.Q.value = .7;
    filter.connect(trackGain);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const [index, interval] of profile.chord.entries()) {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = index === 0 ? "sine" : profile.waveform;
      oscillator.frequency.value = frequency(profile.root + interval - 12);
      oscillator.detune.value = index === 1 ? -4 : index === 2 ? 5 : 0;
      voiceGain.gain.value = index === 0 ? .045 : .024;
      oscillator.connect(voiceGain).connect(filter);
      oscillator.start();
      nodes.push(oscillator);
    }
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = .08;
    lfoGain.gain.value = Math.min(380, profile.brightness * .2);
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    nodes.push(lfo);
    this.beat = 0;
    const beatMs = 60_000 / profile.tempo;
    const timer = window.setInterval(() => {
      if (!this.track || this.context?.state !== "running") return;
      this.beat += 1;
      if (this.beat % profile.pulseEvery === 0) this.musicPulse(profile, trackGain);
      if (profile.percussion) this.musicPercussion(profile, selection.mood, trackGain);
    }, beatMs);
    this.track = { gain: trackGain, nodes, timer };
  }

  private stopTrack(fadeSeconds: number): void {
    const context = this.context;
    const track = this.track;
    if (!context || !track) return;
    window.clearInterval(track.timer);
    const now = context.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    for (const node of track.nodes) {
      try { node.stop(now + fadeSeconds + .05); } catch { /* Already stopped. */ }
    }
    window.setTimeout(() => track.gain.disconnect(), (fadeSeconds + .2) * 1000);
    this.track = null;
  }

  private musicPulse(profile: MusicProfile, output: AudioNode): void {
    const context = this.context;
    if (!context || this.musicMuted) return;
    const note = profile.scale[(this.beat / profile.pulseEvery) % profile.scale.length | 0]!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = profile.waveform === "sawtooth" ? "triangle" : profile.waveform;
    oscillator.frequency.value = frequency(profile.root + note);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.035 * profile.intensity, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + Math.max(.28, 60 / profile.tempo));
    oscillator.connect(gain).connect(output);
    oscillator.start(now);
    oscillator.stop(now + 1.2);
  }

  private musicPercussion(profile: MusicProfile, mood: Mood, output: AudioNode): void {
    const context = this.context;
    if (!context || this.musicMuted) return;
    const beatInBar = this.beat % 4;
    if (beatInBar === 0 || (mood === "combat" && beatInBar === 2)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(mood === "boss" ? 72 : 88, now);
      oscillator.frequency.exponentialRampToValueAtTime(42, now + .16);
      gain.gain.setValueAtTime(.09 * profile.intensity, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .24);
      oscillator.connect(gain).connect(output);
      oscillator.start(now);
      oscillator.stop(now + .3);
    }
  }

  private tone(startFrequency: number, duration: number, type: OscillatorType, volume: number, endFrequency = startFrequency, delay = 0): void {
    const context = this.context;
    if (!context || !this.effectsBus) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(.018, duration / 4));
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(this.effectsBus);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  private noise(duration: number, volume: number, cutoff: number, delay: number): void {
    const context = this.context;
    if (!context || !this.effectsBus) return;
    if (!this.noiseBuffer) {
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.effectsBus);
    source.start(start);
    source.stop(start + duration);
  }
}

export interface SoundscapeControls {
  musicMuted: boolean;
  setMusicMuted: (muted: boolean) => void;
  musicVolume: number;
  setMusicVolume: (volume: number) => void;
  effectsMuted: boolean;
  setEffectsMuted: (muted: boolean) => void;
  effectsVolume: number;
  setEffectsVolume: (volume: number) => void;
  mood: Mood;
  trackLabel: string;
  play: (effect: SoundEffect) => void;
}

export function useSoundscape(state: PublicState | null, lastRoll: RollResult | null): SoundscapeControls {
  const engine = useRef<SoundscapeEngine | null>(null);
  if (!engine.current) engine.current = new SoundscapeEngine();
  const [musicMuted, setMusicMutedState] = useState(() => localStorage.getItem("grimoire.musicMuted") === "1");
  const [musicVolume, setMusicVolumeState] = useState(() => parseStoredVolume(localStorage.getItem("grimoire.musicVolume"), .32));
  const [effectsMuted, setEffectsMutedState] = useState(() => localStorage.getItem("grimoire.effectsMuted") === "1");
  const [effectsVolume, setEffectsVolumeState] = useState(() => parseStoredVolume(localStorage.getItem("grimoire.effectsVolume"), .7));
  const scene: SoundscapeScene = state?.scene ?? DEFAULT_SCENE;
  const sceneKey = sceneSoundscapeKey(scene);
  const [movement, setMovement] = useState(() => ({ sceneKey, index: 0 }));
  const movementIndex = movement.sceneKey === sceneKey ? movement.index : 0;
  const selection = useMemo(() => selectSoundscape(scene, movementIndex), [sceneKey, movementIndex]);
  const mood = scene.mood;
  const previousScene = useRef<string | undefined>(undefined);
  const previousMood = useRef<Mood | undefined>(undefined);
  const previousCheck = useRef<string | null>(null);
  const previousLogLength = useRef(0);

  useEffect(() => {
    setMovement(current => current.sceneKey === sceneKey && current.index === 0
      ? current
      : { sceneKey, index: 0 });
    return scheduleMovementRotation(() => {
      setMovement(current => current.sceneKey === sceneKey
        ? { sceneKey, index: current.index + 1 }
        : current);
    });
  }, [sceneKey]);

  useEffect(() => {
    engine.current?.configure({ musicMuted, musicVolume, effectsMuted, effectsVolume });
  }, [musicMuted, musicVolume, effectsMuted, effectsVolume]);

  useEffect(() => {
    const audio = engine.current;
    if (!audio) return;
    const unlockAndClick = (event: PointerEvent) => {
      void audio.unlock().then(() => {
        const target = event.target instanceof Element ? event.target.closest("button,[role='button'],[role='tab']") : null;
        if (target) audio.play(target.getAttribute("data-sfx") === "choice" || target.getAttribute("aria-pressed") !== null ? "choice" : "ui");
      });
    };
    window.addEventListener("pointerdown", unlockAndClick, { capture: true });
    const close = () => audio.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pointerdown", unlockAndClick, { capture: true });
      window.removeEventListener("pagehide", close);
      audio.close();
    };
  }, []);

  useEffect(() => {
    engine.current?.setSoundscape(selection);
    if (previousMood.current && previousMood.current !== mood && (mood === "combat" || mood === "boss"))
      engine.current?.play("combat");
    previousMood.current = mood;
  }, [selection.id, mood]);

  useEffect(() => {
    if (previousScene.current && previousScene.current !== sceneKey) engine.current?.play("scene");
    previousScene.current = sceneKey;
  }, [sceneKey]);

  useEffect(() => {
    if (lastRoll) engine.current?.play(lastRoll.success ? "success" : "failure");
  }, [lastRoll]);

  useEffect(() => {
    const checkKey = state?.pendingCheck ? `${state.pendingCheck.playerName}:${state.pendingCheck.skill}:${state.pendingCheck.dc}` : null;
    if (checkKey && checkKey !== previousCheck.current) engine.current?.play("roll");
    previousCheck.current = checkKey;
  }, [state?.pendingCheck]);

  useEffect(() => {
    const length = state?.log.length ?? 0;
    if (length > previousLogLength.current) {
      const latest = state?.log[length - 1];
      if (latest?.who === "system" && !latest.text.includes(" rolled ")) engine.current?.play("event");
    }
    previousLogLength.current = length;
  }, [state?.log.length]);

  const setMusicMuted = useCallback((muted: boolean) => {
    setMusicMutedState(muted);
    localStorage.setItem("grimoire.musicMuted", muted ? "1" : "0");
    engine.current?.setMusicMuted(muted);
  }, []);
  const setMusicVolume = useCallback((volume: number) => {
    const value = normalizeVolume(volume, .32);
    setMusicVolumeState(value);
    localStorage.setItem("grimoire.musicVolume", String(value));
    engine.current?.setMusicVolume(value);
  }, []);
  const setEffectsMuted = useCallback((muted: boolean) => {
    setEffectsMutedState(muted);
    localStorage.setItem("grimoire.effectsMuted", muted ? "1" : "0");
    engine.current?.setEffectsMuted(muted);
  }, []);
  const setEffectsVolume = useCallback((volume: number) => {
    const value = normalizeVolume(volume, .7);
    setEffectsVolumeState(value);
    localStorage.setItem("grimoire.effectsVolume", String(value));
    engine.current?.setEffectsVolume(value);
  }, []);
  const play = useCallback((effect: SoundEffect) => engine.current?.play(effect), []);

  return {
    musicMuted, setMusicMuted, musicVolume, setMusicVolume,
    effectsMuted, setEffectsMuted, effectsVolume, setEffectsVolume,
    mood, trackLabel: selection.label, play,
  };
}
