import { describe, it, expect } from "vitest";
import type { HmrContext } from "vite";
import viteConfig, { devNoFullReload, CODE_CHANGED_EVENT } from "../vite.config";

/* Ticket #58: Der Build hat ZWEI getrennte Wege, die nicht wieder zusammenfallen
 * dürfen. Diese Tests sichern beide Pfade gegen Regressionen ab:
 *  - Prod/Host-Build (Default-Mode) = Multi-File, KEIN Single-File-Plugin, dist/.
 *  - Offline-Build (mode "offline")  = Single-File-Plugin aktiv, dist-offline/.
 * vite.config exportiert via defineConfig die Konfig-Funktion (Funktionsform);
 * wir rufen sie mit dem ConfigEnv selbst auf und prüfen das Ergebnis. */

type ConfigFn = (env: {
  command: "build" | "serve";
  mode: string;
}) => { plugins?: unknown[]; build?: { outDir?: string }; define?: Record<string, string> };

const resolve = (mode: string) =>
  (viteConfig as unknown as ConfigFn)({ command: "build", mode });

const pluginNames = (plugins: unknown[] | undefined): string[] =>
  (plugins ?? [])
    .flat()
    .map((p) => (p as { name?: string } | null)?.name)
    .filter((n): n is string => typeof n === "string");

const SINGLEFILE = "vite:singlefile";

describe("Build-Strategie #58: Prod-Build (Multi-File)", () => {
  const cfg = resolve("production");

  it("schreibt nach dist/", () => {
    expect(cfg.build?.outDir).toBe("dist");
  });

  it("bindet das Single-File-Plugin NICHT ein (Assets bleiben eigene Dateien)", () => {
    expect(pluginNames(cfg.plugins)).not.toContain(SINGLEFILE);
  });
});

describe("Build-Strategie #58: Offline-Build (Single-File)", () => {
  const cfg = resolve("offline");

  it("schreibt nach dist-offline/ (kollidiert nicht mit dem Prod-Build)", () => {
    expect(cfg.build?.outDir).toBe("dist-offline");
  });

  it("aktiviert das Single-File-Plugin (alles inline für Doppelklick-Offline)", () => {
    expect(pluginNames(cfg.plugins)).toContain(SINGLEFILE);
  });
});

/* Ticket #331: ein dritter Build-Weg `--mode devpanel`, der das Dev-Panel (#325)
 * ABSICHTLICH mit ausliefert (self-contained, passwortgated). Diese Tests sichern:
 *  - der Mode hat sein eigenes Ausgabeverzeichnis (keine Kollision mit den anderen),
 *  - er ist self-contained (Single-File-Plugin, eine Datei zum Verteilen/Ziehen),
 *  - das Build-Flag __KQ_DEVPANEL__ ist NUR hier ein statisches `true`,
 *  - und – das eigentliche Geheimhaltungs-Tor – in `build`/`build:offline` ein
 *    statisches `false`, damit das Panel aus den ÖFFENTLICHEN Builds rausgestrippt
 *    wird (der dynamische devpanel-Import wird dort toter Code). */
describe("Build-Strategie #331: Dev-Panel-Build (verteilbar, passwortgated)", () => {
  const cfg = resolve("devpanel");

  it("schreibt in ein eigenes Verzeichnis dist-devpanel/ (keine Kollision)", () => {
    expect(cfg.build?.outDir).toBe("dist-devpanel");
    expect(cfg.build?.outDir).not.toBe(resolve("production").build?.outDir);
    expect(cfg.build?.outDir).not.toBe(resolve("offline").build?.outDir);
  });

  it("ist self-contained (Single-File-Plugin, eine verteilbare Datei)", () => {
    expect(pluginNames(cfg.plugins)).toContain(SINGLEFILE);
  });

  it("setzt das Panel-Flag __KQ_DEVPANEL__ statisch auf true", () => {
    expect(cfg.define?.__KQ_DEVPANEL__).toBe("true");
  });
});

