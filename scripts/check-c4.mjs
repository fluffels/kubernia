// Kein Shebang – wie scripts/docs-gen.mjs: das Skript wird per `node scripts/check-c4.mjs` gestartet UND von
// test/check-c4.test.ts importiert; ein `#!` bricht den Vitest-Import.
/**
 * Architekturmodell-Wächter (#1420, ADR 0020): das LikeC4-Modell unter `docs/architektur/` ist eine zweite
 * Ableitung derselben SSOTs wie die generierten Schichtdiagramme. `check:c4` prüft in dieser Reihenfolge
 *   1. `likec4 validate` (Syntax, Referenzen),
 *   2. `likec4 format --check` (Layout-Drift; Fix: `npm run c4:format`),
 *   3. den Abgleich des Modells gegen scripts/layers.cjs und src/:
 *      Art `schicht`/`bibliothek` ↔ Labels von SCHICHT_MODELL, Beziehungen zwischen ihnen ↔ sollKanten (beide Richtungen),
 *      Art `modul` ↔ Top-Level von src/ unter der Schicht, die schichtVon liefert, View-Deckel.
 * Gebunden wird über Art + Titel. Eine Art, die weder gebunden ist noch in `erzaehlung` steht, ist rot (fail-closed).
 * Pfade und Bindungen stehen im Block `architektur` von scripts/docs-gen/config.json (keine zweite Pfadliste).
 * Die LikeC4-Model-API steckt in genau einem Adapter (`ladeC4Modell`).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leseConfigObjekt } from "./docs-gen/markdown.mjs";
import { ladeModell, schichtVon, sollKanten } from "./docs-gen/schichten.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "scripts/docs-gen/config.json";
const BINDER = ["schicht", "extern", "modul"];

/** Top-Level von `quelle`: Ordner plus `.ts`-Dateien (ohne `.d.ts`); ein Barrel `x.ts` neben `x/` ist dasselbe Modul. */
export function srcModule(rootDir, quelle) {
  const basis = join(rootDir, quelle);
  const map = new Map();
  for (const name of readdirSync(basis).sort()) {
    if (name.startsWith(".")) continue;
    const istOrdner = statSync(join(basis, name)).isDirectory();
    if (!istOrdner && (!name.endsWith(".ts") || name.endsWith(".d.ts"))) continue;
    const modul = istOrdner ? name : name.slice(0, -3);
    if (!map.has(modul)) map.set(modul, []);
    map.get(modul).push(istOrdner ? `${quelle}/${name}/` : `${quelle}/${name}`);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, pfade]) => ({ name, pfade: pfade.sort() }));
}

/** Eine Meldung als eine Zeile: Fundort, Art, Titel, Problem, Fix. */
export function formatiere(m) {
  return `✖ ${m.datei}:${m.zeile} ${m.art} „${m.element}“: ${m.text}. Fix: ${m.fix}`;
}

const slash = (p) => p.split("\\").join("/");
const meld = (datei, zeile, art, element, text, fix) => ({ datei, zeile, art, element, text, fix });

function pruefeConfig(cfg) {
  const f = (text, fix) => meld(CONFIG, 1, "architektur", "config", text, fix);
  if (!cfg || typeof cfg !== "object") return [f(`Block "architektur" fehlt`, `Block "architektur" mit workspace, quelle, bindungen, erzaehlung und maxKnotenJeView in ${CONFIG} anlegen`)];
  const probleme = [];
  const bindungen = cfg.bindungen ?? {};
  const erz = Array.isArray(cfg.erzaehlung) ? cfg.erzaehlung : [];
  for (const [art, binder] of Object.entries(bindungen)) {
    if (!BINDER.includes(binder)) probleme.push(f(`bindungen.${art} nennt den unbekannten Binder "${binder}"`, `einen von ${BINDER.join(", ")} eintragen`));
    if (erz.includes(art)) probleme.push(f(`Art "${art}" steht zugleich in bindungen und erzaehlung`, `die Art aus einer der beiden Listen entfernen`));
  }
  if (!cfg.workspace || !cfg.quelle) probleme.push(f(`workspace oder quelle fehlt`, `beide Pfade in "architektur" eintragen`));
  if (!Number.isInteger(cfg.maxKnotenJeView) || cfg.maxKnotenJeView < 1) probleme.push(f(`maxKnotenJeView ist keine positive Zahl`, `eine Zahl eintragen (nur senken)`));
  return probleme;
}

