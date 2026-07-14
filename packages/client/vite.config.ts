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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  },
  // GRIMOIRE_PUBLIC_ORIGIN doubles as the client's game-API origin unless
  // VITE_GAME_ORIGIN overrides it explicitly (split-origin deployments).
  define: publicOrigin && !process.env.VITE_GAME_ORIGIN
    ? { "import.meta.env.VITE_GAME_ORIGIN": JSON.stringify(publicOrigin) }
    : {},
});
