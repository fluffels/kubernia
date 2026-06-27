/* CronJob & Job (#274) – Wissens-Karten für „geplante/einmalige Aufgaben".
 *
 * kubequest kannte bisher nur dauerlaufende Workloads (Deployment). Dieses Ticket
 * ergänzt die Lerninhalte um die beiden Workload-Typen mit ENDE:
 *   - Job:     läuft einmal bis zum Erfolg und endet (Migration, einmaliger Import).
 *   - CronJob: ein Job nach Zeitplan (cron-Syntax), z.B. nächtliches Backup.
 * plus den Praxis-Befehl, einen CronJob sofort manuell als Job auszulösen.
 *
 * Die Karten hängen am Backup-Quest-Kapitel (storage-backup-restore), weil dort der
 * kanonische CronJob-Anwendungsfall „nächtliches Backup" sitzt (#274 „knüpft an
 * Backups #244 an"). Reine Daten-Karten (Krabben-Quiz), konsistent mit dem
 * quiz-getriebenen Storage-Arc – kein Sim-Eingriff nötig.
 *
 * Red-Green: jede Erwartung fällt bei verfälschter Karte wirklich auf (correct-Index,
 * Schlüsselbegriffe in der richtigen Antwort, chapter-Verankerung).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";

/** Die fünf neuen Wissens-Karten dieses Tickets. */
const NEW_CARDS = [
  "q-job-vs-deployment",
  "q-cronjob-schedule",
  "q-job-cronjob-deployment",
  "q-cronjob-trigger",
  "q-cron-syntax",
];

const byId = (id: string) => KQContent.CRAB_QUIZ.find((c) => c.id === id);

test("#274 alle fünf Job/CronJob-Karten existieren und sind wohlgeformt", () => {
  for (const id of NEW_CARDS) {
    const card = byId(id);
    assert.ok(card, "Karte fehlt: " + id);
    assert.ok(card!.options.length >= 2, id + ": zu wenige Optionen");
    assert.ok(card!.correct >= 0 && card!.correct < card!.options.length, id + ": correct-Index außerhalb");
    assert.ok(card!.options[card!.correct].trim().length > 0, id + ": richtige Option leer");
    assert.ok(card!.explain.trim().length > 0, id + ": Erklärung fehlt");
  }
});

test("#274 Karten sind über das Backup-Kapitel im SR-Pool erreichbar", () => {
  for (const id of NEW_CARDS) {
    assert.equal(byId(id)!.chapter, "storage-backup-restore", id + ": falsches/fehlendes chapter");
  }
  // Das chapter muss auf eine echte Quest zeigen (sonst toter Content).
  assert.ok(
    KQContent.QUESTS.some((q) => q.id === "storage-backup-restore"),
    "Quest storage-backup-restore existiert nicht (mehr)",
  );
});

test("#274 Job-vs-Deployment: die richtige Antwort grenzt 'Ende' gegen 'Dauerdienst' ab", () => {
  const card = byId("q-job-vs-deployment")!;
  const right = card.options[card.correct].toLowerCase();
  assert.ok(/job/.test(right) && /(endet|ende|fertig|einmal)/.test(right), "Job-Ende fehlt in der richtigen Antwort");
  assert.ok(/(deployment|dienst|dauer|laufen)/.test(right), "Deployment-Dauerdienst-Abgrenzung fehlt");
});

test("#274 CronJob-Schedule: die richtige Antwort nennt Zeitplan/cron", () => {
  const card = byId("q-cronjob-schedule")!;
  const right = card.options[card.correct].toLowerCase();
  assert.ok(/cron|zeitplan|plan/.test(right), "Zeitplan/cron fehlt in der richtigen Antwort");
});

test("#274 Manueller Trigger: der Befehl 'create job --from=cronjob' wird gelehrt", () => {
  const card = byId("q-cronjob-trigger")!;
  const haystack = (card.options[card.correct] + " " + card.explain).toLowerCase();
  assert.ok(/create\s+job/.test(haystack), "kubectl create job fehlt");
  assert.ok(/--from\s*=\s*cronjob|from=cronjob/.test(haystack), "--from=cronjob fehlt");
});

test("#274 cron-Syntax: eine konkrete cron-Zeile (z.B. nächtlich) wird erklärt", () => {
  const card = byId("q-cron-syntax")!;
  const haystack = card.q + " " + card.options.join(" ") + " " + card.explain;
  // Eine 5-Felder-cron-Zeile irgendwo in der Karte (z.B. "0 3 * * *").
  assert.ok(/(\S+\s+){4}\S+/.test(haystack) && /\*/.test(haystack), "keine cron-Zeile (5 Felder mit *) in der Karte");
});