/** Quelle (Titel → id) je Binder aus dem Schicht-Modell. */
function quellen(modell) {
  return {
    schicht: new Map(modell.schichten.map((s) => [s.label, s.id])),
    extern: new Map(modell.extern.map((x) => [x.label, x.id])),
  };
}

const sortiere = (ms) => ms.sort((a, b) => a.datei.localeCompare(b.datei) || a.zeile - b.zeile || a.text.localeCompare(b.text));

function pruefeArten(c4, cfg) {
  const bekannt = new Set([...Object.keys(cfg.bindungen), ...cfg.erzaehlung]);
  return c4.elemente
    .filter((e) => !bekannt.has(e.kind))
    .map((e) => meld(e.datei, e.zeile, e.kind, e.title, `Art "${e.kind}" ist weder gebunden noch Erzählung`, `Art in ${CONFIG} unter architektur.bindungen (mit Quelle) oder architektur.erzaehlung eintragen oder das Element umbenennen`));
}

function pruefeLabels(c4, quelle, binder, binderVon, ordner) {
  const ms = [];
  const els = c4.elemente.filter((e) => binderVon(e.kind) === binder);
  for (const e of els) {
    if (!quelle.has(e.title)) {
      ms.push(meld(e.datei, e.zeile, e.kind, e.title, `keine Quelle in scripts/layers.cjs (bekannt: ${[...quelle.keys()].join(", ")})`, `Titel auf ein Label aus scripts/layers.cjs ändern oder das Element entfernen`));
    }
  }
  for (const label of quelle.keys()) {
    if (!els.some((e) => e.title === label)) {
      const art = binder === "extern" ? "bibliothek" : "schicht";
      ms.push(meld(ordner, 1, art, label, `fehlt im Modell, steht aber in scripts/layers.cjs`, `Element ${art} '${label}' in docs/architektur/spiel.c4 anlegen`));
    }
  }
  return ms;
}

/** Ein doppelter Titel in einer gebundenen Art ist rot (Bindung läuft über Art + Titel). */
function pruefeDoppelte(c4, binderVon) {
  const gesehen = new Map();
  const ms = [];
  for (const e of c4.elemente) {
    if (!binderVon(e.kind)) continue;
    const key = JSON.stringify([e.kind, e.title]);
    const erstes = gesehen.get(key);
    if (erstes) ms.push(meld(e.datei, e.zeile, e.kind, e.title, `Titel kommt doppelt vor (auch ${erstes.datei}:${erstes.zeile})`, `Titel eindeutig machen oder das Duplikat entfernen`));
    else gesehen.set(key, e);
  }
  return ms;
}

function pruefeKanten(c4, modell, byId, binderVon, labelId, ordner) {
  const ms = [];
  const soll = new Set(sollKanten(modell).map(([v, n]) => `${v}>${n}`));
  const ist = new Set();
  const name = (id) => [...modell.schichten, ...modell.extern].find((s) => s.id === id)?.label ?? id;
  for (const b of c4.beziehungen) {
    const von = byId.get(b.von);
    const nach = byId.get(b.nach);
    if (!von || !nach) continue;
    const bv = binderVon(von.kind);
    const bn = binderVon(nach.kind);
    if (bv === "modul" || bn === "modul") {
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Beziehung mit einem Modul-Ende ist nicht aus einer SSOT ableitbar`, `Beziehung entfernen (Modul-Abhängigkeiten liefert npm run check:arch, Schicht-Richtungen scripts/layers.cjs)`));
      continue;
    }
    if (!["schicht", "extern"].includes(bv) || !["schicht", "extern"].includes(bn)) continue;
    const vid = labelId(bv, von.title);
    const nid = labelId(bn, nach.title);
    if (!vid || !nid) continue;
    ist.add(`${vid}>${nid}`);
    if (!soll.has(`${vid}>${nid}`)) {
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Schicht-Richtung ${name(vid)} → ${name(nid)} ist verboten (nicht in SCHICHT_MODELL.darf)`, `Beziehung entfernen oder die Richtung bewusst in scripts/layers.cjs erlauben`));
    }
  }
  for (const [v, n] of sollKanten(modell)) {
    if (ist.has(`${v}>${n}`)) continue;
    const ve = c4.elemente.find((e) => binderVon(e.kind) && labelId(binderVon(e.kind), e.title) === v && ["schicht", "extern"].includes(binderVon(e.kind)));
    ms.push(meld(ve?.datei ?? ordner, ve?.zeile ?? 1, "beziehung", `${name(v)} → ${name(n)}`, `erlaubte Schicht-Richtung fehlt im Modell`, `Beziehung '${name(v)} → ${name(n)}' im Modell ergänzen`));
  }
  return ms;
}

