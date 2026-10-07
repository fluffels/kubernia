// Kein Shebang (siehe docs-gen.mjs). Generatoren `quest-graph` und `quests-je-thema` (#1370): Regionen-/
// Quest-Graph und Quest-Zahlen aus den Content-Daten (`src/content/data`). Region = Karte des Standplatzes
// des Gebers (`entities.json`); Kanten sind der Lernpfad (`quest-order.json`) und `requires` (gestrichelt).
// `ladeQuestDaten` spiegelt die Prüfregeln des Loaders (`src/content/loader/quests.ts`), ohne ihn zu importieren
// (der Generator ist reines Node); ein Bindungstest hält die Reihenfolge gegen `KQContent.QUESTS`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MERMAID_FRONTMATTER, byCodeUnit, leseJson, mermaidText, renderTable } from "./markdown.mjs";

const brauche = (cfg, schluessel) => {
  const v = cfg?.[schluessel];
  if (typeof v !== "string" || v === "") throw new Error(`config.quests.${schluessel} fehlt`);
  return v;
};

const bezeichner = (praefix, s) => `${praefix}${String(s).replace(/[^A-Za-z0-9_]/g, "_")}`;

/** Standard-Obergrenze je Diagramm; größere Regionen werden in Teile zerlegt (Mermaid-Grenze: 50 000 Zeichen, 500 Kanten). */
const MAX_JE_DIAGRAMM = 30;
/** Harter Deckel für den Text eines Diagramms (Mermaid `maxTextSize` ist 50 000). */
const MAX_DIAGRAMM_ZEICHEN = 40000;

/** Zählt `n` mit Singular/Plural-Wort. */
const quests = (n) => `${n} ${n === 1 ? "Quest" : "Quests"}`;

