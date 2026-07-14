import { useState } from "react";
import type { PublicState, SaveMeta } from "@grimoire/shared";

export interface PendingJourney {
  action: "new" | "load";
  saveId?: number;
}

export default function JourneyGate({
  state, connected, pending, error, onJoinCurrent, onNewJourney, onLoadJourney,
}: {
  state: PublicState;
  connected: boolean;
  pending: PendingJourney | null;
  error: string | null;
  onJoinCurrent: () => void;
  onNewJourney: () => void;
  onLoadJourney: (save: SaveMeta) => void;
}) {
  const [showSaves, setShowSaves] = useState(false);
  const hasCurrentJourney = state.party.length > 0 || state.scene.kind !== "fireside" || state.log.length > 0;
  const busy = pending !== null || !connected;

  const chooseNew = () => {
    if (hasCurrentJourney && !confirm("Start a new shared journey? This replaces the current table for everyone. Save it first if you want to return.")) return;
    onNewJourney();
  };

  const chooseSave = (save: SaveMeta) => {
    if (!confirm(`Load "${save.name}"? This replaces the current shared table for everyone.`)) return;
    onLoadJourney(save);
  };

  return (
    <main className="h-[100dvh] w-screen overflow-y-auto overscroll-y-contain bg-[radial-gradient(circle_at_top,#292016_0%,#0b0a09_58%)] px-4 py-8 text-stone-200">
      <div className="fadein mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col justify-center">
        <header className="mb-7 text-center">
          <h1 className="narration text-5xl tracking-wide text-amber-100/90">Grimoire</h1>
          <p className="mt-1 text-sm text-stone-400">Choose Your Journey</p>
        </header>

        {hasCurrentJourney && (
          <section className="mb-4 rounded-2xl border border-emerald-800/50 bg-emerald-950/15 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/70">Shared Table In Progress</div>
            <div className="mt-1 text-xl text-stone-100">{state.campaignName}</div>
            <div className="mt-1 text-xs text-stone-500">
              {state.scene.name}{state.party.length > 0 ? ` · Party: ${state.party.map(hero => hero.name).join(", ")}` : ""}
            </div>
            <button type="button" disabled={busy} onClick={onJoinCurrent}
              className="mt-4 w-full rounded-xl bg-emerald-800/80 py-3 font-medium text-emerald-50 transition hover:bg-emerald-700 disabled:opacity-40">
              Join Current Journey
            </button>
            <p className="mt-2 text-center text-[11px] text-stone-600">For friends joining the party already playing on this host.</p>
          </section>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <button type="button" disabled={busy || hasCurrentJourney} onClick={chooseNew}
            className="rounded-2xl border border-amber-700/60 bg-amber-950/25 p-5 text-left transition hover:border-amber-500/80 hover:bg-amber-950/40 disabled:opacity-40">
            <span className="block text-xl text-amber-100">New Journey</span>
            <span className="mt-1 block text-xs normal-case leading-relaxed text-stone-500">{hasCurrentJourney ? "Join the current party first; a joined player can replace it from Settings." : "Create a new hero and begin a fresh shared adventure."}</span>
          </button>
          <button type="button" disabled={busy || hasCurrentJourney || state.saves.length === 0} onClick={() => setShowSaves(value => !value)}
            className="rounded-2xl border border-stone-700 bg-stone-900/55 p-5 text-left transition hover:border-amber-500/70 disabled:opacity-40">
            <span className="block text-xl text-stone-100">Load Saved Journey</span>
            <span className="mt-1 block text-xs normal-case leading-relaxed text-stone-500">
              {hasCurrentJourney ? "Join the current party first; active tables cannot be replaced by newcomers." : state.saves.length === 0 ? "No saved journeys are stored on this host yet." : `${state.saves.length} saved ${state.saves.length === 1 ? "journey" : "journeys"} on this host.`}
            </span>
          </button>
        </div>

        {showSaves && state.saves.length > 0 && (
          <section aria-label="Saved Journeys" className="mt-3 rounded-2xl border border-stone-800 bg-black/35 p-3">
            <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.2em] text-stone-500">Saved Journeys</div>
            <ul className="space-y-2">
              {state.saves.map(save => (
                <li key={save.id} className="flex items-center gap-3 rounded-xl border border-stone-800 bg-stone-900/60 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-stone-200">{save.name}</div>
                    <div className="mt-0.5 text-[10px] text-stone-600">{save.savedAt}</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => chooseSave(save)}
                    className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:border-amber-500/60 disabled:opacity-40">
                    Load
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 px-1 text-[11px] normal-case leading-relaxed text-amber-200/55">Loading changes the shared table for every connected player.</p>
          </section>
        )}

        <div className="mt-5 min-h-5 text-center text-sm">
          {pending && <span className="ember text-stone-400">Preparing The Journey<span>.</span><span>.</span><span>.</span></span>}
          {!pending && !connected && <span className="ember text-stone-500">Reaching The Storyteller<span>.</span><span>.</span><span>.</span></span>}
          {!pending && connected && error && <span className="text-red-300/90">{error}</span>}
        </div>

        <details className="mt-4 rounded-xl border border-stone-800/80 bg-stone-950/50 px-4 py-3 text-xs text-stone-500">
          <summary className="cursor-pointer text-stone-400">How Co-Op Works</summary>
          <p className="mt-2 normal-case leading-relaxed">You share one scene, story, and quest journal. Outside combat there is no fixed turn order: anyone can act when the Storyteller is ready, and actions resolve one at a time. Everyone sees and hears each result. Only the named hero rolls when a check appears.</p>
          <p className="mt-2 normal-case leading-relaxed text-stone-600">Personal side quests, private conversations, and parallel exploration are planned; the current room keeps dialogue and quests shared.</p>
        </details>
      </div>
    </main>
  );
}
