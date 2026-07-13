import { useState, type ReactNode } from "react";
import {
  BACKGROUND_BUILD_RULES, CLASS_BUILD_RULES, LANGUAGES, POINT_BUY_BUDGET, POINT_BUY_COST,
  RACE_BUILD_RULES, STANDARD_ARRAY, applyRacialBonuses, backgroundRulesById,
  buildLevelOneCharacter, classRulesById, pointBuySpent, raceRulesById, validateBuildChoices,
  type CharacterBuildChoices,
} from "@grimoire/rules";
import {
  ABILITIES, ALIGNMENTS, SKILLS,
  type Ability, type AbilityMethod, type AbilityScores, type Alignment, type Skill,
} from "@grimoire/shared";

export interface JoinPayload {
  playerName: string;
  characterId: string;
  sex: "male" | "female";
  age: "young" | "adult" | "elder";
  bio: string;
  portraitUrl: null;
  abilities: AbilityScores;
  abilityMethod: AbilityMethod;
  proficientSkills: Skill[];
  raceId: string;
  subraceId: string | null;
  racialAbilityChoices: Ability[];
  racialSkills: Skill[];
  backgroundId: string;
  backgroundName: string;
  backgroundSkills: Skill[];
  alignment: Alignment;
  personalityTraits: string[];
  ideal: string;
  bond: string;
  flaw: string;
  languages: string[];
  equipmentPackageId: string;
}

const CLASSES = Object.values(CLASS_BUILD_RULES);
const RACES = Object.values(RACE_BUILD_RULES);
const TABS = ["Race", "Class", "Abilities", "Details", "Equipment", "Review"] as const;
const MALE_NAMES = ["Bram", "Cedric", "Doran", "Garrick", "Joren", "Kael", "Marek", "Osric", "Rurik", "Silas"];
const FEMALE_NAMES = ["Anya", "Brienne", "Elara", "Isolde", "Kira", "Lysa", "Mara", "Nessa", "Sera", "Wren"];
const LOOKS = ["Black hair, gray eyes, wiry build", "Auburn hair, green eyes, broad shoulders", "Silver-streaked hair, dark eyes, weathered hands", "Braided dark hair, amber eyes, lean and quiet"];
const PASTS = ["Former caravan guard who saw something in the mountains", "Ran away from a temple upbringing", "Last survivor of a fishing village", "Disgraced noble hiding a family secret", "Woke in a field with no memory of the years before"];

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const shuffled = <T,>(items: readonly T[]): T[] => [...items].sort(() => Math.random() - 0.5);
const modifier = (score: number) => Math.floor((score - 10) / 2);
const formatModifier = (value: number) => value >= 0 ? `+${value}` : `${value}`;

function rollAbilities(): AbilityScores {
  return Object.fromEntries(ABILITIES.map(ability => {
    const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
    return [ability, dice[1]! + dice[2]! + dice[3]!];
  })) as AbilityScores;
}

function languageDefaults(raceId: string, backgroundId: string): string[] {
  const race = raceRulesById(raceId)!;
  const background = backgroundRulesById(backgroundId)!;
  const count = (race.extraLanguageCount ?? 0) + background.languageCount;
  return LANGUAGES.filter(language => !race.languages.includes(language)).slice(0, count);
}

function skillDefaults(raceId: string, classId: string, backgroundId: string) {
  const race = raceRulesById(raceId)!;
  const cls = classRulesById(classId)!;
  const background = backgroundRulesById(backgroundId)!;
  const taken = new Set<Skill>(race.fixedSkills ?? []);
  const racialSkills = shuffled(SKILLS.filter(skill => !taken.has(skill))).slice(0, race.skillChoiceCount ?? 0);
  racialSkills.forEach(skill => taken.add(skill));
  const backgroundChoices = background.fixedSkills
    ? [...background.fixedSkills]
    : shuffled(SKILLS.filter(skill => !taken.has(skill))).slice(0, background.skillChoiceCount ?? 0);
  backgroundChoices.forEach(skill => taken.add(skill));
  const preferred = cls.recommendedSkills.filter(skill => !taken.has(skill));
  const remainder = cls.skillChoices.filter(skill => !taken.has(skill) && !preferred.includes(skill));
  return {
    racialSkills,
    backgroundSkills: background.fixedSkills ? [] : backgroundChoices,
    classSkills: [...preferred, ...remainder].slice(0, cls.skillCount),
  };
}

