// Kein Shebang – wie scripts/docs-gen.mjs: das Skript wird per `node scripts/check-c4.mjs` gestartet UND von
// test/check-c4.test.ts importiert; ein `#!` bricht den Vitest-Import.
/**
 * Architekturmodell-Wächter (#1420, ADR 0020): das LikeC4-Modell unter `docs/architektur/` ist eine zweite
 * Ableitung derselben SSOTs wie die generierten Schichtdiagramme. `check:c4` prüft in dieser Reihenfolge
 *   1. `likec4 validate` (Syntax, Referenzen),
 *   2. `likec4 format --check` (Layout-Drift; Fix: `npm run c4:format`),
 *   3. den Abgleich des Modells gegen scripts/layers.cjs und der Quellwurzel (`architektur.quelle`):
 *      Art `schicht`/`bibliothek` ↔ Labels von SCHICHT_MODELL, Beziehungen zwischen ihnen ↔ sollKanten (beide Richtungen),
 *      Art `modul` ↔ Top-Level der Quellwurzel unter der Schicht, die schichtVon liefert, View-Deckel,
 *      die Harness-Arten (agent, skill, workflow, hook, githook, gate, ciworkflow, mcp) ↔ ihre Quellen (scripts/check-c4-harness.mjs),
 *      die Pflicht-Views (architektur.pflichtViews) und keine freistehende Zahl in Labels (SSOT-Konstanten gehören den generierten Diagrammen).
 * Gebunden wird über Art + Titel. Eine Art, die weder gebunden ist noch in `erzaehlung` steht, ist rot (fail-closed).
 * Pfade und Bindungen stehen im Block `architektur` von scripts/docs-gen/config.json (keine zweite Pfadliste); `architektur.quelle` muss `struktur.quelle` der Projekt-Config gleichen (sonst Exit 1 vor dem ersten likec4-Aufruf).
 * Die LikeC4-Model-API steckt in genau einem Adapter (`ladeC4Modell`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fenceMaske, leseConfigObjekt } from "./docs-gen/markdown.mjs";
import { ladeProjektConfig, PROJEKT_CONFIG, strukturAus } from "./projekt-config-lib.mjs";
import { escapeRegex } from "./ticket-namen.mjs";
import { ladeModell, schichtVon, sollKanten } from "./docs-gen/schichten.mjs";
import { HARNESS_BINDER, harnessQuellen, ortFuer, pruefeHarness } from "./check-c4-harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "scripts/docs-gen/config.json";
const SPIEL_BINDER = ["schicht", "extern", "modul", "port", "adapter"];
const BINDER = [...SPIEL_BINDER, ...HARNESS_BINDER];

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
  if (!cfg || typeof cfg !== "object") return [f(`Block "architektur" fehlt`, `Block "architektur" mit workspace, quelle, bindungen, erzaehlung, pflichtViews und maxKnotenJeView in ${CONFIG} anlegen`)];
  const probleme = [];
  const bindungen = cfg.bindungen ?? {};
  const erz = Array.isArray(cfg.erzaehlung) ? cfg.erzaehlung : [];
  for (const [art, binder] of Object.entries(bindungen)) {
    if (!BINDER.includes(binder)) probleme.push(f(`bindungen.${art} nennt den unbekannten Binder "${binder}"`, `einen von ${BINDER.join(", ")} eintragen`));
    if (erz.includes(art)) probleme.push(f(`Art "${art}" steht zugleich in bindungen und erzaehlung`, `die Art aus einer der beiden Listen entfernen`));
  }
  if (!cfg.workspace || !cfg.quelle) probleme.push(f(`workspace oder quelle fehlt`, `beide Pfade in "architektur" eintragen`));
  if (!cfg.hexagon || typeof cfg.hexagon.datei !== "string" || typeof cfg.hexagon.abschnitt !== "string") {
    probleme.push(f(`Block "hexagon" (datei, abschnitt) fehlt`, `"hexagon": { "datei": "docs/arc42-architektur.md", "abschnitt": "Hexagonale Sicht (Ports & Adapters)" } in "architektur" eintragen`));
  }
  if (!Array.isArray(cfg.pflichtViews) || cfg.pflichtViews.length === 0 || cfg.pflichtViews.some((v) => typeof v !== "string" || !v)) {
    probleme.push(f(`pflichtViews ist keine nicht-leere Liste von View-Namen`, `"pflichtViews": ["ticket-lauf", …] in "architektur" eintragen (mindestens ticket-lauf)`));
  }
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

function pruefeLabels(c4, quelle, binder, binderVon, o) {
  const ms = [];
  const els = c4.elemente.filter((e) => binderVon(e.kind) === binder);
  for (const e of els) {
    if (!quelle.has(e.title)) {
      ms.push(meld(e.datei, e.zeile, e.kind, e.title, `keine Quelle in ${o.sq} (bekannt: ${[...quelle.keys()].join(", ")})`, `Titel auf ein Label aus ${o.sq} ändern oder das Element entfernen`));
    }
  }
  for (const label of quelle.keys()) {
    if (!els.some((e) => e.title === label)) {
      const art = binder === "extern" ? "bibliothek" : "schicht";
      ms.push(meld(o.ordner, 1, art, label, `fehlt im Modell, steht aber in ${o.sq}`, `Element ${art} '${label}' in ${o.ordner} anlegen`));
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

function pruefeKanten(c4, modell, byId, binderVon, labelId, o) {
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
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Beziehung mit einem Modul-Ende ist nicht aus einer SSOT ableitbar`, `Beziehung entfernen (Modul-Abhängigkeiten liefert npm run check:arch, Schicht-Richtungen ${o.sq})`));
      continue;
    }
    if (!["schicht", "extern"].includes(bv) || !["schicht", "extern"].includes(bn)) continue;
    const vid = labelId(bv, von.title);
    const nid = labelId(bn, nach.title);
    if (!vid || !nid) continue;
    ist.add(`${vid}>${nid}`);
    if (!soll.has(`${vid}>${nid}`)) {
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Schicht-Richtung ${name(vid)} → ${name(nid)} ist verboten (nicht in SCHICHT_MODELL.darf)`, `Beziehung entfernen oder die Richtung bewusst in ${o.sq} erlauben`));
    }
  }
  for (const [v, n] of sollKanten(modell)) {
    if (ist.has(`${v}>${n}`)) continue;
    const ve = c4.elemente.find((e) => binderVon(e.kind) && labelId(binderVon(e.kind), e.title) === v && ["schicht", "extern"].includes(binderVon(e.kind)));
    ms.push(meld(ve?.datei ?? o.ordner, ve?.zeile ?? 1, "beziehung", `${name(v)} → ${name(n)}`, `erlaubte Schicht-Richtung fehlt im Modell`, `Beziehung '${name(v)} → ${name(n)}' im Modell ergänzen`));
  }
  return ms;
}

function pruefeModule(c4, modell, module, byId, binderVon, o) {
  const ms = [];
  const label = new Map(modell.schichten.map((s) => [s.id, s.label]));
  const els = c4.elemente.filter((e) => binderVon(e.kind) === "modul");
  const schichtEl = (titel) => c4.elemente.find((e) => binderVon(e.kind) === "schicht" && e.title === titel);
  for (const m of module) {
    const ids = new Set(m.pfade.map((p) => schichtVon(p, modell)));
    if (ids.size > 1) {
      ms.push(meld(o.ordner, 1, "modul", m.name, `${m.pfade.join(" und ")} liegen in verschiedenen Schichten (${[...ids].join(", ")})`, `Datei und Ordner in dieselbe Schicht legen oder die wurzeln in ${o.sq} angleichen`));
      continue;
    }
    const soll = label.get([...ids][0]);
    const vorhanden = els.filter((e) => e.title === m.name);
    if (vorhanden.length === 0) {
      const s = schichtEl(soll);
      ms.push(meld(s?.datei ?? o.ordner, s?.zeile ?? 1, "modul", m.name, `fehlt im Modell, steht aber als ${m.pfade.join(", ")} in ${o.quelle}/`, `Element modul '${m.name}' unter der Schicht '${soll}' in ${s?.datei ?? o.ordner} anlegen`));
      continue;
    }
    for (const e of vorhanden) {
      const eltern = byId.get(e.parentId);
      if (!eltern || binderVon(eltern.kind) !== "schicht" || eltern.title !== soll) {
        ms.push(meld(e.datei, e.zeile, "modul", m.name, `liegt unter ${eltern ? `„${eltern.title}“` : "keinem Element"}, gehört laut ${o.sq} aber unter die Schicht „${soll}“`, `Element in die Schicht '${soll}' verschieben`));
      }
    }
  }
  const namen = new Set(module.map((m) => m.name));
  for (const e of els) {
    if (!namen.has(e.title)) ms.push(meld(e.datei, e.zeile, "modul", e.title, `kein Eintrag in ${o.quelle}/ (Top-Level: ${[...namen].join(", ")})`, `Element entfernen oder den Titel auf einen Top-Level-Eintrag von ${o.quelle}/ ändern`));
  }
  return ms;
}

/** Backtick-Pfade der Hexagon-Sicht: unter der Quellwurzel oder unter test/, scripts/, docs/. */
const hexPfad = (quelle) => new RegExp("`((?:" + escapeRegex(quelle) + "|test|scripts|docs)/[^`\\s]*)`", "g");
const HEX_KOPF = { port: ["Port", "Seite", "Ort", "Schicht"], adapter: ["Adapter", "Port", "Ort", "Schicht"] };
const zellen = (zeile) => zeile.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const pfadeIn = (text, quelle) => [...text.matchAll(hexPfad(quelle))].map((m) => m[1]);