/** Liest und prüft alle Quest-Daten; liefert die Quests in Lernpfad-Reihenfolge samt Region und die Regionen. */
export function ladeQuestDaten(rootDir, cfg) {
  const ordnerRel = brauche(cfg, "ordner");
  const ordnerAbs = join(rootDir, ordnerRel);
  if (!existsSync(ordnerAbs)) throw new Error(`Quest-Ordner ${ordnerRel} nicht gefunden (Config quests veraltet?)`);
  const dateien = readdirSync(ordnerAbs).filter((n) => n.endsWith(".json")).sort(byCodeUnit);

  const nachId = new Map();
  for (const f of dateien) {
    const liste = leseJson(rootDir, `${ordnerRel}/${f}`, "Quest-Datei");
    if (!Array.isArray(liste)) throw new Error(`${ordnerRel}/${f} muss ein Array von Quests sein`);
    for (const q of liste) {
      const wo = `${ordnerRel}/${f}: Quest ${JSON.stringify(q?.id)}`;
      for (const k of ["id", "title", "giver", "topic"]) {
        if (typeof q?.[k] !== "string" || q[k] === "") throw new Error(`${wo}: ${k} fehlt`);
      }
      if (q.requires !== undefined && !(Array.isArray(q.requires) && q.requires.every((r) => typeof r === "string" && r !== ""))) {
        throw new Error(`${wo}: requires muss eine Liste von Quest-IDs sein`);
      }
      if (nachId.has(q.id)) throw new Error(`Quest-ID "${q.id}" kommt doppelt vor (${ordnerRel}/${f})`);
      nachId.set(q.id, { id: q.id, title: q.title, giver: q.giver, topic: q.topic, requires: q.requires ?? [] });
    }
  }

  const reihenfolgeRel = brauche(cfg, "reihenfolge");
  const reihenfolge = leseJson(rootDir, reihenfolgeRel, "Reihenfolge");
  if (!Array.isArray(reihenfolge)) throw new Error(`${reihenfolgeRel} muss ein Array von Quest-IDs sein`);
  const gesehen = new Set();
  for (const id of reihenfolge) {
    if (!nachId.has(id)) throw new Error(`${reihenfolgeRel}: unbekannte Quest-ID "${id}"`);
    if (gesehen.has(id)) throw new Error(`${reihenfolgeRel}: Quest-ID "${id}" steht doppelt`);
    gesehen.add(id);
  }
  for (const id of [...nachId.keys()].sort(byCodeUnit)) {
    if (!gesehen.has(id)) throw new Error(`Quest "${id}" fehlt in ${reihenfolgeRel} (wäre unerreichbar)`);
  }

  const standRel = brauche(cfg, "standplaetze");
  const stand = leseJson(rootDir, standRel, "Standplätze");
  const kartenVon = new Map();
  for (const n of stand?.npcs ?? []) {
    if (kartenVon.has(n.id) && kartenVon.get(n.id) !== n.map) {
      throw new Error(`NPC "${n.id}" hat mehrere Standplätze auf verschiedenen Karten in ${standRel} (Region nicht eindeutig)`);
    }
    kartenVon.set(n.id, n.map);
  }
  const npcRel = brauche(cfg, "npcs");
  const npcs = leseJson(rootDir, npcRel, "NPC-Namen");

  const themenRel = brauche(cfg, "themen");
  const themenListe = leseJson(rootDir, themenRel, "Themen");
  if (!Array.isArray(themenListe)) throw new Error(`${themenRel} muss ein Array sein`);
  const themen = themenListe.map((t) => ({ id: t.id, label: t.label }));
  const themenIds = new Set(themen.map((t) => t.id));

  const geordnet = reihenfolge.map((id) => nachId.get(id));
  for (const q of geordnet) {
    if (!themenIds.has(q.topic)) throw new Error(`Quest "${q.id}": unbekanntes Thema "${q.topic}" (${themenRel})`);
    const map = kartenVon.get(q.giver);
    if (map === undefined) throw new Error(`Quest "${q.id}": Geber "${q.giver}" hat keinen Standplatz in ${standRel}`);
    const name = npcs?.[q.giver]?.name;
    if (typeof name !== "string" || name === "") throw new Error(`Quest "${q.id}": Geber "${q.giver}" hat keinen Namen in ${npcRel}`);
    for (const r of q.requires) {
      if (!nachId.has(r)) throw new Error(`Quest "${q.id}": requires verweist auf unbekannte Quest "${r}"`);
    }
    q.region = map;
    q.geberName = name;
  }

  // Kollisionen der Mermaid-Bezeichner (`-` und andere Zeichen werden zu `_`).
  const belegt = new Map();
  const pruefeKollision = (bez, roh) => {
    if (belegt.has(bez) && belegt.get(bez) !== roh) throw new Error(`Mermaid-Bezeichner "${bez}" kollidiert: "${belegt.get(bez)}" und "${roh}" (anders benennen)`);
    belegt.set(bez, roh);
  };
  for (const q of geordnet) pruefeKollision(bezeichner("q_", q.id), q.id);

  const maxTeil = Number.isInteger(cfg.maxQuestsJeDiagramm) && cfg.maxQuestsJeDiagramm > 0 ? cfg.maxQuestsJeDiagramm : MAX_JE_DIAGRAMM;
  const regionen = [];
  for (const q of geordnet) {
    let r = regionen.find((x) => x.map === q.region);
    if (!r) {
      r = { map: q.region, quests: [], geber: [] };
      regionen.push(r);
      pruefeKollision(bezeichner("r_", q.region), q.region);
    }
    r.quests.push(q);
    if (!r.geber.includes(q.geberName)) r.geber.push(q.geberName);
  }
  // Große Regionen in Teile zerlegen (aufeinanderfolgende Quests der Region), je Teil ein Diagramm.
  for (const r of regionen) {
    const anzahl = Math.ceil(r.quests.length / maxTeil);
    r.teile = [];
    for (let i = 0; i < anzahl; i++) {
      const label = anzahl === 1 ? r.map : `${r.map}, Teil ${i + 1}`;
      const teil = { label, quests: r.quests.slice(i * maxTeil, (i + 1) * maxTeil) };
      for (const x of teil.quests) x.gruppe = label;
      r.teile.push(teil);
    }
  }
  return { quests: geordnet, regionen, themen };
}

function ueberblick(daten) {
  const { quests: geordnet, regionen } = daten;
  const rid = (map) => bezeichner("r_", map);
  const zeilen = ["flowchart TB", '  start(["Start"])'];
  for (const r of regionen) {
    zeilen.push(`  ${rid(r.map)}["${mermaidText(r.map)}<br/>${mermaidText(quests(r.quests.length))} · ${mermaidText(r.geber.join(", "))}"]`);
  }
  zeilen.push(`  start --> ${rid(geordnet[0].region)}`);
  const uebergaenge = new Map();
  for (let i = 1; i < geordnet.length; i++) {
    const von = geordnet[i - 1].region;
    const nach = geordnet[i].region;
    if (von === nach) continue;
    const k = `${von}\u0000${nach}`;
    uebergaenge.set(k, { von, nach, n: (uebergaenge.get(k)?.n ?? 0) + 1 });
  }
  for (const u of uebergaenge.values()) {
    zeilen.push(`  ${rid(u.von)} -->${u.n > 1 ? `|"${u.n}×"|` : ""} ${rid(u.nach)}`);
  }
  const abhaengig = new Set();
  for (const q of geordnet) {
    for (const r of q.requires) {
      const dep = geordnet.find((x) => x.id === r);
      if (dep.region === q.region) continue;
      const k = `${dep.region}\u0000${q.region}`;
      if (abhaengig.has(k)) continue;
      abhaengig.add(k);
      zeilen.push(`  ${rid(dep.region)} -. requires .-> ${rid(q.region)}`);
    }
  }
  return ["```mermaid", MERMAID_FRONTMATTER, ...zeilen, "```"].join("\n");
}

