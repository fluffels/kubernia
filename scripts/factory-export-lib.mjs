// Prüfungen und Lock-Auszug des Export-Werkzeugs (ADR 0022 F10, Teil 7a, #1923). Einmalig: das Werkzeug samt dieser Bibliothek entfällt mit K9 (#1882).
// Alles pur: Eingaben sind Maps `Pfad -> Text` und geparste Configs, Ausgaben Befund-Listen und Zählungen; geschrieben wird hier nichts.
//
// Bekannte Muster (Grenzen, fail-open): Importe erkennt `importeAus` (ein dynamischer Pfad bleibt unsichtbar); ein in der Quelle schon unauflösbarer
// Importtext (Fixture-Text in Tests) und ein Paketname, den kubernia nicht kennt, gelten als Fixture-Rauschen und werden nur gezählt. Skriptbezüge
// sind Treffer von `scripts/<name>.mjs|cjs|js` ohne Platzhalter; lokale Pfade die Treffer von `pfadBefunde`; kubernia-Literale die Begriffe der
// Config (`begriffeAus`), die kein Projektliteral der Factory sind und deren Regex in beiden Configs verschieden ist.
import { builtinModules } from "node:module";
import { posix } from "node:path";
import { importeAus, begriffeAus, relativeImporte, zielDatei } from "./besitz-lib.mjs";
import { isCheckable } from "./check-basis.mjs";
import { pfadBefunde } from "./check-internalrefs.mjs";

const CODE_DATEI = /\.(?:mjs|cjs|js|ts)$/;
const BUILTINS = new Set(builtinModules);
const PAKET_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const ABHAENGIGKEITS_ARTEN = ["dependencies", "devDependencies", "optionalDependencies"];

/** Sortierte Schlüsselliste ohne Doppelte. */
const namen = (pkg) => [...new Set(ABHAENGIGKEITS_ARTEN.flatMap((art) => Object.keys(pkg?.[art] ?? {})))];

/** Auflösung `name` von `von` aus nach Node-Art: erst `<von>/node_modules/<name>`, dann hinauf bis zur Wurzel; `null` ohne Treffer. */
function aufloesen(packages, von, name) {
  let basis = von;
  for (;;) {
    const kandidat = basis === "" ? `node_modules/${name}` : `${basis}/node_modules/${name}`;
    if (Object.hasOwn(packages, kandidat)) return kandidat;
    if (basis === "") return null;
    const i = basis.lastIndexOf("node_modules/");
    basis = i <= 0 ? "" : basis.slice(0, i - 1);
  }
}

/**
 * Lock-Auszug (Auftrag: `package-lock.json` des Factory-Repos als Auszug aus dem Lock von kubernia). Die Wurzel kommt aus `pkg` (der Vorlage),
 * die Hülle ist alles, was von den Wurzel-Abhängigkeiten über `dependencies`, `optionalDependencies` und `peerDependencies` erreichbar ist; die
 * Reihenfolge der Quelle und alle Flags bleiben. Rückgabe `{ lock, befunde }`: ein fehlendes Pflichtziel (Wurzel-Abhängigkeit oder `dependencies`
 * eines Eintrags) ist ein Befund, ein fehlendes optionales oder Peer-Ziel wird übersprungen.
 */
export function lockAuszug(lock, pkg) {
  const befunde = [];
  const packages = lock?.packages;
  if (packages === null || typeof packages !== "object") return { lock: null, befunde: ["Lock: keine packages"] };
  const erreicht = new Set([""]);
  const offen = [];
  const besuche = (von, name, pflicht, herkunft) => {
    const ziel = aufloesen(packages, von, name);
    if (ziel === null) {
      if (pflicht) befunde.push(`Lock: '${name}' (${herkunft}) hat keinen Eintrag`);
      return;
    }
    if (!erreicht.has(ziel)) {
      erreicht.add(ziel);
      offen.push(ziel);
    }
  };
  for (const art of ABHAENGIGKEITS_ARTEN) for (const name of Object.keys(pkg?.[art] ?? {})) besuche("", name, art !== "optionalDependencies", "Wurzel");
  while (offen.length > 0) {
    const pfad = offen.pop();
    const eintrag = packages[pfad];
    for (const name of Object.keys(eintrag.dependencies ?? {})) besuche(pfad, name, true, pfad);
    for (const name of Object.keys(eintrag.optionalDependencies ?? {})) besuche(pfad, name, false, pfad);
    for (const name of Object.keys(eintrag.peerDependencies ?? {})) besuche(pfad, name, false, pfad);
  }
  const wurzel = { name: pkg.name, version: pkg.version };
  for (const art of ABHAENGIGKEITS_ARTEN) if (pkg[art] !== undefined) wurzel[art] = pkg[art];
  if (pkg.engines !== undefined) wurzel.engines = pkg.engines;
  const neu = {};
  for (const [pfad, eintrag] of Object.entries(packages)) {
    if (pfad === "") neu[""] = wurzel;
    else if (erreicht.has(pfad)) neu[pfad] = eintrag;
  }
  if (!Object.hasOwn(neu, "")) neu[""] = wurzel;
  return { lock: { name: pkg.name, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: lock.requires, packages: neu }, befunde };
}

