// Kein Shebang: wird per `node scripts/verify-lauf.mjs` gestartet UND von test/verify-lauf.test.ts importiert.
/**
 * Zwei-Stufen-Prüfung (#1120): ein Wrapper um die Gate-Kette aus `package.json › scripts.verify`.
 *
 *  - `npm run verify:kompakt` (Stufe „Abschluss“): dieselbe Kette wie `verify`, aber jeder Schritt einzeln, ALLE Schritte
 *    laufen auch nach einem Rot, Ausgabe bei Grün nur eine Zeile, bei Rot nur die Blöcke der roten Schritte.
 *  - `npm run verify:changed` (Stufe „Iterieren“): wie kompakt, aber `lint` und `test` nur für die geänderten Dateien
 *    (Slice gegen die Merge-Base, dieselbe Basis wie `check:diffsize`). Kein Gate, ersetzt nie den vollen Lauf.
 *
 * Die Kette wird aus `package.json` aufgelöst (`kettenSchritte`, dieselbe Auflösung wie docgen/docdrift), nicht hier gepflegt:
 * ein neues Gate läuft automatisch in beiden Modi mit. Die CI fährt weiter das rohe `npm run verify`.
 * Fail-closed: kann der Slice nicht sicher bestimmt werden, laufen Lint und Test voll.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBase } from "./check-basis.mjs";
import { kettenSchritte } from "./docs-gen/npm-ketten.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Mehr geänderte Dateien als das: die Einengung lohnt nicht mehr, Lint und Test laufen voll. */
export const MAX_DATEIEN = 150;
/** Ausgabe eines roten Schritts: über dieser Zeilenzahl die ersten KOPF und die letzten ENDE. */
export const MAX_ZEILEN = 100;
export const KOPF = 80;
export const ENDE = 20;
/** Eine geänderte Datei daraus macht die Einengung unsicher (sie wirkt auf alle Läufe). */
export const KONFIG_DATEIEN = /^(?:package\.json|package-lock\.json|eslint\.config\.[cm]?js|eslint-suppressions\.json|vite\.config\.ts|tsconfig[^/]*\.json)$/;
const SCHRITT_RE = /^[\w:.-]+$/;
const LINTBAR = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

/** Schritte der `verify`-Kette; wirft ohne `verify`-Skript oder bei einem Namen mit Shell-Zeichen. */
export function ketteAusPackage(pkg) {
  const scripts = pkg?.scripts ?? {};
  if (typeof scripts.verify !== "string") throw new Error('package.json hat kein Skript "verify"');
  const schritte = kettenSchritte(scripts, ["verify"], "verify");
  for (const s of schritte) {
    if (!SCHRITT_RE.test(s)) throw new Error(`Schritt "${s}" der verify-Kette ist kein einfaches npm-Skript (Shell-Zeichen?)`);
  }
  return schritte;
}

const norm = (p) => String(p).replace(/\\/g, "/");

/**
 * Entscheidet, ob und wie Lint und Test eingeengt werden. Pur.
 * `dateien`: geänderte, existierende Pfade (relativ, `/`); `tests`: `{ pfad, text }` aller Testdateien.
 * Rückgabe `{ voll: true, grund }` oder `{ voll: false, lint, related, perName }`.
 */
export function bestimmeEngung({ base, dateien, tests }) {
  if (!base) return { voll: true, grund: "keine Vergleichs-Basis" };
  const liste = [...new Set((dateien ?? []).map(norm))];
  if (liste.length > MAX_DATEIEN) return { voll: true, grund: `mehr als ${MAX_DATEIEN} geänderte Dateien` };
  const konfig = liste.find((d) => KONFIG_DATEIEN.test(d));
  if (konfig) return { voll: true, grund: `${konfig} geändert` };
  const namen = [...new Set(liste.map((d) => basename(d)).filter(Boolean))];
  const perName = (tests ?? [])
    .filter((t) => !liste.includes(norm(t.pfad)) && namen.some((n) => t.text.includes(n)))
    .map((t) => norm(t.pfad));
  return { voll: false, lint: liste.filter((d) => LINTBAR.test(d)), related: liste, perName };
}