function regionDiagramm(teil, daten) {
  const { quests: geordnet } = daten;
  const qid = (id) => bezeichner("q_", id);
  const knoten = teil.quests.map((q) => `  ${qid(q.id)}["${mermaidText(q.title)}<br/>${mermaidText(q.geberName)}"]`);
  const stubs = new Map();
  const kanten = [];
  const stub = (praefix, text, andere) => {
    const id = bezeichner(`${praefix}_`, andere);
    if (!stubs.has(id)) stubs.set(id, `  ${id}(["${mermaidText(`${text} ${andere}`)}"])`);
    return id;
  };
  for (let i = 1; i < geordnet.length; i++) {
    const a = geordnet[i - 1];
    const b = geordnet[i];
    if (a.gruppe === teil.label && b.gruppe === teil.label) kanten.push(`  ${qid(a.id)} --> ${qid(b.id)}`);
    else if (b.gruppe === teil.label) kanten.push(`  ${stub("aus", "aus", a.gruppe)} --> ${qid(b.id)}`);
    else if (a.gruppe === teil.label) kanten.push(`  ${qid(a.id)} --> ${stub("nach", "weiter nach", b.gruppe)}`);
  }
  const extern = new Map();
  for (const q of teil.quests) {
    for (const r of q.requires) {
      const dep = geordnet.find((x) => x.id === r);
      if (dep.gruppe === teil.label) kanten.push(`  ${qid(dep.id)} -. requires .-> ${qid(q.id)}`);
      else {
        const eid = bezeichner("ext_q_", dep.id);
        if (!extern.has(eid)) extern.set(eid, `  ${eid}(["${mermaidText(`${dep.title} (${dep.gruppe})`)}"])`);
        kanten.push(`  ${eid} -. requires .-> ${qid(q.id)}`);
      }
    }
  }
  const text = ["```mermaid", MERMAID_FRONTMATTER, "flowchart TB", ...knoten, ...stubs.values(), ...extern.values(), ...kanten, "```"].join("\n");
  if (text.length > MAX_DIAGRAMM_ZEICHEN) {
    throw new Error(`Diagramm "${teil.label}" hat ${text.length} Zeichen (Deckel ${MAX_DIAGRAMM_ZEICHEN}, Mermaid rendert ab 50 000 nicht mehr). Fix: config.quests.maxQuestsJeDiagramm senken`);
  }
  return text;
}

/** Generator `quest-graph`: Überblick über alle Regionen und je Region ein Diagramm. */
export function questGraphGenerator({ rootDir, config }) {
  const daten = ladeQuestDaten(rootDir, config.quests);
  if (daten.quests.length === 0) throw new Error("keine Quests gefunden (Config quests veraltet?)");
  const teile = ["## Überblick", "", ueberblick(daten), "", "## Regionen"];
  for (const r of daten.regionen) {
    teile.push("", `### Region \`${r.map}\``, "", `${quests(r.quests.length)} · Geber: ${r.geber.join(", ")}`);
    for (const t of r.teile) {
      if (r.teile.length > 1) teile.push("", `#### Teil ${r.teile.indexOf(t) + 1} von ${r.teile.length} (${quests(t.quests.length)})`);
      teile.push("", regionDiagramm(t, daten));
    }
  }
  return teile.join("\n");
}

/** Generator `quests-je-thema`: Tabelle Thema | Quests | Geber plus Gesamtzeile. */
export function questsJeThemaGenerator({ rootDir, config }) {
  const { quests: geordnet, themen } = ladeQuestDaten(rootDir, config.quests);
  const zeilen = themen.map((t) => {
    const q = geordnet.filter((x) => x.topic === t.id);
    const geber = [...new Set(q.map((x) => x.geberName))];
    return [t.label, String(q.length), geber.length ? geber.join(", ") : "–"];
  });
  zeilen.push(["**Gesamt**", `**${geordnet.length}**`, ""]);
  return renderTable(["Thema", "Quests", "Geber"], zeilen);
}