/**
 * Liest den Abschnitt `### <abschnitt>` der Hexagon-Sicht (bis zur nächsten Überschrift der Ebene 1 bis 3, Code-Fences
 * ausgeblendet): die Tabellen `| Port | Seite | Ort | Schicht |` und `| Adapter | Port | Ort | Schicht |` sowie alle Backtick-Pfade
 * `<quelle>/…`/`test/…`. Liefert `null`, wenn der Abschnitt fehlt. Reine Funktion.
 */
export function leseHexagon(text, abschnitt, quelle) {
  const lines = text.split(/\r?\n/);
  const fence = fenceMaske(lines);
  const start = lines.findIndex((l, i) => !fence[i] && l.trim() === `### ${abschnitt}`);
  if (start < 0) return null;
  let ende = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!fence[i] && /^#{1,3}\s/.test(lines[i])) {
      ende = i;
      break;
    }
  }
  const hex = { start: start + 1, ports: [], adapter: [], pfade: [], schief: [] };
  let modus = null;
  for (let i = start + 1; i < ende; i++) {
    if (fence[i]) continue;
    const line = lines[i];
    for (const pfad of pfadeIn(line, quelle)) hex.pfade.push({ pfad, zeile: i + 1 });
    if (!line.trim().startsWith("|")) {
      modus = null;
      continue;
    }
    const z = zellen(line);
    const kopf = Object.entries(HEX_KOPF).find(([, k]) => k.length === z.length && k.every((c, j) => c === z[j]));
    if (kopf) {
      modus = kopf[0];
      continue;
    }
    if (!modus || z.every((c) => /^:?-+:?$/.test(c))) continue;
    if (z.length !== 4) {
      hex.schief.push({ zeile: i + 1, text: line.trim() });
      continue;
    }
    const zeile = { name: z[0], zwei: z[1], ort: pfadeIn(z[2], quelle), schicht: z[3], zeile: i + 1 };
    (modus === "port" ? hex.ports : hex.adapter).push(zeile);
  }
  return hex;
}

