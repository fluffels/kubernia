// Kein Shebang (siehe board-lib.mjs).
/**
 * Spielrhythmus-Pflege (#1215/#1217): berechnet die nötigen Verschiebungen im Kopf des Boards aus
 * EINER Listenabfrage und setzt sie nacheinander. Logik und Randfälle: scripts/board-lib.mjs
 * (getestet in test/board.test.ts). Regel: AGENTS.md › Wo die TODOs leben.
 *
 *   node scripts/board-rhythm.mjs            # berechnen und Positionen setzen
 *   node scripts/board-rhythm.mjs --dry-run  # nur anzeigen
 *
 * Ausgabe `OK` (Rhythmus intakt) oder `LEER` (im Kopf fehlt ein Spielticket, tiefer gibt es keins).
 * Bei Rate-Limit sofort stoppen und die Restschritte melden, nicht in einer Schleife weiterversuchen.
 */
import { pathToFileURL } from "node:url";
import { isRateLimit, loadItems, markUnfree, planRhythm, setPosition } from "./board-lib.mjs";

const PAUSE_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fehlerausgabe mit Hinweis auf Rate-Limit und offene Schritte; beendet mit Exit-Code 1. */
function fail(e, rest = "") {
  const limit = isRateLimit(e.message) ? " (API-Rate-Limit)" : "";
  console.error(`✖ Abbruch${limit}: ${e.message.split("\n")[0]}${rest ? `; offen bleiben ${rest}` : ""}. Später erneut fahren.`);
  process.exit(1);
}

async function main(argv = process.argv.slice(2)) {
  const dry = argv.includes("--dry-run");
  let plan;
  try {
    plan = planRhythm(markUnfree(loadItems()));
  } catch (e) {
    fail(e);
  }
  const { moves, end } = plan;

  for (const [n, { item, afterId }] of moves.entries()) {
    console.log(`#${item.number} „${item.title.slice(0, 50)}“ → vor das dritte Nicht-Spielticket`);
    if (dry) continue;
    try {
      setPosition(item.id, afterId);
    } catch (e) {
      fail(e, moves.slice(n).map((m) => `#${m.item.number}`).join(", "));
    }
    await sleep(PAUSE_MS);
  }

  if (end === "leer") console.log("LEER: im Kopf fehlt ein Spielticket und tiefer gibt es keins, melden (docs/ticket-reihenfolge.md)");
  else if (end === "limit") {
    console.error("✖ Schrittgrenze erreicht, Rhythmus nicht konvergiert, Board prüfen.");
    process.exitCode = 1;
  } else console.log(moves.length === 0 ? "OK: Rhythmus intakt" : "OK: Rhythmus hergestellt");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