describe("Geheimhaltung #331/#325: Panel-Flag bleibt in öffentlichen Builds aus", () => {
  // Der Riegel: nur dann strippt der Bundler den dynamischen devpanel-Import aus
  // den ausgelieferten Builds, wenn __KQ_DEVPANEL__ dort ein statisches `false` ist.
  it("ist im Prod-Build (dist/) statisch false", () => {
    expect(resolve("production").define?.__KQ_DEVPANEL__).toBe("false");
  });
  it("ist im Offline-Build (dist-offline/) statisch false", () => {
    expect(resolve("offline").define?.__KQ_DEVPANEL__).toBe("false");
  });
});

/* #301: Im Dev-Server darf eine Quellcode-Änderung KEINEN automatischen
 * Full-Reload mehr auslösen (riss sonst laufende NPC-Gespräche weg + blaues
 * Flackern). Das Plugin fängt JS/TS-Updates ab (leeres Modul-Array → Vite lädt
 * nicht neu) und meldet die Änderung als Custom-Event; CSS bleibt live-HMR. */
describe("Dev-Server #301: kein Auto-Full-Reload bei Code-Änderungen", () => {
  // Mini-HotUpdate-Kontext mit aufgezeichneten ws.send-Aufrufen.
  const runHotUpdate = (file: string) => {
    const sent: unknown[] = [];
    const plugin = devNoFullReload();
    // Nur die vom Plugin genutzten Felder (file + server.ws.send) nachbilden; der
    // Rest des echten HmrContext/ViteDevServer ist hier irrelevant, daher ein
    // einmaliger Cast über unknown auf den echten Vite-Typ.
    const ctx = {
      file,
      server: { ws: { send: (m: unknown) => sent.push(m) } },
    } as unknown as HmrContext;
    // handleHotUpdate ist ein ObjectHook (Funktion ODER { handler }); hier die
    // Funktionsform herausziehen und aufrufen.
    const hook = plugin.handleHotUpdate;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    const result = fn?.call(undefined as never, ctx);
    return { result, sent };
  };

  it("ist nur im Dev-Server aktiv (apply: 'serve'), nie im Build", () => {
    expect(devNoFullReload().apply).toBe("serve");
  });

  it("ist im Dev/Prod-Build-Pfad eingehängt, NICHT im Offline-Pfad", () => {
    expect(pluginNames(resolve("development").plugins)).toContain("kq-dev-no-full-reload");
    expect(pluginNames(resolve("offline").plugins)).not.toContain("kq-dev-no-full-reload");
  });

  it("fängt eine .ts-Änderung ab → leeres Modul-Array (kein Reload) + Hinweis-Event", () => {
    const { result, sent } = runHotUpdate("/src/scenes.ts");
    expect(result).toEqual([]); // leeres Array unterdrückt den Full-Reload
    expect(sent).toEqual([{ type: "custom", event: CODE_CHANGED_EVENT, data: { file: "/src/scenes.ts" } }]);
  });

  it("lässt CSS unangetastet (return undefined → normales Live-HMR, kein Event)", () => {
    const { result, sent } = runHotUpdate("/style.css");
    expect(result).toBeUndefined();
    expect(sent).toEqual([]); // kein Custom-Event, Vite macht sein Standard-CSS-HMR
  });

  it("greift auch bei den anderen JS-Endungen, aber nicht bei HTML/Assets", () => {
    expect(runHotUpdate("/src/main.js").result).toEqual([]);
    expect(runHotUpdate("/src/x.tsx").result).toEqual([]);
    expect(runHotUpdate("/index.html").result).toBeUndefined(); // HTML-Shell darf weiter neu laden
    expect(runHotUpdate("/assets/maps/harbor.tmj").result).toBeUndefined();
  });
});

describe("Build-Strategie #58: beide Wege sind wirklich verschieden", () => {
  it("Prod- und Offline-Build landen in getrennten Verzeichnissen", () => {
    expect(resolve("production").build?.outDir).not.toBe(
      resolve("offline").build?.outDir,
    );
  });

  it("nur der Offline-Build ist self-contained (Single-File-Plugin exklusiv dort)", () => {
    const prod = pluginNames(resolve("production").plugins).includes(SINGLEFILE);
    const offline = pluginNames(resolve("offline").plugins).includes(SINGLEFILE);
    expect({ prod, offline }).toEqual({ prod: false, offline: true });
  });
});
