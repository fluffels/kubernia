/* Tests für die Freies-Funken-Erklärungen (#362):
 *  - die pure Auswahl-Mechanik (funkexplain.ts), inkl. Dosierung + Red-Green
 *  - die geladenen Katalog-Daten (content/data/funk-explain/*), Konsistenz + Treffer
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { pickFunkExplanation, type FunkExplanation } from "../src/funkexplain";
import { KQContent } from "../src/content";

/* ---------- pure Auswahl-Mechanik ---------- */

const SAMPLE: FunkExplanation[] = [
  { id: "a", match: [/^docker\s+pull\b/], text: "Pull-Text" },
  { id: "b", match: [/^kubectl\s+get\s+pods?\b/], text: "Pods-Text" },
];

test("#362 pickFunkExplanation: passender Befehl liefert die Erklärung", () => {
  const hit = pickFunkExplanation("docker pull nginx", SAMPLE, new Set());
  assert.equal(hit?.id, "a");
});

test("#362 pickFunkExplanation: Whitespace wird normalisiert", () => {
  const hit = pickFunkExplanation("  docker   pull   nginx  ", SAMPLE, new Set());
  assert.equal(hit?.id, "a");
});

test("#362 pickFunkExplanation: ohne Treffer kommt null (nicht nach jeder Ausgabe)", () => {
  assert.equal(pickFunkExplanation("ls", SAMPLE, new Set()), null);
  assert.equal(pickFunkExplanation("", SAMPLE, new Set()), null);
});

test("#362 pickFunkExplanation: schon gezeigte Erklärung wird übersprungen (nie zweimal)", () => {
  const shown = new Set<string>(["a"]);
  assert.equal(pickFunkExplanation("docker pull nginx", SAMPLE, shown), null);
  // andere Erklärung bleibt verfügbar
  assert.equal(pickFunkExplanation("kubectl get pods", SAMPLE, shown)?.id, "b");
});

test("#362 pickFunkExplanation: Reihenfolge im Katalog ist die Priorität (Red-Green)", () => {
  const overlap: FunkExplanation[] = [
    { id: "spezifisch", match: [/^kubectl\s+get\s+pods\b/], text: "spezifisch" },
    { id: "allgemein", match: [/^kubectl\s+get\b/], text: "allgemein" },
  ];
  assert.equal(pickFunkExplanation("kubectl get pods", overlap, new Set())?.id, "spezifisch");
  // Gegenprobe: nur die allgemeine trifft den reinen get
  assert.equal(pickFunkExplanation("kubectl get nodes", overlap, new Set())?.id, "allgemein");
});

/* ---------- geladener Katalog (Content-as-Data) ---------- */

test("#362 Katalog lädt und ist nicht leer", () => {
  assert.ok(KQContent.FUNK_EXPLAINS.length > 0, "es sollte Erklärungen geben");
});

test("#362 jede Erklärung hat ID, mind. ein Muster und nicht-leeren Text", () => {
  for (const e of KQContent.FUNK_EXPLAINS) {
    assert.ok(e.id && e.id.trim(), "ID fehlt");
    assert.ok(e.match.length > 0, `Muster fehlt: ${e.id}`);
    assert.ok(e.text && e.text.trim(), `Text fehlt: ${e.id}`);
  }
});

test("#362 keine doppelten IDs im Katalog", () => {
  const ids = KQContent.FUNK_EXPLAINS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte Erklärungs-ID");
});

test("#362 zentrale Befehle treffen ihre Erklärung im echten Katalog", () => {
  const cat = KQContent.FUNK_EXPLAINS;
  const cases: [string, string][] = [
    ["docker pull nginx", "fx-docker-pull"],
    ["docker run -d --name web nginx", "fx-docker-run"],
    ["kubectl get pods", "fx-kubectl-get-pods"],
    ["kubectl get nodes", "fx-kubectl-get-nodes"],
    ["kubectl apply -f app.yaml", "fx-kubectl-apply"],
    ["helm install hafen ./chart", "fx-helm-install"],
    ["git push origin main", "fx-git-push"],
    ["terraform apply", "fx-terraform-apply"],
  ];
  for (const [line, expected] of cases) {
    assert.equal(pickFunkExplanation(line, cat, new Set())?.id, expected, `${line} → ${expected}`);
  }
});

test("#362 ein nicht abgedeckter Befehl bekommt keine Erklärung", () => {
  // `ls`/`cat`/`help` sind reine Terminal-Navigation, kein Lernmoment-Befehl.
  assert.equal(pickFunkExplanation("ls", KQContent.FUNK_EXPLAINS, new Set()), null);
  assert.equal(pickFunkExplanation("help", KQContent.FUNK_EXPLAINS, new Set()), null);
});
