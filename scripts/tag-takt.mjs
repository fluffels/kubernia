#!/usr/bin/env node
/**
 * Tag-Takt (#103): Besitz-Änderungen im Factory-Repo erreichen die Bezieher zeitnah. Je Push auf main und wöchentlich zählt dieses Skript die
 * Besitz-PRs seit dem letzten Release-Tag (Form `v1.2.3` aus release-tag-lib.mjs, #90) und das Alter der ältesten ungetaggten Änderung.
 *  - Besitz-PR: ein Commit auf main (erster Elternteil), der einen verteilten Pfad aus `.factory/besitz.json` (Ring `oberflaeche` zählt nicht) oder das
 *    Manifest selbst berührt. Bewusste Grenze: Pfad-Ebene, nicht Block- oder Schlüssel-Ebene; das zählt eher zu viel als zu wenig.
 *  - Ab 3 Besitz-PRs, einem ältesten Commit über 7 Tage oder einer Commit-Zeile `<praefixe.commitZeile>Sync-Dringlich: <grund>` in einem Besitz-Commit
 *    hält das Skript GENAU EIN Kopf-Ticket „🏷️ Tag v<x> setzen und syncen“ (Board-Spitze, Art `tag`) mit Tag-Vorschlag, PRs, CI-Status des
 *    main-Commits, fertigem Befehl und der Checkliste („Trockenlauf-Sync in einem Bezieher“, „CI des Sync-PR je Bezieher grün“). Ein offenes Ticket wird nie verdoppelt, sondern bei
 *    Änderung aktualisiert (geclaimt: unberührt) und geschlossen, sobald nichts Ungetaggtes mehr da ist.
 *  - Taggen bleibt Pre-Flight („ja, taggen“, Veröffentlichen); danach setzt der Agent den Tag und erstellt je Bezieher den Sync-PR.
 *  - Grenze: ein Trockenlauf im Bezieher in CI bräuchte ein Cross-Repo-Token (Secret = Pre-Flight); ohne ihn bleibt die Checkliste.
 * Bekannte Grenze: der Titel-Marker `🏷️ Tag ` ist breit; ein von Hand angelegtes, vertrauenswürdiges Issue mit diesem Titelanfang zählt als Tag-Ticket (das Emoji-Präfix ist diesem Takt vorbehalten).
 * In einem Bezieher (es gibt `.factory/sync-stand.json`) tut das Skript nichts. Ohne Release-Tag ebenfalls nichts.
 *
 * Aufruf: node scripts/tag-takt.mjs [--dry-run]   (Workflow: .github/workflows/board-takt.yml)
 * Die Funktionen oben sind pur und getestet (test/tag-takt.test.ts); die Aufrufe von git und gh unten nicht.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { wirdVerteilt } from "./besitz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { liesSyncStand } from "./factory-sync-lib.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { inboxStart, vertrauterOwner, zielZugang } from "./inbox-start-lib.mjs";
import { zeilenRe } from "./nachweis-lib.mjs";
import { labelAus } from "./projekt-config-lib.mjs";
import { teile, vergleicheTags } from "./release-tag-lib.mjs";
import { commitZeilenAus } from "./slice-override.mjs";

export const TAG_MARKER = "🏷️ Tag ";
export const MIN_PRS = 3;
export const MAX_ALTER_TAGE = 7;
const MAX_ZEILEN = 50;
const TAG_MS = 86_400_000;
const MANIFEST = ".factory/besitz.json";
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** Titel des Tag-Tickets. Pur. */
export const tagTitel = (tag) => `🏷️ Tag ${tag} setzen und syncen`;

