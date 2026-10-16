// Kein Shebang – wie scripts/check-c4.mjs: von test/check-c4-harness.test.ts importiert.
/**
 * Harness-Bindungen des Architekturmodells (#1421, ADR 0020): die Arten agent, skill, workflow, hook, githook, gate,
 * ciworkflow und mcp sind je an genau eine SSOT gebunden; `check:c4` ruft `pruefeHarness` auf. Rot in beide Richtungen
 * (Element ohne Quelle, Quelle ohne Element). Ein `gate` liegt dazu unter dem Element, dessen Titel die Kette ist,
 * der es per `kettenSchritte` gehört. Beziehungen zwischen Harness-Elementen sind Erzählung und werden nicht geprüft.
 * Pfade stehen im Config-Block (`harness`, `gates`, `kennzahlen.workflows`), keine zweite Pfadliste.
 * Der Loader `harnessQuellen` liest die Quellen; `pruefeHarness` ist rein.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harnessKatalog } from "./docs-gen/harness-inventar.mjs";
import { kettenSchritte } from "./docs-gen/npm-ketten.mjs";

export const HARNESS_BINDER = ["agent", "skill", "workflow", "hook", "githook", "gate", "ciworkflow", "mcp"];

const meld = (datei, zeile, art, element, text, fix) => ({ datei, zeile, art, element, text, fix });

/** Fundort für „fehlt im Modell“: die Datei des ersten Elements dieser Binder-Familie, sonst der Workspace. */
export function ortFuer(c4, binderVon, binders, fallback) {
  return c4.elemente.find((e) => binders.includes(binderVon(e.kind)))?.datei ?? fallback;
}

const lesJson = (rootDir, pfad, was) => {
  if (!existsSync(join(rootDir, pfad))) throw new Error(`${was} ${pfad} fehlt (Quelle der Harness-Bindung)`);
  return JSON.parse(readFileSync(join(rootDir, pfad), "utf8"));
};

const dateien = (rootDir, ordner, was, filter) => {
  if (!existsSync(join(rootDir, ordner))) throw new Error(`${was} ${ordner} fehlt (Quelle der Harness-Bindung)`);
  return readdirSync(join(rootDir, ordner), { withFileTypes: true })
    .filter((e) => e.isFile() && filter(e.name))
    .map((e) => e.name)
    .sort();
};

/**
 * Liest die Quellen der Harness-Bindungen: `{ [binder]: { herkunft, eintraege: [{ titel, kette? }] } }`. Ein nicht konfigurierter
 * Schlüssel lässt den Binder aus (pruefeHarness meldet das als rot); ein konfigurierter, aber fehlender Pfad wirft mit dem Dateinamen.
 */
export function harnessQuellen(rootDir, config, binders = HARNESS_BINDER) {
  const h = config.harness ?? {};
  const q = {};
  /** `optional`: ein fehlender Ordner heißt „keine Einträge“ (Workflows gibt es nur, wenn das Projekt welche hat). */
  const katalog = (key, was, liste, optional = false) => {
    if (!h[key]) return;
    if (!existsSync(join(rootDir, h[key]))) {
      if (optional) {
        q[liste.binder] = { herkunft: h[key], eintraege: [] };
        return;
      }
      throw new Error(`${was} ${h[key]} fehlt (Quelle der Harness-Bindung)`);
    }
    q[liste.binder] = { herkunft: h[key], eintraege: harnessKatalog(rootDir, { [key]: h[key] })[liste.feld].map((x) => ({ titel: x.name })) };
  };
  if (binders.includes("agent")) katalog("agents", "Agent-Ordner", { binder: "agent", feld: "agents" });
  if (binders.includes("skill")) katalog("skills", "Skill-Ordner", { binder: "skill", feld: "skills" });
  if (binders.includes("workflow")) katalog("workflows", "Workflow-Ordner", { binder: "workflow", feld: "workflows" }, true);
  if (binders.includes("hook") && h.settings) {
    const hooks = lesJson(rootDir, h.settings, "Hook-Einstellungen").hooks ?? {};
    q.hook = { herkunft: `${h.settings} (hooks)`, eintraege: Object.keys(hooks).map((titel) => ({ titel })) };
  }
  if (binders.includes("githook") && h.gitHooks) {
    q.githook = { herkunft: h.gitHooks, eintraege: dateien(rootDir, h.gitHooks, "Git-Hook-Ordner", (n) => !n.startsWith(".")).map((titel) => ({ titel })) };
  }
  if (binders.includes("mcp") && h.mcp) {
    const json = lesJson(rootDir, h.mcp, "MCP-Konfiguration");
    q.mcp = { herkunft: h.mcp, eintraege: Object.keys(json.mcpServers ?? {}).map((titel) => ({ titel })) };
  }
  if (binders.includes("ciworkflow") && config.kennzahlen?.workflows) {
    const ordner = config.kennzahlen.workflows;
    q.ciworkflow = { herkunft: ordner, eintraege: dateien(rootDir, ordner, "CI-Ordner", (n) => /\.ya?ml$/.test(n)).map((titel) => ({ titel })) };
  }
  if (binders.includes("gate") && config.gates?.package && Array.isArray(config.gates.chains)) {
    const g = config.gates;
    const scripts = lesJson(rootDir, g.package, "package.json").scripts ?? {};
    const gesehen = new Set();
    const eintraege = [];
    for (const kette of g.chains) {
      if (typeof scripts[kette] !== "string") throw new Error(`Gate-Kette ${kette} fehlt in ${g.package} (scripts, Quelle der Harness-Bindung)`);
      for (const titel of kettenSchritte(scripts, g.chains, kette)) {
        if (gesehen.has(titel)) continue;
        gesehen.add(titel);
        eintraege.push({ titel, kette });
      }
    }
    q.gate = { herkunft: `${g.package} (${g.chains.join(", ")})`, eintraege };
  }
  return q;
};

