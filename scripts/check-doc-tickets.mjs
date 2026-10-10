// Kein Shebang — analog zu scripts/check-docdrift.mjs: dieses Skript wird über
// `node scripts/check-doc-tickets.mjs` (npm run check:doctickets) gestartet UND
// von test/doctickets.test.ts importiert. Ein `#!` bricht genau diesen esbuild-Import.
/**
 * Doku-Aktualitäts-Wächter (#610) — ergänzt den Harness-Drift-Wächter (#529,
 * check-docdrift.mjs) um die eine Dimension, die dieser NICHT prüft: **inhaltliche
 * Aktualität**.
 *
 * Hintergrund: docs/agent-harness.md § „Roadmap / bekannte Lücken" listet
 * Harness-Verbesserungen, die noch **offen** sind. Diese Liste veraltet leise —
 * genau so wie die alte „#492 (RNG-Determinismus) ist offen"-Zeile, die noch
 * dastand, obwohl das Gate längst existierte (Befund iSAQB-Runde 3). check:docdrift
 * prüft nur Kommandos/Links/Anker, nicht ob eine als „offen" dokumentierte
 * Ticket-Nummer auf GitHub inzwischen geschlossen ist. Dieser Wächter schließt die
 * Lücke: er liest die zwischen zwei Markern gelistete „offen"-Tabelle und prüft jede
 * Nummer gegen den echten `gh issue`-Status.
 *
 * BEWUSST NICHT Teil von `npm run verify` / der Vitest-Suite: der eigentliche
 * gh-Abgleich braucht Netz + Auth und ist nicht deterministisch — er darf die
 * hermetische, offline-fähige Gate-Kette nicht netzabhängig machen. Er läuft als
 * eigener (bewusst non-blocking, „alarmierender") CI-Job und lokal auf Zuruf beim
 * Pflege-Schritt. Die REINE Parse-Logik (`parseOpenHarnessTickets`) ist dagegen
 * offline + deterministisch und wird von test/doctickets.test.ts Red-Green geprüft.
 *
 * Graceful degradation (wie check:diffsize im flachen Checkout): fehlt `gh` oder
 * lässt sich ein Status nicht ermitteln (offline, kein Token, frischer Clone), wird
 * ÜBERSPRUNGEN (exit 0) mit klarer Meldung — nicht fälschlich grün gemeldet, aber
 * auch nicht rot aus dem falschen Grund. ROT gibt es nur, wenn gh eine als „offen"
 * gelistete Nummer sicher als CLOSED zurückmeldet.
 *
 * Ausführen mit:  npm run check:doctickets
 */

import { readFileSync } from "node:fs";
import { ghText } from "./gh-cli.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { SIZE_ALLOWLIST, CONTEXT_ALLOWLIST } from "./check-allowlists.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Doku-Datei mit der Roadmap-Tabelle. */
export const HARNESS_DOC = "docs/agent-harness.md";

/** Marker, zwischen denen die als „offen" dokumentierten Ticket-Nummern stehen.
 *  NUR Nummern zwischen diesen beiden Markern gelten als „offen dokumentiert" —
 *  so zählen die #-Nummern in Prosa/„erledigt"-Notizen (z.B. das erledigte #492)
 *  bewusst NICHT mit. */
export const OPEN_TICKETS_START = "<!-- open-harness-tickets:start -->";
export const OPEN_TICKETS_END = "<!-- open-harness-tickets:end -->";

/** Extrahiert die als „offen" markierten Ticket-Nummern aus dem Markdown.
 *  Rein, deterministisch, offline — die testbare Wahrheit hinter dem gh-Abgleich.
 *  Fehlen die Marker (oder stehen sie verkehrt), wird eine leere Liste geliefert. */