/** Top-Level-Modul eines Pfads unter der Quellwurzel (`<quelle>/ui/a.ts` → `ui`, `<quelle>/sim.ts` → `sim`), sonst `null`. */
const modulVon = (pfad, quelle) => {
  if (!pfad.startsWith(`${quelle}/`)) return null;
  const erster = pfad.slice(quelle.length + 1).split("/")[0];
  return erster.endsWith(".ts") ? erster.slice(0, -3) : erster || null;
};

/** Eine Tabellenzeile gegen Schicht-Modell: Schicht-Spalte ↔ schichtVon, genau ein Top-Level-Modul. Liefert { modul, schichtId } oder null (Meldungen in `ms`). */
function pruefeHexZeile(z, art, { modell, quelle, datei, ms, sq }) {
  const m = (text, fix) => ms.push(meld(datei, z.zeile, art, z.name, text, fix));
  if (z.ort.length === 0) return m(`Spalte Ort nennt keinen Backtick-Pfad`, `den Ort als \`${quelle}/…\` eintragen`), null;
  const module = new Set(z.ort.map((p) => modulVon(p, quelle)));
  if (module.has(null)) return m(`Ort liegt nicht unter ${quelle}/`, `Pfade unter ${quelle}/ angeben`), null;
  if (module.size > 1) return m(`Ort liegt in mehreren Top-Level-Modulen (${[...module].join(", ")})`, `Zeile je Modul aufteilen`), null;
  const ids = new Set(z.ort.map((p) => schichtVon(p, modell)));
  const id = [...ids][0];
  const schicht = modell.schichten.find((s) => s.id === id);
  if (ids.size > 1 || !schicht) return m(`Ort liegt in verschiedenen oder unbekannten Schichten`, `Pfade einer Schicht angeben`), null;
  if (schicht.label !== z.schicht) {
    return m(`Schicht-Spalte „${z.schicht}“ widerspricht ${sq} (dort „${schicht.label}“)`, `Schicht-Spalte auf „${schicht.label}“ ändern`), null;
  }
  return { modul: [...module][0], schichtId: id };
}

