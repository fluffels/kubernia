#!/usr/bin/env node
/**
 * Ergebnis je Ticket-Lauf (#1123) — deterministisch aus git und GitHub, nicht aus Langfuse.
 *
 * Je gemergtem PR im Zeitfenster: Review-Runden und Runde-1-Blocker je Brille (aus der Review-Zeile der
 * Squash-Message, Präfix aus der Projekt-Config), rote CI-Läufe (distinct Head-SHAs mit Fehlschlag zwischen PR-Erstellung und Merge), das
 * Label `labels.festgefahren` der Projekt-Config (aus den Label-Events, zählt auch bei später entferntem Label) und Nacharbeit: ein Revert
 * oder eine Folge-Fix-Commit-Zeile `Folge #<ticket-nr>` innerhalb von 14 Tagen nach dem Merge. Daraus die
 * Lens-Trefferquote je Brille und der Anteil ohne Nacharbeit. Dazu je PR die Abnahme (`{durchgaenge}` | "entfaellt" | "override" | null) und die Quote im ersten Durchgang. Definitionen und Grenzen: docs/model-routing.md
 * › Ergebnis je Ticket-Lauf.
 *
 *   node scripts/lauf-ergebnis.mjs --von <ISO> --bis <ISO> [--ticket <nr>…] [--ohne <nr>…] [--start-agent <typ>] [--json]
 *
 * `--start-agent <typ>` (#1646): statt aller PRs im Fenster nur die der Tickets, deren erster Lauf dieses Subagent-Typs in [von, bis] startet
 * (aus den lokalen Transkripten, 48 h Vorlauf beim Laden). PRs ohne Ticket und Tickets mit früherem Start fallen heraus; `--ohne` bleibt kombinierbar,
 * `--ticket` nicht. `von`/`bis` gelten zugleich für den Merge-Zeitpunkt. Fehlen die Transkripte des Typs, bricht das Skript ab (Exit 2).
 *
 * Exit 0 ok, 1 falscher Aufruf, 2 unvollständige Daten (nie still 0: abgeschnittene PR-Liste, lokal fehlender
 * Merge-Commit, gh-/git-Fehler). Reines Node-Skript; der Kern ist pur, git/gh sind injizierbar (Test).
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { labelAus, ladeProjektConfig, repoOwner } from "./projekt-config-lib.mjs";
import { aktiverOverride, commitZeilenAus } from "./slice-override.mjs";
import { hoechsterAbnahmeDurchgang, parseNachweis } from "./nachweis-lib.mjs";
import { issueKommentare } from "./fremdtext-lib.mjs";
import { passtTicketFilter, TICKET_OPTIONEN, ticketFilterAus, ticketMeldung } from "./mess-lib.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { distinctRoteShas, ghText, holeRoteLaeufe } from "./ci-laeufe.mjs";
import { ladeLaeufe, laufAus, mitVorlauf, ticketsMitStartImFenster } from "./subagent-laeufe.mjs";
import { ticketNamen } from "./ticket-namen.mjs";
import { projektOrdner } from "./transkript.mjs";

export const NACHARBEIT_TAGE = 14;
/** `git log --since` filtert nach Commit-Datum, `mergedAt` kann eine Sekunde später liegen: Puffer vor `von` (Zuordnung läuft über die SHA, Zeitfilter macht `nacharbeitVon`). */
const SINCE_PUFFER_MS = 60 * 60_000;
const TAG_MS = 24 * 3600 * 1000;
const PR_LIMIT = 1000;
/** PRs je GraphQL-Abfrage (Aliase): hält die Abfrage klein und die Zahl der Aufrufe bei ⌈N/50⌉. */
const GRAPHQL_BLOCK = 50;
/** Label-Events je PR, die EINE Abfrage liefert (`first:`); mehr ist abgeschnitten und damit ein Datenfehler. */
const LABEL_EVENTS_JE_PR = 100;

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

