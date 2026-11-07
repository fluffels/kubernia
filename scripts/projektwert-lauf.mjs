// Lauf über die Projektwert-Prüf-Fläche (ADR 0022 F3f, factory#162 L32): Dateien unter einer Wurzel sammeln, Stellen gegen die Config prüfen oder schreiben.
// Ausgelagert aus `besitz-lib.mjs`. Importe: Node-Builtins, `skill-pfade.mjs`, `besitz-lib.mjs` (Manifest, Zeilenenden, Pfadregel) und `projektwert-lib.mjs` (Stellen, Abgleich, Rendern).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";
import { eolVon, MANIFEST_PFAD, manifestAusText, normalisiereEol, pfadSicher } from "./besitz-lib.mjs";
import { PROJEKTWERT_KENNUNG, projektwertAbweichungen, rendereProjektwerte, projektwertStellen } from "./projektwert-lib.mjs";

const PROJEKTWERT_FLAECHEN = [/^\.claude\/agents\/[^/]+\.md$/, /^\.claude\/skills\/[^/]+\/[^/]+\.md$/, /^\.agents\/skills\/[^/]+\/[^/]+\.md$/];

/** Geschlossene Prüf-Fläche: `.md`-Pfade des Manifests plus Agenten- und Skill-Markdown aus `liste` (alle Projektpfade, Schrägstrich-Form). Sortiert, ohne Doppelte. */
export function projektwertDateien(manifestPfade, liste) {
  const aus = liste.filter((p) => PROJEKTWERT_FLAECHEN.some((r) => r.test(p)));
  return [...new Set([...manifestPfade.filter((p) => pfadSicher(p) && /\.(md|ya?ml)$/.test(p)), ...aus])].sort();
}

/** Alle Agenten-, Skill-Zeiger- und Skill-Quell-Dateien (`.claude/agents`, `.claude/skills`, `.agents/skills`) unter `wurzel` (Schrägstrich-Form, unsortiert). */
export function projektDateien(wurzel) {
  const unter = (rel) => {
    const voll = join(wurzel, ...rel.split("/"));
    return existsSync(voll) ? readdirSync(voll, { withFileTypes: true }) : [];
  };
  const dateien = (rel) => unter(rel).filter((d) => d.isFile()).map((d) => `${rel}/${d.name}`);
  const unterordner = (rel) => unter(rel).filter((d) => d.isDirectory()).map((d) => `${rel}/${d.name}`);
  return [...dateien(".claude/agents"), ...[ZEIGER_WURZEL, QUELL_VERZEICHNIS].flatMap((w) => unterordner(w).flatMap(dateien))];
}

const KEINE_CONFIG = "Projekt-Config nicht lesbar";

/** Lader der Config, der sie höchstens einmal ruft: ein Fehler landet als `Projekt-Config: …` in `fehler`, danach wirft jeder Aufruf `KEINE_CONFIG`. */
function configLader(ladeConfig, fehler) {
  let config;
  return () => {
    if (config === undefined) {
      try {
        config = ladeConfig();
      } catch (err) {
        config = null;
        fehler.push(`Projekt-Config: ${err.message}`);
      }
    }
    if (config === null) throw new Error(KEINE_CONFIG);
    return config;
  };
}

/** Prüft eine Datei mit Stellen gegen die Config und trägt Zähler, Funde und (bei Abweichung) den Neutext in `res`/`neu` ein; Dateien ohne Stellen zählen nicht. */
function pruefeDatei(pfad, roh, { configLaden, schreiben, res, neu }) {
  const text = normalisiereEol(roh);
  const st = projektwertStellen(text, pfad);
  if (st.bloecke.length + st.zeilen.length === 0) return;
  res.dateien++;
  const abw = projektwertAbweichungen(pfad, text, configLaden);
  res.abweichungen.push(...abw);
  if (!schreiben) res.fehler.push(...abw);
  if (abw.length > 0) neu.set(pfad, { roh, text: rendereProjektwerte(text, configLaden, pfad) });
}

/**
 * Prüft (oder schreibt mit `schreiben`) alle Projektwert-Stellen unter `wurzel`. `ladeConfig` wird nur gerufen, wenn eine Datei Stellen hat.
 * Rückgabe: `{ dateien (Zahl der Dateien mit Stellen), fehler, geaendert, abweichungen }`; `abweichungen` sind nur die Funde "Wert weicht von der Config ab" (im Prüfmodus auch in `fehler`), die Aufrufer schlagen daran den `--write`-Fix vor. Geschrieben wird nur, wenn kein Fehler vorliegt.
 */
export function projektwertLauf(wurzel, ladeConfig, { schreiben = false } = {}) {
  const res = { dateien: 0, fehler: [], geaendert: [], abweichungen: [] };
  const lies = (rel) => {
    const voll = join(wurzel, ...rel.split("/"));
    return existsSync(voll) ? readFileSync(voll, "utf8") : null;
  };
  // ein fehlendes oder kaputtes Manifest meldet das Drift-Gate selbst
  const manifestPfade = manifestAusText(lies(MANIFEST_PFAD)).manifest?.eintraege.map((e) => e?.pfad) ?? [];
  const kontext = { configLaden: configLader(ladeConfig, res.fehler), schreiben, res, neu: new Map() };
  for (const pfad of projektwertDateien(manifestPfade, projektDateien(wurzel))) {
    const roh = lies(pfad);
    if (roh === null || !roh.includes(PROJEKTWERT_KENNUNG)) continue;
    try {
      pruefeDatei(pfad, roh, kontext);
    } catch (err) {
      if (err.message !== KEINE_CONFIG) res.fehler.push(err.message);
    }
  }
  if (schreiben && res.fehler.length === 0) {
    for (const [pfad, { roh, text }] of kontext.neu) {
      writeFileSync(join(wurzel, ...pfad.split("/")), eolVon(roh) === "\n" ? text : text.replace(/\n/g, "\r\n"));
      res.geaendert.push(pfad);
    }
  }
  return res;
}