function pruefeHexTabellen(hex, ctx) {
  const { ms, datei } = ctx;
  const info = { port: new Map(), adapter: new Map() };
  const gesehen = { port: new Set(), adapter: new Set() };
  for (const s of hex.schief) ms.push(meld(datei, s.zeile, "hexagon", "Tabelle", `Zeile hat nicht vier Zellen: ${s.text}`, `Zeile auf vier Zellen bringen`));
  for (const art of ["port", "adapter"]) {
    for (const z of art === "port" ? hex.ports : hex.adapter) {
      if (gesehen[art].has(z.name)) ms.push(meld(datei, z.zeile, art, z.name, `Zeile kommt doppelt vor`, `das Duplikat entfernen`));
      gesehen[art].add(z.name);
      const r = pruefeHexZeile(z, art, ctx);
      if (r) info[art].set(z.name, { ...r, z });
      if (art === "port" && !["treibend", "getrieben"].includes(z.zwei)) {
        ms.push(meld(datei, z.zeile, art, z.name, `Seite „${z.zwei}“ ist weder treibend noch getrieben`, `treibend oder getrieben eintragen`));
      }
      if (art === "adapter" && !hex.ports.some((p) => p.name === z.zwei)) {
        ms.push(meld(datei, z.zeile, art, z.name, `Port „${z.zwei}“ steht nicht in der Ports-Tabelle`, `den Port in die Ports-Tabelle aufnehmen oder den Namen korrigieren`));
      }
    }
  }
  return info;
}

