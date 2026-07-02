/* ===== Terraform-Konfig-Inhalte (Content-as-Data, #147) =====
 * Die Expeditions-Flotte (Phase 9) braucht plausible Beispiel-Konfigurationen als
 * Spielinhalt für die in der Sim-Grundlage (#146) angelegten Befehle: ein wieder-
 * verwendbares Modul (Variablen/Ressourcen/Outputs), Remote State (`backend`-Block),
 * mehrere `provider`-Blöcke (Multi-Cloud) und sauber durchgereichte Variablen/Outputs.
 *
 * Eine Terraform-Konfig ist ein **benanntes Beispiel-Szenario**: die simulierten
 * `.tf`-Dateien (was der Spieler per `cat` liest) PLUS der passende Sim-Zustand
 * (`tfModules`/`tfProviders`/`tfBackend`/`tfOutputs`/`tfResources`), beides zusammen
 * als ein `Scenario`. Die Quests des Arcs (#150–#153) verweisen per `scenarioRef`
 * auf diese Konfigs, statt die langen `.tf`-Texte zu duplizieren – DRY über den
 * ganzen Arc (Stardew-Scope: vier Quests teilen sich eine Quelle der Wahrheit).
 *
 * Wie die Quests **pro Region aufgeteilt** (`../data/terraform/<region>.json`), kein
 * Monolith. Hier nur STRUKTURELLE Prüfung (id/label/Szenario-Objekt + nicht-leeres
 * `files`); die Sim-Semantik (läuft init→plan→apply? passt der Text zum Modell?) ist
 * keine Loader-Aufgabe, sondern wird in `test/tf-configs.test.ts` abgesichert. */
import { fail, asRecord, asArray, asNonEmptyString, assertNoUnknownKeys } from "../parse";
import { reviveScenario } from "../scenario";
import { assembleUnique, makeGlobLoader } from "./shared";
import type { Scenario } from "../../sim";

// Terraform-Konfig-Inhalte (#147) liegen pro Region in data/terraform/<region>.json.
const tfConfigModules = import.meta.glob<{ default: unknown }>("../data/terraform/*.json", { eager: true });

/** Eine benannte Terraform-Konfig: ein Beispiel-Szenario, auf das Quests per
 *  `scenarioRef` verweisen. `scenario` trägt die simulierten `.tf`-Dateien (`files`)
 *  und den dazugehörigen Sim-Zustand. */
export interface TfConfig {
  id: string;
  /** Kurzes, sprechendes Anzeige-Label (Doku/Tooling). */
  label: string;
  scenario: Scenario;
}

/** Validiert EINE rohe Terraform-Konfig und gibt sie typisiert zurück. Sichert
 *  strukturell ab, dass ein nicht-leeres `files` mit rein textuellen Inhalten da ist
 *  (diese Konfigs existieren, damit der Spieler sie per `cat` lesen kann). */
function parseOneTfConfig(v: unknown, where: string): TfConfig {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, ["id", "label", "scenario"]);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `tf-config ${id}`;
  const label = asNonEmptyString(o.label, `${path}.label`);
  // Scenario strukturell gegen die Feld-Allowlist prüfen (#494) statt ungeprüft casten.
  const scenario = reviveScenario(o.scenario, `${path}.scenario`);
  // tf-config-spezifisch: der Spieler MUSS etwas per `cat` lesen können → nicht-leeres
  // `files` mit nicht-leeren Inhalten (strenger als das generische reviveScenario).
  const files = asRecord(scenario.files, `${path}.scenario.files`);
  const fileNames = Object.keys(files);
  if (fileNames.length === 0) fail(`${path}.scenario.files`, "mindestens eine .tf-Datei erwartet");
  for (const fn of fileNames) asNonEmptyString(files[fn], `${path}.scenario.files["${fn}"]`);
  return { id, label, scenario };
}

/** Validiert eine rohe Konfig-Liste (eine Regionen-Datei). Wirft beim ersten Verstoß. */
export function parseTfConfigs(raw: unknown, where = "tf-configs"): TfConfig[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens eine Terraform-Konfig erwartet");
  return arr.map((c, i) => parseOneTfConfig(c, `${where}[${i}]`));
}

/** Führt die Regionen-Listen zusammen und prüft auf doppelte IDs über die Dateien
 *  hinweg – eine Dublette ließe zwei `scenarioRef`-Ziele kollidieren. */
export function assembleTfConfigs(regions: TfConfig[][]): TfConfig[] {
  return assembleUnique(regions, "tf-configs", "Konfig-ID", "Regionen-Dateien");
}

/** Validierte Terraform-Konfigs in Laufzeit-Form – Quelle: `../data/terraform/<region>.json`.
 *  Lazy (#435) wie die übrigen Sammlungen: erst beim ersten Zugriff geparst, dann gecacht. */
export const getTfConfigs = makeGlobLoader(tfConfigModules, parseTfConfigs, assembleTfConfigs);

/** Löst einen `scenarioRef` (Konfig-ID) zum hinterlegten Beispiel-Szenario auf.
 *  Wirft `ContentValidationError`, wenn die ID auf keine Konfig zeigt (Tippfehler
 *  fällt beim Laden hart auf, nicht erst still im Spiel). */
export function resolveScenarioRef(ref: string, path: string): Scenario {
  const cfg = getTfConfigs().find(c => c.id === ref);
  if (!cfg) fail(path, `unbekannte Konfig-Referenz „${ref}" (nicht in data/terraform/*.json)`);
  return cfg.scenario;
}