/** Kürzt eine Ausgabe über MAX_ZEILEN auf die ersten KOPF und die letzten ENDE Zeilen mit Hinweis. Pur. */
export function kuerze(text, schritt) {
  const zeilen = String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (zeilen.length <= MAX_ZEILEN) return zeilen.join("\n");
  const weg = zeilen.length - KOPF - ENDE;
  return [...zeilen.slice(0, KOPF), `… ${weg} Zeilen gekürzt, volle Ausgabe: npm run ${schritt}`, ...zeilen.slice(-ENDE)].join("\n");
}

const sek = (ms) => `${Math.round(ms / 1000)} s`;

/** Bericht aus den Schrittergebnissen `{ name, ok, ms, ausgabe, info, uebersprungen }`: grün eine Zeile, rot nur rote Blöcke + Summe. Pur. */
export function bericht(ergebnisse, { modus = "kompakt", hinweis = "" } = {}) {
  const rot = ergebnisse.filter((e) => !e.ok);
  const gesamt = ergebnisse.reduce((n, e) => n + e.ms, 0);
  const teil = (e) => `${e.name} ${e.uebersprungen ? "übersprungen" : e.ok ? "ok" : "ROT"} ${sek(e.ms)}${e.info ? ` (${e.info})` : ""}`;
  const kopf = `verify:${modus}`;
  const zusatz = hinweis ? ` · ${hinweis}` : "";
  if (!rot.length) {
    return `${kopf} grün · ${ergebnisse.length}/${ergebnisse.length} · ${sek(gesamt)} · ${ergebnisse.map(teil).join(", ")}${zusatz}`;
  }
  const blöcke = rot.map((e) => `── ${e.name}: rot (Exit ${e.exit ?? "?"}, ${sek(e.ms)}) ──\n${kuerze(e.ausgabe, e.name)}`);
  const summe = `${kopf} ROT · ${ergebnisse.length - rot.length}/${ergebnisse.length} grün · ${sek(gesamt)} · rot: ${rot.map((e) => e.name).join(", ")}${zusatz}`;
  return `${blöcke.join("\n\n")}\n\n${summe}`;
}

/**
 * Führt die Schritte aus. `run(job)` → `{ status, output }`; Job `{ art: "npm", schritt }` oder `{ art: "node", args }`.
 * `engung`: Ergebnis von `bestimmeEngung` oder `null` (voller Modus). Alle Schritte laufen, auch nach einem Rot.
 */
export function laufe({ schritte, engung = null, run, jetzt = () => Date.now() }) {
  const eng = engung && !engung.voll ? engung : null;
  return schritte.map((name) => {
    const t0 = jetzt();
    let job = { art: "npm", schritt: name };
    let info = "";
    if (eng && name === "lint") {
      if (!eng.lint.length) return { name, ok: true, uebersprungen: true, ms: 0, info: "keine Dateien" };
      job = { art: "node", args: ["eslint", "--max-warnings", "0", "--no-warn-ignored", ...eng.lint] };
      info = `${eng.lint.length} Dateien`;
    } else if (eng && name === "test") {
      job = { art: "node", args: ["vitest", "related", "--run", "--passWithNoTests", ...eng.related, ...eng.perName] };
      info = `related ${eng.related.length} + ${eng.perName.length} per Name`;
    }
    const r = run(job);
    return { name, ok: r.status === 0, exit: r.status, ms: jetzt() - t0, ausgabe: r.output, info };
  });
}

// ── IO (dünn) ────────────────────────────────────────────────────────────────

const git = (args) => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const liste = (text) => text.split("\0").filter(Boolean);

