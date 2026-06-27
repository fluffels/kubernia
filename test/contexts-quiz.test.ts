/* kubectl Context & Multi-Cluster (#272) – Wissens-Karten „dev ↔ prod sicher wechseln".
 *
 * kubequest tat bisher so, als gäbe es genau EINEN Cluster. In echt wird ständig
 * zwischen Clustern gewechselt (dev ↔ prod). Dieses Ticket ergänzt die Lerninhalte
 * um das kubeconfig-/Context-Konzept:
 *   - current-context / get-contexts: auf welchen Cluster zeige ich gerade?
 *   - use-context: zwischen Clustern umschalten (die Umstellung bleibt bestehen).
 *   - die Gefahr: derselbe Befehl trifft je nach Context einen anderen Cluster.
 *   - Mini-Szenario „du wolltest dev, warst aber auf prod" + gute Gewohnheit.
 *
 * Reine Daten-Karten (Krabben-Quiz), KEIN Sim-Eingriff: Context-Befehle würden im
 * Drill gegen den Sim laufen (radio.ts ruft Game.sim.exec), den es für `kubectl config`
 * nicht gibt – ein voll simuliertes Multi-Cluster wäre ein eigenes, viel größeres
 * Ticket. Quiz-Karten lehren das Konzept ohne Sim-Ausführung (#272 erlaubt
 * „Quiz- ODER Befehlskarte(n)"). Verankert am Kapitel k8s-node-capacity, wo der
 * Spieler kubectl sicher beherrscht und „Cluster als Ort" konkret ist – ein
 * natürlicher Schritt zu „du hast in Wahrheit mehrere Cluster".
 *
 * Red-Green: jede Erwartung fällt bei verfälschter Karte wirklich auf (correct-Index,
 * Schlüsselbefehle in der richtigen Antwort, chapter-Verankerung).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";

/** Die vier neuen Wissens-Karten dieses Tickets. */
const NEW_CARDS = [
  "q-ctx-current",
  "q-ctx-use",
  "q-ctx-danger",
  "q-ctx-devprod",
];

const CHAPTER = "k8s-node-capacity";

const byId = (id: string) => KQContent.CRAB_QUIZ.find((c) => c.id === id);

test("#272 alle vier Context-Karten existieren und sind wohlgeformt", () => {
  for (const id of NEW_CARDS) {
    const card = byId(id);
    assert.ok(card, "Karte fehlt: " + id);
    assert.ok(card!.options.length >= 2, id + ": zu wenige Optionen");
    assert.ok(card!.correct >= 0 && card!.correct < card!.options.length, id + ": correct-Index außerhalb");
    assert.ok(card!.options[card!.correct].trim().length > 0, id + ": richtige Option leer");
    assert.ok(card!.explain.trim().length > 0, id + ": Erklärung fehlt");
  }
});

test("#272 Karten sind über das k8s-node-capacity-Kapitel im SR-Pool erreichbar", () => {
  for (const id of NEW_CARDS) {
    assert.equal(byId(id)!.chapter, CHAPTER, id + ": falsches/fehlendes chapter");
  }
  // Das chapter muss auf eine echte Quest zeigen (sonst toter Content).
  assert.ok(
    KQContent.QUESTS.some((q) => q.id === CHAPTER),
    "Quest " + CHAPTER + " existiert nicht (mehr)",
  );
});

test("#272 current-context: die richtige Antwort nennt current-context UND get-contexts", () => {
  const card = byId("q-ctx-current")!;
  const right = card.options[card.correct].toLowerCase();
  assert.ok(/current-context/.test(right), "current-context fehlt in der richtigen Antwort");
  assert.ok(/get-contexts/.test(right), "get-contexts fehlt in der richtigen Antwort");
});

test("#272 use-context: die richtige Antwort lehrt den Umschalt-Befehl", () => {
  const card = byId("q-ctx-use")!;
  const right = card.options[card.correct].toLowerCase();
  assert.ok(/use-context/.test(right), "use-context fehlt in der richtigen Antwort");
});

test("#272 Gefahr: die richtige Antwort grenzt dev gegen prod ab", () => {
  const card = byId("q-ctx-danger")!;
  const right = card.options[card.correct].toLowerCase();
  assert.ok(/prod/.test(right) && /dev/.test(right), "dev/prod-Abgrenzung fehlt in der richtigen Antwort");
});

test("#272 Mini-Szenario: 'du wolltest dev, warst aber auf prod' wird gestellt + die Gewohnheit gelehrt", () => {
  const card = byId("q-ctx-devprod")!;
  const frage = (card.q + " " + card.options.join(" ")).toLowerCase();
  // Das Szenario nennt sowohl prod (wo man irrtümlich war) als auch dev (wohin man wollte).
  assert.ok(/prod/.test(frage) && /dev/.test(frage), "dev/prod-Szenario nicht erkennbar");
  const right = (card.options[card.correct] + " " + card.explain).toLowerCase();
  // Die gute Gewohnheit: current-context prüfen + auf dev zurückschalten.
  assert.ok(/current-context/.test(right), "Gewohnheit 'current-context prüfen' fehlt");
  assert.ok(/use-context/.test(right), "Rückschalten per use-context fehlt");
});