/**
 * Der Abgleich der Harness-Arten. Reine Funktion: Modell (`c4`), Config-Block `architektur` (`cfg`), Quellen von `harnessQuellen`
 * (`harness`, `null` = nicht geladen) und `binderVon` rein, Meldungen raus. Ohne gebundene Harness-Art wird nichts geprüft.
 */
export function pruefeHarness({ c4, cfg, harness, binderVon }) {
  const bindungen = cfg.bindungen ?? {};
  const aktiv = HARNESS_BINDER.filter((b) => Object.values(bindungen).includes(b));
  const ms = [];
  const byId = new Map(c4.elemente.map((e) => [e.id, e]));
  for (const binder of aktiv) {
    const art = Object.keys(bindungen).find((a) => bindungen[a] === binder);
    const ort = ortFuer(c4, binderVon, [binder], cfg.workspace);
    const q = harness?.[binder];
    if (!q || !Array.isArray(q.eintraege)) {
      ms.push(meld(ort, 1, art, binder, `keine Quelle für die Bindung (Config-Schlüssel fehlt oder die Quelle wurde nicht geladen)`, `den Pfad für ${binder} im Config-Block harness, gates bzw. kennzahlen.workflows eintragen`));
      continue;
    }
    const els = c4.elemente.filter((e) => binderVon(e.kind) === binder);
    const titel = new Set(q.eintraege.map((x) => x.titel));
    for (const e of els) {
      if (!titel.has(e.title)) ms.push(meld(e.datei, e.zeile, e.kind, e.title, `keine Quelle in ${q.herkunft} (bekannt: ${[...titel].join(", ") || "keine"})`, `Titel auf einen Eintrag aus ${q.herkunft} ändern oder das Element entfernen`));
    }
    for (const x of q.eintraege) {
      const vorhanden = els.filter((e) => e.title === x.titel);
      const unter = x.kette ? ` unter dem Element '${x.kette}'` : "";
      if (vorhanden.length === 0) {
        ms.push(meld(ort, 1, art, x.titel, `fehlt im Modell, steht aber in ${q.herkunft}`, `Element ${art} '${x.titel}'${unter} in ${ort} anlegen`));
        continue;
      }
      if (!x.kette) continue;
      for (const e of vorhanden) {
        const eltern = byId.get(e.parentId);
        if (eltern?.title !== x.kette) {
          ms.push(meld(e.datei, e.zeile, e.kind, e.title, `liegt unter ${eltern ? `„${eltern.title}“` : "keinem Element"}, gehört laut ${q.herkunft} aber unter „${x.kette}“`, `Element unter das Element '${x.kette}' verschieben`));
        }
      }
    }
  }
  return ms;
}