/** Zelle für die Liste: nur sichtbarer Text, ohne `|`, Backticks und Zeilenumbrüche, höchstens 120 Zeichen. Pur. */
const zelle = (x) =>
  String(x ?? "")
    .replace(/[|`\r\n]+/g, " ")
    .trim()
    .slice(0, 120) || "-";

/** Pur: Commits aus `git log --first-parent --format=%x1e%H%x1f%cI%x1f%B%x1f --name-only` als `{ sha, datum, betreff, body, dateien[] }`. */
export function commitsAusLog(text) {
  return String(text)
    .split("\x1e")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const [sha, datum, body = "", dateien = ""] = c.split("\x1f");
      return {
        sha: sha.trim(),
        datum: datum.trim(),
        betreff: body.split(/\r?\n/)[0].trim(),
        body: body.replace(/\r/g, ""),
        dateien: dateien.split(/\r?\n/).map((d) => d.trim()).filter(Boolean),
      };
    });
}

/** Pur: die Besitz-Commits (Pfad-Ebene) mit `pr` = letztes `(#N)` im Betreff, sonst die Kurz-SHA. `manifest` = `{ eintraege: [{ pfad, ring }] }`. */
export function besitzCommits(commits, manifest) {
  const pfade = [...(manifest?.eintraege ?? []).filter(wirdVerteilt).map((e) => e.pfad), MANIFEST];
  const beruehrt = (datei) => pfade.some((p) => datei === p || datei.startsWith(`${p}/`));
  return commits
    .filter((c) => c.dateien.some(beruehrt))
    .map((c) => {
      const nr = [...c.betreff.matchAll(/\(#(\d+)\)/g)].pop()?.[1];
      return { ...c, pr: nr ? `#${nr}` : c.sha.slice(0, 7) };
    });
}

/** Pur: der vorgeschlagene nächste Tag nach Conventional Commits (`!` oder `BREAKING CHANGE:` Major, `feat` Minor, sonst Patch); `v` bleibt erhalten. */
export function naechsterTag(letzterTag, commits) {
  const [major, minor, patch] = teile(letzterTag);
  const breaking = (c) => /^[a-z]+(\([^)]*\))?!:/.test(c.betreff) || /^(?:\* )?BREAKING[ -]CHANGE:/m.test(c.body);
  const feature = (c) => /^feat(\([^)]*\))?:/.test(c.betreff);
  const stufe = [major + 1, 0, 0];
  const neu = commits.some(breaking) ? stufe : commits.some(feature) ? [major, minor + 1, 0] : [major, minor, patch + 1];
  return `${letzterTag.startsWith("v") ? "v" : ""}${neu.join(".")}`;
}

/** Pur: das Dringlich-Signal (`{ grund, sha }` der ersten Zeile `<dringlichKey>: <grund>` mit nicht leerem Grund) in den Besitz-Commits oder `null`. */
export function dringlichSignal(besitz, dringlichKey) {
  for (const c of besitz) {
    const treffer = [...c.body.matchAll(zeilenRe(dringlichKey))].find((m) => m[2].trim() !== "");
    if (treffer) return { grund: treffer[2].trim(), sha: c.sha };
  }
  return null;
}

/** Pur: das Alter der ältesten Änderung in ganzen Tagen (Kommazahl) oder `null`; `datum` ISO. */
const alterTage = (besitz, jetzt) => (besitz.length === 0 ? null : (jetzt.getTime() - Math.min(...besitz.map((c) => Date.parse(c.datum)))) / TAG_MS);

/**
 * Pur: die Entscheidung des Takts. `offene` = vertraute offene Issues `[{ number, titel, assignees }]`; Rückgabe `{ aktion, grund, warnungen, nummer?, ausloeser? }`
 * mit `aktion` `anlegen | aktualisieren | schliessen | nichts`. Ohne Release-Tag nichts; ein geclaimtes Ticket bleibt unberührt.
 */
export function entscheideTagTakt({ letzterTag, besitz, jetzt, offene, dringlichKey }) {
  const warnungen = [];
  const tagOffene = offene.filter((i) => i.titel.startsWith(TAG_MARKER)).sort((a, b) => a.number - b.number);
  if (tagOffene.length > 1) warnungen.push(`Mehrere offene Tag-Tickets (${tagOffene.map((i) => `#${i.number}`).join(", ")}): das älteste gilt, keines wird geschlossen.`);
  if (!letzterTag) return { aktion: "nichts", grund: "kein Release-Tag in der Historie", warnungen };
  const offen = tagOffene[0];
  if (offen) {
    if (offen.assignees.length > 0) return { aktion: "nichts", grund: `Ticket #${offen.number} ist geclaimt`, warnungen };
    if (besitz.length === 0) {
      if (tagOffene.length > 1) return { aktion: "nichts", grund: "nichts Ungetaggtes, aber mehrere offene Tickets (keine Selbst-Schließung)", warnungen };
      return { aktion: "schliessen", nummer: offen.number, grund: "keine ungetaggten Besitz-PRs mehr", warnungen };
    }
    return { aktion: "aktualisieren", nummer: offen.number, grund: `offenes Ticket #${offen.number}`, warnungen };
  }
  const tage = alterTage(besitz, jetzt);
  const dringlich = dringlichSignal(besitz, dringlichKey);
  const ausloeser = [];
  if (besitz.length >= MIN_PRS) ausloeser.push(`${besitz.length} Besitz-PRs seit ${letzterTag} (ab ${MIN_PRS})`);
  if (tage !== null && tage > MAX_ALTER_TAGE) ausloeser.push(`älteste ungetaggte Änderung über ${MAX_ALTER_TAGE} Tage alt`);
  if (dringlich) ausloeser.push(`Dringlich: ${zelle(dringlich.grund)} (${dringlich.sha.slice(0, 7)})`);
  if (ausloeser.length === 0) return { aktion: "nichts", grund: `${besitz.length} Besitz-PRs, jünger als ${MAX_ALTER_TAGE} Tage, kein Dringlich-Signal`, warnungen };
  return { aktion: "anlegen", grund: ausloeser.join("; "), ausloeser, warnungen };
}

/**
 * Zweitabfrage vor dem Anlegen (fail-closed): die REST-Liste hinkt bei frischen Tickets nach. `zweit()` liefert `[{ number, titel }]`; kennt es ein offenes
 * Tag-Ticket oder wirft es, wird aus `anlegen` ein `nichts` mit Warnung. Jede andere Aktion bleibt unberührt. Pur.
 */
export function bestaetigeTagAnlegen(e, { zweit }) {
  if (e.aktion !== "anlegen") return e;
  let da;
  try {
    const frisch = zweit();
    da = frisch.filter((i) => String(i?.titel).startsWith(TAG_MARKER)).map((i) => `#${i.number}`);
  } catch (err) {
    return { aktion: "nichts", grund: "Anlegen abgebrochen: Zweitabfrage fehlgeschlagen (fail-closed, der nächste Lauf versucht es erneut)", warnungen: [...e.warnungen, `Zweitabfrage vor dem Anlegen fehlgeschlagen: ${fehlerText(err)}`] };
  }
  if (da.length === 0) return e;
  return { aktion: "nichts", grund: `Anlegen abgebrochen: die REST-Liste kannte ${da.join(", ")} noch nicht (frisch angelegt)`, warnungen: [...e.warnungen, `REST-Liste hinkt: offenes Tag-Ticket ${da.join(", ")} nur per Zweitabfrage gefunden.`] };
}

/** Pur: CI-Zustand des main-Commits aus den Workflow-Läufen (`[{ path, status, conclusion, html_url }]`, neueste zuerst) als `{ zustand: gruen|rot|laeuft|unbekannt, url }`. */
export function ciZustand(laeufe) {
  const lauf = (Array.isArray(laeufe) ? laeufe : []).find((r) => r?.path === CI_WORKFLOW);
  if (!lauf) return { zustand: "unbekannt", url: null };
  const url = typeof lauf.html_url === "string" ? lauf.html_url : null;
  if (lauf.status !== "completed") return { zustand: "laeuft", url };
  return { zustand: lauf.conclusion === "success" ? "gruen" : "rot", url };
}

const CI_TEXT = { gruen: "grün", rot: "ROT", laeuft: "läuft noch", unbekannt: "unbekannt" };

/** Pur: Body des Tag-Tickets. `prs` = `besitzCommits`, `aeltestes` = `{ datum, sha }`, `ci` = `ciZustand`. */
export function tagBody({ tag, letzterTag, sha, prs, aeltestes, ausloeser, ci }) {
  const zeilen = prs.slice(0, MAX_ZEILEN).map((c) => `- ${c.pr} ${zelle(c.betreff)} (${c.datum.slice(0, 10)})`);
  if (prs.length > MAX_ZEILEN) zeilen.push(`- … und ${prs.length - MAX_ZEILEN} weitere`);
  return [
    `Besitz-Änderungen liegen ungetaggt auf main. Auslöser: ${ausloeser.join("; ")}.`,
    "",
    `- Vorgeschlagener Tag: \`${tag}\` (Basis ${letzterTag}, Vorschlag nach Conventional Commits)`,
    `- Älteste ungetaggte Änderung: ${aeltestes.datum.slice(0, 10)} (${aeltestes.sha.slice(0, 7)})`,
    `- main-Commit: \`${sha}\``,
    `- CI-Status dieses Commits: ${CI_TEXT[ci.zustand] ?? CI_TEXT.unbekannt}${ci.url ? ` ([Lauf](${ci.url}))` : ""}`,
    "",
    `Besitz-PRs seit ${letzterTag} (${prs.length}):`,
    ...zeilen,
    "",
    "Befehl (erst nach „ja, taggen“; CI des Commits vorher grün):",
    "",
    "```",
    "git fetch origin --tags",
    `gh run list --commit ${sha} --workflow ci.yml`,
    `git tag -a ${tag} ${sha} -m "${tag}"`,
    `git push origin ${tag}`,
    "```",
    "",
    "Checkliste:",
    "- [ ] Trockenlauf-Sync in einem Bezieher: `node scripts/factory-sync.mjs --quelle <checkout auf " + sha.slice(0, 7) + "> --entwurf --trocken` (Pfade der Bezieher: `node scripts/arbeitsplatz.mjs pfade`)",
    "- [ ] Pre-Flight „ja, taggen“ (Veröffentlichen) bei der Maintainerin einholen",
    `- [ ] Tag \`${tag}\` setzen (Befehl oben)`,
    `- [ ] Sync-PR je Bezieher mit \`--tag ${tag}\` (dort das Ticket „🔄 Factory-Update“, anstoßen per \`gh workflow run factory-update.yml --repo <bezieher>\`)`,
    "- [ ] CI des Sync-PR je Bezieher grün (der Trockenlauf listet nur Dateiänderungen; check:docdrift und die Wächter-Tests des Beziehers laufen erst dort; rot: Folge-Fix in der Factory und Patch-Tag)",
    "- [ ] Ticket schließen, sobald der Tag steht und die Sync-PRs grün sind (ein geclaimtes Ticket schließt der Takt nicht selbst; ohne Assignee schließt er es beim nächsten Lauf)",
    "",
    "Grenze: ein Trockenlauf im Bezieher in CI bräuchte ein Cross-Repo-Token (Secret anlegen ist Pre-Flight); ohne ihn bleibt die Checkliste. Vorschau dieses Takts: `node scripts/tag-takt.mjs --dry-run`. Mechanik: docs/agent-harness.md › Tag-Takt (#103).",
  ].join("\n");
}

const KOMMENTAR_ERLEDIGT = "Keine ungetaggten Besitz-PRs mehr (Tag gesetzt), automatisch geschlossen.";

/** Liest alles Nötige; wirft bei einem Git-Fehler. `io.liesCi` darf werfen (dann `unbekannt`). */
function sammle(io, log) {
  const letzterTag = vergleicheTags(io.tags());
  const commits = letzterTag ? commitsAusLog(io.ladeLog(letzterTag)) : [];
  const besitz = besitzCommits(commits, io.ladeManifest());
  const sha = io.headSha();
  let ci = { zustand: "unbekannt", url: null };
  try {
    ci = ciZustand(io.ladeLaeufe(sha));
  } catch (err) {
    log(`CI-Status nicht lesbar (${fehlerText(err)}), im Ticket steht „unbekannt“.`);
  }
  return { letzterTag, besitz, sha, ci };
}

/** Führt die Aktion aus. Rückgabe: true bei Fehler. */
function fuehreAus(e, io, log) {
  try {
    if (e.aktion === "schliessen") {
      io.schliesse(e.nummer, KOMMENTAR_ERLEDIGT);
      log(`Tag-Ticket #${e.nummer} geschlossen.`);
      return false;
    }
    const { titel, body } = e.soll;
    if (e.aktion === "aktualisieren") {
      io.aktualisiere(e.nummer, titel, body);
      log(`Tag-Ticket #${e.nummer} aktualisiert (${titel}).`);
      return false;
    }
    const nr = io.legeIssueAn(titel, body);
    log(`Tag-Ticket angelegt: #${nr} (${titel})`);
    if (!io.projectToken) log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
    else if (!io.sortiereEin(nr, "tag")) {
      log(`::error::Einsortieren von #${nr} an die Board-Spitze fehlgeschlagen.`);
      return true;
    }
    return false;
  } catch (err) {
    log(`::error::Tag-Ticket (${e.aktion}) nicht geschrieben: ${fehlerText(err)}`);
    return true;
  }
}

/** Pur: Soll-Titel und Soll-Body des Tickets. */
function sollTicket(e, { letzterTag, besitz, sha, ci }) {
  const tag = naechsterTag(letzterTag, besitz);
  const aeltestes = besitz.reduce((a, c) => (Date.parse(c.datum) < Date.parse(a.datum) ? c : a));
  const ausloeser = e.ausloeser ?? [`${besitz.length} Besitz-PRs seit ${letzterTag}`];
  return { titel: tagTitel(tag), body: tagBody({ tag, letzterTag, sha, prs: besitz, aeltestes, ausloeser, ci }) };
}

/** Pur: stimmt das offene Ticket mit dem Soll überein? */
const istAktuell = (offen, soll) => offen?.titel === soll.titel && offen.body === soll.body;

/** Entscheidung samt Soll-Ticket (`soll` bei anlegen/aktualisieren); ein bereits aktuelles Ticket wird zu `nichts`. */
function plane({ io, daten, offene, trocken }) {
  let e = entscheideTagTakt({ letzterTag: daten.letzterTag, besitz: daten.besitz, jetzt: io.jetzt(), offene, dringlichKey: io.dringlichKey });
  if (e.aktion === "anlegen" && !trocken) e = bestaetigeTagAnlegen(e, { zweit: io.frischeOffene });
  if (e.aktion !== "anlegen" && e.aktion !== "aktualisieren") return e;
  const soll = sollTicket(e, daten);
  if (e.aktion === "aktualisieren" && istAktuell(offene.find((i) => i.number === e.nummer), soll)) return { ...e, aktion: "nichts", grund: "Ticket ist aktuell", soll };
  return { ...e, soll };
}

/** Ein Lauf. Exit 0 (auch „nichts zu tun“), 1 bei Lese- oder Schreibfehler. `io` siehe `main`; `trocken` schreibt nichts. */
export function lauf({ io, trocken = false }) {
  const log = io.log ?? console.log;
  if (io.istBezieher()) {
    log("Tag-Takt: Bezieher-Repo (Sync-Stand vorhanden), nichts zu tun.");
    return 0;
  }
  let daten;
  let offene;
  try {
    daten = sammle(io, log);
    offene = io.ladeOffene();
  } catch (err) {
    log(`::error::Tag-Takt: Lesen fehlgeschlagen: ${fehlerText(err)}`);
    return 1;
  }
  const e = plane({ io, daten, offene, trocken });
  for (const w of e.warnungen) log(`::warning::${w}`);
  log(`Tag-Takt: ${e.aktion}${e.nummer ? ` #${e.nummer}` : ""} (${e.grund})`);
  if (trocken) {
    if (e.soll) log([e.soll.titel, ...e.soll.body.split("\n")].map((z) => `[dry-run] ${z}`).join("\n"));
    return 0;
  }
  return e.aktion === "nichts" ? 0 : fuehreAus(e, io, log) ? 1 : 0;
}

// ---- IO (ungetestet) ----

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** Einstieg. `deps` (Tests): `start`, `gh`, `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { start = inboxStart, gh = { text: ghText, json: ghJson }, log = console.log, err = console.error } = {}) {
  const s = await start(argv, { skript: "tag-takt", praefix: "Tag-Takt: Projekt-Config nicht lesbar: ", log, err });
  if (s.code !== undefined) return s.code;
  const { config, libs } = s;
  const { REPO, ladeSammelKontext, vertrauteIssues, frischeOffeneIssues, platziereOben } = libs;
  const { ziel, zielOpt } = zielZugang(libs);
  const wurzel = process.cwd();
  const io = {
    log,
    istBezieher: () => liesSyncStand(wurzel).zustand !== "fehlt",
    tags: () => git(["tag", "--merged", "HEAD"]).split(/\r?\n/).map((t) => t.trim()).filter(Boolean),
    ladeLog: (tag) => git(["log", "--first-parent", "--format=%x1e%H%x1f%cI%x1f%B%x1f", "--name-only", `${tag}..HEAD`, "--"]),
    ladeManifest: () => JSON.parse(readFileSync(MANIFEST, "utf8")),
    headSha: () => git(["rev-parse", "HEAD"]).trim(),
    ladeLaeufe: (sha) => gh.json(["api", `repos/${REPO}/actions/runs?head_sha=${sha}&event=push&per_page=30`, "--jq", ".workflow_runs"]),
    ladeOffene: () => {
      const kontext = ladeSammelKontext({ ladeKommentare: () => [] });
      return vertrauteIssues(kontext.rohe, vertrauterOwner(kontext, libs))
        .filter((i) => i.title.startsWith(TAG_MARKER))
        .map((i) => ({ number: i.number, titel: i.title, assignees: (i.assignees ?? []).map((a) => a?.login).filter(Boolean), body: String(i.body ?? "") }));
    },
    frischeOffene: () => frischeOffeneIssues({ repo: ziel, anzahl: 50, mitBoard: false }, zielOpt),
    dringlichKey: commitZeilenAus(config).syncDringlich,
    jetzt: () => new Date(),
    projectToken: process.env.PROJECT_TOKEN,
    legeIssueAn: (titel, body) => {
      const label = labelAus(config, "harness");
      return gh.text(["issue", "create", "--repo", ziel, "--title", titel, ...(label ? ["--label", label] : []), "--body", body], zielOpt).trim().split("/").pop();
    },
    sortiereEin: (nr, art) => {
      try {
        platziereOben(nr, art, process.env.PROJECT_TOKEN, ziel === REPO ? undefined : ziel);
        return true;
      } catch {
        return false;
      }
    },
    aktualisiere: (nr, titel, body) => gh.text(["api", "-X", "PATCH", `repos/${ziel}/issues/${nr}`, "-f", `title=${titel}`, "-f", `body=${body}`], zielOpt),
    schliesse: (nr, kommentar) => gh.text(["issue", "close", String(nr), "--repo", ziel, "--reason", "completed", "--comment", kommentar], zielOpt),
  };
  return lauf({ io, trocken: s.trocken });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