/** Anzahl distinct Head-SHAs roter CI-Läufe zwischen PR-Erstellung und Merge (Zählung: ci-laeufe.mjs). Pure. */
export function ciFixRunden(laeufe, createdAt, mergedAt) {
  return distinctRoteShas(laeufe, { von: createdAt, bis: mergedAt }).length;
}

/** GraphQL-Abfrage der LABELED_EVENTs für einen Block PR-Nummern (ein Alias `p<nr>` je PR). Pure. */
export function labelAbfrage(nummern) {
  const je = nummern
    .map((n) => `p${n}: pullRequest(number: ${n}) { timelineItems(itemTypes: [LABELED_EVENT], first: ${LABEL_EVENTS_JE_PR}) { pageInfo { hasNextPage } nodes { ... on LabeledEvent { createdAt label { name } } } } }`)
    .join(" ");
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${je} } }`;
}

/**
 * Anzahl der Label-Events mit dem Namen `label` (Config: `labels.festgefahren`) je PR-Nummer aus der GraphQL-Antwort. Wirft DatenFehler, wenn ein PR
 * fehlt oder seine Label-Events über die erste Seite (`LABEL_EVENTS_JE_PR`) hinausgehen. `totalCount` taugt dafür nicht:
 * GitHub zählt damit ALLE Timeline-Einträge des PRs (gemessen 2026-10-07: totalCount 19 bei null Label-Events), nur
 * `nodes` und `pageInfo` folgen dem `itemTypes`-Filter. Pure.
 */
export function festgefahrenAusAntwort(antwort, nummern, label) {
  if (typeof label !== "string" || label === "") throw new Error("festgefahrenAusAntwort braucht den Label-Namen (labels.festgefahren der Projekt-Config)");
  const repo = antwort?.data?.repository;
  if (!repo) throw new DatenFehler("GraphQL-Antwort ohne data.repository.");
  const out = {};
  for (const n of nummern) {
    const items = repo[`p${n}`]?.timelineItems;
    if (!items) throw new DatenFehler(`GraphQL: PR #${n} ohne Label-Events in der Antwort.`);
    if (items.pageInfo?.hasNextPage !== false) throw new DatenFehler(`PR #${n}: mehr als ${LABEL_EVENTS_JE_PR} Label-Events (oder pageInfo fehlt): abgeschnitten.`);
    out[n] = (items.nodes ?? []).filter((e) => e?.label?.name === label).length;
  }
  return out;
}

/** Abnahme eines PRs aus dem Merge-Body: `"override"` (hat Vorrang, wie im Gate; ein Widerruf hebt ihn auf), `{durchgaenge}` bei gültigem Urteil, `"entfaellt"`, sonst `null` (keine oder ungültige Zeile). Pure. */
export function abnahmeVon(body, abnahme, zeilen) {
  if (aktiverOverride(body, zeilen.abnahmeOverride) !== null) return "override";
  if (abnahme?.art === "urteil") return { durchgaenge: abnahme.durchgaenge };
  if (abnahme?.art === "entfaellt") return "entfaellt";
  return null;
}