function pruefeModule(c4, modell, module, byId, binderVon, ordner) {
  const ms = [];
  const label = new Map(modell.schichten.map((s) => [s.id, s.label]));
  const els = c4.elemente.filter((e) => binderVon(e.kind) === "modul");
  const schichtEl = (titel) => c4.elemente.find((e) => binderVon(e.kind) === "schicht" && e.title === titel);
  for (const m of module) {
    const ids = new Set(m.pfade.map((p) => schichtVon(p, modell)));
    if (ids.size > 1) {
      ms.push(meld(ordner, 1, "modul", m.name, `${m.pfade.join(" und ")} liegen in verschiedenen Schichten (${[...ids].join(", ")})`, `Datei und Ordner in dieselbe Schicht legen oder die wurzeln in scripts/layers.cjs angleichen`));
      continue;
    }
    const soll = label.get([...ids][0]);
    const vorhanden = els.filter((e) => e.title === m.name);
    if (vorhanden.length === 0) {
      const s = schichtEl(soll);
      ms.push(meld(s?.datei ?? ordner, s?.zeile ?? 1, "modul", m.name, `fehlt im Modell, steht aber als ${m.pfade.join(", ")} in src/`, `Element modul '${m.name}' unter der Schicht '${soll}' in docs/architektur/spiel.c4 anlegen`));
      continue;
    }
    for (const e of vorhanden) {
      const eltern = byId.get(e.parentId);
      if (!eltern || binderVon(eltern.kind) !== "schicht" || eltern.title !== soll) {
        ms.push(meld(e.datei, e.zeile, "modul", m.name, `liegt unter ${eltern ? `„${eltern.title}“` : "keinem Element"}, gehört laut layers.cjs aber unter die Schicht „${soll}“`, `Element in die Schicht '${soll}' verschieben`));
      }
    }
  }
  const namen = new Set(module.map((m) => m.name));
  for (const e of els) {
    if (!namen.has(e.title)) ms.push(meld(e.datei, e.zeile, "modul", e.title, `kein Eintrag in src/ (Top-Level: ${[...namen].join(", ")})`, `Element entfernen oder den Titel auf einen Top-Level-Eintrag von src/ ändern`));
  }
  return ms;
}

/** Der Abgleich. Reine Funktion: Adapter-Output, Modell (layers.cjs), src-Module und Config rein, Meldungen raus. */
export function pruefeArchitektur({ modell, module, c4, cfg }) {
  const probleme = pruefeConfig(cfg);
  if (probleme.length) return sortiere(probleme);
  const ordner = c4.elemente[0]?.datei ?? cfg.workspace;
  const binderVon = (kind) => cfg.bindungen[kind] ?? null;
  const q = quellen(modell);
  const byId = new Map(c4.elemente.map((e) => [e.id, e]));
  const labelId = (binder, titel) => q[binder]?.get(titel) ?? null;
  const ms = [...pruefeArten(c4, cfg), ...pruefeDoppelte(c4, binderVon)];
  for (const binder of ["schicht", "extern"]) ms.push(...pruefeLabels(c4, q[binder], binder, binderVon, ordner));
  ms.push(...pruefeKanten(c4, modell, byId, binderVon, labelId, ordner));
  ms.push(...pruefeModule(c4, modell, module, byId, binderVon, ordner));
  for (const v of c4.views) {
    if (v.knoten > cfg.maxKnotenJeView) {
      ms.push(meld(v.datei, v.zeile, "view", v.id, `${v.knoten} Knoten, erlaubt sind ${cfg.maxKnotenJeView} (architektur.maxKnotenJeView)`, `View je Schicht teilen, den Deckel nur senken`));
    }
  }
  return sortiere(ms);
}

/**
 * Der einzige Adapter zur LikeC4-Model-API. `likec4` wird erst hier geladen (docs-gen und die puren Tests laden es nie).
 * LikeC4 zählt Zeilen ab 0; der Adapter gibt sie 1-basiert aus.
 */
