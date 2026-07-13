import { useCallback, useEffect, useRef, useState } from "react";
import type { Mood, PublicState, RollResult } from "@grimoire/shared";

export type SoundEffect = "ui" | "choice" | "scene" | "roll" | "success" | "failure" | "combat" | "event";

interface MusicProfile {
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

interface Track {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  timer: number;
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value: number) => Math.min(1, Math.max(0, value));

class SoundscapeEngine {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private track: Track | null = null;
  private mood: Mood = "mystery";
  private musicVolume = .32;
  private effectsVolume = .7;
  private musicMuted = false;
  private effectsMuted = false;
  private beat = 0;
  private noiseBuffer: AudioBuffer | null = null;

  configure(settings: { musicVolume: number; effectsVolume: number; musicMuted: boolean; effectsMuted: boolean }): void {
    this.musicVolume = clamp(settings.musicVolume);
    this.effectsVolume = clamp(settings.effectsVolume);
    this.musicMuted = settings.musicMuted;
    this.effectsMuted = settings.effectsMuted;
    this.updateBuses();
  }

  async unlock(): Promise<void> {
    if (!this.context) this.createContext();
    if (this.context?.state === "suspended") await this.context.resume();
  }

  setMood(mood: Mood): void {
    const changed = mood !== this.mood;
    this.mood = mood;
    if (this.context && (changed || !this.track)) this.startTrack(MUSIC_PROFILES[mood]);
  }

  setMusicVolume(value: number): void {
    this.musicVolume = clamp(value);
    this.updateBuses();
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = clamp(value);
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
    this.startTrack(MUSIC_PROFILES[this.mood]);
  }

  private updateBuses(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.musicBus?.gain.setTargetAtTime(this.musicMuted ? 0 : this.musicVolume, now, .08);
    this.effectsBus?.gain.setTargetAtTime(this.effectsMuted ? 0 : this.effectsVolume, now, .025);
  }

  private startTrack(profile: MusicProfile): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
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
      if (profile.percussion) this.musicPercussion(profile, trackGain);
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

  private musicPercussion(profile: MusicProfile, output: AudioNode): void {
    const context = this.context;
    if (!context || this.musicMuted) return;
    const beatInBar = this.beat % 4;
    if (beatInBar === 0 || (profile.label === "Battle Rhythm" && beatInBar === 2)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(profile.label === "Final Adversary" ? 72 : 88, now);
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
  const [musicVolume, setMusicVolumeState] = useState(() => Number(localStorage.getItem("grimoire.musicVolume") ?? ".32"));
  const [effectsMuted, setEffectsMutedState] = useState(() => localStorage.getItem("grimoire.effectsMuted") === "1");
  const [effectsVolume, setEffectsVolumeState] = useState(() => Number(localStorage.getItem("grimoire.effectsVolume") ?? ".7"));
  const mood = state?.scene.mood ?? "mystery";
  const previousScene = useRef<string | undefined>(undefined);
  const previousMood = useRef<Mood | undefined>(undefined);
  const previousCheck = useRef<string | null>(null);
  const previousLogLength = useRef(0);

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
    engine.current?.setMood(mood);
    if (previousMood.current && previousMood.current !== mood && (mood === "combat" || mood === "boss"))
      engine.current?.play("combat");
    previousMood.current = mood;
  }, [mood]);

  useEffect(() => {
    const sceneName = state?.scene.name;
    if (sceneName && previousScene.current && previousScene.current !== sceneName) engine.current?.play("scene");
    previousScene.current = sceneName;
  }, [state?.scene.name]);

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
    const value = clamp(volume);
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
    const value = clamp(volume);
    setEffectsVolumeState(value);
    localStorage.setItem("grimoire.effectsVolume", String(value));
    engine.current?.setEffectsVolume(value);
  }, []);
  const play = useCallback((effect: SoundEffect) => engine.current?.play(effect), []);

  return {
    musicMuted, setMusicMuted, musicVolume, setMusicVolume,
    effectsMuted, setEffectsMuted, effectsVolume, setEffectsVolume,
    mood, trackLabel: MUSIC_PROFILES[mood].label, play,
  };
}
