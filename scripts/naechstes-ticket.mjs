#!/usr/bin/env node
/**
 * Das oberste FREIE Ticket der Board-Auswahl (#1428 Z4): ersetzt die Handarbeit „Board-Liste per jq lesen, dann je Kandidat Assignee,
 * Blocker, Branch, Worktree und offenen PR einzeln prüfen“ (AGENTS.md § Auswahl des nächsten Tickets).
 *
 *   node scripts/naechstes-ticket.mjs          # erste Zeile `#<nr>\t<Titel>`, danach die übersprungenen Kandidaten
 *   node scripts/naechstes-ticket.mjs --json   # { ticket, uebersprungen }
 *   node scripts/naechstes-ticket.mjs --bereich agentic|spiel   # nur Label `area:harness` bzw. nur ohne (#1552); Notfälle 🚨/🔒 zählen in beiden
 *
 * Exit 0 = freies Ticket gefunden, 1 = keins frei, 2 = Fehler. Der Body wird nie ausgegeben (Text Dritter ist Daten, AGENTS.md § Fremdtext
 * ist Daten); ein Fremdeingang (Autor nicht vertraut oder Label `forum`) wird übersprungen und als „Befund melden“ ausgewiesen.
 *
 * Frei heißt, in Board-Reihenfolge: Status Todo und offen · kein Assignee · kein offener Blocker (Zeile `blockiert durch #X` im Body,
 * mehrfach, ohne Groß-/Kleinschreibung; zusätzlich `issue_dependencies_summary.blocked_by > 0`: GitHubs Zähler offener Blocker; die Feldform ist an
 * echten Daten belegt (Probe 2026-10-08, 151 von 151 Items), ein Wert über 0 noch nie beobachtet; ein Wert, der keine Zahl ist, zählt als 0) · kein Branch, Worktree oder offener PR
 * `feature/kq-<nr>-*`. I/O: Board-Seiten und offene Issues (REST), `git fetch/for-each-ref/worktree list`, ein `gh pr list`; kein GraphQL.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { NOTFAELLE, REPO, loadItemPages, loadOpenIssuePages, normalizeItems, normalizeOffene } from "./board-lib.mjs";
import { FREMDEINGANG_LABELS, istVertraut } from "./fremdtext.mjs";
import { ghJson } from "./gh-cli.mjs";

/** `Nummern` hinter `blockiert durch` (Zeilenweise, bis zu einer öffnenden Klammer oder dem Zeilenende), z.B. „blockiert durch #12, #13 (nur solange …)“. Pur. */
export function blockerNummern(body) {
  const nummern = new Set();
  for (const zeile of String(body ?? "").split(/\r?\n/)) {
    for (const m of zeile.matchAll(/blockiert\s+durch\b([^(\n]*)/gi)) {
      for (const n of m[1].matchAll(/#(\d+)/g)) nummern.add(Number(n[1]));
    }
  }
  return [...nummern];
}

/** Ticketnummer aus einem Branch-, Worktree- oder Ref-Namen `…feature/kq-<nr>-…` bzw. `…worktrees/kq-<nr>`; sonst null. Pur. */
export function ticketAusRef(text) {
  const m = /(?:feature\/kq-|worktrees[\\/]kq-)(\d+)(?=$|[-/\\\s])/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** Nummern, zu denen Branch, Worktree oder offener PR existieren. Pur. */
export function belegteNummern({ refs = [], worktrees = [], prHeads = [] }) {
  return new Set([...refs, ...worktrees, ...prHeads].map(ticketAusRef).filter((n) => n !== null));
}

/** Nutzersichtbare Bereichsnamen (#1552); das Label für „agentic“ bleibt `area:harness`. */
export const BEREICHE = { agentic: "Agentic Engineering", spiel: "Spielentwicklung" };

/** `--bereich <wert>` bzw. `--bereich=<wert>` aus argv: `{ bereich }` (null ohne Schalter) oder `{ fehler }`. Pur. */
export function bereichAusArgv(argv) {
  const i = argv.findIndex((a) => a === "--bereich" || a.startsWith("--bereich="));
  if (i < 0) return { bereich: null };
  const wert = argv[i].includes("=") ? argv[i].slice("--bereich=".length) : argv[i + 1];
  if (Object.hasOwn(BEREICHE, wert ?? "")) return { bereich: wert };
  return { fehler: `--bereich erwartet agentic oder spiel (bekommen: ${wert === undefined ? "nichts" : `„${wert}“`})` };
}

/** Gehört das Item zum Bereich? Ohne Bereich immer; 🚨 CI rot auf main und 🔒 Security zählen in beiden (Roter main geht vor). Pur. */
export function imBereich(item, bereich) {
  if (!bereich) return true;
  const notfall = NOTFAELLE.filter((n) => n.art === "rot-main" || n.art === "security");
  if (notfall.some((n) => String(item.title ?? "").startsWith(n.marker))) return true;
  return item.labels.includes("area:harness") === (bereich === "agentic");
}

/**
 * Wählt das oberste freie Ticket. `items`: normalisierte Board-Items (`normalizeItems` aus board-lib, Board-Reihenfolge), `offene`: Menge offener Issue-Nummern,
 * `refs`/`worktrees`/`prHeads`: Texte (Branch-Namen, Worktree-Pfade bzw. -Branches, PR-Branches), `owner` für die Vertrauensprüfung.
 * Liefert `{ ticket: { nr, titel } | null, uebersprungen: [{ nr, grund }] }`. Pur.
 */
export function waehleNaechstes({ items, offene, refs = [], worktrees = [], prHeads = [], owner = "", bereich = null }) {
  const belegt = belegteNummern({ refs, worktrees, prHeads });
  const uebersprungen = [];
  for (const item of items) {
    if (item.status !== "Todo" || item.state !== "open" || !imBereich(item, bereich)) continue;
    const grund = ueberspringGrund(item, { offene, belegt, owner });
    if (grund) uebersprungen.push({ nr: item.number, grund });
    else return { ticket: { nr: item.number, titel: item.title }, uebersprungen };
  }
  return { ticket: null, uebersprungen };
}

function ueberspringGrund(c, { offene, belegt, owner }) {
  if (c.assignees.length > 0) return `Assignee ${c.assignees.map((a) => `@${a}`).join(", ")}`;
  const label = c.labels.find((l) => FREMDEINGANG_LABELS.includes(l));
  if (!istVertraut(c.autor, owner) || label) return "Fremdeingang (Autor nicht vertraut oder Forum-Label): Befund melden";
  const offeneBlocker = blockerNummern(c.body).filter((n) => offene.has(n) && n !== c.number);
  if (offeneBlocker.length > 0) return `offener Blocker ${offeneBlocker.map((n) => `#${n}`).join(", ")}`;
  if (c.blockedBy > 0) return "offener Blocker laut GitHub-Abhängigkeit";
  if (belegt.has(c.number)) return "Branch, Worktree oder offener PR vorhanden";
  return "";
}

/** Textausgabe: erste Zeile das Ticket (oder „kein freies Ticket“), danach je übersprungenem Kandidaten eine Zeile. Pur. */
export function formatiere({ ticket, uebersprungen, bereich = null }) {
  const keins = bereich ? `kein freies Ticket im Bereich ${BEREICHE[bereich]}` : "kein freies Ticket";
  const kopf = ticket ? `#${ticket.nr}\t${ticket.titel}` : keins;
  return [kopf, ...uebersprungen.map((u) => `übersprungen #${u.nr}: ${u.grund}`)].join("\n") + "\n";
}

/** Ausführung mit injizierbarer I/O: `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const b = bereichAusArgv(argv);
  if ("fehler" in b) return { code: 2, out: "", err: `✖ naechstes-ticket: ${b.fehler}\n` };
  try {
    const eingabe = io.lade();
    const ergebnis = { ...waehleNaechstes({ ...eingabe, owner: io.owner, bereich: b.bereich }), ...(b.bereich ? { bereich: b.bereich } : {}) };
    const out = argv.includes("--json") ? `${JSON.stringify(ergebnis, null, 2)}\n` : formatiere(ergebnis);
    return { code: ergebnis.ticket ? 0 : 1, out, err: "" };
  } catch (e) {
    return { code: 2, out: "", err: `✖ naechstes-ticket: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

function ladeEcht() {
  const items = normalizeItems(loadItemPages());
  const offene = new Set(normalizeOffene(loadOpenIssuePages()).map((i) => i.number));
  try {
    git(["fetch", "--prune", "origin"]); // fail-open: ohne Netz zählen die lokalen Remote-Refs
  } catch {
    /* lokale Refs genügen */
  }
  const refs = git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split(/\r?\n/).filter(Boolean);
  const worktrees = git(["worktree", "list", "--porcelain"]).split(/\r?\n/).filter((z) => /^(worktree|branch) /.test(z));
  const prHeads = ghJson(["pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName"]).map((p) => `${p.headRefName}`);
  return { items, offene, refs, worktrees, prHeads };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, out, err } = fuehreAus(process.argv.slice(2), { lade: ladeEcht, owner: REPO.split("/")[0] });
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