export default function CharacterCreator({ onJoin, connected }: { onJoin: (payload: JoinPayload) => void; connected: boolean }) {
  const defaults = skillDefaults("human", "fighter", "acolyte");
  const [tab, setTab] = useState(0);
  const [sex, setSex] = useState<"male" | "female">("male");
  const [age, setAge] = useState<"young" | "adult" | "elder">("adult");
  const [name, setName] = useState(() => pick(MALE_NAMES));
  const [bio, setBio] = useState(() => `${pick(LOOKS)}; ${pick(PASTS)}`);
  const [classId, setClassId] = useState("fighter");
  const [raceId, setRaceId] = useState("human");
  const [subraceId, setSubraceId] = useState<string | null>(null);
  const [abilityMethod, setAbilityMethod] = useState<AbilityMethod>("standard");
  const [abilities, setAbilities] = useState<AbilityScores>({ ...CLASS_BUILD_RULES.Fighter.recommendedAbilities });
  const [racialAbilityChoices, setRacialAbilityChoices] = useState<Ability[]>([]);
  const [classSkills, setClassSkills] = useState<Skill[]>(defaults.classSkills);
  const [racialSkills, setRacialSkills] = useState<Skill[]>(defaults.racialSkills);
  const [backgroundId, setBackgroundId] = useState("acolyte");
  const [backgroundName, setBackgroundName] = useState("Acolyte");
  const [backgroundSkills, setBackgroundSkills] = useState<Skill[]>(defaults.backgroundSkills);
  const [alignment, setAlignment] = useState<Alignment>("Neutral");
  const [personalityTraits, setPersonalityTraits] = useState(["I stay calm when plans fall apart.", "I ask questions others overlook."]);
  const [ideal, setIdeal] = useState("Freedom. Everyone should choose their own path.");
  const [bond, setBond] = useState("I carry a promise I refuse to break.");
  const [flaw, setFlaw] = useState("I take risks when someone doubts me.");
  const [languages, setLanguages] = useState<string[]>(() => languageDefaults("human", "acolyte"));
  const [equipmentPackageId, setEquipmentPackageId] = useState(CLASS_BUILD_RULES.Fighter.equipmentPackages[0]!.id);

  const cls = classRulesById(classId)!;
  const race = raceRulesById(raceId)!;
  const background = backgroundRulesById(backgroundId)!;
  const pointsRemaining = abilityMethod === "point-buy" ? POINT_BUY_BUDGET - pointBuySpent(abilities) : 0;
  const choices: CharacterBuildChoices = {
    classRules: cls, raceRules: race, subraceId, abilityMethod, abilities,
    racialAbilityChoices, classSkills, racialSkills, backgroundRules: background,
    backgroundName, backgroundSkills, alignment, personalityTraits, ideal, bond, flaw,
    extraLanguages: languages, equipmentPackageId,
  };
  const validationError = validateBuildChoices(choices);
  const valid = !validationError && !!name.trim();
  const preview = !validationError ? buildLevelOneCharacter("preview", name.trim() || "Unnamed Hero", choices) : null;

  const resetSkills = (nextRace: string, nextClass: string, nextBackground: string) => {
    const next = skillDefaults(nextRace, nextClass, nextBackground);
    setClassSkills(next.classSkills);
    setRacialSkills(next.racialSkills);
    setBackgroundSkills(next.backgroundSkills);
  };

  const chooseRace = (id: string) => {
    const next = raceRulesById(id)!;
    setRaceId(id);
    setSubraceId(next.subraces?.[0]?.id ?? null);
    const flexible = ABILITIES.filter(ability => !next.abilityChoiceExcluded?.includes(ability));
    setRacialAbilityChoices(flexible.slice(0, next.abilityChoiceCount ?? 0));
    setLanguages(languageDefaults(id, backgroundId));
    resetSkills(id, classId, backgroundId);
  };

  const chooseClass = (id: string) => {
    const next = classRulesById(id)!;
    setClassId(id);
    setAbilityMethod("standard");
    setAbilities({ ...next.recommendedAbilities });
    setEquipmentPackageId(next.equipmentPackages[0]!.id);
    resetSkills(raceId, id, backgroundId);
  };

  const chooseBackground = (id: string) => {
    const next = backgroundRulesById(id)!;
    setBackgroundId(id);
    setBackgroundName(next.label);
    setLanguages(languageDefaults(raceId, id));
    resetSkills(raceId, classId, id);
  };

  const setMethod = (method: AbilityMethod) => {
    setAbilityMethod(method);
    setAbilities(method === "rolled" ? rollAbilities() : { ...cls.recommendedAbilities });
  };

  const adjustAbility = (ability: Ability, delta: -1 | 1) => {
    const score = abilities[ability] + delta;
    if (score < 8 || score > 15) return;
    const next = { ...abilities, [ability]: score };
    if (pointBuySpent(next) <= POINT_BUY_BUDGET) setAbilities(next);
  };

  const swapAssignedScore = (ability: Ability, score: number) => {
    const other = ABILITIES.find(candidate => candidate !== ability && abilities[candidate] === score);
    if (other) setAbilities({ ...abilities, [ability]: score, [other]: abilities[ability] });
  };

  const randomizeDetails = (nextSex: "male" | "female") => {
    setSex(nextSex);
    setAge(pick(["young", "adult", "elder"] as const));
    setName(pick(nextSex === "male" ? MALE_NAMES : FEMALE_NAMES));
    setBio(`${pick(LOOKS)}; ${pick(PASTS)}`);
    setAlignment(pick(ALIGNMENTS));
    setPersonalityTraits(["I keep moving when others freeze.", "I remember every kindness."]);
    setIdeal(pick(["Freedom. Everyone should choose their own path.", "Knowledge. Truth is worth the danger.", "Community. We survive by standing together."]));
    setBond(pick(["I carry a promise I refuse to break.", "My lost home still guides every choice.", "Someone once saved me; I will repay that debt."]));
    setFlaw(pick(["I take risks when someone doubts me.", "I trust a compelling mystery too quickly.", "I hide fear behind sharp words."]));
  };

  const randomizeEverything = () => {
    const nextSex = pick(["male", "female"] as const);
    const nextClass = pick(CLASSES);
    const nextRace = pick(RACES);
    const nextBackground = pick(Object.values(BACKGROUND_BUILD_RULES));
    const nextSkills = skillDefaults(nextRace.id, nextClass.id, nextBackground.id);
    const method = pick(["standard", "point-buy", "rolled"] as const);
    setClassId(nextClass.id);
    setRaceId(nextRace.id);
    setSubraceId(nextRace.subraces ? pick(nextRace.subraces).id : null);
    setBackgroundId(nextBackground.id);
    setBackgroundName(nextBackground.id === "custom" ? "Wanderer" : nextBackground.label);
    setAbilityMethod(method);
    setAbilities(method === "rolled" ? rollAbilities() : { ...nextClass.recommendedAbilities });
    setClassSkills(nextSkills.classSkills);
    setRacialSkills(nextSkills.racialSkills);
    setBackgroundSkills(nextSkills.backgroundSkills);
    const flexible = ABILITIES.filter(ability => !nextRace.abilityChoiceExcluded?.includes(ability));
    setRacialAbilityChoices(shuffled(flexible).slice(0, nextRace.abilityChoiceCount ?? 0));
    setLanguages(shuffled(LANGUAGES.filter(language => !nextRace.languages.includes(language))).slice(0, (nextRace.extraLanguageCount ?? 0) + nextBackground.languageCount));
    setEquipmentPackageId(pick(nextClass.equipmentPackages).id);
    randomizeDetails(nextSex);
  };

  return <div className="min-h-screen w-screen overflow-y-auto flex items-center justify-center">
    <form className="fadein w-full max-w-3xl px-4 md:px-6 py-6" onSubmit={event => {
      event.preventDefault();
      if (!connected || !valid) return;
      onJoin({
        playerName: name.trim(), characterId: classId, sex, age, bio: bio.trim(), portraitUrl: null,
        abilities, abilityMethod, proficientSkills: classSkills, raceId, subraceId,
        racialAbilityChoices, racialSkills, backgroundId, backgroundName, backgroundSkills,
        alignment, personalityTraits, ideal, bond, flaw, languages, equipmentPackageId,
      });
    }}>
      <h1 className="narration text-5xl text-amber-100/90 tracking-wide text-center mb-1">Grimoire</h1>
      <p className="text-sm text-stone-400 text-center mb-4">Create A Level 1 Hero · 2014 SRD Rules</p>
      <button type="button" onClick={randomizeEverything} className="w-full rounded-xl border border-stone-700 text-stone-300 hover:border-amber-600/60 hover:text-amber-200 py-2 text-sm transition mb-4">Randomize Everything</button>

      <div className="grid grid-cols-6 gap-1 mb-5" role="tablist" aria-label="Character Creation Steps">
        {TABS.map((label, index) => <button type="button" key={label} role="tab" aria-selected={tab === index} onClick={() => setTab(index)} className={`rounded-lg border px-1 py-2 text-[10px] md:text-xs transition ${tab === index ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-800 bg-stone-900/50 text-stone-500 hover:border-stone-600"}`}><span className="hidden md:inline">{index + 1}. </span>{label}</button>)}
      </div>

      <div className="min-h-[430px]">
        {tab === 0 && <>
          <TabHeading title="Choose A Race" note="Race grants ability increases, speed, languages, and traits." />
          <OptionGrid columns="grid-cols-2 md:grid-cols-3">{RACES.map(item => <ChoiceCard key={item.id} selected={raceId === item.id} title={item.raceName} text={item.summary} onClick={() => chooseRace(item.id)} />)}</OptionGrid>
          {race.subraces?.length ? <label className="block mt-4"><FieldLabel>{race.raceName === "Dragonborn" ? "Draconic Ancestry" : "Lineage"} *</FieldLabel><select value={subraceId ?? ""} onChange={event => setSubraceId(event.target.value)} className="creator-field">{race.subraces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
          {(race.abilityChoiceCount ?? 0) > 0 && <ChoicePills title={`Flexible Ability Increases * · Choose ${race.abilityChoiceCount}`} options={ABILITIES.filter(ability => !race.abilityChoiceExcluded?.includes(ability))} selected={racialAbilityChoices} limit={race.abilityChoiceCount ?? 0} onChange={setRacialAbilityChoices} />}
          {(race.skillChoiceCount ?? 0) > 0 && <ChoicePills title={`Racial Skill Proficiencies * · Choose ${race.skillChoiceCount}`} options={SKILLS.filter(skill => ![...(race.fixedSkills ?? []), ...classSkills, ...(background.fixedSkills ?? backgroundSkills)].includes(skill))} selected={racialSkills} limit={race.skillChoiceCount ?? 0} onChange={setRacialSkills} />}
          <RuleSummary>{race.size} · {race.speed} Ft. · {race.languages.join(" · ")} · {race.traits.join(" · ")}</RuleSummary>
        </>}

        {tab === 1 && <>
          <TabHeading title="Choose A Class" note="Class grants hit points, saves, skills, equipment, and features." />
          <OptionGrid columns="grid-cols-2 md:grid-cols-3">{CLASSES.map(item => <ChoiceCard key={item.id} selected={classId === item.id} title={item.className} text={item.summary} onClick={() => chooseClass(item.id)} />)}</OptionGrid>
          <ChoicePills title={`Class Skill Proficiencies * · Choose ${cls.skillCount}`} options={cls.skillChoices.filter(skill => ![...(race.fixedSkills ?? []), ...racialSkills, ...(background.fixedSkills ?? backgroundSkills)].includes(skill))} selected={classSkills} limit={cls.skillCount} onChange={setClassSkills} />
          <RuleSummary>Hit Die D{cls.hitDie} · Primary {cls.primaryAbilities.join(" Or ")} · Saves {cls.savingThrows.join(" And ")}</RuleSummary>
        </>}

        {tab === 2 && <>
          <TabHeading title="Determine Ability Scores" note="Choose one official method. Race increases are shown in the final score." />
          <div className="grid grid-cols-3 gap-2 mb-4">{(["standard", "point-buy", "rolled"] as const).map(method => <button type="button" key={method} onClick={() => setMethod(method)} className={`rounded-xl border py-2 text-sm ${abilityMethod === method ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-700 text-stone-400"}`}>{method === "point-buy" ? "Point Buy" : method === "rolled" ? "Roll 4D6" : "Standard Array"}</button>)}</div>
          {abilityMethod === "point-buy" && <div className={`text-right text-sm mb-2 ${pointsRemaining === 0 ? "text-emerald-300" : "text-amber-300"}`}>{pointsRemaining} Points Remaining</div>}
          {abilityMethod === "rolled" && <button type="button" onClick={() => setAbilities(rollAbilities())} className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-300 mb-3">Roll Again</button>}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">{ABILITIES.map(ability => {
            const finalScores = applyRacialBonuses(abilities, race, subraceId, racialAbilityChoices);
            const bonus = finalScores[ability] - abilities[ability];
            return <div key={ability} className="rounded-xl border border-stone-700 bg-stone-900/70 p-2 text-center">
              <div className="text-[10px] tracking-widest text-stone-500">{ability}</div>
              {abilityMethod === "point-buy" ? <><div className="text-xl text-stone-100">{abilities[ability]}</div><div className="flex justify-center gap-1 mt-1"><ScoreButton label={`Lower ${ability}`} disabled={abilities[ability] <= 8} onClick={() => adjustAbility(ability, -1)}>−</ScoreButton><ScoreButton label={`Raise ${ability}`} disabled={abilities[ability] >= 15 || (POINT_BUY_COST[abilities[ability] + 1]! - POINT_BUY_COST[abilities[ability]]!) > pointsRemaining} onClick={() => adjustAbility(ability, 1)}>+</ScoreButton></div></> : <select aria-label={`${ability} Score`} value={abilities[ability]} onChange={event => swapAssignedScore(ability, Number(event.target.value))} className="bg-stone-950 border border-stone-700 rounded px-1 py-1 my-1 text-stone-100">{ABILITIES.map((candidate, index) => <option key={`${candidate}-${index}`} value={abilities[candidate]}>{abilities[candidate]}</option>)}</select>}
              <div className="text-xs text-amber-200/80">{finalScores[ability]} {bonus > 0 ? `(+${bonus})` : ""} · {formatModifier(modifier(finalScores[ability]))}</div>
            </div>;
          })}</div>
          <RuleSummary>{abilityMethod === "standard" ? `Use ${STANDARD_ARRAY.join(", ")} Once Each.` : abilityMethod === "point-buy" ? "Spend Exactly 27 Points; Scores Range From 8 To 15 Before Race." : "Six Sets Of 4D6, Dropping The Lowest Die Each Time."}</RuleSummary>
        </>}

        {tab === 3 && <>
          <TabHeading title="Describe Your Character" note="Only the name is required; randomization fills the roleplaying details." />
          <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Your Hero's Name *" maxLength={30} className="creator-field mb-3 text-lg" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3"><Segmented value={sex} options={["male", "female"] as const} set={setSex} /><Segmented value={age} options={["young", "adult", "elder"] as const} set={setAge} /><select value={alignment} onChange={event => setAlignment(event.target.value as Alignment)} className="creator-field">{ALIGNMENTS.map(item => <option key={item}>{item}</option>)}</select></div>
          <div className="grid md:grid-cols-2 gap-2 mb-3">
            <input value={personalityTraits[0] ?? ""} onChange={event => setPersonalityTraits([event.target.value, personalityTraits[1] ?? ""])} placeholder="Personality Trait" className="creator-field" />
            <input value={personalityTraits[1] ?? ""} onChange={event => setPersonalityTraits([personalityTraits[0] ?? "", event.target.value])} placeholder="Personality Trait" className="creator-field" />
            <input value={ideal} onChange={event => setIdeal(event.target.value)} placeholder="Ideal" className="creator-field" />
            <input value={bond} onChange={event => setBond(event.target.value)} placeholder="Bond" className="creator-field" />
            <input value={flaw} onChange={event => setFlaw(event.target.value)} placeholder="Flaw" className="creator-field md:col-span-2" />
          </div>
          <textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={200} rows={2} placeholder="Appearance, Vibe, And Past — Used For Your Portrait And Story" className="creator-field resize-none mb-3" />
          <div className="grid md:grid-cols-2 gap-3"><label><FieldLabel>Background *</FieldLabel><select value={backgroundId} onChange={event => chooseBackground(event.target.value)} className="creator-field">{Object.values(BACKGROUND_BUILD_RULES).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><FieldLabel>Background Name *</FieldLabel><input value={backgroundName} onChange={event => setBackgroundName(event.target.value)} maxLength={40} className="creator-field" /></label></div>
          {background.id === "custom" && <ChoicePills title="Background Skill Proficiencies * · Choose 2" options={SKILLS.filter(skill => ![...(race.fixedSkills ?? []), ...racialSkills, ...classSkills].includes(skill))} selected={backgroundSkills} limit={2} onChange={setBackgroundSkills} />}
          <ChoicePills title={`Additional Languages * · Choose ${(race.extraLanguageCount ?? 0) + background.languageCount}`} options={LANGUAGES.filter(language => !race.languages.includes(language))} selected={languages} limit={(race.extraLanguageCount ?? 0) + background.languageCount} onChange={setLanguages} />
        </>}

        {tab === 4 && <>
          <TabHeading title="Choose Equipment" note="Pick a compact, legal SRD starting loadout. Background gear is included automatically." />
          <OptionGrid columns="grid-cols-1 md:grid-cols-2">{cls.equipmentPackages.map(pack => <ChoiceCard key={pack.id} selected={equipmentPackageId === pack.id} title={pack.label} text={pack.items.join(" · ")} onClick={() => setEquipmentPackageId(pack.id)} />)}</OptionGrid>
          <RuleSummary>Background Gear · {background.equipment.join(" · ")}</RuleSummary>
        </>}

        {tab === 5 && <>
          <TabHeading title="Come Together" note="Review the authoritative sheet the game engine will use." />
          {preview ? <div className="rounded-2xl border border-stone-700 bg-stone-900/60 p-4">
            <div className="flex justify-between gap-3 mb-3"><div><div className="text-xl text-amber-100">{preview.name}</div><div className="text-sm text-stone-400">{preview.subrace ?? preview.raceName} · {preview.className} 1 · {preview.background} · {preview.alignment}</div></div><div className="text-right text-sm text-stone-300">{preview.maxHp} HP<br />AC {preview.ac} · {preview.speed} Ft.</div></div>
            <div className="grid grid-cols-6 gap-1 mb-3">{ABILITIES.map(ability => { const score = preview.abilities[ability] ?? 10; return <div key={ability} className="text-center rounded-lg bg-stone-950/70 p-1"><div className="text-[9px] text-stone-500">{ability}</div><div>{score}</div><div className="text-[10px] text-amber-300">{formatModifier(modifier(score))}</div></div>; })}</div>
            <ReviewLine label="Skills" value={preview.proficientSkills.join(" · ")} /><ReviewLine label="Languages" value={preview.languages.join(" · ")} /><ReviewLine label="Features" value={[...preview.traits, ...preview.classFeatures].join(" · ")} />{preview.spells.length > 0 && <ReviewLine label="Spells" value={preview.spells.join(" · ")} />}<ReviewLine label="Equipment" value={preview.inventory.join(" · ")} />
          </div> : <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">Required: {validationError}</div>}
          {!name.trim() && <div className="mt-2 text-sm text-red-300">Required: Enter A Hero Name.</div>}
        </>}
      </div>

      <div className="flex gap-2 mt-4">{tab > 0 && <button type="button" onClick={() => setTab(current => current - 1)} className="rounded-xl border border-stone-700 px-5 py-3 text-stone-300 hover:border-stone-500">Back</button>}{tab < TABS.length - 1 ? <button type="button" onClick={() => setTab(current => current + 1)} className="flex-1 rounded-xl bg-amber-800/90 hover:bg-amber-700 py-3 font-medium">Continue</button> : <button type="submit" disabled={!connected || !valid} className="flex-1 rounded-xl bg-amber-700/90 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed py-3 text-lg font-medium transition">{connected ? "Begin The Adventure" : "Connecting..."}</button>}</div>
    </form>
  </div>;
}

function TabHeading({ title, note }: { title: string; note: string }) {
  return <div className="mb-4"><h2 className="narration text-2xl text-amber-100/90">{title}</h2><p className="text-xs text-stone-500 mt-1">{note}</p></div>;
}

function OptionGrid({ columns, children }: { columns: string; children: ReactNode }) {
  return <div className={`grid ${columns} gap-2`}>{children}</div>;
}

function ChoiceCard({ selected, title, text, onClick }: { selected: boolean; title: string; text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`text-left rounded-xl border px-3 py-2 transition ${selected ? "border-amber-500/80 bg-amber-950/40" : "border-stone-700 bg-stone-900/60 hover:border-stone-500"}`}><div className={`text-sm font-medium ${selected ? "text-amber-200" : "text-stone-300"}`}>{title}</div><div className="text-[11px] text-stone-500 mt-0.5 leading-tight normal-case">{text}</div></button>;
}

function ChoicePills<T extends string>({ title, options, selected, limit, onChange }: { title: string; options: readonly T[]; selected: T[]; limit: number; onChange: (items: T[]) => void }) {
  return <div className="mt-4"><div className="text-xs text-stone-400 mb-2">{title} · {selected.length}/{limit}</div><div className="flex flex-wrap gap-1.5">{options.map(option => {
    const active = selected.includes(option);
    return <button type="button" key={option} onClick={() => onChange(active ? selected.filter(item => item !== option) : selected.length < limit ? [...selected, option] : selected)} className={`rounded-full border px-2.5 py-1 text-xs transition ${active ? "border-amber-500/80 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400 hover:border-stone-500"}`}>{option}</button>;
  })}</div></div>;
}

function Segmented<T extends string>({ value, options, set }: { value: T; options: readonly T[]; set: (value: T) => void }) {
  return <div className={`grid gap-1 ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>{options.map(option => <button type="button" key={option} onClick={() => set(option)} className={`rounded-xl border py-2 text-sm capitalize ${value === option ? "border-amber-500/80 bg-amber-950/40 text-amber-200" : "border-stone-700 text-stone-400"}`}>{option}</button>)}</div>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="block text-[10px] uppercase tracking-widest text-stone-500 mb-1">{children}</span>;
}

function RuleSummary({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-stone-800 bg-stone-900/50 px-3 py-2 mt-4 text-xs text-stone-400 capitalize">{children}</div>;
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return <div className="text-xs border-t border-stone-800 py-2"><span className="text-stone-500 mr-2">{label}</span><span className="text-stone-300 capitalize">{value}</span></div>;
}

function ScoreButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="w-7 rounded border border-stone-700 disabled:opacity-25 hover:border-amber-500/60">{children}</button>;
}