/** Bewertet die PRs; `ci`/`festgefahren` sind je PR-Nummer vorab geholt, `konfigZeilen` sind die Commit-Zeilen der Projekt-Config (`commitZeilen`). Pure. Liefert Zeilen und Kennzahlen. */
export function bewertePrs({ prs, commits, ci, festgefahren, jetzt, konfigZeilen, offenMitFix = 0 }) {
  const eintraege = prs.map((pr) => {
    const mergeSha = pr.mergeCommit?.oid ?? "";
    const commit = commits.find((c) => c.sha === mergeSha);
    const ticket = ticketVon(pr);
    const body = commit?.body ?? "";
    const { review, abnahme } = parseNachweis(body, konfigZeilen);
    return {
      pr: pr.number,
      ticket,
      gemergt: pr.mergedAt,
      runden: review && Number.isInteger(review.runden) ? review.runden : null,
      blocker: review?.blocker ?? null,
      abnahme: abnahmeVon(body, abnahme, konfigZeilen),
      ciFix: ciFixRunden(ci[pr.number] ?? [], pr.createdAt, pr.mergedAt),
      festgefahren: festgefahren[pr.number] ?? 0,
      nacharbeit: nacharbeitVon({ pr: pr.number, ticket, mergeSha, mergedAt: pr.mergedAt, commits, jetzt }),
    };
  });
  const mitNachweis = eintraege.filter((z) => z.runden !== null);
  const brillen = {};
  for (const z of mitNachweis) {
    for (const b of z.blocker ?? []) {
      const e = (brillen[b.lens] ??= { prs: 0, treffer: 0, summe: 0 });
      e.prs += 1;
      if (b.n > 0) e.treffer += 1;
      e.summe += Number.isFinite(b.n) ? b.n : 0;
    }
  }
  // Blocker je PR der Brille (Σ Blocker / PRs; #1441): die Zahl, an der die Wirkung der Selbstprüfung vor dem Commit gemessen wird.
  for (const e of Object.values(brillen)) e.jePr = e.prs > 0 ? e.summe / e.prs : null;
  const zaehle = (art) => eintraege.filter((z) => z.nacharbeit === art).length;
  const abgelaufen = eintraege.filter((z) => z.nacharbeit !== "offen");
  return {
    zeilen: eintraege,
    kennzahlen: {
      prs: eintraege.length,
      ohneNachweis: eintraege.length - mitNachweis.length,
      ohneBlockerFeld: mitNachweis.filter((z) => z.blocker === null).length,
      // Echte Zählung (#1609): PRs mit `blocker=`-Feld, in denen eine Brille in Runde 1 mindestens einen Blocker hatte; der Proxy (Runden ≥ 2) bleibt zum Vergleich.
      runde1MitBlocker: mitNachweis.filter((z) => z.blocker?.some((b) => b.n > 0)).length,
      mitBlockerFeld: mitNachweis.filter((z) => z.blocker !== null).length,
      runde1MitBlockerProxy: mitNachweis.filter((z) => z.runden >= 2).length,
      mitNachweis: mitNachweis.length,
      brillen,
      ohneNacharbeit: zaehle("nein"),
      nachweisbareFenster: abgelaufen.length,
      nacharbeitOffen: zaehle("offen"),
      ciFixSumme: eintraege.reduce((a, z) => a + z.ciFix, 0),
      festgefahrenSumme: eintraege.reduce((a, z) => a + z.festgefahren, 0),
      // Abnahme (ADR 0022 F13): gemessen = PRs mit gültigem Urteil, davon im ersten Durchgang; entfällt/override zählen nicht in die Quote, ohne = keine oder ungültige Zeile.
      abnahme: {
        gemessen: eintraege.filter((z) => typeof z.abnahme === "object" && z.abnahme !== null).length,
        ersterDurchgang: eintraege.filter((z) => z.abnahme?.durchgaenge === 1).length,
        entfaellt: eintraege.filter((z) => z.abnahme === "entfaellt").length,
        override: eintraege.filter((z) => z.abnahme === "override").length,
        ohne: eintraege.filter((z) => z.abnahme === null).length,
      },
      // Abnahme-Fix (#1808): PRs mit mehr als einem Abnahme-Durchgang (der Fix nach Urteil `fix`), davon mit Festgefahren-Label (Hand-off).
      // `mitFix` zählt nur gemergte PRs; der offene Hand-off-PR steht getrennt in `offenMitFix` (nie in `mitFix` addiert).
      abnahmeFix: {
        mitFix: eintraege.filter((z) => z.abnahme?.durchgaenge >= 2).length,
        mitFixUndFestgefahren: eintraege.filter((z) => z.abnahme?.durchgaenge >= 2 && z.festgefahren > 0).length,
        offenMitFix,
      },
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
  out.push("", `PRs: ${k.prs} (ohne Review-Nachweis: ${k.ohneNachweis}, ohne blocker-Feld: ${k.ohneBlockerFeld})`);
  out.push(`Runde 1 mit Blocker (aus blocker=): ${prozent(k.runde1MitBlocker, k.mitBlockerFeld)}; Proxy Runden ≥ 2: ${prozent(k.runde1MitBlockerProxy, k.mitNachweis)}`);
  for (const [lens, e] of Object.entries(k.brillen)) out.push(`Lens-Trefferquote ${lens}: ${prozent(e.treffer, e.prs)}, Σ Blocker ${e.summe} (${e.jePr === null ? "–" : e.jePr.toFixed(2).replace(".", ",")} je PR)`);
  out.push(`Ohne Nacharbeit (${NACHARBEIT_TAGE} T): ${prozent(k.ohneNacharbeit, k.nachweisbareFenster)}, Fenster noch offen: ${k.nacharbeitOffen}`);
  const a = k.abnahme;
  out.push(`Abnahme im ersten Durchgang: ${prozent(a.ersterDurchgang, a.gemessen)}; entfällt ${a.entfaellt}, Override ${a.override}, ohne gültige Abnahme-Zeile ${a.ohne}`);
  out.push(`Abnahme-Fix: ${k.abnahmeFix.mitFix} PRs, davon mit Hand-off: ${prozent(k.abnahmeFix.mitFixUndFestgefahren, k.abnahmeFix.mitFix)}; offen (Hand-off, nicht gemergt): ${k.abnahmeFix.offenMitFix}`);
  out.push(`Σ CI-Fix-Runden: ${k.ciFixSumme}, Σ festgefahren: ${k.festgefahrenSumme}`);
  return out.join("\n");
}

/** Commit-Zeilen, Festgefahren-Label und Besitzer (`repo` = owner/name) aus der Projekt-Config (`ladeConfig`, Standard: die echte); wirft mit der Meldung des Laders. */
function konfigurationAus(ladeConfig) {
  const config = ladeConfig();
  const owner = config?.repo === undefined ? undefined : repoOwner(config);
  return { zeilen: commitZeilenAus(config), label: labelAus(config, "festgefahren"), owner, config };
}

/**
 * Offene PRs mit Festgefahren-Label (Hand-off), erstellt im Fenster, im Ticketfilter, mit höchstem gültigem Abnahme-Durchgang ≥ 2 (#1814):
 * der Hand-off-PR, den `abnahmeFix.mitFix` als nie gemergter PR nicht sieht. Jeder gh-Fehler und jede unlesbare Antwort ist ein DatenFehler (keine stille 0).
 */
function zaehleOffeneMitFix({ gh, label, von, bis, tickets, ohne, zeilen, owner }) {
  const json = (args) => {
    try {
      return JSON.parse(gh(args));
    } catch (e) {
      throw e instanceof DatenFehler ? e : new DatenFehler(`gh ${args.slice(0, 2).join(" ")}: Antwort ist kein JSON.`);
    }
  };
  const liste = json(["pr", "list", "--state", "open", "--base", "main", "--label", label, "--limit", String(PR_LIMIT), "--json", "number,title,createdAt,closingIssuesReferences"]);
  if (!Array.isArray(liste)) throw new DatenFehler("Liste offener PRs: Antwort ist keine Liste.");
  if (liste.length >= PR_LIMIT) throw new DatenFehler(`Liste offener PRs bei ${PR_LIMIT} abgeschnitten.`);
  const t0 = new Date(von).getTime();
  const t1 = new Date(bis).getTime();
  const imFenster = liste
    .filter((p) => new Date(p.createdAt).getTime() >= t0 && new Date(p.createdAt).getTime() <= t1)
    .filter((p) => passtTicketFilter(ticketVon(p), { tickets, ohne }));
  if (imFenster.length > 0 && !owner) throw new DatenFehler("Besitzer des Repos unbekannt (repo der Projekt-Config): vertraute Abnahme-Marker nicht prüfbar.");
  return imFenster.filter((p) => hoechsterAbnahmeDurchgang(issueKommentare(p.number, json), owner, zeilen) >= 2).length;
}

/** Holt die Daten über `runGit`/`runGh` (injizierbar) und bewertet. Wirft DatenFehler bei Lücken. */
export function laufErgebnis({ von, bis, runGit, runGh, jetzt = new Date(), tickets = [], ohne = [], ladeConfig = ladeProjektConfig, owner: ownerArg }) {
  const { zeilen, label, owner: ownerConfig } = konfigurationAus(ladeConfig);
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
  // Ticketfilter (wie kontext-treiber): `tickets` = nur diese, `ohne` = alle außer diesen; vor den weiteren gh-Aufrufen, damit sie nur die Teilmenge laden.
  const prs = liste
    .filter((p) => new Date(p.mergedAt).getTime() >= t0 && new Date(p.mergedAt).getTime() <= t1)
    .filter((p) => passtTicketFilter(ticketVon(p), { tickets, ohne }))
    .sort((a, b) => a.number - b.number);
  let commits;
  try {
    commits = parseCommits(runGit(["log", "origin/main", `--since=${new Date(t0 - SINCE_PUFFER_MS).toISOString()}`, "--format=%H%x1f%cI%x1f%B%x1e"]));
  } catch (e) {
    throw new DatenFehler(`git log origin/main fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
  const fehlend = prs.filter((p) => !commits.some((c) => c.sha === p.mergeCommit?.oid));
  if (fehlend.length > 0) throw new DatenFehler(`Merge-Commit lokal unbekannt (PR ${fehlend.map((p) => `#${p.number}`).join(", ")}): erst \`git fetch origin\`.`);
  // Konstante Zahl gh-Aufrufe statt zwei je PR: EINE paginierte Abfrage roter Läufe ab dem frühesten PR-Datum (nach
  // Branch gruppiert) plus ein GraphQL-Aufruf je 50 PRs für die Label-Events.
  const ci = {};
  let festgefahren = {};
  if (prs.length > 0) {
    const seit = prs.map((p) => p.createdAt).sort()[0];
    let laeufe;
    try {
      laeufe = holeRoteLaeufe(gh, { seit });
    } catch (e) {
      throw e instanceof DatenFehler ? e : new DatenFehler(e instanceof Error ? e.message : String(e));
    }
    const jeBranch = new Map();
    for (const l of laeufe) jeBranch.set(l.branch, [...(jeBranch.get(l.branch) ?? []), l]);
    for (const p of prs) ci[p.number] = jeBranch.get(p.headRefName) ?? [];
    for (let i = 0; i < prs.length; i += GRAPHQL_BLOCK) {
      const nummern = prs.slice(i, i + GRAPHQL_BLOCK).map((p) => p.number);
      const antwort = gh(["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${labelAbfrage(nummern)}`]);
      let json;
      try {
        json = JSON.parse(antwort);
      } catch {
        throw new DatenFehler("GraphQL-Antwort ist kein JSON.");
      }
      festgefahren = { ...festgefahren, ...festgefahrenAusAntwort(json, nummern, label) };
    }
  }
  const offenMitFix = zaehleOffeneMitFix({ gh, label, von, bis, tickets, ohne, zeilen, owner: ownerArg ?? ownerConfig });
  return bewertePrs({ prs, commits, ci, festgefahren, jetzt, konfigZeilen: zeilen, offenMitFix });
}

/**
 * Wie `laufErgebnis`, aber die PR-Menge sind die Tickets mit erstem Lauf im Fenster (#1646). `laeufe` = geladene Transkripte `{ meta, zeilen }`.
 * Eine leere Menge ergibt 0 PRs (leere `tickets` hießen im Filter „alle“) und braucht keinen gh-Aufruf.
 */
export function laufErgebnisStartAgent({ laeufe, von, bis, ohne = [], jetzt = new Date(), ladeConfig = ladeProjektConfig, ...io }) {
  const { zeilen, config } = konfigurationAus(ladeConfig);
  const namen = ticketNamen(config);
  const tickets = ticketsMitStartImFenster(laeufe.map((l) => laufAus(l, namen)).filter(Boolean), { von, bis });
  if (tickets.length === 0) return bewertePrs({ prs: [], commits: [], ci: {}, festgefahren: {}, jetzt, konfigZeilen: zeilen });
  return laufErgebnis({ von, bis, jetzt, tickets, ohne, ladeConfig, ...io });
}

/** Lädt die Läufe des Typs ab `von` minus Vorlauf; fehlender Ordner oder kein einziger Lauf des Typs ist ein `DatenFehler` (fail-closed). */
export function ladeStartLaeufe(dir, agent, von) {
  if (!existsSync(dir)) throw new DatenFehler("Keine lokalen Transkripte (Projektordner fehlt).");
  let laeufe;
  try {
    laeufe = ladeLaeufe(dir, agent, mitVorlauf(von));
  } catch (e) {
    throw new DatenFehler(`Transkripte nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (laeufe.length === 0) throw new DatenFehler(`Keine Transkripte des Typs ${agent} gefunden.`);
  return laeufe;
}

export const AUFRUFHILFE = "Aufruf: node scripts/lauf-ergebnis.mjs --von <ISO> --bis <ISO> [--ticket <nr>…] [--ohne <nr>…] [--start-agent <typ>] [--json]";

/** Argumente: `--von`, `--bis`, wiederholbar `--ticket <nr>` (nur diese) und `--ohne <nr>` (alle außer diesen), `--json`. `--start-agent <typ>` (kein Default, nicht mit `--ticket`). Eine Nicht-Ganzzahl oder ein fehlender Wert setzt `fehler`. */
export function parseArgs(argv) {
  const optionen = { von: { type: "string" }, bis: { type: "string" }, ...TICKET_OPTIONEN, "start-agent": { type: "string" }, json: { type: "boolean" } };
  const meldung = (art, flag) => (art === "ohne-wert" && flag === "--start-agent" ? "--start-agent erwartet einen Agent-Typ" : ticketMeldung(art, flag));
  const { werte, fehler } = flagsLesen(argv, optionen, { meldung });
  const { tickets, ohne, fehler: ticketFehler } = ticketFilterAus(werte);
  const a = { von: werte.von, bis: werte.bis, tickets, ohne, json: werte.json === true, fehler: fehler?.text ?? ticketFehler };
  if (werte["start-agent"] !== undefined) a.startAgent = werte["start-agent"];
  if (a.startAgent === "") a.fehler ??= "--start-agent erwartet einen Agent-Typ";
  if (a.startAgent !== undefined && a.tickets.length > 0) a.fehler ??= "--start-agent und --ticket schließen sich aus";
  return a;
}

function main(argv) {
  const { von, bis, tickets, ohne, json, fehler, startAgent } = parseArgs(argv);
  if (fehler || !von || !bis || [von, bis].some((d) => Number.isNaN(new Date(d).getTime()))) {
    console.error(fehler ? [fehler, AUFRUFHILFE].join("\n") : AUFRUFHILFE);
    process.exit(1);
  }
  try {
    const run = (cmd) => (args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const io = { von, bis, runGit: run("git"), runGh: ghText, ohne };
    const ergebnis = startAgent === undefined ? laufErgebnis({ ...io, tickets }) : laufErgebnisStartAgent({ ...io, laeufe: ladeStartLaeufe(projektOrdner(), startAgent, von) });
    console.log(json ? JSON.stringify(ergebnis, null, 2) : formatiere(ergebnis));
  } catch (e) {
    console.error(`✖ lauf-ergebnis: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

if (istDirektaufruf(import.meta.url)) main(process.argv.slice(2));