function sammleTests(dir = join(WURZEL, "test")) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sammleTests(p));
    else if (e.name.endsWith(".test.ts")) out.push({ pfad: norm(relative(WURZEL, p)), text: readFileSync(p, "utf8") });
  }
  return out;
}

/** Fail-closed: wirft das Laden des Slice (git, Dateisystem), laufen Lint und Test voll, mit Grund. Pur bis auf `lade`. */
export function engungSicher(lade) {
  try {
    return lade();
  } catch (e) {
    return { voll: true, grund: `Slice nicht lesbar: ${String(e?.message ?? e).split("\n")[0]}` };
  }
}

/** Die echten Zugriffe auf git und das Dateisystem; `ladeEngung` nimmt sie injiziert (Test ohne Repo). */
const ECHTE_ZUGRIFFE = { git, existiert: (d) => existsSync(join(WURZEL, d)), sammleTests: () => sammleTests() };

/** Der Slice als Einengung; jeder Fehler beim Laden (git, Dateisystem) endet fail-closed bei „voll“ mit Grund. */
export function ladeEngung(zugriffe = ECHTE_ZUGRIFFE) {
  return engungSicher(() => ladeEngungUngesichert(zugriffe));
}

function ladeEngungUngesichert({ git: g, existiert, sammleTests: tests }) {
  const base = resolveBase(g);
  if (!base) return bestimmeEngung({ base: null });
  const geaendert = liste(g(["diff", "--name-only", "-z", "--diff-filter=d", base]));
  const neu = liste(g(["ls-files", "-z", "--others", "--exclude-standard"]));
  const dateien = [...new Set([...geaendert, ...neu])].filter((d) => existiert(d));
  return bestimmeEngung({ base, dateien, tests: tests() });
}

const BIN = { eslint: "node_modules/eslint/bin/eslint.js", vitest: "node_modules/vitest/vitest.mjs" };

function echterLauf(job) {
  const opt = { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const r = job.art === "npm"
    ? spawnSync(`npm run -s ${job.schritt}`, { ...opt, shell: true })
    : spawnSync(process.execPath, [join(WURZEL, BIN[job.args[0]]), ...job.args.slice(1)], opt);
  return ergebnisAusProzess(r);
}

/** Ergebnis `{ status, output }` aus dem Rückgabewert von `spawnSync`; Signal, Timeout und Startfehler (`status` null) sind rot. Pur. */
export function ergebnisAusProzess(r) {
  return { status: statusVon(r), output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}

/** Exit-Code des Laufs: 0 nur, wenn jeder Schritt ok ist (der Beweis für den Short-Circuit der Review-Stufe 0). Pur. */
export const exitCode = (ergebnisse) => (ergebnisse.every((e) => e.ok) ? 0 : 1);

/** Status eines beendeten Prozesses; ein Abbruch per Signal oder Timeout (`status` null) gilt als rot, nie als grün. Pur. */
export const statusVon = (r) => r.status ?? 1;

/**
 * Der Lauf als Funktion (#1428 Z9): liefert den Exit-Code statt `process.exitCode` zu setzen, die Zugriffe sind injizierbar
 * (`deps.pkg`, `deps.ladeEngung`, `deps.run`, `deps.log`). Der Direktaufruf unten setzt `process.exitCode`.
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const { pkg = JSON.parse(readFileSync(join(WURZEL, "package.json"), "utf8")), ladeEngung: lade = ladeEngung, run = echterLauf, log = console.log } = deps;
  const changed = argv.includes("--changed");
  const schritte = ketteAusPackage(pkg);
  const engung = changed ? lade() : null;
  const hinweis = engung?.voll ? `Lint und Test voll (${engung.grund})` : "";
  const ergebnisse = laufe({ schritte, engung, run });
  log(bericht(ergebnisse, { modus: changed ? "changed" : "kompakt", hinweis }));
  return exitCode(ergebnisse);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
