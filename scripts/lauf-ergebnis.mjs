#!/usr/bin/env node
/**
 * Ergebnis je Ticket-Lauf (#1123) — deterministisch aus git und GitHub, nicht aus Langfuse.
 *
 * Je gemergtem PR im Zeitfenster: Review-Runden und Runde-1-Blocker je Brille (aus der `KQ-Review:`-Zeile der
 * Squash-Message), rote CI-Läufe (distinct Head-SHAs mit Fehlschlag zwischen PR-Erstellung und Merge), das Label
 * `status:festgefahren` (aus den Label-Events, zählt auch bei später entferntem Label) und Nacharbeit: ein Revert
 * oder eine Folge-Fix-Commit-Zeile `Folge #<ticket-nr>` innerhalb von 14 Tagen nach dem Merge. Daraus die
 * Lens-Trefferquote je Brille und der Anteil ohne Nacharbeit. Definitionen und Grenzen: docs/model-routing.md
 * › Ergebnis je Ticket-Lauf.
 *
 *   node scripts/lauf-ergebnis.mjs --von <ISO> --bis <ISO> [--json]
 *
 * Exit 0 ok, 1 falscher Aufruf, 2 unvollständige Daten (nie still 0: abgeschnittene PR-Liste, lokal fehlender
 * Merge-Commit, gh-/git-Fehler). Reines Node-Skript; der Kern ist pur, git/gh sind injizierbar (Test).
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseNachweis } from "./slice-override.mjs";

export const NACHARBEIT_TAGE = 14;
const TAG_MS = 24 * 3600 * 1000;
const PR_LIMIT = 1000;

/** Daten sind unvollständig: das Skript bricht mit Exit 2 ab statt eine schönere Zahl zu liefern. */
export class DatenFehler extends Error {}

