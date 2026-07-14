import { CONFIG } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One constrained-generation call: guaranteed-parseable JSON per the given schema. */
export async function generateJson(messages: ChatMessage[], jsonSchema: unknown): Promise<string> {
  const res = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: CONFIG.dmModel,
      messages,
      stream: false,
      format: jsonSchema,
      keep_alive: "60m",
      options: { num_ctx: CONFIG.numCtx, temperature: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { message: { content: string } };
  return j.message.content;
}

/** Streamed free-text generation. Calls onChunk for every token group; returns the full text. */
export async function generateStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<string> {
  // inactivity guard: if the GPU is starved (e.g. a game hogging VRAM) and the stream
  // stalls, fail fast with a clear error instead of hanging the whole table
  const abort = new AbortController();
  let stallTimer = setTimeout(() => abort.abort(new Error("narration stalled - GPU overloaded?")), 30000);
  const poke = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => abort.abort(new Error("narration stalled - GPU overloaded?")), 30000);
  };

  const res = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
    method: "POST",
    signal: abort.signal,
    body: JSON.stringify({
      model: CONFIG.dmModel,
      messages,
      stream: true,
      keep_alive: "60m",
      // num_predict caps a beat at ~4 sentences: keeps pacing snappy and bounds worst-case latency
      options: { num_ctx: CONFIG.numCtx, temperature: 0.85, repeat_penalty: 1.1, num_predict: 180 },
    }),
  });
  if (!res.ok || !res.body) { clearTimeout(stallTimer); throw new Error(`ollama ${res.status}: ${await res.text()}`); }

  let full = "";
  let buf = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      poke();
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line) as { message?: { content?: string } };
        const t = j.message?.content ?? "";
        if (t) {
          full += t;
          onChunk(t);
        }
      }
    }
  } finally {
    clearTimeout(stallTimer);
  }
  return full;
}

/** Preload the DM model into VRAM (call while players are in the lobby). */
export async function warmUp(): Promise<void> {
  await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: CONFIG.dmModel,
      messages: [{ role: "user", content: "ready" }],
      stream: false,
      keep_alive: "60m",
      options: { num_ctx: CONFIG.numCtx },
    }),
  }).catch(() => { /* ollama not up yet — fine, first turn will load it */ });
}
