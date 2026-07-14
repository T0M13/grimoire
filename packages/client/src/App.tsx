import { useEffect, useRef, useState } from "react";
import {
  CLASS_BUILD_RULES, POINT_BUY_BUDGET, POINT_BUY_COST, STANDARD_ARRAY,
  classRulesById, pointBuySpent,
} from "@grimoire/rules";
import {
  SKILL_ABILITY, SKILLS, ABILITIES,
  type Ability, type AbilityScores, type Character, type NarrationSpeaker, type Quest, type Skill,
} from "@grimoire/shared";
import { assetUrl, useGame } from "./useGame";
import { useSoundscape, type SoundscapeControls } from "./useSoundscape";
import CharacterCreator from "./CharacterCreator";

const mod = (score: number) => Math.floor((score - 10) / 2);
const fmtMod = (m: number) => (m >= 0 ? `+${m}` : `${m}`);

const CLASSES = [
  { id: "fighter", label: "Fighter", blurb: "Steel and grit. Hits hard, stands firm." },
  { id: "rogue", label: "Rogue", blurb: "Shadows, locks, and pointed remarks." },
  { id: "cleric", label: "Cleric", blurb: "Faith that mends wounds and breaks evil." },
  { id: "wizard", label: "Wizard", blurb: "Old books, older words, raw power." },
] as const;


export default function App() {
  const game = useGame();
  const sound = useSoundscape(game.state, game.lastRoll);
  const me = localStorage.getItem("grimoire.player");
  const myName: string | null = me ? (JSON.parse(me).playerName as string) : null;
  // case-insensitive: the server matches names case-insensitively on reattach
  const joined = !!game.state?.party.some(c => c.name.toLowerCase() === myName?.toLowerCase());

  if (!game.state) return <Center><Embers text="Reaching the storyteller" /></Center>;
  if (!joined) return <CharacterCreator onJoin={p => game.send({ type: "join", ...p })} connected={game.connected} />;
  return <GameScreen {...{ game, myName: myName!, sound }} />;
}

// ---------------- join ----------------

interface JoinPayload {
  playerName: string;
  characterId: string;
  sex: "male" | "female";
  age: "young" | "adult" | "elder";
  bio: string;
  portraitUrl: string | null;
  abilities: AbilityScores;
  proficientSkills: Skill[];
}

const RANDOM_NAMES = {
  male: ["Bram", "Cedric", "Doran", "Falk", "Garrick", "Joren", "Kael", "Marek", "Osric", "Rurik", "Silas", "Torvald"],
  female: ["Anya", "Brienne", "Elara", "Isolde", "Kira", "Lysa", "Mara", "Nessa", "Sera", "Tamsin", "Vex", "Wren"],
} as const;
const RANDOM_LOOKS = ["black hair, gray eyes, wiry build", "auburn hair, green eyes, broad shoulders", "silver-streaked hair, dark eyes, weathered hands", "blond hair, blue eyes, quick smile", "shaved head, brown eyes, old burn scar", "braided dark hair, amber eyes, lean and quiet"];
const RANDOM_PASTS = ["former caravan guard who saw something in the mountains", "ran away from a temple upbringing", "last survivor of a fishing village", "ex-soldier who deserted a losing war", "raised by smugglers, still owes them money", "disgraced noble hiding a family secret", "woke in a field two winters ago with no memory before that"];
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const shuffled = <T,>(values: readonly T[]): T[] => [...values].sort(() => Math.random() - 0.5);

function randomAbilityScores(): AbilityScores {
  const scores = shuffled(STANDARD_ARRAY);
  return Object.fromEntries(ABILITIES.map((ability, index) => [ability, scores[index]!])) as AbilityScores;
}