/** `git log --format=%H%x1f%cI%x1f%B%x1e` → `[{sha, datum, body}]`. Pure. */
export function parseCommits(log) {
  return String(log)
    .split("\x1e")
    .map((e) => e.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((e) => {
      const [sha, datum, ...rest] = e.split("\x1f");
      return { sha: sha.trim(), datum, body: rest.join("\x1f").replace(/\r/g, "") };
    });
}

/** Ticketnummer eines PRs: das erste verknüpfte Issue, sonst die letzte `(#N)` im Titel. */
export function ticketVon(pr) {
  const ref = pr.closingIssuesReferences?.[0]?.number;
  if (ref) return ref;
  const alle = [...String(pr.title ?? "").matchAll(/\(#(\d+)\)/g)];
  return alle.length > 0 ? Number(alle[alle.length - 1][1]) : null;
}

/** Nacharbeit nach dem Merge: 'revert' | 'folge' | 'nein' | 'offen' (Fenster läuft noch, kein Treffer). Pure. */
export function nacharbeitVon({ pr, ticket, mergeSha, mergedAt, commits, jetzt }) {
  const von = new Date(mergedAt).getTime();
  const bis = von + NACHARBEIT_TAGE * TAG_MS;
  for (const c of commits) {
    const t = new Date(c.datum).getTime();
    if (c.sha === mergeSha || !(t > von && t <= bis)) continue;
    const revertet = [...c.body.matchAll(/This reverts commit ([0-9a-f]{7,40})/gi)].some((m) => mergeSha.startsWith(m[1].toLowerCase()));
    const betreff = c.body.split("\n", 1)[0];
    if (revertet || (/^Revert "/.test(betreff) && betreff.includes(`(#${pr})`))) return "revert";
    const folge = [...c.body.matchAll(/^Folge #(\d+)\b/gm)].some((m) => Number(m[1]) === ticket || Number(m[1]) === pr);
    if (folge) return "folge";
  }
  return jetzt.getTime() < bis ? "offen" : "nein";
}

/** Anzahl distinct Head-SHAs roter CI-Läufe zwischen PR-Erstellung und Merge. Pure. */
export function ciFixRunden(laeufe, createdAt, mergedAt) {
  const von = new Date(createdAt).getTime();
  const bis = new Date(mergedAt).getTime();
  const shas = laeufe.filter((l) => new Date(l.createdAt).getTime() >= von && new Date(l.createdAt).getTime() <= bis).map((l) => l.sha);
  return new Set(shas).size;
}

/** Bewertet die PRs; `ci`/`festgefahren` sind je PR-Nummer vorab geholt. Pure. Liefert Zeilen und Kennzahlen. */
export function bewertePrs({ prs, commits, ci, festgefahren, jetzt }) {
  const zeilen = prs.map((pr) => {
    const mergeSha = pr.mergeCommit?.oid ?? "";
    const commit = commits.find((c) => c.sha === mergeSha);
    const ticket = ticketVon(pr);
    const { review } = parseNachweis(commit?.body ?? "");
    return {
      pr: pr.number,
      ticket,
      gemergt: pr.mergedAt,
      runden: review && Number.isInteger(review.runden) ? review.runden : null,
      blocker: review?.blocker ?? null,
      ciFix: ciFixRunden(ci[pr.number] ?? [], pr.createdAt, pr.mergedAt),
      festgefahren: festgefahren[pr.number] ?? 0,
      nacharbeit: nacharbeitVon({ pr: pr.number, ticket, mergeSha, mergedAt: pr.mergedAt, commits, jetzt }),
    };
  });
  const mitNachweis = zeilen.filter((z) => z.runden !== null);
  const brillen = {};
  for (const z of mitNachweis) {
    for (const b of z.blocker ?? []) {
      const e = (brillen[b.lens] ??= { prs: 0, treffer: 0, summe: 0 });
      e.prs += 1;
      if (b.n > 0) e.treffer += 1;
      e.summe += Number.isFinite(b.n) ? b.n : 0;
    }
  }
  const zaehle = (art) => zeilen.filter((z) => z.nacharbeit === art).length;
  const abgelaufen = zeilen.filter((z) => z.nacharbeit !== "offen");
  return {
    zeilen,
    kennzahlen: {
      prs: zeilen.length,
      ohneNachweis: zeilen.length - mitNachweis.length,
      ohneBlockerFeld: mitNachweis.filter((z) => z.blocker === null).length,
      runde1MitBlockerProxy: mitNachweis.filter((z) => z.runden >= 2).length,
      mitNachweis: mitNachweis.length,
      brillen,
      ohneNacharbeit: zaehle("nein"),
      nachweisbareFenster: abgelaufen.length,
      nacharbeitOffen: zaehle("offen"),
      ciFixSumme: zeilen.reduce((a, z) => a + z.ciFix, 0),
      festgefahrenSumme: zeilen.reduce((a, z) => a + z.festgefahren, 0),
    },
  };
}

const prozent = (a, b) => (b === 0 ? "–" : `${Math.round((a / b) * 100)} % (${a}/${b})`);

/** Markdown-Ausgabe: Tabelle je PR plus Aggregatzeilen. Pure. */
export function formatiere({ zeilen, kennzahlen: k }) {
  const blocker = (z) => (z.blocker === null ? "–" : z.blocker.map((b) => `${b.lens}:${b.n}`).join(","));
  const out = ["| PR | Ticket | gemergt | Runden | Blocker R1 | CI-Fix | festgefahren | Nacharbeit |", "|---|---|---|---|---|---|---|---|"];
  for (const z of zeilen) {
    out.push(`| #${z.pr} | ${z.ticket ? `#${z.ticket}` : "–"} | ${z.gemergt.slice(0, 10)} | ${z.runden ?? "ohne Nachweis"} | ${blocker(z)} | ${z.ciFix} | ${z.festgefahren} | ${z.nacharbeit} |`);
  }
  out.push("", `PRs: ${k.prs} (ohne KQ-Review-Nachweis: ${k.ohneNachweis}, ohne blocker-Feld: ${k.ohneBlockerFeld})`);
  out.push(`Runde 1 mit Blocker (Proxy runden ≥ 2): ${prozent(k.runde1MitBlockerProxy, k.mitNachweis)}`);
  for (const [lens, e] of Object.entries(k.brillen)) out.push(`Lens-Trefferquote ${lens}: ${prozent(e.treffer, e.prs)}, Σ Blocker ${e.summe}`);
  out.push(`Ohne Nacharbeit (${NACHARBEIT_TAGE} T): ${prozent(k.ohneNacharbeit, k.nachweisbareFenster)}, Fenster noch offen: ${k.nacharbeitOffen}`);
  out.push(`Σ CI-Fix-Runden: ${k.ciFixSumme}, Σ festgefahren: ${k.festgefahrenSumme}`);
  return out.join("\n");
}

/** Holt die Daten über `runGit`/`runGh` (injizierbar) und bewertet. Wirft DatenFehler bei Lücken. */
export function laufErgebnis({ von, bis, runGit, runGh, jetzt = new Date() }) {
  const gh = (args) => {
    try {
      return runGh(args);
    } catch (e) {
      throw new DatenFehler(`gh ${args.slice(0, 2).join(" ")} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const liste = JSON.parse(
    gh([
      "pr", "list", "--state", "merged", "--base", "main", "--search", `merged:${von}..${bis}`, "--limit", String(PR_LIMIT),
      "--json", "number,title,createdAt,mergedAt,mergeCommit,headRefName,closingIssuesReferences",
    ]),
  );
  if (liste.length >= PR_LIMIT) throw new DatenFehler(`PR-Liste bei ${PR_LIMIT} abgeschnitten: Zeitfenster verkleinern.`);
  const t0 = new Date(von).getTime();
  const t1 = new Date(bis).getTime();
  const prs = liste.filter((p) => new Date(p.mergedAt).getTime() >= t0 && new Date(p.mergedAt).getTime() <= t1).sort((a, b) => a.number - b.number);
  let commits;
  try {
    commits = parseCommits(runGit(["log", "origin/main", `--since=${von}`, "--format=%H%x1f%cI%x1f%B%x1e"]));
  } catch (e) {
    throw new DatenFehler(`git log origin/main fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
  const fehlend = prs.filter((p) => !commits.some((c) => c.sha === p.mergeCommit?.oid));
  if (fehlend.length > 0) throw new DatenFehler(`Merge-Commit lokal unbekannt (PR ${fehlend.map((p) => `#${p.number}`).join(", ")}): erst \`git fetch origin\`.`);
  const ci = {};
  const festgefahren = {};
  for (const p of prs) {
    const runs = gh([
      "api", "--paginate",
      `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(p.headRefName)}&event=pull_request&status=failure&per_page=100`,
      "--jq", ".workflow_runs[] | [.head_sha,.created_at] | @tsv",
    ]);
    ci[p.number] = runs.split(/\r?\n/).filter(Boolean).map((l) => ({ sha: l.split("\t")[0], createdAt: l.split("\t")[1] }));
    const events = gh([
      "api", "--paginate", `repos/{owner}/{repo}/issues/${p.number}/events`,
      "--jq", '.[] | select(.event=="labeled" and .label.name=="status:festgefahren") | .created_at',
    ]);
    festgefahren[p.number] = events.split(/\r?\n/).filter(Boolean).length;
  }
  return bewertePrs({ prs, commits, ci, festgefahren, jetzt });
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const von = opt("--von");
  const bis = opt("--bis");
  if (!von || !bis || [von, bis].some((d) => Number.isNaN(new Date(d).getTime()))) {
    console.error("Aufruf: node scripts/lauf-ergebnis.mjs --von <ISO> --bis <ISO> [--json]");
    process.exit(1);
  }
  try {
    const run = (cmd) => (args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const ergebnis = laufErgebnis({ von, bis, runGit: run("git"), runGh: run("gh") });
    console.log(argv.includes("--json") ? JSON.stringify(ergebnis, null, 2) : formatiere(ergebnis));
  } catch (e) {
    console.error(`✖ lauf-ergebnis: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
