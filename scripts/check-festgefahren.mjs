// Kein Shebang — wie andere check-*.mjs: dieses Skript wird über
// `node scripts/check-festgefahren.mjs` (CI, festgefahren.yml) gestartet UND
// von test/festgefahren.test.ts importiert. Ein `#!` bricht den esbuild-Import.
/**
 * Festgefahren-Wächter (#904) — session-externer Retry-Zähler.
 *
 * Hintergrund: Das Festgefahren-Protokoll (AGENTS.md #710) schreibt vor, dass ein
 * Agent nach dreimaligem gescheitertem Fix-Versuch stoppt und einen konsolidierten
 * Entscheidungs-Kommentar postet statt endlos weiterzufixen. Bis #904 war das eine
 * Verhaltensregel (Bitte) — nichts erzwang den Stopp technisch.
 *
 * Dieses Skript schließt genau diese Lücke: Es zählt, wie viele DISTINCT Commits
 * (= Pushes, identifiziert über die head_sha) auf einem PR zu einem failed CI-Lauf
 * geführt haben. Erreicht die Zahl die Schwelle MAX_FAILED_PUSHES (1 initial +
 * 3 Fix-Versuche = 4 distinct gescheiterte Pushes), setzt es das Label
 * das Festgefahren-Label der Projekt-Config (`labels.festgefahren`) auf den PR und postet den Konsolidierungs-Kommentar.
 *
 * Bewusst NICHT in `npm run verify`: der gh-Aufruf braucht Netz + Auth und ist
 * nicht deterministisch. Läuft als CI-Job in `.github/workflows/festgefahren.yml`,
 * ausgelöst von `workflow_run` nach jedem failed CI-Lauf auf einem PR.
 *
 * Manuelle CI-Neustarts (Rerun) inflationieren den Zähler NICHT: gleicher Commit
 * → gleiche head_sha → zählt weiterhin als einer. Der Abruf (paginiert, ab Erstellung des PRs)
 * steht in ci-laeufe.mjs, geteilt mit token-baseline.mjs und lauf-ergebnis.mjs.
 */

