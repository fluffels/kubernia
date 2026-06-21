/// <reference types="vitest/config" />
import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// #301: Im Dev-Server löste bisher JEDE Quellcode-Änderung einen vollen
// Page-Reload aus – das Spiel hat keine HMR-Boundaries (Phaser-Instanz +
// globale Singletons lassen sich nicht hot-swappen), also fällt Vite auf einen
// Full-Reload zurück. Mitten im Spielen riss das den In-Memory-Zustand weg
// (laufende NPC-Gespräche verschwanden, kurzes blaues Phaser-Hintergrund-
// Flackern), während die Position über den localStorage-Save erhalten blieb –
// genau das Bug-Bild aus #301. Besonders störend, weil parallele Agenten
// Dateien editieren, WÄHREND gespielt wird (daher „sporadisch nach einer
// Weile"). Im Prod-/Offline-Build gibt es keinen Dev-Server und damit kein HMR,
// also tritt der Bug dort nicht auf.
//
// Dieses Plugin unterbindet für JS/TS-Änderungen den automatischen Full-Reload
// (handleHotUpdate gibt ein leeres Modul-Array zurück → Vite schickt KEINEN
// Reload, siehe Vite-Client: bei 0 Modulen und Nicht-HTML passiert nichts) und
// schickt stattdessen ein sanftes Custom-Event an den Client, der einen Toast
// zeigt („F5 zum Übernehmen"). So bleibt das laufende Spiel inkl. Gespräch
// stehen; Code-Änderungen holt man sich bewusst per Reload. CSS-HMR bleibt
// unangetastet (Style-Edits swappen weiter live). Nur Dev (`apply: "serve"`).
export const CODE_CHANGED_EVENT = "kq:code-changed";
export function devNoFullReload(): Plugin {
  return {
    name: "kq-dev-no-full-reload",
    apply: "serve",
    handleHotUpdate(ctx) {
      // Nur den Spielcode abfangen; CSS/HTML/Assets behalten ihr Standardverhalten
      // (CSS soll weiter live hot-swappen, return undefined = Vite macht das Normale).
      if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(ctx.file)) return;
      ctx.server.ws.send({ type: "custom", event: CODE_CHANGED_EVENT, data: { file: ctx.file } });
      return []; // leeres Modul-Array → kein Full-Reload (#301)
    },
  };
}

// Zwei getrennte Build-Wege (Ticket #58) aus derselben Quelle (src/ + assets-data.ts):
//
//   • `vite build`                → Prod/Host-Build: normales Vite-Multi-File-Bundle
//     nach dist/. Assets liegen als eigene Dateien neben der HTML, werden vom
//     Webserver ausgeliefert und einzeln vom Browser gecacht. Gedacht zum Hosten.
//
//   • `vite build --mode offline` → Offline-Export: EINE self-contained
//     dist-offline/index.html (alle Assets via vite-plugin-singlefile inline als
//     Data-URI). Das ist das „per Doppelklick offline spielbar"-Feature – braucht
//     keinen Server, ist aber durch das eager-inline-Base64 bewusst nicht mehr der
//     Standardpfad, sondern ein zusätzliches Target.
//
// base "./" hält die Pfade relativ, damit beide Targets aus einem Unterordner bzw.
// per file:// laufen.
export default defineConfig(({ mode }: ConfigEnv): UserConfig => {
  const offline = mode === "offline";
  // Dev-Panel-Build (#331): ein dritter Mode (`vite build --mode devpanel`), der
  // das sonst dev-server-only Panel (#325) ABSICHTLICH MIT ausliefert – als eine
  // self-contained Datei (wie offline), passwortgated über das aus dem CI-Secret
  // injizierte VITE_KQ_DEVPANEL_PW. Das Build-Flag __KQ_DEVPANEL__ schaltet den
  // Panel-Mount in main.ts frei; in ALLEN anderen Modi ist es per `define` ein
  // statisches `false` → der dynamische devpanel-Import ist dort toter Code und
  // wird rausgestrippt (öffentliche `build`/`build:offline` bleiben panel-frei).
  const devpanel = mode === "devpanel";
  const singleFile = offline || devpanel; // beide liefern EINE self-contained Datei
  return {
    base: "./",
    define: {
      // Statisch foldbares Flag (kein import.meta.env-Sub-Key, damit Vites eigene
      // env-Behandlung unangetastet bleibt): true nur im devpanel-Mode.
      __KQ_DEVPANEL__: JSON.stringify(devpanel),
    },
    // Single-File-Modi (offline/devpanel): alles inline. Sonst: im Dev-Server den
    // störenden Auto-Full-Reload unterbinden (#301); im Prod-Build ist das
    // `apply: "serve"`-Plugin inaktiv und bleibt wirkungslos.
    plugins: singleFile ? [viteSingleFile()] : [devNoFullReload()],
    build: {
      outDir: devpanel ? "dist-devpanel" : offline ? "dist-offline" : "dist",
      emptyOutDir: true,
      // #199: Phaser (~1,9 MB) in einen eigenen langlebigen Vendor-Chunk auslagern.
      // Im Single-File-Modus (offline/devpanel) ist Code-Splitting sinnlos – dort
      // inline alles viteSingleFile sowieso in eine Datei. Für den regulären
      // Host-Build trennt manualChunks Phaser vom Spielcode: Phaser ändert sich
      // selten → Browser cachet den Vendor-Chunk dauerhaft; Spielcode-Änderungen
      // invalidieren nur den kleinen Spielchunk. Der Vendor-Chunk selbst ist
      // bewusst >500 kB (Phaser ist eine Game-Engine), daher chunkSizeWarningLimit
      // hochgesetzt – ein unerwartetes Wachstum des Spielcode-Chunks würde trotzdem
      // auffallen, weil er deutlich unter dem Limit bleibt.
      ...(singleFile
        ? {}
        : {
            chunkSizeWarningLimit: 2200,
            rollupOptions: {
              output: {
                // Funktions-Form statt der früheren Objekt-Form `{ vendor: ["phaser"] }`:
                // Vite 8 / Rollup 4 hat die deprecated Objekt-Form aus dem öffentlichen Typ
                // entfernt (nur noch `ManualChunksFunction`). Alle Phaser-Module landen
                // weiterhin im langlebigen `vendor`-Chunk; alles andere bleibt im Spielcode.
                manualChunks: (id) => (id.includes("node_modules/phaser") ? "vendor" : undefined),
              },
            },
          }),
    },
    test: {
      // Die Unit-Tests (sim/content) brauchen kein DOM – laufen schnell auf Node.
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  };
});