/** Paketname eines Importspezifizierers (`vitest/config` -> `vitest`, `@a/b/c` -> `@a/b`); `null` bei einem Pfad, `node:`-Import, Builtin oder Text, der kein Paketname ist. */
export function paketName(spec) {
  if (/^[./]/.test(spec) || spec.startsWith("node:")) return null;
  const teile = spec.split("/");
  const name = spec.startsWith("@") ? teile.slice(0, 2).join("/") : teile[0];
  if (BUILTINS.has(name) || BUILTINS.has(spec)) return null;
  return PAKET_NAME.test(name) ? name : `?${spec}`;
}

/** Relative Importe aller Code-Dateien: Befund, wenn der Import in der Quelle auflöst und im Export nicht; in der Quelle schon unauflösbare werden gezählt. */
export function pruefeRelativeImporte(dateien, quellPfade) {
  const exportPfade = new Set(dateien.keys());
  const befunde = [];
  let unaufloesbar = 0;
  for (const [pfad, text] of dateien) {
    if (!CODE_DATEI.test(pfad)) continue;
    for (const spec of relativeImporte(text)) {
      if (zielDatei(pfad, spec, exportPfade) !== null) continue;
      const q = zielDatei(pfad, spec, quellPfade);
      if (q === null) unaufloesbar++;
      else befunde.push(`${pfad}: relativer Import '${spec}' löst im Export nicht auf (in der Quelle: ${q})`);
    }
  }
  return { befunde, unaufloesbar };
}

/**
 * Paket-Importe: Befund, wenn ein Paket, das kubernia kennt, nicht in der Vorlage steht; Befund auch für eine Vorlagen-Abhängigkeit, die kubernia nicht
 * hat oder mit anderer Range führt. Unbekannte Namen (Fixture-Text) und Builtins zählen nicht; die unbekannten Namen kommen sortiert zurück.
 */
export function pruefePaketImporte(dateien, kubPkg, vorlagePkg) {
  const kub = new Set(namen(kubPkg));
  const vorlage = new Set(namen(vorlagePkg));
  const befunde = [];
  const unbekannt = new Set();
  for (const [pfad, text] of dateien) {
    if (!CODE_DATEI.test(pfad)) continue;
    for (const spec of importeAus(text)) {
      const name = paketName(spec);
      if (name === null || vorlage.has(name)) continue;
      if (kub.has(name)) befunde.push(`${pfad}: Paket '${name}' steht nicht in der package.json-Vorlage`);
      else unbekannt.add(name);
    }
  }
  const range = (pkg, name) => ABHAENGIGKEITS_ARTEN.map((art) => pkg?.[art]?.[name]).find((r) => r !== undefined);
  for (const name of vorlage) {
    if (!kub.has(name)) befunde.push(`package.json-Vorlage: '${name}' steht in kubernia nicht (kein Lock-Eintrag ableitbar)`);
    else if (range(kubPkg, name) !== range(vorlagePkg, name)) befunde.push(`package.json-Vorlage: '${name}' hat die Range ${range(vorlagePkg, name)}, kubernia ${range(kubPkg, name)}`);
  }
  return { befunde, unbekannt: [...unbekannt].sort() };
}

const SKRIPT_BEZUG = /\bscripts\/[\w./-]+?\.(?:mjs|cjs|js)\b/g;

/** Skriptbezüge in `package.json`, `.claude/settings.json` und den Workflows: jeder genannte Skriptpfad muss im Export liegen. */
export function pruefeSkriptBezuege(dateien) {
  const befunde = [];
  for (const [pfad, text] of dateien) {
    if (pfad !== "package.json" && pfad !== ".claude/settings.json" && !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(pfad)) continue;
    for (const bezug of new Set(text.match(SKRIPT_BEZUG) ?? [])) {
      if (!dateien.has(bezug)) befunde.push(`${pfad}: nennt ${bezug}, das nicht im Export liegt`);
    }
  }
  return { befunde };
}

