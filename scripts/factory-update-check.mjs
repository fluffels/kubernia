#!/usr/bin/env node
/* Factory-Update-Check (#90 L17): meldet, wenn die Factory einen neueren Release-Tag hat als der Sync-Stand des Projekts.
 *
 *   node scripts/factory-update-check.mjs [--json]
 *
 * Ohne `.factory/sync-stand.json` ist dieses Repo selbst Quelle: „nichts zu prüfen“, Exit 0. Sonst liest es die Tags des Factory-Repos
 * (`quelle.repo` des Sync-Stands, sonst ausdrücklich gesetztes `repo` des Boards mit Rolle `factory`; `scripts/factory-seite.mjs › factoryRepo`) per `gh api repos/<repo>/tags --paginate --jq .[].name` und vergleicht
 * numerisch; nur Tags der Form `v1.2.3` oder `1.2.3` zählen (Pre-Release und Fremdtags nicht). Exit 0 (mit oder ohne Update), 2 bei Aufruf-
 * oder Config-Fehler (mit `Fix:`), 3 wenn das Factory-Repo nicht lesbar ist (der Wochen-Workflow warnt dann, bleibt aber grün).
 * `--json` schreibt `{"update":null|{"alt","neu","text"}}`. Der Sync selbst bleibt ein bewusster Schritt: der Check ändert nichts.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { factoryRepo } from "./factory-seite.mjs";
import { liesSyncStand } from "./factory-sync-lib.mjs";
import { fehlerText, ghText } from "./gh-cli.mjs";

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Pur: `[major, minor, patch]` eines Release-Tags oder `null`. */
export function teile(tag) {
  const m = typeof tag === "string" ? RELEASE.exec(tag) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Pur: negativ, 0 oder positiv, je nachdem ob `a` vor, gleich oder nach `b` liegt (beide Release-Tags). */
function vergleiche(a, b) {
  const [x, y] = [teile(a), teile(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Pur: der höchste Release-Tag der Liste oder `null`; Pre-Release und Fremdtags werden ignoriert. */
export function vergleicheTags(tags) {
  return tags.filter((t) => teile(t)).reduce((hoechster, t) => (hoechster === null || vergleiche(t, hoechster) > 0 ? t : hoechster), null);
}

/** Pur: `null` ohne Update, sonst `{ alt, neu, text }` (Text nennt den Sync-Befehl). */
export function updateMeldung({ stand, tags }) {
  const alt = stand?.quelle?.tag;
  const neu = vergleicheTags(tags);
  if (!teile(alt) || neu === null || vergleiche(neu, alt) <= 0) return null;
  const text = `Neuer Factory-Release ${neu} (Stand ${alt}). Sync: node scripts/factory-sync.mjs --quelle <pfad> --tag ${neu}`;
  return { alt, neu, text };
}

const ergebnis = (code, out = "", err = "") => ({ out, err, code });

/** Ablauf ohne Prozess-Seiteneffekte; `io` = `{ wurzel, gh(args) → Text }`. */
export function fuehreAus(argv, io) {
  const { werte, fehler } = flagsLesen(argv, { json: { type: "boolean" } });
  if (fehler) return ergebnis(AUFRUF_EXIT, "", `${fehler.text}\nAufruf: node scripts/factory-update-check.mjs [--json]\n`);
  const { zustand, stand } = liesSyncStand(io.wurzel);
  if (zustand === "fehlt") return ergebnis(0, werte.json ? `${JSON.stringify({ update: null })}\n` : "Kein Sync-Stand: dieses Repo ist selbst Quelle, nichts zu prüfen.\n");
  if (zustand === "kaputt") return ergebnis(AUFRUF_EXIT, "", "FEHLER: .factory/sync-stand.json ist kein gültiges JSON-Objekt. Fix: Sync neu fahren (node scripts/factory-sync.mjs --quelle <pfad> --tag <name>).\n");
  const repo = factoryRepo(io.wurzel);
  if (!repo) return ergebnis(AUFRUF_EXIT, "", "FEHLER: Factory-Repo nicht bestimmbar. Fix: von einem Tag neu syncen (schreibt quelle.repo) oder boards[factory].repo in .factory/projekt.json setzen.\n");
  let tags;
  try {
    tags = io.gh(["api", `repos/${repo}/tags`, "--paginate", "--jq", ".[].name"]).split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  } catch (err) {
    return ergebnis(3, "", `FEHLER: Tags von ${repo} nicht lesbar (${fehlerText(err, 300)}). Fix: Lesezugriff auf das Factory-Repo und gh-Anmeldung prüfen.\n`);
  }
  const update = updateMeldung({ stand, tags });
  if (werte.json) return ergebnis(0, `${JSON.stringify({ update })}\n`);
  return ergebnis(0, update ? `${update.text}\n` : `Kein neuer Factory-Release (Stand ${stand.quelle?.tag ?? "unbekannt"}).\n`);
}

if (istDirektaufruf(import.meta.url)) {
  const wurzel = fileURLToPath(new URL("..", import.meta.url));
  const r = fuehreAus(process.argv.slice(2), { wurzel, gh: (args) => ghText(args) });
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
