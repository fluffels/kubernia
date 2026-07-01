/* #495: Coverage wird gemessen UND pro Schicht gegatet — diese Fitness-Function hält die
 * Coverage-Config ehrlich (analog verify-script/docmap/docdrift: struktureller Wächter, kein
 * Verhaltens-Test).
 *
 * Motivation (Architektur-Analyse 2026-07, iSAQB): 94 Testdateien sagen NICHTS über die
 * Abdeckung. Der Repo-Mittelwert (~62 %) versteckt, dass die Domäne exzellent (~92-96 %),
 * die Präsentation aber unit-untestbar (~5 %, nur e2e-Smoke) ist. Das Gate misst darum PRO
 * SCHICHT-Bucket — und genau diese Zuordnung darf nicht driften. Der Wächter sichert:
 *
 *  1. Werkzeug da: `@vitest/coverage-v8`-Dep + `test:coverage`-Skript (= vitest --coverage),
 *     in `verify:full` und als CI-Schritt (kein still weggefallenes Gate).
 *  2. Config-Form: vite.config nutzt die Schicht-SSOT (layers.cjs) statt hartkodierter Globs,
 *     Provider v8, misst nur src, kein maschinelles Absenken (`autoUpdate` nicht an).
 *  3. Floors sinnvoll gestaffelt: Domäne ≥ Anwendung ≥ Präsentation (hart→explizit-niedrig),
 *     jede Schicht explizit vorhanden.
 *  4. **Die Bindung** (Kernstück): für JEDE echte src-.ts-Datei greift GENAU EIN Bucket-Glob,
 *     und dieser stimmt mit `layerOf()` (der RegExp-Wahrheit, die auch dependency-cruiser
 *     nutzt) überein. So können Glob-Form und RegExp-Form nicht auseinanderlaufen, und keine
 *     Datei rutscht ungegatet durch.
 *
 * Ausführen mit:  npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { LAYERS, COVERAGE_GLOBS, layerOf } = require("../scripts/layers.cjs") as {
  LAYERS: { PRESENTATION: string; APPLICATION: string; ENTRY: string; DOMAIN: string };
  COVERAGE_GLOBS: Record<string, string>;
  layerOf: (file: string) => string;
};

// picomatch ist die Glob-Engine, die auch Vitest für die Coverage-`thresholds` nutzt (transitive
// Dep, kein eigenes Paket). Per require geladen, weil es keine Typdeklarationen mitbringt — so
// bleibt es hier bewusst untypisiert, ohne eine @types-Dep einzuführen. Signatur nur so weit
// getippt, wie der Test sie braucht (Glob → Prädikat).
const picomatch = require("picomatch") as (glob: string, opts?: { dot?: boolean }) => (path: string) => boolean;

const readRepo = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const pkg = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const viteConfig = readRepo("vite.config.ts");
const ci = readRepo(".github/workflows/ci.yml");

/** Alle echten src-.ts-Dateien (repo-relativer POSIX-Pfad) — dieselbe Grundmenge, die die
 *  Coverage `include: ["src/**\/*.ts"]` misst. */
function collectSrcTs(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of readdirSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), { withFileTypes: true })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile() && ent.name.endsWith(".ts")) out.push(child);
    }
  };
  walk("src");
  return out.sort();
}

describe("#495 Coverage-Gate: Werkzeug vorhanden & verdrahtet", () => {
  it("@vitest/coverage-v8 ist eine devDependency", () => {
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toBeTruthy();
  });

  it("`test:coverage` existiert und fährt vitest mit --coverage", () => {
    const s = pkg.scripts["test:coverage"];
    expect(s, "npm run test:coverage muss existieren").toBeTruthy();
    expect(s).toMatch(/vitest\s+run\b/);
    expect(s).toMatch(/--coverage\b/);
  });

  it("`verify:full` enthält das Coverage-Gate (nicht still weggefallen)", () => {
    expect(pkg.scripts["verify:full"]).toMatch(/\bnpm run test:coverage\b/);
  });

  it("die CI fährt `npm run test:coverage` als eigenen Schritt", () => {
    expect(ci).toMatch(/\bnpm run test:coverage\b/);
  });
});

