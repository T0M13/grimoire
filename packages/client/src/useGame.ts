import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckRequest, ClientMessage, NarrationSpeaker, PublicState, RollResult, ServerMessage } from "@grimoire/shared";

const GAME_ORIGIN = new URL(
  (import.meta.env.VITE_GAME_ORIGIN as string | undefined)
    ?? `${location.protocol}//${location.hostname}:${import.meta.env.VITE_GAME_PORT ?? "8787"}`,
);
export const assetUrl = (path: string) => new URL(path, GAME_ORIGIN).toString();

function gameSocketUrl(): string {
  const url = new URL("/ws", GAME_ORIGIN);
  url.protocol = GAME_ORIGIN.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export interface GameConnection {
  connected: boolean;
  state: PublicState | null;
  /** narration currently streaming in (not yet in state.log) */
  liveNarration: string | null;
  liveSpeaker: NarrationSpeaker | null;
  lastRoll: RollResult | null;
  pendingCheck: CheckRequest | null;
  errorFlash: string | null;
  audio: {
    muted: boolean;
    setMuted: (m: boolean) => void;
    volume: number;
    setVolume: (v: number) => void;
    paused: boolean;
    togglePause: () => void;
    speaking: boolean;
  };
  send: (msg: ClientMessage) => void;
}

export function useGame(): GameConnection {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<PublicState | null>(null);
  const [liveNarration, setLiveNarration] = useState<string | null>(null);
  const [liveSpeaker, setLiveSpeaker] = useState<NarrationSpeaker | null>(null);
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);

  // ---- narration audio: sequential queue with mute / volume / pause ----
  const [muted, setMutedState] = useState(() => localStorage.getItem("grimoire.muted") === "1");
  const [volume, setVolumeState] = useState(() => Number(localStorage.getItem("grimoire.volume") ?? "0.9"));
  const [paused, setPaused] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const rejoined = useRef(false);
  const queue = useRef<string[]>([]);
  const current = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const pausedRef = useRef(paused);
  mutedRef.current = muted;
  volumeRef.current = volume;
  pausedRef.current = paused;

  const playNext = useCallback(() => {
    if (pausedRef.current) return;
    const next = queue.current.shift();
    if (!next) {
      current.current = null;
      setSpeaking(false);
      return;
    }
    const a = new Audio(assetUrl(next));
    a.volume = volumeRef.current;
    current.current = a;
    setSpeaking(true);
    a.onended = a.onerror = () => playNext();
    void a.play().catch(() => playNext());
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    localStorage.setItem("grimoire.muted", m ? "1" : "0");
    if (m) {
      // silence immediately, even mid-sentence
      current.current?.pause();
      current.current = null;
      queue.current = [];
      setSpeaking(false);
      setPaused(false);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    localStorage.setItem("grimoire.volume", String(clamped));
    if (current.current) current.current.volume = clamped;
  }, []);

  const togglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev;
      pausedRef.current = next;
      if (next) {
        current.current?.pause();
      } else if (current.current) {
        void current.current.play().catch(() => playNext());
      } else {
        playNext();
      }
      return next;
    });
  }, [playNext]);

  const enqueueAudio = useCallback((url: string) => {
    if (mutedRef.current) return;
    queue.current.push(url);
    if (!current.current && !pausedRef.current) playNext();
  }, [playNext]);

  const stopAudio = useCallback(() => {
    current.current?.pause();
    current.current = null;
    queue.current = [];
    pausedRef.current = false;
    setPaused(false);
    setSpeaking(false);
  }, []);

  useEffect(() => {
    let alive = true;
    let retry = 0;

    function connect() {
      const ws = new WebSocket(gameSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        stopAudio();
        if (alive) setTimeout(connect, Math.min(500 * 2 ** retry++, 8000));
      };
      ws.onmessage = ev => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        switch (msg.type) {
          case "state": {
            // seamless rejoin after refresh - but only if our character still exists
            // in this campaign (a reset campaign should show the join screen again)
            const saved = localStorage.getItem("grimoire.player");
            if (saved) {
              const identity = JSON.parse(saved) as { playerName: string };
              const known = msg.state.party.some(c => c.name.toLowerCase() === identity.playerName.toLowerCase());
              if (known && !rejoined.current) {
                rejoined.current = true;
                wsRef.current?.send(JSON.stringify({ type: "join", ...identity }));
              }
            }
            setState(msg.state);
            break;
          }
          case "narration_start":
            setLiveSpeaker(msg.speaker);
            setLiveNarration("");
            break;
          case "narration_chunk": setLiveNarration(prev => (prev ?? "") + msg.text); break;
          case "narration_end":
            setLiveNarration(null);
            setLiveSpeaker(null);
            break;
          case "audio": enqueueAudio(msg.url); break;
          case "audio_stop": stopAudio(); break;
          case "scene_image":
            setState(prev => prev ? { ...prev, scene: { ...prev.scene, imageUrl: msg.url } } : prev);
            break;
          case "roll_result":
            setLastRoll(msg.result);
            setTimeout(() => setLastRoll(null), 3500);
            break;
          case "roll_request": break; // arrives via state.pendingCheck too
          case "error":
            setErrorFlash(msg.message);
            setTimeout(() => setErrorFlash(null), 3000);
            break;
        }
      };
    }

    connect();
    window.addEventListener("pagehide", stopAudio);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", stopAudio);
      stopAudio();
      wsRef.current?.close();
    };
  }, [enqueueAudio, stopAudio]);

  const send = useCallback((msg: ClientMessage) => {
    if (msg.type === "join") {
      const { type: _t, ...identity } = msg;
      localStorage.setItem("grimoire.player", JSON.stringify(identity));
    }
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return {
    connected, state, liveNarration, liveSpeaker, lastRoll,
    pendingCheck: state?.pendingCheck ?? null,
    errorFlash,
    audio: { muted, setMuted, volume, setVolume, paused, togglePause, speaking },
    send,
  };
}
