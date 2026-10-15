#!/usr/bin/env node
/**
 * Budget-Pacing-CLI (#1358): sagt, ob das nächste Ticket starten darf. Regeln und Defaults: docs/model-routing.md §6.
 *
 *   node scripts/budget-pacing.mjs [--json] [--ohne-probe]
 *
 * Quelle ist der Snapshot der Statusline (`statusline.mjs`); fehlt er oder ist er älter als 15 min, läuft eine Headless-Probe
 * (ein Haiku-Aufruf außerhalb des Projekts, liest das `rate_limit_event`), außer mit `--ohne-probe`.
 * Zeile 1: `ok` | `knapp · Pause bis <Zeit>` | `stopp · Pause bis <Zeit>`. Exit 0 ok (auch fail-open), 3 knapp, 4 stopp, 2 Aufruffehler.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ausProbe, brauchtProbe, liesSnapshot, pacing, schreibeSnapshot, snapshotPfad, zielquoteAusEnv } from "./budget-lib.mjs";

const EXIT = { ok: 0, knapp: 3, stopp: 4 };
const argv = process.argv.slice(2);
const bekannt = new Set(["--json", "--ohne-probe"]);
const unbekannt = argv.filter((a) => !bekannt.has(a));
if (unbekannt.length) {
  console.error(`Unbekannte Argumente: ${unbekannt.join(" ")}\nAufruf: node scripts/budget-pacing.mjs [--json] [--ohne-probe]`);
  process.exit(2);
}

/** Headless-Probe: cwd im OS-Temp, damit weder Projekt-Hooks noch das kubernia-Tag greifen. `null` bei jedem Fehler. */
function probe() {
  // KQ_PACING_PROBE_SKRIPT ersetzt den Claude-Aufruf (nur für Tests: ein Skript, das stream-json-Zeilen ausgibt).
  const fake = process.env.KQ_PACING_PROBE_SKRIPT;
  const [datei, args] = fake
    ? [process.execPath, [fake]]
    : ["claude", ["-p", "Antworte nur mit: ok", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--max-turns", "1"]];
  const r = spawnSync(datei, args, {
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.error || !r.stdout ? null : ausProbe(r.stdout.split(/\r?\n/));
}

const jetzt = Date.now();
const pfad = snapshotPfad();
const { zielquote, warnung: zielWarnung } = zielquoteAusEnv(process.env);
const gelesen = liesSnapshot(pfad);
let snapshot = gelesen.snapshot;
const vorab = [];
if (zielWarnung) vorab.push(zielWarnung);
if (brauchtProbe(snapshot, jetzt) && !argv.includes("--ohne-probe")) {
  const gemessen = probe();
  if (gemessen) {
    snapshot = gemessen;
    try {
      schreibeSnapshot(gemessen, pfad);
    } catch (e) {
      vorab.push(`Snapshot nicht schreibbar: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else vorab.push("Headless-Probe lieferte keinen Stand.");
} else if (!snapshot && gelesen.warnung) vorab.push(gelesen.warnung);

const u = pacing(snapshot, { jetzt, zielquote });
u.warnungen.unshift(...vorab);
const zeit = (ms) => {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, "0");
  const zone = new Intl.DateTimeFormat("de-DE", { timeZoneName: "short" }).formatToParts(d).find((t) => t.type === "timeZoneName")?.value ?? "";
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())} (${zone})`;
};

if (argv.includes("--json")) {
  console.log(JSON.stringify({ ...u, pauseBisText: u.pauseBis ? zeit(u.pauseBis) : null, stand: snapshot?.stand ?? null }));
} else {
  const pct = (x) => (x === null ? "?" : `${Math.round(x * 10) / 10} %`);
  console.log(u.status === "ok" ? "ok" : `${u.status} · Pause bis ${zeit(u.pauseBis)}`);
  console.log(`7d: Ist ${pct(u.ist7)}, Soll ${pct(u.soll7)}, Zielquote ${u.zielquote} % · 5h: ${pct(u.ist5)} · Quelle: ${u.quelle ?? "-"} · Alter: ${u.alterMs === null ? "?" : `${Math.round(u.alterMs / 60_000)} min`}`);
  for (const w of u.warnungen) console.log(`Warnung: ${w}`);
}
process.exit(EXIT[u.status]);