/** Ein Port/Adapter-Element im Modell ↔ seine Tabellenzeile: Existenz, Elternmodul, Tag. */
function pruefeHexElemente(hex, c4, info, ctx) {
  const { ms, datei, byId, binderVon } = ctx;
  for (const art of ["port", "adapter"]) {
    const els = c4.elemente.filter((e) => binderVon(e.kind) === art);
    for (const [name, i] of info[art]) {
      const e = els.find((x) => x.title === name);
      if (!e) {
        ms.push(meld(datei, i.z.zeile, art, name, `fehlt im Modell`, `Element ${art} '${name}' unter dem Modul '${i.modul}' in ${ctx.ordner} anlegen`));
        continue;
      }
      const eltern = byId.get(e.parentId);
      if (!eltern || binderVon(eltern.kind) !== "modul" || eltern.title !== i.modul) {
        ms.push(meld(e.datei, e.zeile, art, name, `liegt unter ${eltern ? `„${eltern.title}“` : "keinem Element"}, laut Tabelle gehört es unter das Modul „${i.modul}“`, `Element unter das Modul '${i.modul}' verschieben`));
      }
      if (art === "port") {
        const tags = e.tags ?? [];
        if (!tags.includes(i.z.zwei) || tags.includes(i.z.zwei === "treibend" ? "getrieben" : "treibend")) {
          ms.push(meld(e.datei, e.zeile, art, name, `Tag ${tags.map((t) => `#${t}`).join(" ") || "fehlt"} passt nicht zur Seite „${i.z.zwei}“ der Tabelle`, `Tag #${i.z.zwei} setzen (und nur diesen)`));
        }
      }
    }
    const namen = new Set([...(art === "port" ? hex.ports : hex.adapter)].map((z) => z.name));
    for (const e of els) {
      if (!namen.has(e.title)) ms.push(meld(e.datei, e.zeile, art, e.title, `steht nicht in der ${art === "port" ? "Ports" : "Adapter"}-Tabelle der hexagonalen Sicht`, `Zeile in ${ctx.datei} ergänzen oder das Element entfernen`));
    }
  }
}

/** Kanten mit Port-/Adapter-Ende: genau je Adapter eine Kante Adapter → Port, Richtung nach den Schichtregeln. */
function pruefeHexKanten(hex, c4, info, ctx) {
  const { ms, datei, byId, binderVon, modell } = ctx;
  const soll = new Set(sollKanten(modell).map(([v, n]) => `${v}>${n}`));
  const erwartet = new Map();
  for (const z of hex.adapter) {
    const a = c4.elemente.find((e) => binderVon(e.kind) === "adapter" && e.title === z.name);
    const p = c4.elemente.find((e) => binderVon(e.kind) === "port" && e.title === z.zwei);
    if (a && p) erwartet.set(`${a.id}>${p.id}`, z);
  }
  const ist = new Set();
  for (const b of c4.beziehungen) {
    const von = byId.get(b.von);
    const nach = byId.get(b.nach);
    if (!von || !nach) continue;
    const bv = binderVon(von.kind);
    const bn = binderVon(nach.kind);
    if (!["port", "adapter"].includes(bv) && !["port", "adapter"].includes(bn)) continue;
    const key = `${b.von}>${b.nach}`;
    if (!erwartet.has(key)) {
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Kante mit Port-/Adapter-Ende ist nicht Adapter → Port laut Tabelle`, `Kante entfernen oder auf 'Adapter -> Port' laut Adapter-Tabelle ändern`));
    } else if (ist.has(key)) {
      ms.push(meld(b.datei, b.zeile, "beziehung", `${von.title} → ${nach.title}`, `Kante kommt doppelt vor`, `das Duplikat entfernen`));
    }
    ist.add(key);
  }
  for (const [key, z] of erwartet) {
    if (!ist.has(key)) {
      const a = c4.elemente.find((e) => e.id === key.split(">")[0]);
      ms.push(meld(a?.datei ?? datei, a?.zeile ?? 1, "beziehung", `${z.name} → ${z.zwei}`, `Kante Adapter → Port fehlt im Modell`, `Beziehung '${z.name} -> ${z.zwei}' im Modell ergänzen`));
    }
  }
  for (const z of hex.adapter) {
    const ai = info.adapter.get(z.name);
    const pi = info.port.get(z.zwei);
    if (ai && pi && ai.schichtId !== pi.schichtId && !soll.has(`${ai.schichtId}>${pi.schichtId}`)) {
      ms.push(meld(datei, z.zeile, "adapter", z.name, `Schicht-Richtung ${ai.z.schicht} → ${pi.z.schicht} ist laut SCHICHT_MODELL.darf verboten`, `Adapter in eine Schicht legen, die den Port erreichen darf`));
    }
  }
}

/**
 * Die hexagonale Sicht (#1567, ADR 0024): arc42-Tabellen ↔ Dateisystem, Schicht-Modell und C4-Modell. Reine Funktion:
 * `hexagon` = { text (arc42 oder null), existiert(pfad) }.
 */
export function pruefeHexagon({ hexagon, c4, modell, cfg, byId, binderVon, o }) {
  const datei = cfg.hexagon.datei;
  const ms = [];
  const hex = hexagon.text == null ? null : leseHexagon(hexagon.text, cfg.hexagon.abschnitt, cfg.quelle);
  if (!hex) {
    return [meld(datei, 1, "hexagon", cfg.hexagon.abschnitt, `Abschnitt „### ${cfg.hexagon.abschnitt}“ fehlt`, `Abschnitt mit Ports- und Adapter-Tabelle in ${datei} anlegen`)];
  }
  for (const [art, liste] of [["port", hex.ports], ["adapter", hex.adapter]]) {
    if (liste.length === 0) ms.push(meld(datei, hex.start, art, cfg.hexagon.abschnitt, `${art === "port" ? "Ports" : "Adapter"}-Tabelle fehlt oder ist leer`, `Tabelle mit Kopf | ${HEX_KOPF[art].join(" | ")} | anlegen`));
  }
  for (const p of hex.pfade) {
    if (!hexagon.existiert(p.pfad)) ms.push(meld(datei, p.zeile, "hexagon", p.pfad, `Pfad existiert nicht`, `Pfad korrigieren oder die Zeile entfernen`));
  }
  const ctx = { ms, datei, byId, binderVon, modell, quelle: cfg.quelle, sq: o.sq, ordner: o.ordner };
  const info = pruefeHexTabellen(hex, ctx);
  pruefeHexElemente(hex, c4, info, ctx);
  pruefeHexKanten(hex, c4, info, ctx);
  return ms;
}

const ZAHL = /(^|[^\p{L}\d])\d/u;

/**
 * Keine Zahl aus SSOT-Konstanten in Texten (ADR 0020): eine freistehende Zahl (Ziffer, vor der kein Buchstabe oder keine Ziffer steht)
 * in Beschreibung, Technik, Beziehungs- und Schritt-Labels, View-Titeln und Titeln nicht gebundener Arten ist rot. Der Titel einer
 * gebundenen Art steht in der SSOT und ist ausgenommen (`check:c4`). Zahlwörter (`drei`) erkennt die Regel nicht (Review-Sache).
 */
function pruefeZiffern(c4, binderVon) {
  const ms = [];
  const melde = (datei, zeile, art, element, feld, text) => {
    if (typeof text === "string" && ZAHL.test(text)) {
      ms.push(meld(datei, zeile, art, element, `${feld} „${text}“ enthält eine freistehende Zahl (Zahlen aus SSOT-Konstanten gehören den generierten Diagrammen)`, `Zahl aus dem Text nehmen oder die Aussage ohne Zahl formulieren`));
    }
  };
  for (const e of c4.elemente) {
    if (!binderVon(e.kind)) melde(e.datei, e.zeile, e.kind, e.title, "Titel", e.title);
    melde(e.datei, e.zeile, e.kind, e.title, "Beschreibung", e.beschreibung);
    melde(e.datei, e.zeile, e.kind, e.title, "Technik", e.technik);
  }
  for (const b of c4.beziehungen) {
    melde(b.datei, b.zeile, "beziehung", `${b.von} → ${b.nach}`, "Titel", b.titel);
    melde(b.datei, b.zeile, "beziehung", `${b.von} → ${b.nach}`, "Beschreibung", b.beschreibung);
  }
  for (const v of c4.views) {
    melde(v.datei, v.zeile, "view", v.id, "Titel", v.titel);
    for (const k of v.kanten ?? []) melde(v.datei, v.zeile, "view", v.id, "Schritt-Label", k.label);
  }
  return ms;
}

/** Der Abgleich. Reine Funktion: Adapter-Output, Modell (layers.cjs), src-Module, Hexagon-Eingang, Harness-Quellen und Config rein, Meldungen raus. `schichtQuelle` ist der Pfad der Schicht-Quelle (nur für Meldungstexte). */
export function pruefeArchitektur({ modell, module, c4, cfg, hexagon, harness = null, schichtQuelle = "der Schicht-Quelle" }) {
  const probleme = pruefeConfig(cfg);
  if (probleme.length) return sortiere(probleme);
  const binderVon = (kind) => cfg.bindungen[kind] ?? null;
  const o = { ordner: ortFuer(c4, binderVon, SPIEL_BINDER, cfg.workspace), sq: schichtQuelle, quelle: cfg.quelle };
  const q = quellen(modell);
  const byId = new Map(c4.elemente.map((e) => [e.id, e]));
  const labelId = (binder, titel) => q[binder]?.get(titel) ?? null;
  const ms = [...pruefeArten(c4, cfg), ...pruefeDoppelte(c4, binderVon)];
  for (const binder of ["schicht", "extern"]) ms.push(...pruefeLabels(c4, q[binder], binder, binderVon, o));
  ms.push(...pruefeKanten(c4, modell, byId, binderVon, labelId, o));
  ms.push(...pruefeModule(c4, modell, module, byId, binderVon, o));
  ms.push(...pruefeHexagon({ hexagon, c4, modell, cfg, byId, binderVon, o }));
  ms.push(...pruefeHarness({ c4, cfg, harness, binderVon }));
  ms.push(...pruefeZiffern(c4, binderVon));
  for (const id of cfg.pflichtViews) {
    if (!c4.views.some((v) => v.id === id)) ms.push(meld(CONFIG, 1, "view", id, `Pflicht-View fehlt im Modell`, `View '${id}' unter ${cfg.workspace} anlegen oder bewusst aus architektur.pflichtViews nehmen`));
  }
  for (const v of c4.views) {
    for (const k of v.kanten ?? []) {
      const von = byId.get(k.von);
      const nach = byId.get(k.nach);
      if (von && nach && (binderVon(von.kind) === "modul" || binderVon(nach.kind) === "modul")) {
        ms.push(meld(v.datei, v.zeile, "view", v.id, `zeigt die abgeleitete Kante ${von.title} → ${nach.title} mit einem Modul-Ende (nicht aus einer SSOT ableitbar)`, `Kanten, die Module verschachtelter Elemente anheben, mit einem Tag versehen und per 'exclude * -> * where tag is #…' aus der View nehmen`));
      }
    }
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
    const elemente = [...model.elements()].map((e) => ({ id: e.id, kind: e.kind, title: e.title, parentId: e.parent?.id ?? null, tags: [...e.tags].map(String), beschreibung: e.description?.text ?? null, technik: e.technology ?? null, ...ort({ element: e.id }) }));
    const beziehungen = [...model.relationships()].map((r) => ({ von: r.source.id, nach: r.target.id, titel: r.title ?? null, beschreibung: r.description?.text ?? null, ...ort({ relation: r.id }) }));
    const views = [...model.views()].map((v) => ({ id: v.id, titel: v.title ?? v.id, knoten: [...v.nodes()].length, kanten: [...v.edges()].map((e) => ({ von: e.source.id, nach: e.target.id, ...(v._type === "dynamic" ? { label: e.label ?? null } : {}) })), ...ort({ view: v.id }) }));
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
  // Die Quellwurzel steht zweimal (Projekt-Config `struktur.quelle` für die Kern-Checks, `architektur.quelle` hier): beide müssen dasselbe Verzeichnis nennen.
  let struktur;
  try {
    struktur = strukturAus(ladeProjektConfig({ rootDir, pruefen: false }));
  } catch (e) {
    err(`✖ ${PROJEKT_CONFIG}:1 struktur „check:c4“: ${e instanceof Error ? e.message.split("\n").join(" ") : e}`);
    return 1;
  }
  if (struktur.quelle !== cfg.quelle) {
    err(`✖ ${CONFIG}:1 architektur.quelle „${cfg.quelle}“ weicht von struktur.quelle „${struktur.quelle}“ in ${PROJEKT_CONFIG} ab. Fix: beide Dateien auf dieselbe Quellwurzel setzen`);
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
    const hexDatei = join(rootDir, cfg.hexagon.datei);
    const hexagon = { text: existsSync(hexDatei) ? readFileSync(hexDatei, "utf8") : null, existiert: (p) => existsSync(join(rootDir, p)) };
    const binder = HARNESS_BINDER.filter((b) => Object.values(cfg.bindungen).includes(b));
    const harness = binder.length ? harnessQuellen(rootDir, config, binder) : null;
    const ms = pruefeArchitektur({ modell, module: srcModule(rootDir, cfg.quelle), c4: await ladeC4Modell(rootDir, ws), cfg, hexagon, harness, schichtQuelle: config.schichten.layers });
    for (const m of ms) err(formatiere(m));
    if (ms.length) rot = true;
  } catch (e) {
    err(`✖ ${ws}:1 abgleich „check:c4“: ${e instanceof Error ? e.message : e}. Fix: Ursache beheben`);
    rot = true;
  }
  if (!rot) out(`check:c4: Architekturmodell stimmt mit ${config.schichten.layers}, ${cfg.quelle}/ und den Harness-Quellen überein.`);
  return rot ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await cli(process.argv.slice(2));
