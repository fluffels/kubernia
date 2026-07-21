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
 * `status:festgefahren` auf den PR und postet den Konsolidierungs-Kommentar.
 *
 * Bewusst NICHT in `npm run verify`: der gh-Aufruf braucht Netz + Auth und ist
 * nicht deterministisch. Läuft als CI-Job in `.github/workflows/festgefahren.yml`,
 * ausgelöst von `workflow_run` nach jedem failed CI-Lauf auf einem PR.
 *
 * Manuelle CI-Neustarts (Rerun) inflationieren den Zähler NICHT: gleicher Commit
 * → gleiche head_sha → zählt weiterhin als einer.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Schwelle: 1 initialer Fehlschlag + 3 gescheiterte Fix-Versuche = „dreimal" aus AGENTS.md. */
export const MAX_FAILED_PUSHES = 4;

/** Das Label, das der Wächter bei Erreichen der Schwelle setzt. */
export const STUCK_LABEL = "status:festgefahren";

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
 * @returns {string}
 */
export function buildStuckComment(failedCount, runUrl) {
  const fixAttempts = failedCount - 1;
  return [
    `## ⚓ Festgefahren-Wächter hat angeschlagen (#904)`,
    ``,
    `Dieser PR hat **${failedCount} distinct fehlgeschlagene CI-Läufe** auf diesem Branch — das entspricht **${fixAttempts} gescheiterten Fix-Versuchen** nach dem ersten Fehlschlag.`,
    ``,
    `Das Festgefahren-Protokoll aus [AGENTS.md](../AGENTS.md) (Schwelle: ${MAX_FAILED_PUSHES - 1} Fix-Versuche) ist damit erreicht. Das Label \`${STUCK_LABEL}\` ist gesetzt.`,
    ``,
    `**Als Agent: Nicht weiterfixen auf diesem Branch. Stattdessen:**`,
    `1. Den aktuellen Fehlerbefund hier zusammenfassen (was wurde versucht, warum greift es nicht)`,
    `2. 2–3 konkrete Entscheidungsoptionen für die Maintainerin benennen`,
    `3. Den PR offen lassen und ASSIGNED bleiben, bis die Maintainerin entschieden hat`,
    ``,
    `Letzter fehlgeschlagener CI-Lauf: ${runUrl}`,
  ].join("\n");
}

// ── CLI (läuft nur als CI-Job in festgefahren.yml) ───────────────────────────

/** `gh <args>` ausführen und stdout als JSON parsen. Wirft bei Fehler. */
function ghJson(args) {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

/** `gh <args>` ausführen, Ausgabe an Terminal durchreichen. */
function ghRun(args) {
  execFileSync("gh", args, { stdio: "inherit" });
}

function main() {
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
    "--json", "number,labels",
  ]);

  if (prs.length === 0) {
    console.log(`Kein offener PR für Branch '${headBranch}' — Festgefahren-Wächter übersprungen.`);
    return;
  }

  const pr = prs[0];
  const prNumber = pr.number;

  // 2. Schon festgefahren? Kein Doppel-Kommentar.
  const alreadyStuck = (pr.labels ?? []).some((l) => l.name === STUCK_LABEL);
  if (alreadyStuck) {
    console.log(`PR #${prNumber}: Label '${STUCK_LABEL}' ist bereits gesetzt — übersprungen.`);
    return;
  }

  // 3. Fehlgeschlagene CI-Läufe auf diesem Branch zählen (distinct head_sha).
  //    Manuelle Reruns haben dieselbe head_sha → zählen einmal, nicht doppelt.
  //    per_page=10 reicht: Schwelle ist 4 — mehr müssen wir nicht kennen.
  let failedRuns;
  try {
    const runsPage = ghJson([
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs` +
        `?branch=${encodeURIComponent(headBranch)}&status=failure&event=pull_request&per_page=10`,
    ]);
    failedRuns = runsPage.workflow_runs ?? [];
  } catch (err) {
    console.error(`gh api fehlgeschlagen (${err.message}) — Wächter übersprungen.`);
    return; // graceful degradation: kein Netz/Token soll nicht fälschlich rot werden
  }

  const distinctShas = new Set(failedRuns.map((r) => r.head_sha));
  const failedCount = distinctShas.size;

  console.log(
    `PR #${prNumber}: ${failedCount} distinct failed CI-Pushes auf Branch '${headBranch}' (Schwelle: ${MAX_FAILED_PUSHES}).`,
  );

  if (!isStuck(failedCount)) {
    console.log(`Noch nicht festgefahren (${failedCount}/${MAX_FAILED_PUSHES}) — alles gut.`);
    return;
  }

  // 4. Schwelle erreicht: Label setzen.
  console.log(
    `Schwelle erreicht (${failedCount} >= ${MAX_FAILED_PUSHES}) — setze '${STUCK_LABEL}' auf PR #${prNumber}.`,
  );
  ghRun(["pr", "edit", String(prNumber), "--repo", repo, "--add-label", STUCK_LABEL]);

  // 5. Konsolidierungs-Kommentar posten.
  const comment = buildStuckComment(failedCount, runUrl);
  ghRun(["pr", "comment", String(prNumber), "--repo", repo, "--body", comment]);

  console.log(`Festgefahren-Wächter: PR #${prNumber} als '${STUCK_LABEL}' markiert.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