export function parseOpenHarnessTickets(md) {
  const start = md.indexOf(OPEN_TICKETS_START);
  const end = md.indexOf(OPEN_TICKETS_END);
  if (start < 0 || end < 0 || end <= start) return [];
  const block = md.slice(start + OPEN_TICKETS_START.length, end);
  const nums = new Set();
  // NUR die fett markierten Ticket-Nummern der Zeilen (`**#594**`, `**#593 / #594**`)
  // zählen als „offen dokumentiert" — NICHT die #-Referenzen in der Beschreibungsspalte
  // (z.B. „… ergänzt das Bundle-Budget #503"), die auf schon erledigte Tickets zeigen.
  for (const bold of block.matchAll(/\*\*([^*]+)\*\*/g)) {
    for (const m of bold[1].matchAll(/#(\d+)/g)) nums.add(Number(m[1]));
  }
  return [...nums].sort((a, b) => a - b);
}

/** Die Ausnahme-Listen, die ein offenes Ticket nennen müssen (#1460 Z1). DECKEL in check-size sind Ratchet-Historie,
 *  kein Ticket-Versprechen, und gehören bewusst nicht dazu. */
export const AUSNAHME_LISTEN = [
  { skript: "scripts/check-allowlists.mjs › SIZE_ALLOWLIST", eintraege: SIZE_ALLOWLIST },
  { skript: "scripts/check-allowlists.mjs › CONTEXT_ALLOWLIST", eintraege: CONTEXT_ALLOWLIST },
];

/** Je Ausnahme die Ticket-Nummer: das erste `#N` der Begründung, sonst null. Rein, offline. */
export function ausnahmeTickets(eintraege) {
  return eintraege.map((e) => {
    const m = /#(\d+)/.exec(e.reason ?? "");
    return { file: e.file, nr: m ? Number(m[1]) : null };
  });
}

/**
 * Urteil über die Ausnahmen (`{ file, nr, skript }`): `stateOf(nr)` liefert "OPEN" | "CLOSED" | null (nicht ermittelbar). Rot ist eine
 * Ausnahme ohne Nummer oder mit CLOSED-Ticket, unbekannt eine mit nicht ermittelbarem Status (kein Rot aus dem falschen Grund). Rein.
 */
export function bewerteAusnahmen(ausnahmen, stateOf) {
  const rot = [];
  const unbekannt = [];
  for (const a of ausnahmen) {
    if (a.nr === null) {
      rot.push({ ...a, grund: "keine Ticket-Nummer" });
      continue;
    }
    const state = stateOf(a.nr);
    if (state === "CLOSED") rot.push({ ...a, grund: `#${a.nr} ist CLOSED` });
    else if (state == null) unbekannt.push(a);
  }
  return { rot, unbekannt };
}

// ── gh-Abgleich (nur in der CLI, nicht im Test) ─────────────────────────────────

/** true, wenn `gh` als ausführbares Kommando verfügbar ist. */
function ghAvailable() {
  try {
    ghText(["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** GitHub-Status EINER Nummer: "OPEN" | "CLOSED" | null (nicht ermittelbar). */
function ghStateOf(number) {
  try {
    const out = ghText(["issue", "view", String(number), "--json", "state", "-q", ".state"]);
    return out.trim().toUpperCase();
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const yellow = (s) => paint("33", s);

  const md = readFileSync(join(ROOT, HARNESS_DOC), "utf8");
  const open = parseOpenHarnessTickets(md);
  const ausnahmen = AUSNAHME_LISTEN.flatMap((l) => ausnahmeTickets(l.eintraege).map((e) => ({ ...e, skript: l.skript })));

  if (open.length === 0 && ausnahmen.length === 0) {
    console.log(green(`✔ Keine offen-markierten Roadmap-Tickets in ${HARNESS_DOC} (nichts abzugleichen).`));
    return;
  }

  if (!ghAvailable()) {
    console.error(
      yellow(
        `… gh nicht verfügbar — Doku-Aktualitäts-Abgleich übersprungen (${open.length} als „offen" markierte Tickets: ${open
          .map((n) => `#${n}`)
          .join(", ")}; ${ausnahmen.length} Größen-Ausnahmen).`,
      ),
    );
    return; // graceful skip: offline/kein Token darf nicht rot aus dem falschen Grund sein
  }

  const closed = [];
  const unknown = [];
  const urteil = bewerteAusnahmen(ausnahmen, ghStateOf);
  for (const a of urteil.unbekannt) {
    console.error(yellow(`… #${a.nr}: gh-Status der Ausnahme für ${a.file} nicht ermittelbar — übersprungen (transient/kein Zugriff).`));
  }
  for (const a of urteil.rot) {
    console.error(
      red(`✖ ${a.skript}: die Ausnahme für ${a.file}: ${a.grund}; offenes Ticket eintragen oder die Ausnahme abbauen.`),
    );
  }
  for (const n of open) {
    const state = ghStateOf(n);
    if (state === "CLOSED") closed.push(n);
    else if (state == null) unknown.push(n);
  }

  for (const n of unknown) {
    console.error(yellow(`… #${n}: gh-Status nicht ermittelbar — übersprungen (transient/kein Zugriff).`));
  }

  if (urteil.rot.length && closed.length === 0) {
    console.error(`\nAusnahme-Drift: eine Größen-Ausnahme nennt kein offenes Ticket.`);
    process.exit(1);
  }

  if (closed.length) {
    for (const n of closed) {
      console.error(
        red(
          `✖ #${n} ist in ${HARNESS_DOC} als „offen" gelistet, ist auf GitHub aber CLOSED. ` +
            `Zeile aus der open-harness-tickets-Tabelle entfernen (erledigte Roadmap-Punkte gehören in „Schon gelandet").`,
        ),
      );
    }
    console.error(`\nDoku-Aktualitäts-Drift: die Harness-Roadmap listet erledigte Tickets als offen.`);
    process.exit(1);
  }

  console.log(
    green(`✔ Harness-Roadmap aktuell: ${open.length} als „offen" markierte Tickets und ${ausnahmen.length} Größen-Ausnahmen mit offenem Ticket.`),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
