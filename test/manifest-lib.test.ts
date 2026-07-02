/* Tests: Manifest-Bibliothek + manifestRef (Content-as-Data, #514).
 * Benannte „virtuelle Dateien" (YAML/Dockerfile/CI/Terraform) liegen als Daten
 * (data/manifests/*.json); Quests verweisen per `scenario.manifests` darauf, Drills holen
 * denselben Text über `getManifest(id)`. Geprüft:
 *  1. Die Bibliothek lädt, IDs sind eindeutig, jedes yaml nicht-leer.
 *  2. `getManifest` löst bekannte IDs auf und scheitert hart bei unbekannten.
 *  3. Parser/Assembler weisen kaputte Eingaben ab (Red-Green).
 *  4. `manifestRef` (scenario.manifests) expandiert beim Laden korrekt in scenario.files –
 *     inkl. Fehlerfälle (unbekannte ID, Datei zugleich in files + manifests). */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  getManifest, getManifests, parseManifests, assembleManifests,
} from "../src/content/manifest-lib";
import { parseQuests, ContentValidationError } from "../src/content/loader";

const MANIFESTS = getManifests();

test("manifest-lib: Bibliothek geladen, IDs eindeutig, jedes yaml nicht-leer", () => {
  assert.ok(MANIFESTS.length > 0, "keine Manifeste geladen");
  const ids = MANIFESTS.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte Manifest-IDs");
  for (const m of MANIFESTS) {
    assert.ok(m.yaml.trim().length > 0, `${m.id}: yaml ist leer`);
  }
  // Ein paar erwartete IDs quer über die Themen-Dateien.
  for (const want of [
    "deployment-lager", "ingress-hafentor-tls", "networkpolicy-hafenmauer",
    "statefulset-speicher", "argo-app-of-apps", "servicemonitor-lager",
    "role-pod-leser", "dockerfile-nginx", "gitlab-ci-pipeline", "terraform-ost-plateau",
  ]) {
    assert.ok(ids.includes(want), `Manifest „${want}" fehlt`);
  }
});

test("getManifest: bekannte ID liefert den yaml-Text, unbekannte scheitert hart", () => {
  assert.equal(getManifest("dockerfile-nginx"), "FROM nginx:1.27\nCOPY site/ /usr/share/nginx/html\nEXPOSE 80");
  assert.throws(
    () => getManifest("gibt-es-nicht"),
    (e: unknown) => e instanceof ContentValidationError && /unbekannte Manifest-Referenz/.test((e as Error).message),
  );
});

test("parseManifests: Red-Green – fehlendes yaml, unbekannter Schlüssel, leere Liste scheitern", () => {
  assert.throws(() => parseManifests([{ id: "x" }], "t"),
    (e: unknown) => e instanceof ContentValidationError, "fehlendes yaml nicht abgewiesen");
  assert.throws(() => parseManifests([{ id: "x", yaml: "y", foo: 1 }], "t"),
    (e: unknown) => e instanceof ContentValidationError && /unbekannter Schlüssel/.test((e as Error).message),
    "unbekannter Schlüssel nicht abgewiesen");
  assert.throws(() => parseManifests([], "t"),
    (e: unknown) => e instanceof ContentValidationError, "leere Liste nicht abgewiesen");
  // Positiv: valides Manifest (mit optionalem note) geht durch.
  const ok = parseManifests([{ id: "a", note: "hin", yaml: "Z" }], "t");
  assert.equal(ok[0].id, "a");
  assert.equal(ok[0].note, "hin");
});

test("assembleManifests: doppelte ID über Themen-Dateien hinweg scheitert (Red-Green)", () => {
  assert.throws(
    () => assembleManifests([[{ id: "dup", yaml: "a" }], [{ id: "dup", yaml: "b" }]]),
    (e: unknown) => e instanceof ContentValidationError && /doppelte Manifest-ID/.test((e as Error).message),
  );
});

/* ===== manifestRef – die Brücke „Quest verweist auf Manifest" (#514) ===== */

/** Minimale valide Roh-Quest mit einem terminal-Schritt; `scenario` wird hineingemischt. */
function questWithScenario(scenario: Record<string, unknown>) {
  return [{
    id: "ref-test", title: "Referenztest", giver: "ada", topic: "yaml",
    rewardXp: 1, rewardCoins: 1,
    steps: [{
      type: "terminal", brief: "B", scenario,
      tasks: [{ id: "t1", text: "Tu was", accept: ["^x$"], solution: "x", hint: "h" }],
    }],
  }];
}

test("manifestRef: scenario.manifests expandiert beim Laden in scenario.files", () => {
  const quests = parseQuests(questWithScenario({ manifests: { "deployment.yaml": "deployment-lager" } }), "ref-test");
  const scenario = quests[0].steps[0].scenario!;
  assert.equal(scenario.files!["deployment.yaml"], getManifest("deployment-lager"));
  // Die Loader-Kurzform ist danach weg – die Laufzeit sieht nur fertige files.
  assert.equal((scenario as Record<string, unknown>).manifests, undefined);
});

test("manifestRef: manifests + explizite files (verschiedene Namen) werden zusammengeführt", () => {
  const quests = parseQuests(questWithScenario({
    files: { "eigen.yaml": "roher inhalt" },
    manifests: { "deployment.yaml": "deployment-lager" },
  }), "ref-test");
  const files = quests[0].steps[0].scenario!.files!;
  assert.equal(files["eigen.yaml"], "roher inhalt");
  assert.equal(files["deployment.yaml"], getManifest("deployment-lager"));
});

test("manifestRef: unbekannte Manifest-ID scheitert hart beim Laden", () => {
  assert.throws(
    () => parseQuests(questWithScenario({ manifests: { "x.yaml": "gibt-es-nicht" } }), "ref-test"),
    (e: unknown) => e instanceof ContentValidationError && /unbekannte Manifest-Referenz/.test((e as Error).message),
  );
});

test("manifestRef: derselbe Dateiname in files UND manifests ist mehrdeutig und scheitert", () => {
  assert.throws(
    () => parseQuests(questWithScenario({
      files: { "deployment.yaml": "roh" },
      manifests: { "deployment.yaml": "deployment-lager" },
    }), "ref-test"),
    (e: unknown) => e instanceof ContentValidationError && /mehrdeutig/.test((e as Error).message),
  );
});
