/* ===== Kubernia – Manifest-Registry (sim/manifest/registry.ts, #1139) =====
 * Löst den Datei-Inhalt eines `kubectl apply/delete -f` zu `ApplyEffect`s auf: YAML parsen,
 * je Dokument `apiVersion|kind` im Mapper-Register nachschlagen, alles-oder-nichts. Fehlertexte
 * folgen kubectl (englischer Rahmen), die Ursache steht deutsch dahinter, der Tipp separat.
 *
 * Vorrang (#1299): Der Dateiinhalt ist die Wahrheit. Ein Parse-Fehler gewinnt immer. Haben alle
 * Dokumente ein Mapper-Kind, gilt der Mapper-Pfad (der hinterlegte `applyEffects`-Eintrag liefert
 * nur die Sim-Sonderfelder, siehe `withSimFields`). Sonst gilt der hinterlegte Effekt, falls
 * vorhanden, ansonsten `no matches for kind`. Ein neuer Ressourcentyp = ein Eintrag in `MAPPERS`
 * (+ Mapper in der Datei der API-Gruppe, #1141/#1142). */
import type { ApplyEffect } from "../state";
import { parseYamlDocuments, YamlError, type YamlValue } from "../yaml";
import { Leaf, ManifestError } from "./fields";
import { mapDeployment } from "./apps";
import { mapService } from "./core";

type Mapper = (doc: Leaf) => ApplyEffect;

/** `apiVersion|kind` → Mapper. Ein Eintrag je unterstützter Ressource. */
const MAPPERS: Readonly<Record<string, Mapper>> = {
  "apps/v1|Deployment": mapDeployment,
  "v1|Service": mapService,
};

/** Ein Fehlschlag der Auflösung: kubectl-Text plus optionaler deutscher Tipp (für `host._err`). */
export interface ManifestFailure { error: string; hint?: string }

/** Der kubectl-Befehl, der die Datei liest (nur für den Fehlertext „no objects passed to …“). */
export type ManifestVerb = "apply" | "delete";

/** Das Ergebnis: die Effekte in Dokument-Reihenfolge oder ein Fehlschlag. */
export type ManifestResult = ApplyEffect[] | ManifestFailure;

/** Der Tipp zu unbekannten Kinds, aus dem Register abgeleitet (kein zweiter Pflegeort). */
function supportedHint(): string {
  const kinds = Object.keys(MAPPERS).map(k => k.split("|")[1] + " (" + k.split("|")[0] + ")");
  return "Per Datei versteht dieses Sim zurzeit: " + kinds.join(", ") + ".";
}

function failure(error: string, hint?: string): ManifestFailure {
  return hint === undefined ? { error } : { error, hint };
}