import { istDirektaufruf } from "./hook-io.mjs";
import { ghText, zaehleRoteCommits } from "./ci-laeufe.mjs";
import { ghJson } from "./gh-cli.mjs";
import { labelAus, ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Schwelle: 1 initialer Fehlschlag + 3 gescheiterte Fix-Versuche = „dreimal" aus AGENTS.md. */
export const MAX_FAILED_PUSHES = 4;

/** Das Label, das der Wächter bei Erreichen der Schwelle setzt (`labels.festgefahren`); wirft ohne den Schlüssel, kein stiller Standardwert. */
export function stuckLabel(config) {
  return labelAus(config, "festgefahren");
}

/**
 * Reine Logik: Ist die Schwelle überschritten?
 * Exportiert für Tests (kein gh, kein Netz, deterministisch).
 *
 * @param {number} distinctFailedPushes - Anzahl distinct head_sha mit failed CI-Lauf
 * @returns {boolean}
 */
export function isStuck(distinctFailedPushes) {
  return distinctFailedPushes >= MAX_FAILED_PUSHES;
}

/**
 * Baut den Konsolidierungs-Kommentar, den der Wächter auf dem PR postet.
 * Exportiert für Tests.
 *
 * @param {number} failedCount - Anzahl distinct Fehlschläge (>= MAX_FAILED_PUSHES)
 * @param {string} runUrl - URL des auslösenden CI-Laufs
 * @param {string} label - das gesetzte Festgefahren-Label (`stuckLabel()`)
 * @returns {string}
 */
export function buildStuckComment(failedCount, runUrl, label) {
  const fixAttempts = failedCount - 1;
  return [
    `## ⚓ Festgefahren-Wächter hat angeschlagen (#904)`,
    ``,
    `Dieser PR hat **${failedCount} distinct fehlgeschlagene CI-Läufe** auf diesem Branch — das entspricht **${fixAttempts} gescheiterten Fix-Versuchen** nach dem ersten Fehlschlag.`,
    ``,
    `Das Festgefahren-Protokoll aus [AGENTS.md](../AGENTS.md) (Schwelle: ${MAX_FAILED_PUSHES - 1} Fix-Versuche) ist damit erreicht. Das Label \`${label}\` ist gesetzt.`,
    ``,
    `**Als Agent: Nicht weiterfixen auf diesem Branch. Stattdessen:**`,
    `1. Den aktuellen Fehlerbefund hier zusammenfassen (was wurde versucht, warum greift es nicht)`,
    `2. 2–3 konkrete Optionen benennen; der Hauptchat entscheidet sie nach dem Entscheidungsprotokoll, vorgelegt wird nur Irreversibles oder Außenwirkung`,
    `3. Den PR offen lassen und ASSIGNED bleiben; ein Mehr-Ticket-Lauf geht mit dem nächsten freien Ticket weiter`,
    ``,
    `Letzter fehlgeschlagener CI-Lauf: ${runUrl}`,
  ].join("\n");
}

// ── CLI (läuft nur als CI-Job in festgefahren.yml) ───────────────────────────

/** `gh <args>` ausführen, Ausgabe an Terminal durchreichen. */
function ghRun(args) {
  ghText(args, { stdio: "inherit" });
}

/** Der CI-Lauf. Liefert den Exit-Code 1, wenn `labels.festgefahren` fehlt (vor jedem gh-Aufruf); `config` ist für den Test injizierbar. */
export function main({ config } = {}) {
  // Config zuerst, vor jedem gh-Aufruf: fehlt `labels.festgefahren`, ist der Lauf rot (kein stiller Standardwert; Netzfehler bleiben graceful).
  let label;
  try {
    label = stuckLabel(config ?? ladeProjektConfig());
  } catch (err) {
    console.error(`✖ ${err.message}`);
    return 1;
  }
  const repo = process.env.REPO;
  const headBranch = process.env.HEAD_BRANCH;
  const runUrl = process.env.RUN_URL ?? "(unbekannt)";

  if (!repo || !headBranch) {
    console.error("Fehler: REPO und HEAD_BRANCH müssen als Umgebungsvariablen gesetzt sein.");
    process.exit(1);
  }

  // 1. Offenen PR für diesen Branch finden.
  const prs = ghJson([
    "pr", "list",
    "--repo", repo,
    "--head", headBranch,
    "--state", "open",
    "--limit", "1000",
    "--json", "number,labels,createdAt",
  ]);

  if (prs.length === 0) {
    console.log(`Kein offener PR für Branch '${headBranch}' — Festgefahren-Wächter übersprungen.`);
    return;
  }

  const pr = prs[0];
  const prNumber = pr.number;

  // 2. Schon festgefahren? Kein Doppel-Kommentar.
  const alreadyStuck = (pr.labels ?? []).some((l) => l.name === label);
  if (alreadyStuck) {
    console.log(`PR #${prNumber}: Label '${label}' ist bereits gesetzt — übersprungen.`);
    return;
  }

  // 3. Fehlgeschlagene CI-Läufe auf diesem Branch zählen (distinct head_sha).
  //    Manuelle Reruns haben dieselbe head_sha → zählen einmal, nicht doppelt.
  //    Nur Läufe ab Erstellung DIESES PRs: ein früherer PR auf einem wiederverwendeten Branch zählt nicht mit.
  //    Paginiert (ci-laeufe.mjs), damit auch bei vielen alten Läufen kein neuer abgeschnitten wird.
  let failedCount;
  try {
    failedCount = zaehleRoteCommits(ghText, { branch: headBranch, createdAt: pr.createdAt, repo });
  } catch (err) {
    console.error(`gh api fehlgeschlagen (${err.message}) — Wächter übersprungen.`);
    return; // graceful degradation: kein Netz/Token soll nicht fälschlich rot werden
  }

  console.log(
    `PR #${prNumber}: ${failedCount} distinct failed CI-Pushes auf Branch '${headBranch}' (Schwelle: ${MAX_FAILED_PUSHES}).`,
  );

  if (!isStuck(failedCount)) {
    console.log(`Noch nicht festgefahren (${failedCount}/${MAX_FAILED_PUSHES}) — alles gut.`);
    return;
  }

  // 4. Schwelle erreicht: Label setzen.
  console.log(
    `Schwelle erreicht (${failedCount} >= ${MAX_FAILED_PUSHES}) — setze '${label}' auf PR #${prNumber}.`,
  );
  ghRun(["pr", "edit", String(prNumber), "--repo", repo, "--add-label", label]);

  // 5. Konsolidierungs-Kommentar posten.
  const comment = buildStuckComment(failedCount, runUrl, label);
  ghRun(["pr", "comment", String(prNumber), "--repo", repo, "--body", comment]);

  console.log(`Festgefahren-Wächter: PR #${prNumber} als '${label}' markiert.`);
}

if (istDirektaufruf(import.meta.url)) {
  const code = main();
  if (code) process.exit(code);
}
