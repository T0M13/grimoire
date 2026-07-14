import path from "node:path";
import type { ArtStyle, NpcSpeaker, Scene } from "@grimoire/shared";
import { REPO_ROOT } from "../packages/server/src/config.js";
import { getNpcPortrait, getSceneImage } from "../packages/server/src/media.js";

const style: ArtStyle = "painting";
const scene: Scene = {
  name: "The Weathered Gate",
  kind: "ruined forest gate",
  timeOfDay: "dusk",
  weather: "fog",
  mood: "mystery",
  description: "Isolated visual QA scene.",
  exits: [],
  occupants: [],
  // Deliberate legacy figure clause: environmentScenePrompt must remove it before ComfyUI.
  imagePrompt: "moss-covered stone arch, a hooded figure waits beneath it, fresh claw marks across a splintered oak door, abandoned lantern in wet leaves",
  imageUrl: null,
};
const subjects: NpcSpeaker[] = [
  {
    name: "Elowen Reed", sex: "female", entityType: "person",
    personality: "watchful but compassionate",
    appearance: "middle-aged ranger with warm brown skin, short silver-streaked curls, one eyebrow scar, moss-green cloak",
  },
  {
    name: "Mossback", sex: "male", entityType: "creature",
    personality: "ancient, solemn, and patient",
    appearance: "massive antlered forest guardian with bark-like hide, amber eyes, and small ferns growing across its shoulders",
  },
];

async function resolveAsset(result: { cached: string | null; pending: Promise<string> | null }): Promise<string> {
  if (result.cached) return result.cached;
  if (result.pending) return result.pending;
  throw new Error("visual pipeline returned neither a cached asset nor a pending job");
}

function localPath(url: string): string {
  return path.join(REPO_ROOT, "var", "assets", url.replace(/^\/assets\//, ""));
}

const outputs: Record<string, string> = {};
const environmentUrl = await resolveAsset(getSceneImage(scene, style));
outputs.environment = localPath(environmentUrl);
for (const subject of subjects) {
  const url = await resolveAsset(getNpcPortrait(subject, style));
  outputs[subject.entityType] = localPath(url);
}

console.log(JSON.stringify(outputs, null, 2));