function JoinScreen({ onJoin, connected }: { onJoin: (p: JoinPayload) => void; connected: boolean }) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState<(typeof CLASSES)[number]["id"]>("fighter");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [age, setAge] = useState<"young" | "adult" | "elder">("adult");
  const [desc, setDesc] = useState("");
  const [abilities, setAbilities] = useState<AbilityScores>(() => ({ ...CLASS_BUILD_RULES.Fighter.recommendedAbilities }));
  const [skills, setSkills] = useState<Skill[]>(() => [...CLASS_BUILD_RULES.Fighter.recommendedSkills]);
  const rules = classRulesById(cls)!;
  const pointsRemaining = POINT_BUY_BUDGET - pointBuySpent(abilities);
  const valid = pointsRemaining === 0 && skills.length === rules.skillCount;

  const chooseClass = (id: (typeof CLASSES)[number]["id"]) => {
    const next = classRulesById(id)!;
    setCls(id);
    setAbilities({ ...next.recommendedAbilities });
    setSkills([...next.recommendedSkills]);
  };

  const adjustAbility = (ability: Ability, change: -1 | 1) => {
    const nextScore = abilities[ability] + change;
    if (nextScore < 8 || nextScore > 15) return;
    const next = { ...abilities, [ability]: nextScore };
    if (pointBuySpent(next) <= POINT_BUY_BUDGET) setAbilities(next);
  };

  const toggleSkill = (skill: Skill) => {
    setSkills(current => current.includes(skill)
      ? current.filter(item => item !== skill)
      : current.length < rules.skillCount ? [...current, skill] : current);
  };

  const randomize = () => {
    const s = pick(["male", "female"] as const);
    const selected = pick(CLASSES);
    const selectedRules = classRulesById(selected.id)!;
    setSex(s);
    setAge(pick(["young", "adult", "elder"] as const));
    setCls(selected.id);
    setName(pick(RANDOM_NAMES[s]));
    setDesc(`${pick(RANDOM_LOOKS)}; ${pick(RANDOM_PASTS)}`);
    setAbilities(randomAbilityScores());
    setSkills(shuffled(selectedRules.skillChoices).slice(0, selectedRules.skillCount));
  };

  const Pick = <T extends string>({ value, options, set }: { value: T; options: readonly T[]; set: (v: T) => void }) => (
    <div className={`grid gap-2 mb-3 ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {options.map(o => (
        <button type="button" key={o} onClick={() => set(o)}
          className={`rounded-xl border py-2 text-sm capitalize transition ${value === o ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-700 bg-stone-900/60 text-stone-400 hover:border-stone-500"}`}>
          {o}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen w-screen overflow-y-auto flex items-center justify-center">
      <form
        className="fadein w-full max-w-2xl px-6 py-8"
        onSubmit={e => {
          e.preventDefault();
          if (name.trim() && connected && valid)
            onJoin({
              playerName: name.trim(), characterId: cls, sex, age, bio: desc.trim(), portraitUrl: null,
              abilities, proficientSkills: skills,
            });
        }}>

        <div className="w-full">
          <h1 className="narration text-5xl text-amber-100/90 tracking-wide text-center mb-1">Grimoire</h1>
          <p className="text-sm text-stone-400 text-center mb-6">An Adventure Told to You</p>

          <button type="button" onClick={randomize}
            className="w-full rounded-xl border border-stone-700 text-stone-400 hover:border-amber-600/60 hover:text-amber-200 py-2 text-sm transition mb-3">
            Randomize Everything
          </button>

          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="Your hero's name" maxLength={30}
            className="w-full bg-stone-900/80 border border-stone-700 rounded-xl px-4 py-3 text-lg outline-none focus:border-amber-600/60 mb-3"
          />

          <Pick value={sex} options={["male", "female"] as const} set={setSex} />
          <Pick value={age} options={["young", "adult", "elder"] as const} set={setAge} />

          <div className="grid grid-cols-2 gap-2 mb-3">
            {CLASSES.map(c => (
              <button type="button" key={c.id} onClick={() => chooseClass(c.id)}
                className={`text-left rounded-xl border px-3 py-2 transition ${cls === c.id ? "border-amber-500/80 bg-amber-950/40" : "border-stone-700 bg-stone-900/60 hover:border-stone-500"}`}>
                <div className={`text-sm font-medium ${cls === c.id ? "text-amber-200" : "text-stone-300"}`}>{c.label}</div>
                <div className="text-[11px] text-stone-500 mt-0.5 leading-tight normal-case">{c.blurb}</div>
              </button>
            ))}
          </div>

          <div className="flex items-end justify-between mt-5 mb-2">
            <div>
              <div className="text-sm font-medium text-stone-200">Ability Scores</div>
              <div className="text-[11px] text-stone-500">SRD 27-Point Buy · Scores 8–15</div>
            </div>
            <div className={`text-sm ${pointsRemaining === 0 ? "text-emerald-300" : "text-amber-300"}`}>
              {pointsRemaining} Points Remaining
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
            {ABILITIES.map(ability => (
              <div key={ability} className="rounded-xl border border-stone-700 bg-stone-900/70 p-2 text-center">
                <div className="text-[10px] tracking-widest text-stone-500">{ability}</div>
                <div className="text-xl text-stone-100">{abilities[ability]}</div>
                <div className="text-xs text-amber-200/80 mb-1">{fmtMod(mod(abilities[ability]))}</div>
                <div className="flex justify-center gap-1">
                  <button type="button" aria-label={`Lower ${ability}`} onClick={() => adjustAbility(ability, -1)}
                    disabled={abilities[ability] <= 8}
                    className="w-7 rounded border border-stone-700 disabled:opacity-25 hover:border-amber-500/60">−</button>
                  <button type="button" aria-label={`Raise ${ability}`} onClick={() => adjustAbility(ability, 1)}
                    disabled={abilities[ability] >= 15 || (POINT_BUY_COST[abilities[ability] + 1]! - POINT_BUY_COST[abilities[ability]]!) > pointsRemaining}
                    className="w-7 rounded border border-stone-700 disabled:opacity-25 hover:border-amber-500/60">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-stone-200">Skill Proficiencies</div>
            <div className={`text-xs ${skills.length === rules.skillCount ? "text-emerald-300" : "text-amber-300"}`}>
              Choose {rules.skillCount} · {skills.length}/{rules.skillCount}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {rules.skillChoices.map(skill => (
              <button type="button" key={skill} aria-pressed={skills.includes(skill)} onClick={() => toggleSkill(skill)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${skills.includes(skill) ? "border-amber-500/80 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400 hover:border-stone-500"}`}>
                {skill}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-stone-800 bg-stone-900/50 px-3 py-2 mb-3">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Starter Equipment</div>
            <div className="text-xs text-stone-300 capitalize">{rules.equipmentPackages[0]!.items.join(" · ")}</div>
          </div>

          <textarea
            value={desc} onChange={e => setDesc(e.target.value)} maxLength={200} rows={2}
            placeholder="Describe your hero: looks, vibe, past. (used for your portrait and your story)"
            className="w-full bg-stone-900/80 border border-stone-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-amber-600/60 mb-3 resize-none"
          />

          <button type="submit" disabled={!name.trim() || !connected || !valid}
            className="w-full rounded-xl bg-amber-700/90 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed py-3 text-lg font-medium transition">
            {connected ? "Begin the Adventure" : "Connecting..."}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------- game ----------------

function GameScreen({ game, myName, sound }: { game: ReturnType<typeof useGame>; myName: string; sound: SoundscapeControls }) {
  const [input, setInput] = useState("");
  const [intentMode, setIntentMode] = useState<"act" | "speak" | "ask_dm">("act");
  const [premise, setPremise] = useState("");
  const [sheetFor, setSheetFor] = useState<string | null>(null); // character id
  const [questsOpen, setQuestsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state } = game;
  if (!state) return null;
  const notStarted = state.scene.kind === "fireside";
  const myCheck = state.pendingCheck && state.pendingCheck.playerName.toLowerCase() === myName.toLowerCase();
  const sheetCharacter = sheetFor ? state.party.find(c => c.id === sheetFor) ?? null : null;

  const act = (text: string, mode: "act" | "speak" | "ask_dm" = intentMode) => {
    if (!text.trim()) return;
    game.send({ type: "action", text: text.trim(), mode });
    setInput("");
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <SceneArt url={state.scene.imageUrl} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/25" />

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 py-3 text-sm text-stone-300/90">
        <div className="narration text-lg text-amber-100/85">{state.scene.name}</div>
        <div className="flex items-center gap-3">
          {state.scene.exits.length > 0 && (
            <div className="hidden md:flex gap-2">
              {state.scene.exits.map(e => (
                <button key={e} data-sfx="choice" onClick={() => act(`We head to ${e}.`, "act")}
                  className="px-2.5 py-1 rounded-full border border-stone-600/60 bg-black/40 hover:border-amber-500/60 text-xs">
                  {e}
                </button>
              ))}
            </div>
          )}
          {(game.audio.speaking || game.audio.paused) && !game.audio.muted && (
            <button onClick={game.audio.togglePause}
              className="px-2.5 py-1 rounded-full border border-stone-600/60 bg-black/40 text-xs hover:border-amber-500/60">
              {game.audio.paused ? "Resume" : "Pause"}
            </button>
          )}
          <button onClick={() => setSheetFor(state.party.find(c => c.name.toLowerCase() === myName.toLowerCase())?.id ?? null)}
            className="px-2.5 py-1 rounded-full border border-stone-600/60 bg-black/40 text-xs hover:border-amber-500/60">
            Sheet
          </button>
          <button onClick={() => setQuestsOpen(true)}
            className="px-2.5 py-1 rounded-full border border-stone-600/60 bg-black/40 text-xs hover:border-amber-500/60">
            Quests{state.quests.filter(q => q.status === "active").length > 0 ? ` · ${state.quests.filter(q => q.status === "active").length}` : ""}
          </button>
          <button onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings"
            className="p-1.5 rounded-full border border-stone-600/60 bg-black/40 hover:border-amber-500/60">
            <GearIcon />
          </button>
        </div>
      </div>

      {sheetCharacter && <SheetDrawer c={sheetCharacter} onClose={() => setSheetFor(null)} />}
      {questsOpen && <QuestDrawer quests={state.quests} onClose={() => setQuestsOpen(false)} />}
      {settingsOpen && <SettingsPanel game={game} sound={sound} onClose={() => setSettingsOpen(false)} />}

      {/* party rail */}
      <div className="absolute left-4 bottom-40 md:bottom-32 flex flex-col gap-2">
        {state.party.map(c => (
          <PartyBadge key={c.id} c={c} me={c.name.toLowerCase() === myName.toLowerCase()}
            onClick={() => setSheetFor(c.id)} />
        ))}
      </div>

      {/* dice result overlay */}
      {game.lastRoll && (
        <Center overlay>
          <div className="dicepop text-center">
            <div className={`text-8xl narration ${game.lastRoll.success ? "text-emerald-300" : "text-red-400"}`}>
              {game.lastRoll.total}
            </div>
            <div className="text-stone-300 mt-1 text-sm">
              d20 {game.lastRoll.die}{game.lastRoll.modifier >= 0 ? ` + ${game.lastRoll.modifier}` : ` − ${-game.lastRoll.modifier}`} · {game.lastRoll.skill} DC {game.lastRoll.dc}
            </div>
            <div className={`mt-1 text-lg ${game.lastRoll.success ? "text-emerald-300" : "text-red-400"}`}>
              {game.lastRoll.critical === "success" ? "Critical!" : game.lastRoll.critical === "failure" ? "Critical Failure" : game.lastRoll.success ? "Success" : "Failure"}
            </div>
          </div>
        </Center>
      )}

      {/* bottom: narration + input */}
      <div className="absolute bottom-0 inset-x-0 px-4 pb-4 flex flex-col items-center gap-3">
        <Narration state={state} live={game.liveNarration} liveSpeaker={game.liveSpeaker} />

        {myCheck && !state.dmBusy ? (
          <button onClick={() => game.send({ type: "roll" })}
            className="dicepop rounded-2xl bg-amber-700 hover:bg-amber-600 px-8 py-4 text-xl font-semibold shadow-lg shadow-amber-950/60">
            Roll {state.pendingCheck!.skill} <span className="opacity-75 text-base">(DC {state.pendingCheck!.dc})</span>
          </button>
        ) : state.pendingCheck ? (
          <div className="text-stone-300 text-sm ember">Waiting for {state.pendingCheck.playerName} to roll<span>.</span><span>.</span><span>.</span></div>
        ) : notStarted ? (
          <form className="w-full max-w-2xl flex gap-2"
            onSubmit={e => { e.preventDefault(); if (!state.dmBusy) game.send({ type: "new_campaign", premise }); }}>
            <input value={premise} onChange={e => setPremise(e.target.value)}
              placeholder="What kind of tale? (or leave blank for a surprise)"
              className="flex-1 bg-stone-900/80 border border-stone-700 rounded-xl px-4 py-3 outline-none focus:border-amber-600/60" />
            <button type="submit" disabled={state.dmBusy}
              className="rounded-xl bg-amber-700/90 hover:bg-amber-600 disabled:opacity-40 px-6 font-medium">
              Begin
            </button>
          </form>
        ) : (
          <>
            {state.suggestedActions.length > 0 && !state.dmBusy && (
              <div className="flex flex-wrap justify-center gap-2">
                {state.suggestedActions.map(s => (
                  <button key={s} data-sfx="choice" onClick={() => act(s, "act")}
                    className="px-3 py-1.5 rounded-full border border-stone-600/70 bg-black/50 hover:border-amber-500/70 text-sm text-stone-200">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="w-full max-w-2xl">
              <div className="flex gap-1 mb-1.5" role="group" aria-label="Interaction Mode">
                {([
                  ["act", "Act", "Describe what you do"],
                  ["speak", "Speak", "Address an NPC directly"],
                  ["ask_dm", "Ask DM", "Ask about the world or rules"],
                ] as const).map(([mode, label, title]) => (
                  <button key={mode} type="button" data-sfx="choice" aria-pressed={intentMode === mode}
                    title={title} onClick={() => setIntentMode(mode)}
                    className={`rounded-t-lg border px-3 py-1 text-xs transition ${intentMode === mode ? "border-amber-600/70 bg-amber-950/70 text-amber-200" : "border-stone-700/70 bg-black/50 text-stone-500 hover:text-stone-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <form className="flex gap-2"
                onSubmit={e => { e.preventDefault(); if (!state.dmBusy) act(input); }}>
                <input value={input} onChange={e => setInput(e.target.value)}
                  placeholder={state.dmBusy ? "The Storyteller is speaking..." : intentMode === "speak" ? "What do you say, and to whom?" : intentMode === "ask_dm" ? "Ask the Storyteller about your world..." : "What do you do?"}
                  disabled={state.dmBusy}
                  className="flex-1 bg-stone-900/85 border border-stone-700 rounded-xl px-4 py-3 outline-none focus:border-amber-600/60 disabled:opacity-60" />
                <button type="submit" disabled={state.dmBusy || !input.trim()}
                  className="rounded-xl bg-amber-700/90 hover:bg-amber-600 disabled:opacity-40 px-5 font-medium">
                  {intentMode === "speak" ? "Speak" : intentMode === "ask_dm" ? "Ask DM" : "Act"}
                </button>
              </form>
            </div>
          </>
        )}
        {game.errorFlash && <div className="fadein-fast text-red-300/90 text-sm">{game.errorFlash}</div>}
      </div>
    </div>
  );
}

// ---------------- pieces ----------------

/** Two stacked layers -> new art crossfades in over the old, never blocking anything. */
function SceneArt({ url }: { url: string | null }) {
  const [layers, setLayers] = useState<{ url: string; key: number }[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setLayers(prev => [...prev.slice(-1), { url, key: counter.current++ }]);
    img.src = assetUrl(url);
  }, [url]);
  return (
    <div className="absolute inset-0 bg-stone-950">
      {layers.map(l => (
        <img key={l.key} src={assetUrl(l.url)} alt=""
          className="kenburns fadein absolute inset-0 h-full w-full object-cover" />
      ))}
    </div>
  );
}

function Narration({ state, live, liveSpeaker }: { state: NonNullable<ReturnType<typeof useGame>["state"]>; live: string | null; liveSpeaker: NarrationSpeaker | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [live, state.log.length]);
  const recent = state.log.slice(-6);
  return (
    <div ref={box} className="w-full max-w-3xl max-h-56 md:max-h-64 overflow-y-auto rounded-2xl bg-black/55 backdrop-blur-sm px-6 py-4 space-y-3">
      {recent.map((e, i) => {
        const kind = e.kind ?? (e.who === "dm" ? "dm" : e.who === "system" ? "system" : "player");
        return (
          <p key={`${state.log.length - recent.length + i}`} className={kind === "dm" ? "narration text-lg leading-relaxed text-amber-50/95" : kind === "npc" ? "narration text-lg leading-relaxed text-emerald-100/95" : "text-sm text-sky-200/85"}>
            {kind !== "system" && <span className={`font-semibold ${kind === "dm" || kind === "npc" ? "text-xs uppercase tracking-wider mr-1.5 opacity-65" : ""}`}>{kind === "dm" && e.who === "dm" ? "Storyteller" : e.who}: </span>}
            {kind === "system" ? <span className="text-stone-400 italic text-xs">{e.text}</span> : e.text}
          </p>
        );
      })}
      {live !== null && (
        <p className="narration text-lg leading-relaxed text-amber-50/95">
          <span className={`font-semibold text-xs uppercase tracking-wider mr-1.5 opacity-65 ${liveSpeaker?.kind === "npc" ? "text-emerald-200" : ""}`}>{liveSpeaker?.name ?? "Storyteller"}: </span>
          {live}<span className="ember"><span>▍</span></span>
        </p>
      )}
      {state.dmBusy && live === null && (
        <p className="ember text-stone-400 text-sm">The Storyteller considers<span>.</span><span>.</span><span>.</span></p>
      )}
    </div>
  );
}

function Avatar({ c, className }: { c: Character; className: string }) {
  if (c.portraitUrl)
    return <img src={assetUrl(c.portraitUrl)} alt="" className={`${className} object-cover object-top border border-stone-700/60`} />;
  return (
    <div className={`${className} bg-stone-900 border border-stone-700/60 flex items-center justify-center`}>
      <span className="text-stone-500 narration text-lg">?</span>
    </div>
  );
}

function PartyBadge({ c, me, onClick }: { c: Character; me: boolean; onClick: () => void }) {
  const pct = Math.round((c.hp / c.maxHp) * 100);
  return (
    <button onClick={onClick} title="View Character Sheet"
      className={`text-left flex items-center gap-2.5 rounded-xl pl-1.5 pr-3 py-1.5 bg-black/55 backdrop-blur-sm border transition hover:border-amber-500/60 ${me ? "border-amber-600/50" : "border-stone-700/50"} min-w-44`}>
      <Avatar c={c} className="w-10 h-10 rounded-lg" />
      <div className="flex-1">
        <div className="text-sm leading-tight">{c.name} <span className="text-stone-400 text-xs">{c.className} {c.level}</span></div>
        <div className="h-1.5 mt-1 rounded bg-stone-800 overflow-hidden">
          <div className={`h-full ${pct > 50 ? "bg-emerald-500" : pct > 25 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[10px] text-stone-400 mt-0.5">{c.hp}/{c.maxHp} HP · AC {c.ac}</div>
      </div>
    </button>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="text-stone-300">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ItemIcon({ item }: { item: string }) {
  const name = item.toLowerCase();
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (/sword|axe|mace|dagger|bow|crossbow|staff|spear|javelin|hammer|club|weapon/.test(name))
    return <svg {...common}><path d="m14 4 6-2-2 6-9 9-4 1 1-4 8-10Z"/><path d="m4 20 4-4M9 14l2 2"/></svg>;
  if (/armor|mail|shield|leather|robe/.test(name))
    return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z"/><path d="M12 7v9"/></svg>;
  if (/spell|book|tome|scroll|component|holy symbol|focus/.test(name))
    return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z"/></svg>;
  if (/potion|flask|vial|healer|herbal/.test(name))
    return <svg {...common}><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 4h9.6a2.5 2.5 0 0 0 2.2-4l-5-9V3"/><path d="M7 16h10"/></svg>;
  if (/ration|food|bread|waterskin|wine|ale/.test(name))
    return <svg {...common}><path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11M16 3v18M16 3c5 3 5 8 0 10"/></svg>;
  if (/tool|kit|rope|torch|tinder|crowbar|piton|ink|quill|pack/.test(name))
    return <svg {...common}><path d="m14 6 4-4 4 4-4 4M13 7 3 17v4h4L17 11M4 13l7 7"/></svg>;
  return <svg {...common}><path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3M5 12h14"/></svg>;
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={e => e.stopPropagation()}
        className="fadein-fast absolute right-0 top-0 h-full w-full max-w-sm bg-stone-950/95 backdrop-blur border-l border-stone-800 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 sticky top-0 bg-stone-950/95">
          <div className="narration text-xl text-amber-100/90">{title}</div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200 text-sm px-2 py-1">Close</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function SheetDrawer({ c, onClose }: { c: Character; onClose: () => void }) {
  const rules = CLASS_BUILD_RULES[c.className];
  const allSkills = SKILLS.map(s => ({
    skill: s,
    proficient: c.proficientSkills.includes(s),
  }));
  const passivePerception = 10 + mod(c.abilities.WIS ?? 10)
    + (c.proficientSkills.includes("Perception") ? c.proficiencyBonus : 0);
  const inventory = Object.entries(c.inventory.reduce<Record<string, number>>((items, item) => {
    const key = item.trim();
    items[key] = (items[key] ?? 0) + 1;
    return items;
  }, {}));
  return (
    <Drawer title={c.name} onClose={onClose}>
      <div className="flex items-center gap-4 mb-5">
        <Avatar c={c} className="w-20 h-20 rounded-xl" />
        <div>
          <div className="text-stone-200">{c.subrace ?? c.raceName ?? "Human"} · {c.className} · Level {c.level}</div>
          <div className="text-stone-400 text-sm capitalize">{c.age} {c.sex} · {c.background ?? "Acolyte"} · {c.alignment ?? "Neutral"}</div>
          <div className="text-stone-400 text-sm mt-1">{c.hp}/{c.maxHp} HP · AC {c.ac} · Proficiency +{c.proficiencyBonus}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          ["Armor Class", c.ac], ["Initiative", fmtMod(mod(c.abilities.DEX ?? 10))], ["Speed", `${c.speed ?? 30} ft.`],
          ["Hit Points", `${c.hp}/${c.maxHp}`], ["Hit Dice", `${c.level}d${rules.hitDie}`],
          ["Passive Perception", passivePerception],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-stone-800 bg-stone-900/70 p-2 text-center">
            <div className="text-lg text-stone-100">{value}</div>
            <div className="text-[9px] uppercase tracking-wide text-stone-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {ABILITIES.map((a: Ability) => (
          <div key={a} className="rounded-xl bg-stone-900/80 border border-stone-800 px-3 py-2 text-center">
            <div className="text-[10px] text-stone-500 tracking-widest">{a}</div>
            <div className="text-lg text-stone-100">{c.abilities[a] ?? 10}</div>
            <div className="text-xs text-amber-200/80">{fmtMod(mod(c.abilities[a] ?? 10))}</div>
          </div>
        ))}
      </div>

      <SectionTitle>Saving Throws</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 mb-5">
        {ABILITIES.map(ability => {
          const proficient = (c.savingThrowProficiencies?.length ? c.savingThrowProficiencies : rules.savingThrows).includes(ability);
          const bonus = mod(c.abilities[ability] ?? 10) + (proficient ? c.proficiencyBonus : 0);
          return <div key={ability} className={`text-xs rounded-lg border px-2 py-1 ${proficient ? "border-amber-700/60 text-amber-200" : "border-stone-800 text-stone-500"}`}>
            {proficient ? "●" : "○"} {ability} <span className="float-right">{fmtMod(bonus)}</span>
          </div>;
        })}
      </div>

      <SectionTitle>Skills</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 mb-5">
        {allSkills.map(({ skill, proficient }) => {
          const bonus = mod(c.abilities[SKILL_ABILITY[skill]] ?? 10) + (proficient ? c.proficiencyBonus : 0);
          return <div key={skill} className={`text-xs rounded-lg border px-2 py-1 ${proficient ? "border-amber-700/60 text-amber-200" : "border-stone-800 text-stone-500"}`}>
            {proficient ? "●" : "○"} {skill} <span className="float-right">{fmtMod(bonus)}</span>
          </div>;
        })}
      </div>

      <SectionTitle>Inventory</SectionTitle>
      <ul className="mb-5 grid grid-cols-2 gap-2">
        {inventory.map(([item, count]) => (
          <li key={item} className="min-h-14 flex items-center gap-2.5 rounded-xl border border-stone-800 bg-stone-900/60 px-2.5 py-2">
            <div className="w-8 h-8 shrink-0 rounded-lg border border-stone-700 bg-stone-950 flex items-center justify-center text-amber-300/75">
              <ItemIcon item={item} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-stone-300 capitalize leading-tight">{item}</div>
              {count > 1 && <div className="text-[10px] text-stone-500">Quantity · {count}</div>}
            </div>
          </li>
        ))}
        {inventory.length === 0 && <li className="col-span-2 text-sm text-stone-500 italic">Empty Pockets</li>}
      </ul>

      <SectionTitle>Traits & Proficiencies</SectionTitle>
      <p className="text-sm text-stone-300 mb-2">{(c.traits ?? []).join(" · ") || "None Recorded"}</p>
      {(c.classFeatures ?? []).length > 0 && <p className="text-sm text-stone-300 mb-2">{c.classFeatures.join(" · ")}</p>}
      <p className="text-xs text-stone-500 mb-1">Languages · {(c.languages ?? ["Common"]).join(" · ")}</p>
      {(c.toolProficiencies ?? []).length > 0 && <p className="text-xs text-stone-500 mb-5">Tools · {c.toolProficiencies.join(" · ")}</p>}

      {(c.spells ?? []).length > 0 && <>
        <SectionTitle>Spells</SectionTitle>
        <p className="text-sm text-stone-300 mb-5">{c.spells.join(" · ")}</p>
      </>}

      {(c.personalityTraits?.length || c.ideal || c.bond || c.flaw) && <>
        <SectionTitle>Character</SectionTitle>
        {c.personalityTraits?.filter(Boolean).map((trait, index) => <p key={index} className="text-sm text-stone-300 mb-1">{trait}</p>)}
        {c.ideal && <p className="text-sm text-stone-400 mt-2"><span className="text-stone-500">Ideal · </span>{c.ideal}</p>}
        {c.bond && <p className="text-sm text-stone-400"><span className="text-stone-500">Bond · </span>{c.bond}</p>}
        {c.flaw && <p className="text-sm text-stone-400 mb-5"><span className="text-stone-500">Flaw · </span>{c.flaw}</p>}
      </>}

      {c.bio && (
        <>
          <SectionTitle>Story</SectionTitle>
          <p className="narration text-sm text-stone-300/90 leading-relaxed italic">{c.bio}</p>
        </>
      )}
    </Drawer>
  );
}

function QuestDrawer({ quests, onClose }: { quests: Quest[]; onClose: () => void }) {
  const ordered = [...quests].sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || Number(b.isMain) - Number(a.isMain));
  return (
    <Drawer title="Quest Journal" onClose={onClose}>
      {ordered.length === 0 && <p className="text-sm text-stone-500 italic">Your first quest appears when the adventure begins.</p>}
      <div className="space-y-3">
        {ordered.map(quest => (
          <article key={quest.id} className={`rounded-xl border p-3 ${quest.status === "active" ? "border-amber-800/60 bg-amber-950/15" : "border-stone-800 bg-stone-900/45 opacity-70"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-stone-500">{quest.isMain ? "Main Quest" : "Side Quest"}</div>
                <h3 className="narration text-lg text-amber-100/90">{quest.title}</h3>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${quest.status === "active" ? "border-amber-700/60 text-amber-300" : quest.status === "completed" ? "border-emerald-800 text-emerald-400" : "border-red-900 text-red-400"}`}>{quest.status}</span>
            </div>
            <p className="mt-2 text-sm text-stone-200">{quest.objective}</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">{quest.summary}</p>
          </article>
        ))}
      </div>
    </Drawer>
  );
}

function SettingsPanel({ game, sound, onClose }: { game: ReturnType<typeof useGame>; sound: SoundscapeControls; onClose: () => void }) {
  const [slotName, setSlotName] = useState("");
  const state = game.state!;
  return (
    <Drawer title="Settings" onClose={onClose}>
      <SectionTitle>Narrator</SectionTitle>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => game.audio.setMuted(!game.audio.muted)}
          className={`rounded-xl border px-3 py-1.5 text-sm transition ${game.audio.muted ? "border-stone-700 text-stone-500" : "border-amber-600/60 text-amber-200 bg-amber-950/30"}`}>
          {game.audio.muted ? "All Voices Off" : "All Voices On"}
        </button>
        {(game.audio.speaking || game.audio.paused) && !game.audio.muted && (
          <button onClick={game.audio.togglePause}
            className="rounded-xl border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:border-stone-500">
            {game.audio.paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(["male", "female"] as const).map(v => (
          <button key={v} onClick={() => game.send({ type: "set_voice", voice: v })}
            className={`rounded-xl border py-2 text-sm capitalize transition ${state.narratorVoice === v ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-700 bg-stone-900/60 text-stone-400 hover:border-stone-500"}`}>
            {v} voice
          </button>
        ))}
      </div>
      <label className="block mb-6">
        <span className="text-xs text-stone-500">Narrator & NPC Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={game.audio.volume}
          onChange={e => game.audio.setVolume(Number(e.target.value))}
          className="w-full accent-amber-600" />
      </label>
      <p className="-mt-4 mb-6 text-[11px] leading-relaxed text-stone-600">The storyteller keeps the selected voice. Each named NPC receives a different persistent voice based on sex and personality.</p>

      <SectionTitle>Art style</SectionTitle>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {(["painting", "sketch", "cinematic"] as const).map(s => (
          <button key={s} onClick={() => game.send({ type: "set_art_style", style: s })}
            className={`rounded-xl border py-2 text-sm capitalize transition ${state.artStyle === s ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-700 bg-stone-900/60 text-stone-400 hover:border-stone-500"}`}>
            {s}
          </button>
        ))}
      </div>
      <p className="-mt-1 mb-6 text-[11px] leading-relaxed text-stone-600">Painting is classical oils; Sketch looks like aged ink drawings from an old tome. The current scene repaints in the new style.</p>

      <SectionTitle>Soundscape</SectionTitle>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button onClick={() => sound.setMusicMuted(!sound.musicMuted)}
          className={`rounded-xl border py-2 text-sm transition ${sound.musicMuted ? "border-stone-700 text-stone-500" : "border-amber-600/60 text-amber-200 bg-amber-950/30"}`}>
          {sound.musicMuted ? "Music Off" : "Music On"}
        </button>
        <button onClick={() => sound.setEffectsMuted(!sound.effectsMuted)}
          className={`rounded-xl border py-2 text-sm transition ${sound.effectsMuted ? "border-stone-700 text-stone-500" : "border-amber-600/60 text-amber-200 bg-amber-950/30"}`}>
          {sound.effectsMuted ? "Effects Off" : "Effects On"}
        </button>
      </div>
      <div className="mb-3 rounded-xl border border-stone-800 bg-stone-900/55 px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-stone-600">Now Playing</div>
        <div className="text-sm text-stone-300">{sound.trackLabel}</div>
        <div className="text-[11px] capitalize text-stone-600">{sound.mood} scene</div>
      </div>
      <label className={`block mb-3 ${sound.musicMuted ? "opacity-45" : ""}`}>
        <span className="text-xs text-stone-500">Music Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={sound.musicVolume}
          onChange={e => sound.setMusicVolume(Number(e.target.value))}
          className="w-full accent-amber-600" />
      </label>
      <label className={`block mb-6 ${sound.effectsMuted ? "opacity-45" : ""}`}>
        <span className="text-xs text-stone-500">Effects Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={sound.effectsVolume}
          onChange={e => sound.setEffectsVolume(Number(e.target.value))}
          className="w-full accent-amber-600" />
      </label>

      <SectionTitle>Saves (stored on the host)</SectionTitle>
      <div className="flex gap-2 mb-3">
        <input value={slotName} onChange={e => setSlotName(e.target.value)} maxLength={40}
          placeholder="Name this save"
          className="flex-1 bg-stone-900/80 border border-stone-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-600/60" />
        <button
          disabled={!slotName.trim()}
          onClick={() => { game.send({ type: "save_slot", name: slotName.trim() }); setSlotName(""); }}
          className="rounded-xl bg-amber-700/90 hover:bg-amber-600 disabled:opacity-40 px-4 text-sm font-medium">
          Save
        </button>
      </div>
      <ul className="space-y-2 mb-6">
        {state.saves.map(s => (
          <li key={s.id} className="flex items-center gap-2 rounded-xl border border-stone-800 bg-stone-900/60 px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-stone-200 truncate">{s.name}</div>
              <div className="text-[10px] text-stone-500">{s.savedAt}</div>
            </div>
            <button onClick={() => { if (confirm(`Load "${s.name}"? Unsaved progress in the current tale is replaced.`)) game.send({ type: "load_slot", id: s.id }); }}
              className="text-xs rounded-lg border border-stone-700 px-2.5 py-1 text-stone-300 hover:border-amber-500/60">Load</button>
            <button onClick={() => { if (confirm(`Delete save "${s.name}"?`)) game.send({ type: "delete_slot", id: s.id }); }}
              className="text-xs rounded-lg border border-stone-800 px-2.5 py-1 text-stone-500 hover:border-red-500/60 hover:text-red-300">Delete</button>
          </li>
        ))}
        {state.saves.length === 0 && <li className="text-sm text-stone-500 italic">No Saves Yet</li>}
      </ul>

      <SectionTitle>Danger</SectionTitle>
      <button
        onClick={() => { if (confirm("Start a completely new game? The current tale and all heroes are cleared (save it to a slot first if you want to keep it).")) { game.send({ type: "new_game" }); onClose(); } }}
        className="w-full rounded-xl border border-red-900/70 text-red-300/90 hover:bg-red-950/40 py-2.5 text-sm font-medium transition">
        New Game (Clears Current Tale)
      </button>
    </Drawer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-widest text-stone-500 mb-2">{children}</div>;
}

function Center({ children, overlay = false }: { children: React.ReactNode; overlay?: boolean }) {
  return (
    <div className={`${overlay ? "absolute inset-0 pointer-events-none" : "h-screen w-screen"} flex items-center justify-center`}>
      {children}
    </div>
  );
}

function Embers({ text }: { text: string }) {
  return <div className="ember text-stone-400">{text}<span>.</span><span>.</span><span>.</span></div>;
}
