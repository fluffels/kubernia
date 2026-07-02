/* ===== Inhalte: Manifest-Bibliothek (#514, Content-as-Data) =====
 * Benannte „virtuelle Dateien" (fertige YAML-/Dockerfile-/CI-/Terraform-Schnipsel), die
 * Quests und Drills dem Spieler im simulierten Dateisystem hinlegen (zum Lesen, Anwenden,
 * Reparieren). Früher lagen sie als TS-Konstanten-Monolith in `manifests.ts` – von KEINER
 * Quest genutzt, während die Quests DIESELBEN YAMLs erneut inline in ihre JSON kopierten
 * (zwei Wahrheiten, die bei mehr Content garantiert driften). Seit #514 sind sie EINE
 * Quelle als Daten: Quests verweisen per `manifestRef` (scenario.manifests), Drills holen
 * denselben Text über `getManifest(id)`.
 *
 * Wie die übrigen Sammlungen **pro Thema aufgeteilt** (`./data/manifests/<thema>.json`),
 * kein Monolith bei Stardew-Scope. Hier nur STRUKTURELLE Prüfung (id/yaml da, IDs eindeutig);
 * die Sim-Semantik (versteht `kubectl apply -f` das YAML? passt es zum Modell?) prüfen die
 * Quest-/Drill-Tests.
 *
 * Liegt bewusst als eigenes Leaf-Modul (importiert nur `parse.ts`), damit sowohl der Loader
 * (`resolveScenarioManifests`/`manifestRef`) als auch die Drills (`drills/shared.ts`) es
 * zyklusfrei nutzen können – der Architektur-Wächter (#390, `keine-zyklen`) verbietet sonst
 * einen Import-Zyklus loader ↔ drills.
 */
import { fail, asRecord, asNonEmptyString, asArray, assertNoUnknownKeys, memo } from "./parse";

// Vite eager-Mode: Build-Zeit-Glob (der Single-File-Build inlinet die JSON-Module).
const manifestModules = import.meta.glob<{ default: unknown }>("./data/manifests/*.json", { eager: true });

/** Ein benanntes Manifest: der fertige Datei-Inhalt plus eine optionale, didaktische
 *  Ein-Zeilen-Einordnung (aus den früheren manifests.ts-Kommentaren übernommen). */
export interface Manifest {
  id: string;
  /** Optionale In-Repo-Erklärung „was ist das / worauf achten" (nur für Mitlesende). */
  note?: string;
  /** Der Datei-Inhalt (YAML/Dockerfile/…), den Quests/Drills als virtuelle Datei hinlegen. */
  yaml: string;
}

const MANIFEST_KEYS = ["id", "note", "yaml"] as const;

/** Validiert EIN rohes Manifest und gibt es typisiert zurück (nicht-leere id + yaml). */
function parseOneManifest(v: unknown, where: string): Manifest {
  const o = asRecord(v, where);
  assertNoUnknownKeys(o, where, MANIFEST_KEYS);
  const id = asNonEmptyString(o.id, `${where}.id`);
  const path = `manifest ${id}`;
  const m: Manifest = { id, yaml: asNonEmptyString(o.yaml, `${path}.yaml`) };
  if (o.note !== undefined) m.note = asNonEmptyString(o.note, `${path}.note`);
  return m;
}

/** Validiert eine rohe Manifest-Liste (eine Themen-Datei). Wirft beim ersten Verstoß. */
export function parseManifests(raw: unknown, where = "manifests"): Manifest[] {
  const arr = asArray(raw, where);
  if (arr.length === 0) fail(where, "mindestens ein Manifest erwartet");
  return arr.map((c, i) => parseOneManifest(c, `${where}[${i}]`));
}

/** Führt die Themen-Listen zusammen und prüft auf doppelte IDs über die Dateien hinweg –
 *  eine Dublette ließe zwei `manifestRef`-Ziele kollidieren. */
export function assembleManifests(themes: Manifest[][]): Manifest[] {
  const seen = new Set<string>();
  const out: Manifest[] = [];
  for (const theme of themes) {
    for (const m of theme) {
      if (seen.has(m.id)) fail("manifests", `doppelte Manifest-ID „${m.id}" (über Themen-Dateien hinweg)`);
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Validierte Manifest-Bibliothek in Laufzeit-Form – Quelle: `./data/manifests/<thema>.json`.
 *  Lazy (#435) wie die übrigen Sammlungen: erst beim ersten Zugriff geparst, dann gecacht. */
export const getManifests = memo<Manifest[]>(() =>
  assembleManifests(
    Object.entries(manifestModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, mod]) => parseManifests(mod.default, path)),
  ),
);

/** id → yaml-Text, einmal aufgebaut (memoisiert), für O(1)-Auflösung. */
const manifestById = memo<Map<string, string>>(() => new Map(getManifests().map(m => [m.id, m.yaml])));

/** Löst eine Manifest-ID zum hinterlegten Datei-Inhalt auf. Wirft `ContentValidationError`,
 *  wenn die ID auf kein Manifest zeigt (Tippfehler fällt beim Laden hart auf, nicht erst
 *  still im Spiel) – genau wie `resolveScenarioRef` bei den Terraform-Konfigs (#147). */
export function getManifest(id: string, path = `manifestRef „${id}"`): string {
  const yaml = manifestById().get(id);
  if (yaml === undefined) fail(path, `unbekannte Manifest-Referenz „${id}" (nicht in data/manifests/*.json)`);
  return yaml;
}

/** Löst die `manifests`-Kurzform eines Inline-Szenarios auf (manifestRef, #514):
 *  `manifests: Record<dateiname, manifestId>` → die benannten Datei-Inhalte werden in
 *  `scenario.files` eingesetzt. DRY: EINE Quelle statt in jede Quest kopiertes YAML. Gibt
 *  ein NEUES Roh-Objekt OHNE `manifests`-Schlüssel zurück – der nachgelagerte
 *  `reviveScenario` (Loader) sieht danach nur fertige `files`, genau wie bei inline
 *  geschriebenen Dateien. Ein Dateiname, der zugleich explizit in `files` steht, scheitert
 *  hart (mehrdeutig); ein Tippfehler in der ID fällt über `getManifest` beim Laden auf. */
export function resolveScenarioManifests(rawScenario: unknown, path: string): unknown {
  const o = asRecord(rawScenario, path);
  if (o.manifests === undefined) return o;
  const refs = asRecord(o.manifests, `${path}.manifests`);
  const explicitFiles = o.files === undefined ? {} : asRecord(o.files, `${path}.files`);
  const files: Record<string, unknown> = { ...explicitFiles };
  for (const fname of Object.keys(refs)) {
    if (fname in explicitFiles) {
      fail(`${path}.manifests["${fname}"]`, `Dateiname „${fname}" steht zugleich in files – manifests + files mehrdeutig`);
    }
    const id = asNonEmptyString(refs[fname], `${path}.manifests["${fname}"]`);
    files[fname] = getManifest(id, `${path}.manifests["${fname}"]`);
  }
  const { manifests: _manifests, ...rest } = o;
  return { ...rest, files };
}