export async function ladeC4Modell(rootDir, workspace) {
  const { LikeC4 } = await import("likec4");
  const abs = join(rootDir, workspace);
  const likec4 = await LikeC4.fromWorkspace(abs, { printErrors: false, logger: false });
  try {
    const rel = (uri) => slash(relative(rootDir, fileURLToPath(String(uri))));
    const ort = (ziel) => {
      const loc = likec4.languageServices.locate(ziel);
      return loc ? { datei: rel(loc.uri), zeile: loc.range.start.line + 1 } : { datei: workspace, zeile: 1 };
    };
    if (likec4.hasErrors()) {
      const fehler = likec4.getErrors().map((e) => `${slash(relative(rootDir, e.sourceFsPath))}:${e.line + 1}: ${e.message}`);
      throw new Error(`LikeC4-Modell hat Fehler:\n${fehler.join("\n")}`);
    }
    const model = await likec4.computedModel();
    const elemente = [...model.elements()].map((e) => ({ id: e.id, kind: e.kind, title: e.title, parentId: e.parent?.id ?? null, ...ort({ element: e.id }) }));
    const beziehungen = [...model.relationships()].map((r) => ({ von: r.source.id, nach: r.target.id, ...ort({ relation: r.id }) }));
    const views = [...model.views()].map((v) => ({ id: v.id, titel: v.title ?? v.id, knoten: [...v.nodes()].length, ...ort({ view: v.id }) }));
    return { elemente, beziehungen, views };
  } finally {
    await likec4.dispose();
  }
}

/** Startet die likec4-CLI (gleiche Version wie das Modell) als Kindprozess; liefert den Exit-Code. */
function likec4Cli(rootDir) {
  return (args) => {
    let bin;
    try {
      bin = join(dirname(createRequire(join(rootDir, "package.json")).resolve("likec4/package.json")), "bin", "likec4.mjs");
    } catch {
      return -1;
    }
    return spawnSync(process.execPath, [bin, ...args], { cwd: rootDir, stdio: "inherit" }).status ?? 1;
  };
}

export async function cli(argv, { rootDir = ROOT, out = console.log, err = console.error, spawn } = {}) {
  const run = spawn ?? likec4Cli(rootDir);
  let config;
  try {
    config = leseConfigObjekt(rootDir, CONFIG, "Config");
  } catch (e) {
    err(`✖ ${CONFIG}:1 config „config“: ${e instanceof Error ? e.message : e}. Fix: Datei prüfen`);
    return 1;
  }
  const cfg = config.architektur;
  const configProbleme = pruefeConfig(cfg);
  if (configProbleme.length) {
    for (const m of configProbleme) err(formatiere(m));
    return 1;
  }
  const ws = cfg.workspace;
  const v = run(["validate", ws]);
  if (v !== 0) {
    err(v === -1 ? `✖ package.json:1 devDependency „likec4“: nicht installiert. Fix: npm ci` : `✖ ${ws}:1 validate „likec4“: Modell ungültig. Fix: Fehler in der genannten .c4-Datei beheben (LikeC4 zählt Line ab 0)`);
    return 1;
  }
  let rot = false;
  if (run(["format", "--check", ws]) !== 0) {
    err(`✖ ${ws}:1 format „likec4“: Formatierung weicht ab. Fix: npm run c4:format`);
    rot = true;
  }
  try {
    const modell = ladeModell(rootDir, config.schichten.layers);
    // #1428 Z13: die Quellwurzel steht im Modell; `architektur.quelle` muss dasselbe Verzeichnis nennen (sonst vergliche der Wächter das falsche).
    if (`${cfg.quelle}/` !== modell.quellwurzel) throw new Error(`architektur.quelle „${cfg.quelle}“ passt nicht zur Quellwurzel „${modell.quellwurzel}“ des Schicht-Modells`);
    const ms = pruefeArchitektur({ modell, module: srcModule(rootDir, cfg.quelle), c4: await ladeC4Modell(rootDir, ws), cfg });
    for (const m of ms) err(formatiere(m));
    if (ms.length) rot = true;
  } catch (e) {
    err(`✖ ${ws}:1 abgleich „check:c4“: ${e instanceof Error ? e.message : e}. Fix: Ursache beheben`);
    rot = true;
  }
  if (!rot) out(`check:c4: Architekturmodell stimmt mit scripts/layers.cjs und src/ überein.`);
  return rot ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await cli(process.argv.slice(2));
