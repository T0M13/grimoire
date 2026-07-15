import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// When the game is published behind a reverse proxy on a real domain
// (e.g. GRIMOIRE_PUBLIC_ORIGIN=https://grimoire.example.com), Vite must accept
// that Host header and the client must talk to the game API on the same origin.
const publicOrigin = process.env.GRIMOIRE_PUBLIC_ORIGIN ?? process.env.VITE_GAME_ORIGIN;
const allowedHosts: string[] = [];
if (publicOrigin) {
  try {
    allowedHosts.push(new URL(publicOrigin).hostname);
  } catch {
    console.warn(`[grimoire] ignoring invalid public origin: ${publicOrigin}`);
  }
}

// The page players open. Deliberately not Vite's 5173 default so the usual dev port
// stays free for other projects on the host machine.
const webPort = Number(process.env.GRIMOIRE_WEB_PORT ?? "8786");
const gamePort = Number(process.env.GRIMOIRE_GAME_PORT ?? process.env.VITE_GAME_PORT ?? "8787");
const bindHost = process.env.GRIMOIRE_BIND_HOST ?? "0.0.0.0";
const proxyHost = bindHost === "0.0.0.0"
  ? "127.0.0.1"
  : bindHost === "::"
    ? "[::1]"
    : bindHost.includes(":") ? `[${bindHost}]` : bindHost;
const gameTarget = `http://${proxyHost}:${gamePort}`;
const clientDefines: Record<string, string> = {};
if (publicOrigin && !process.env.VITE_GAME_ORIGIN) {
  clientDefines["import.meta.env.VITE_GAME_ORIGIN"] = JSON.stringify(publicOrigin);
}
if (process.env.GRIMOIRE_GAME_PORT && !process.env.VITE_GAME_PORT) {
  clientDefines["import.meta.env.VITE_GAME_PORT"] = JSON.stringify(process.env.GRIMOIRE_GAME_PORT);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    strictPort: true, // never silently drift to another port; the proxy targets this one
    ...(allowedHosts.length ? { allowedHosts } : {}),
    // Existing reverse-proxy installs route the primary host to the web port. Keep portable
    // journey/hero transfers working even before /export and /import are added as custom routes.
    proxy: {
      "/export": { target: gameTarget },
      "/import": { target: gameTarget },
    },
  },
  // GRIMOIRE_PUBLIC_ORIGIN doubles as the client's game-API origin unless
  // VITE_GAME_ORIGIN overrides it explicitly (split-origin deployments). Direct development
  // also honors GRIMOIRE_GAME_PORT without requiring a duplicate VITE_GAME_PORT setting.
  define: clientDefines,
});