function isMapping(v: YamlValue): v is { [key: string]: YamlValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Nur Text zählt als gesetzt (eine Zahl oder Liste als apiVersion/kind ist wie „nicht gesetzt“). */
function textOf(v: YamlValue | undefined): string {
  return typeof v === "string" ? v : "";
}

function mapOne(doc: YamlValue, file: string, tag: string): ApplyEffect | ManifestFailure {
  const frame = 'error: error validating "' + file + '"' + tag + ": error validating data: ";
  if (!isMapping(doc)) return failure(frame + "Dokument ist kein Mapping (erwartet apiVersion, kind, metadata, spec)");
  const leaf = new Leaf(doc, "");
  const apiVersion = textOf(leaf.key("apiVersion").value);
  const kind = textOf(leaf.key("kind").value);
  const missing = [apiVersion ? "" : "apiVersion not set", kind ? "" : "kind not set"].filter(Boolean);
  if (missing.length > 0) return failure(frame + "[" + missing.join(", ") + "]", "Jedes Manifest beginnt mit 'apiVersion:' und 'kind:'.");
  const mapper = MAPPERS[apiVersion + "|" + kind];
  if (!mapper) {
    const meta = doc.metadata;
    const name = isMapping(meta) ? textOf(meta.name) : "";
    return failure('error: resource mapping not found for name: "' + name + '" namespace: "" from "' + file + '"' + tag
      + ': no matches for kind "' + kind + '" in version "' + apiVersion + '"', supportedHint());
  }
  try {
    return mapper(leaf);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    if (e.raw) return failure(e.message, e.hint);
    return failure(frame + e.message, e.hint ?? "Korrigiere das genannte Feld im Manifest.");
  }
}

function parseDocs(content: string, file: string): YamlValue[] | ManifestFailure {
  try {
    return parseYamlDocuments(content);
  } catch (e) {
    if (!(e instanceof YamlError)) throw e;
    return failure("error: error parsing " + file + ": " + e.message, "Prüfe Einrückung (nur Leerzeichen) und das Muster 'key: wert' in der genannten Zeile.");
  }
}

/** Mappt geparste Dokumente. Alles oder nichts: ein Fehler in einem Dokument liefert den Fehlschlag. */
function mapDocs(docs: YamlValue[], file: string, verb: ManifestVerb): ManifestResult {
  if (docs.length === 0) return failure("error: no objects passed to " + verb, "Die Datei enthält kein Manifest (nur Kommentare oder nichts).");
  const effects: ApplyEffect[] = [];
  for (let i = 0; i < docs.length; i++) {
    const r = mapOne(docs[i], file, docs.length > 1 ? " (Dokument " + (i + 1) + ")" : "");
    if ("error" in r) return r;
    effects.push(r);
  }
  return effects;
}

/** Parst und mappt den Inhalt einer Manifest-Datei. Alles oder nichts. */
export function effectsFromManifest(content: string, file: string, verb: ManifestVerb = "apply"): ManifestResult {
  const docs = parseDocs(content, file);
  return Array.isArray(docs) ? mapDocs(docs, file, verb) : docs;
}

/** Die `kind`s mit Mapper, aus dem Register abgeleitet (kein zweiter Pflegeort). */
export const MAPPED_KINDS: ReadonlySet<string> = new Set(Object.keys(MAPPERS).map(k => k.split("|")[1]));

/* ---- Übergang bis #1143: Sim-Sonderfelder aus dem hinterlegten Effekt ---- */

type DeploymentEffect = NonNullable<ApplyEffect["deployment"]>;

/** Überlagert die Sonderfelder des hinterlegten Deployments (geschlossene Feldliste), nur bei
 *  gleichem Namen und nur in Strukturen, die das YAML deklariert. */
function overlayDeployment(mapped: DeploymentEffect, legacy: DeploymentEffect): DeploymentEffect {
  if (mapped.name !== legacy.name) return mapped;
  const out: DeploymentEffect = { ...mapped };
  if (legacy.requireBuiltImage !== undefined) out.requireBuiltImage = legacy.requireBuiltImage;
  if (legacy.ephemeralUsedMi !== undefined) out.ephemeralUsedMi = legacy.ephemeralUsedMi;
  if (out.emptyDir && legacy.emptyDir) {
    out.emptyDir = { ...out.emptyDir, ...(legacy.emptyDir.data !== undefined && { data: legacy.emptyDir.data }), ...(legacy.emptyDir.usedMi !== undefined && { usedMi: legacy.emptyDir.usedMi }) };
  }
  if (out.initContainer && legacy.initContainer) {
    out.initContainer = { ...out.initContainer, ...(legacy.initContainer.fillsMi !== undefined && { fillsMi: legacy.initContainer.fillsMi }), ...(legacy.initContainer.doubleStage !== undefined && { doubleStage: legacy.initContainer.doubleStage }) };
  }
  return out;
}

function withSimFields(effects: ApplyEffect[], legacy: ApplyEffect): ApplyEffect[] {
  const ld = legacy.deployment;
  if (!ld) return effects;
  return effects.map(e => (e.deployment ? { ...e, deployment: overlayDeployment(e.deployment, ld) } : e));
}

/** Die Wirkung einer Datei: der Inhalt (Mapper-Pfad) hat Vorrang, der hinterlegte Effekt dient als
 *  Rückfall für Typen ohne Mapper und liefert die Sim-Sonderfelder per Ressourcen-Name. */
export function fileEffects(legacy: ApplyEffect | undefined, content: string, file: string, verb: ManifestVerb = "apply"): ManifestResult {
  const docs = parseDocs(content, file);
  if (!Array.isArray(docs)) return docs;
  const mappable = docs.length > 0 && docs.every(d => isMapping(d) && MAPPED_KINDS.has(textOf(d.kind)));
  if (!legacy || mappable || docs.length === 0) {
    const r = mapDocs(docs, file, verb);
    return legacy && Array.isArray(r) ? withSimFields(r, legacy) : r;
  }
  return [legacy];
}
