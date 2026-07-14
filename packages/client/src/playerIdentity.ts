import { ClientMessageSchema, type ClientMessage } from "@grimoire/shared";

const STORAGE_KEY = "grimoire.player";

export type StoredPlayerIdentity = Omit<Extract<ClientMessage, { type: "join" }>, "type">;

type IdentityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Read and validate the browser's remembered seat without letting bad local data crash the UI. */
export function readPlayerIdentity(storage: IdentityStorage = localStorage): StoredPlayerIdentity | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsedJson = JSON.parse(raw) as unknown;
    if (!parsedJson || typeof parsedJson !== "object") throw new Error("Invalid player identity");
    const parsed = ClientMessageSchema.safeParse({ type: "join", ...parsedJson });
    if (!parsed.success || parsed.data.type !== "join") throw new Error("Invalid player identity");
    const { type: _type, ...identity } = parsed.data;
    return identity;
  } catch {
    try { storage.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
    return null;
  }
}

export function writePlayerIdentity(identity: StoredPlayerIdentity, storage: IdentityStorage = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(identity)); } catch { /* reconnect remains optional */ }
}