// Kandidaten der Pfadregel laut Auftrag; Laufwerks- und Ordnerteil getrennt gebaut, damit der Quelltext selbst keinen lokalen Pfad ergibt.
const LAUFWERK = "[A-Za-z]:[\\\\/]+";
const KANDIDATEN = [new RegExp(`${LAUFWERK}(?:dev|Users)(?![\\w])`), new RegExp("(?<![\\w.:/])/[a-z]/dev/"), new RegExp("(?<![\\w.:/\\\\])/Users/")];

/** Lokale Pfade: Befund ist jeder Treffer von `pfadBefunde` (mit den Repo-Namen aus `repoNamen`); Kandidatenzeilen ohne Befund (Platzhalter, Fixture-Wurzeln) werden gezählt. */
export function pruefeLokalePfade(dateien, repoNamen) {
  const dateiListe = [...dateien.keys()].filter((p) => isCheckable(p));
  const lies = (p) => dateien.get(p);
  const treffer = new Map();
  for (const repo of repoNamen) {
    for (const h of pfadBefunde(dateiListe, lies, { repo })) treffer.set(`${h.file}:${h.line}:${h.term}`, h);
  }
  const befunde = [...treffer.values()].map((h) => `${h.file}:${h.line}: lokaler Pfad (${h.term}): ${h.excerpt}`);
  const mitBefund = new Set([...treffer.values()].map((h) => `${h.file}:${h.line}`));
  let durchgelassen = 0;
  for (const pfad of dateiListe) {
    const text = lies(pfad);
    if (text.includes("\0")) continue;
    text.split(/\r?\n/).forEach((zeile, i) => {
      if (KANDIDATEN.some((re) => re.test(zeile)) && !mitBefund.has(`${pfad}:${i + 1}`)) durchgelassen++;
    });
  }
  return { befunde, durchgelassen };
}

/**
 * Die Begriffe, die der Export nicht tragen soll: die der kubernia-Config ohne die geteilten (kein Projektliteral der Factory und in beiden Configs
 * dieselbe Regex, z. B. Owner, Label, Board-ID, Skill), dazu die Projektliterale der Factory-Config (Spielwerte, `kubernia`, `KQ`).
 */
export function kuberniaBegriffe(kubConfig, factoryConfig) {
  const kub = begriffeAus(kubConfig);
  const fac = begriffeAus(factoryConfig);
  const literale = Object.keys(factoryConfig.projektliterale ?? {});
  const out = {};
  for (const [name, re] of Object.entries(kub)) {
    if (literale.includes(name)) continue;
    const f = fac[name];
    const geteilt = f !== undefined && f.source === re.source && f.flags === re.flags;
    if (!geteilt) out[name] = re;
  }
  for (const name of literale) out[name] = fac[name];
  return out;
}

/**
 * kubernia-Literale: Befund je Datei und Begriff (mit Anzahl). `ausgenommen(pfad)` liefert `null` (prüfen), `"zaehlen"` (Rest je Datei im Bericht)
 * oder `"frei"` (nicht geprüft).
 */
export function pruefeLiterale(dateien, begriffe, ausgenommen) {
  const befunde = [];
  const rest = new Map();
  for (const [pfad, text] of dateien) {
    const modus = ausgenommen(pfad);
    if (modus === "frei") continue;
    for (const [name, re] of Object.entries(begriffe)) {
      const n = (text.match(re) ?? []).length;
      if (n === 0) continue;
      if (modus === "zaehlen") rest.set(pfad, (rest.get(pfad) ?? 0) + n);
      else befunde.push(`${pfad}: kubernia-Literal '${name}' (${n}x)`);
    }
  }
  return { befunde, rest };
}

/** Ordner einer Vorlage im Quellbaum. */
export const VORLAGEN_ORDNER = ".factory/produkt/vorlagen";

/** Pfad der Vorlage zu einem Zielpfad. */
export const vorlagenPfad = (ziel) => `${VORLAGEN_ORDNER}/${ziel}.vorlage`;

/** Zielpfad einer Vorlagendatei (`null`, wenn der Pfad nicht unter dem Vorlagen-Ordner liegt oder nicht auf `.vorlage` endet). */
export const vorlagenZiel = (pfad) => (pfad.startsWith(`${VORLAGEN_ORDNER}/`) && pfad.endsWith(".vorlage") ? posix.relative(VORLAGEN_ORDNER, pfad).slice(0, -".vorlage".length) : null);