describe("#495 Coverage-Config: Form & Governance", () => {
  it("nutzt die Schicht-SSOT (layers.cjs) statt hartkodierter Globs", () => {
    expect(viteConfig).toMatch(/COVERAGE_GLOBS/);
    expect(viteConfig).toMatch(/layers\.cjs/);
  });

  it("Provider v8, misst nur src-.ts, kein maschinelles Absenken", () => {
    expect(viteConfig).toMatch(/provider:\s*["']v8["']/);
    expect(viteConfig).toMatch(/include:\s*\[\s*["']src\/\*\*\/\*\.ts["']/);
    // autoUpdate darf NICHT eingeschaltet sein — Floors werden nur per Commit angehoben.
    expect(viteConfig).not.toMatch(/autoUpdate:\s*true/);
  });

  it("Floors sind gestaffelt: Domäne ≥ Anwendung ≥ Präsentation", () => {
    // Die vier Schicht-Floor-Objekte aus vite.config lesen (SSOT bleibt dort).
    const floorOf = (layerConst: string) => {
      const re = new RegExp(
        `\\[LAYERS\\.${layerConst}\\]:\\s*\\{\\s*statements:\\s*(\\d+),\\s*branches:\\s*(\\d+),\\s*functions:\\s*(\\d+),\\s*lines:\\s*(\\d+)`,
      );
      const m = viteConfig.match(re);
      expect(m, `Floor für LAYERS.${layerConst} muss in vite.config stehen`).toBeTruthy();
      const [, st, br, fn, ln] = m!.map(Number);
      return { st, br, fn, ln };
    };
    const domain = floorOf("DOMAIN");
    const app = floorOf("APPLICATION");
    const pres = floorOf("PRESENTATION");
    const entry = floorOf("ENTRY");
    // Domäne hart über Anwendung, Anwendung deutlich über der (bewusst niedrigen) Präsentation.
    for (const k of ["st", "br", "fn", "ln"] as const) {
      expect(domain[k], `Domäne.${k} ≥ Anwendung.${k}`).toBeGreaterThanOrEqual(app[k]);
      expect(app[k], `Anwendung.${k} ≥ Präsentation.${k}`).toBeGreaterThanOrEqual(pres[k]);
    }
    // Domäne ist wirklich „hart" (nicht versehentlich auf 0 gerutscht).
    expect(domain.st).toBeGreaterThanOrEqual(80);
    expect(domain.ln).toBeGreaterThanOrEqual(80);
    // Einstieg existiert explizit (wie Präsentation bewusst niedrig, aber gesetzt).
    expect(entry).toBeTruthy();
  });
});

describe("#495 Bindung: Glob-Form ↔ RegExp-Wahrheit (layerOf) deckungsgleich", () => {
  const files = collectSrcTs();

  it("es gibt src-.ts-Dateien zu prüfen (Testfixture nicht leer)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("jede src-.ts-Datei trifft GENAU EINEN Bucket-Glob = ihre layerOf-Schicht", () => {
    const matchers = Object.fromEntries(
      Object.entries(COVERAGE_GLOBS).map(([layer, glob]) => [layer, picomatch(glob, { dot: true })]),
    );
    const wrong: string[] = [];
    for (const f of files) {
      const hitLayers = Object.entries(matchers)
        .filter(([, isMatch]) => isMatch(f))
        .map(([layer]) => layer);
      const truth = layerOf(f);
      if (hitLayers.length !== 1 || hitLayers[0] !== truth) {
        wrong.push(`${f}: Globs=[${hitLayers.join(",") || "—"}] erwartet=${truth}`);
      }
    }
    expect(wrong, `Glob-Zuordnung weicht von layerOf ab:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("jede Schicht (inkl. Domäne) hat genau EINEN Bucket-Glob", () => {
    for (const layer of Object.values(LAYERS)) {
      expect(typeof COVERAGE_GLOBS[layer], `Schicht ${layer} braucht einen Coverage-Glob`).toBe("string");
    }
    expect(Object.keys(COVERAGE_GLOBS).sort()).toEqual([...Object.values(LAYERS)].sort());
  });
});
