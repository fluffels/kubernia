#!/usr/bin/env node
/**
 * Tag-Takt (#103): Besitz-Änderungen im Factory-Repo erreichen die Bezieher zeitnah. Je Push auf main und wöchentlich zählt dieses Skript die
 * Besitz-PRs seit dem letzten Release-Tag (Form `v1.2.3` aus release-tag-lib.mjs, #90) und das Alter der ältesten ungetaggten Änderung.
 *  - Besitz-PR: ein Commit auf main (erster Elternteil), der einen verteilten Pfad aus `.factory/besitz.json` (Ring `oberflaeche` zählt nicht) oder das
 *    Manifest selbst berührt. Bewusste Grenze: Pfad-Ebene, nicht Block- oder Schlüssel-Ebene; das zählt eher zu viel als zu wenig.
 *  - Ab `MIN_PRS` Besitz-PRs, einem ältesten Commit über 7 Tage oder einer Commit-Zeile `<praefixe.commitZeile>Sync-Dringlich: <grund>` in einem Besitz-Commit
 *    hält das Skript GENAU EIN Kopf-Ticket „🏷️ Tag v<x> setzen und syncen“ (Board-Spitze, Art `tag`) mit Tag-Vorschlag, PRs, CI-Status des
 *    main-Commits, fertigem Befehl und der Checkliste („Trockenlauf gegen den Probe-Erstbezug“, „Bezieher holen das Update selbst“). Ein offenes Ticket wird nie verdoppelt, sondern bei
 *    Änderung aktualisiert (geclaimt: unberührt) und geschlossen, sobald nichts Ungetaggtes mehr da ist.
 *  - `MIN_PRS` = aufgerundeter Median der Besitz-PRs je Tag-Abstand, mindestens 3 (factory#162, Messung 2026-11-04 über v0.1.0..v0.8.0: 10 Abstände mit 1, 2, 7, 1, 1, 4, 4, 4, 0, 3 Besitz-PRs, Median 2,5 → 3;
 *    je 7 Tage kämen 22 PRs heraus, aber nur aus der Anlaufwoche mit zwei überlappenden Fenstern, das trägt keine Schwelle). Das Alters-Signal (7 Tage) und `Sync-Dringlich` bleiben; neu messen, wenn das Alters-Signal öfter auslöst als die Zahl.
 *  - Taggen bleibt Pre-Flight („ja, taggen“, Veröffentlichen); danach holen die Bezieher das Update selbst (`factory-update.yml`, ADR 0031).
 *  - Grenze: die Fabrik schreibt in kein Bezieher-Repo (ADR 0031); der Trockenlauf läuft gegen den Probe-Erstbezug (`test/fixtures/projekt-probe.json`, Export im Scratch).
 *  - Vor-Tag-Probe (factory#188): die Projekt-Config listet die Bezieher (`bezieher`, `owner/name`); die Checkliste verlangt je Bezieher einen LESENDEN Lauf im Scratch-Klon (Entwurfs-Vorschau, Sync mit lokalem Tag,
 *    `verify` nach den mechanischen Update-Schritten; nie Push, PR, Issue oder Kommentar; Fortschreibung zu ADR 0031). Rot durch Factory-Besitz oder fehlend heißt: nicht taggen. Kein Cross-Repo-CI (das bräuchte ein Secret): die Ergebnisse trägt der Mensch oder Agent mit `--probe` ein.
 *  - Milestones (factory#194): ein Milestone, der nach dem Erstellungsdatum des letzten Release-Tags geschlossen wurde, ist ein weiterer Auslöser („Milestone „<titel>“ geschlossen“), schon bei einem
 *    Besitz-PR (ohne ungetaggten Besitz-PR gibt es nichts zu taggen: `nichts` mit Grund). Gelesen über REST (`milestones?state=closed`) und `git for-each-ref` (`creatordate`); fail-open mit Warnung, ohne Milestones unverändert.
 *    Der Takt läuft dafür auch beim Ereignis `milestone: closed` (board-takt.yml).
 * Bekannte Grenze: der Titel-Marker `🏷️ Tag ` ist breit; ein von Hand angelegtes, vertrauenswürdiges Issue mit diesem Titelanfang zählt als Tag-Ticket (das Emoji-Präfix ist diesem Takt vorbehalten).
 * In einem Bezieher (es gibt `.factory/sync-stand.json`) tut das Skript nichts. Ohne Release-Tag ebenfalls nichts.
 *
 * Aufruf: node scripts/tag-takt.mjs [--dry-run]   (Workflow: .github/workflows/board-takt.yml)
 *         node scripts/tag-takt.mjs --probe <owner/name>=<exit>|rest …   (Checkliste der Vor-Tag-Probe, `rest` = Rot nur im Projekt des Beziehers: grün mit Befund, factory#215; Repo-Schreibweise egal (GitHub unterscheidet nicht), Ausgabe unter dem Namen der Config; Exit 0 = alle Bezieher grün, 1 = Blocker oder ausstehend, 2 = Aufruf-/Config-Fehler; kein gh-Aufruf)
 * Die Funktionen oben sind pur und getestet (test/tag-takt.test.ts); `main` läuft in test/tag-takt-main.test.ts über injizierte Nähte, die echten git-/gh-Aufrufe unten nicht.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_PFAD as MANIFEST, istGanzeDatei, manifestAusText, markerEnde, markerStart, wirdVerteilt } from "./besitz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { fehlerMeldung, fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { bestaetigeAnlegen, inboxStart, vertrauterOwner, zielAktionen, zielZugang } from "./inbox-start-lib.mjs";
import { zeilenRe } from "./nachweis-lib.mjs";
import { bezieherAus, labelAus, ladeProjektConfig, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { WERKZEUG_HINWEIS, mechanischeSchritte, teile, vergleicheTags } from "./release-tag-lib.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import { commitZeilenAus } from "./slice-override.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { geschlosseneMilestones, geschlossenSeit, titelBereinigt } from "./milestone-lib.mjs";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));

export const TAG_MARKER = "🏷️ Tag ";
export const MIN_PRS = 3;
export const MAX_ALTER_TAGE = 7;
const MAX_ZEILEN = 50;
const TAG_MS = 86_400_000;
const CI_WORKFLOW = ".github/workflows/ci.yml";
const SKRIPT_DATEI = /^scripts\/.*\.(?:mjs|cjs)$/;
const EXPORT_DEKLARATION = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LISTE = /^export\s*\{([^}]*)\}/gm;

/** Titel des Tag-Tickets. Pur. */
export const tagTitel = (tag) => `🏷️ Tag ${tag} setzen und syncen`;

/** Zelle für die Liste: nur sichtbarer Text, ohne `|`, Backticks und Zeilenumbrüche, höchstens 120 Zeichen. Pur. */
const zelle = (x) =>
  String(x ?? "")
    .replace(/[|`\r\n]+/g, " ")
    .trim()
    .slice(0, 120) || "-";

/** Pur: Commits aus `git log --first-parent --format=%x1e%H%x1f%cI%x1f%B%x1f --name-only --no-renames` als `{ sha, datum, betreff, body, dateien[] }`. */
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

/** Pur: die exportierten Namen eines ES-Moduls (`export const|let|var|function|async function|class NAME` und `export { a, b as c }`, bei `as` zählt der äußere Name) als Set. */
export function exporteAus(text) {
  const namen = new Set();
  const src = String(text ?? "");
  for (const m of src.matchAll(EXPORT_DEKLARATION)) namen.add(m[1]);
  for (const m of src.matchAll(EXPORT_LISTE)) {
    for (const teil of m[1].split(",")) {
      const name = teil.trim().split(/\s+as\s+/).pop();
      if (name) namen.add(name);
    }
  }
  return namen;
}

/** Pur: die Namen, die `altText` exportiert und `neuText` nicht mehr (`null` = Datei gelöscht: alle). Sortiert. */
export function entfernteExporte(altText, neuText) {
  const neu = exporteAus(neuText);
  return [...exporteAus(altText)].filter((n) => !neu.has(n)).sort();
}

/** Pur: die in den Besitz-Commits berührten Skript-Dateien (`scripts/**.mjs|cjs`), die ein verteilter Ganzdatei-Eintrag des Manifests abdeckt. Sortiert, ohne Doppelte. */
export function verteilteSkripte(besitz, manifest) {
  const pfade = (manifest?.eintraege ?? []).filter((e) => wirdVerteilt(e) && istGanzeDatei(e)).map((e) => e.pfad);
  const gedeckt = (d) => pfade.some((p) => d === p || d.startsWith(`${p}/`));
  return [...new Set(besitz.flatMap((c) => c.dateien).filter((d) => SKRIPT_DATEI.test(d) && gedeckt(d)))].sort();
}

/** Pur: der vorgeschlagene nächste Tag nach Conventional Commits (`!` oder `BREAKING CHANGE:` oder ein entfernter Export, `entfernt` = `[{ datei, namen }]`, Major; `feat` Minor, sonst Patch); unter v1 (0.y.z) hebt Breaking nur das Minor (SemVer §4), v1.0.0 setzt man bewusst; `v` bleibt erhalten. */
export function naechsterTag(letzterTag, commits, entfernt = []) {
  const [major, minor, patch] = teile(letzterTag);
  const breaking = (c) => /^[a-z]+(\([^)]*\))?!:/.test(c.betreff) || /^(?:\* )?BREAKING[ -]CHANGE:/m.test(c.body);
  const feature = (c) => /^feat(\([^)]*\))?:/.test(c.betreff);
  const stufe = major === 0 ? [0, minor + 1, 0] : [major + 1, 0, 0];
  const neu = commits.some(breaking) || entfernt.length > 0 ? stufe : commits.some(feature) ? [major, minor + 1, 0] : [major, minor, patch + 1];
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

/** Pur: die Migrationshinweise für Bezieher (`[{ pr, text }]`): jede Zeile `<migrationKey>: <text>` mit nicht leerem Text in den Besitz-Commits (Nicht-Besitz-Commits zählen nicht). */
export function bezieherMigrationen(besitz, migrationKey) {
  return besitz.flatMap((c) => [...c.body.matchAll(zeilenRe(migrationKey))].map((m) => ({ pr: c.pr, text: m[2].trim() })).filter((x) => x.text !== ""));
}

/** Pur: das Alter der ältesten Änderung in ganzen Tagen (Kommazahl) oder `null`; `datum` ISO. */
const alterTage = (besitz, jetzt) => (besitz.length === 0 ? null : (jetzt.getTime() - Math.min(...besitz.map((c) => Date.parse(c.datum)))) / TAG_MS);

/** Pur: die Auslöser für ein neues Tag-Ticket: Anzahl, Alter, Dringlich-Signal und seit dem Tag geschlossene Milestones (factory#194; nur mit mindestens einem Besitz-PR, sonst gäbe es nichts zu taggen). */
function ausloeserVon({ letzterTag, besitz, jetzt, dringlichKey, milestones }) {
  const tage = alterTage(besitz, jetzt);
  const dringlich = dringlichSignal(besitz, dringlichKey);
  const ausloeser = [];
  if (besitz.length >= MIN_PRS) ausloeser.push(`${besitz.length} Besitz-PRs seit ${letzterTag} (ab ${MIN_PRS})`);
  if (tage !== null && tage > MAX_ALTER_TAGE) ausloeser.push(`älteste ungetaggte Änderung über ${MAX_ALTER_TAGE} Tage alt`);
  if (dringlich) ausloeser.push(`Dringlich: ${zelle(dringlich.grund)} (${dringlich.sha.slice(0, 7)})`);
  if (besitz.length > 0) for (const m of milestones) ausloeser.push(`Milestone „${zelle(titelBereinigt(m.titel))}“ geschlossen`);
  return ausloeser;
}

/** Pur: der Log-Grund für `nichts` ohne Auslöser; ein geschlossener Milestone ohne Besitz-PR wird genannt. */
function keinAusloeserGrund({ letzterTag, besitz, milestones }) {
  if (besitz.length === 0 && milestones.length > 0) return `Milestone „${zelle(titelBereinigt(milestones[0].titel))}“ geschlossen, aber nichts Ungetaggtes seit ${letzterTag}`;
  return `${besitz.length} Besitz-PRs, jünger als ${MAX_ALTER_TAGE} Tage, kein Dringlich-Signal`;
}

/**
 * Pur: die Entscheidung des Takts. `milestones` (optional) = seit dem letzten Tag geschlossene Milestones `[{ nummer, titel, closedAt }]` (`geschlossenSeit`); sie sind ein zusätzlicher Auslöser. `offene` = vertraute offene Issues `[{ number, titel, assignees }]`; Rückgabe `{ aktion, grund, warnungen, nummer?, ausloeser? }`
 * mit `aktion` `anlegen | aktualisieren | schliessen | nichts`. Ohne Release-Tag nichts; ein geclaimtes Ticket bleibt unberührt.
 */
export function entscheideTagTakt({ letzterTag, besitz, jetzt, offene, dringlichKey, milestones = [] }) {
  const warnungen = [];
  const tagOffene = offene.filter((i) => i.titel.startsWith(TAG_MARKER)).sort((a, b) => a.number - b.number);
  if (tagOffene.length > 1) warnungen.push(`Mehrere offene Tag-Tickets (${tagOffene.map((i) => `#${i.number}`).join(", ")}): das älteste gilt, keines wird geschlossen.`);
  if (!letzterTag) return { aktion: "nichts", grund: "kein Release-Tag in der Historie", warnungen };
  const offen = tagOffene[0];
  if (offen) {
    if (offen.assignees.length > 0) return { aktion: "nichts", grund: `Ticket #${offen.number} ist geclaimt`, warnungen, geclaimt: offen.number };
    if (besitz.length === 0) {
      if (tagOffene.length > 1) return { aktion: "nichts", grund: "nichts Ungetaggtes, aber mehrere offene Tickets (keine Selbst-Schließung)", warnungen };
      return { aktion: "schliessen", nummer: offen.number, grund: "keine ungetaggten Besitz-PRs mehr", warnungen };
    }
    return { aktion: "aktualisieren", nummer: offen.number, grund: `offenes Ticket #${offen.number}`, warnungen };
  }
  const ausloeser = ausloeserVon({ letzterTag, besitz, jetzt, dringlichKey, milestones });
  if (ausloeser.length === 0) return { aktion: "nichts", grund: keinAusloeserGrund({ letzterTag, besitz, milestones }), warnungen };
  return { aktion: "anlegen", grund: ausloeser.join("; "), ausloeser, warnungen };
}

/**
 * Zweitabfrage vor dem Anlegen (fail-closed): die REST-Liste hinkt bei frischen Tickets nach. `zweit()` liefert `[{ number, titel }]`; kennt es ein offenes
 * Tag-Ticket oder wirft es, wird aus `anlegen` ein `nichts` mit Warnung. Jede andere Aktion bleibt unberührt. Pur.
 */
export const bestaetigeTagAnlegen = (e, { zweit }) => bestaetigeAnlegen(e, { zweit, passt: (i) => String(i?.titel).startsWith(TAG_MARKER), was: "Tag-Ticket" });

/** Pur: CI-Zustand des main-Commits aus den Workflow-Läufen (`[{ path, status, conclusion, html_url }]`, neueste zuerst) als `{ zustand: gruen|rot|laeuft|unbekannt, url }`. */
export function ciZustand(laeufe) {
  const lauf = (Array.isArray(laeufe) ? laeufe : []).find((r) => r?.path === CI_WORKFLOW);
  if (!lauf) return { zustand: "unbekannt", url: null };
  const url = typeof lauf.html_url === "string" ? lauf.html_url : null;
  if (lauf.status !== "completed") return { zustand: "laeuft", url };
  return { zustand: lauf.conclusion === "success" ? "gruen" : "rot", url };
}

const CI_TEXT = { gruen: "grün", rot: "ROT", laeuft: "läuft noch (Stand des Takts; nächster Push auf main oder Montagslauf aktualisiert)", unbekannt: "unbekannt" };

/** Ergebnis-Wert der Probe für „Rot nur im Projekt des Beziehers“ (factory#215), neben dem Exit-Code. */
const PROJEKT_REST = "rest";

/**
 * Pur (factory#188): die Checklisten-Zeilen der Vor-Tag-Probe je Bezieher. `ergebnisse` = `{ "owner/name": exit }` (erster Exit ≠ 0 der Probe-Kette, sonst 0) oder `"rest"` (factory#215: Rot nur im Projekt des Beziehers, kein Blocker, aber als Befund bzw. Bezieher-Migration festzuhalten).
 * Rot (Exit ≠ 0 = Rot durch Factory-Besitz nach den mechanischen Update-Schritten, so das Urteil der Probe) ist ein Blocker, ein fehlendes Ergebnis bleibt ausstehend (`offen`, fail-closed: auch das heißt nicht taggen). Ergebnisse zu fremden Repos zählen nicht.
 */
export function bezieherProbe({ bezieher, ergebnisse = {} }) {
  if (bezieher.length === 0) return { zeilen: ["- Keine Bezieher gelistet (Schlüssel `bezieher` der Projekt-Config): nur der Probe-Erstbezug oben."], blocker: [], offen: [] };
  const blocker = [];
  const offen = [];
  const rest = [];
  const zeilen = bezieher.map((r) => {
    const code = Object.hasOwn(ergebnisse, r) ? ergebnisse[r] : undefined;
    if (code === undefined) {
      offen.push(r);
      return `- [ ] \`${r}\`: Probe ausstehend (nicht taggen, bis sie grün ist)`;
    }
    if (code === 0) return `- [x] \`${r}\`: Probe grün`;
    if (code === PROJEKT_REST) {
      rest.push(r);
      return `- [x] \`${r}\`: Probe grün mit Projekt-Rest (Befund bzw. Bezieher-Migration festhalten, kein Blocker)`;
    }
    blocker.push(r);
    return `- [ ] BLOCKER \`${r}\`: Probe rot (Exit ${code}), nicht taggen`;
  });
  return { zeilen, blocker, offen, rest };
}

/** Pur (factory#188): der Ablauf-Abschnitt der Vor-Tag-Probe (Text und Befehle), nur lesend im Scratch. */
function probeAblauf({ tag, sha }) {
  const mechanisch = mechanischeSchritte("<s>/quelle");
  return [
    `Vor-Tag-Probe je Bezieher (factory#188; nur lesend: ein Klon im Scratch, nie der Checkout des Beziehers; kein Push, kein PR, kein Issue, kein Kommentar; rot heißt: nicht taggen). Je Bezieher \`<owner/name>\` der Liste unten; \`<s>\` = leerer Scratch-Ordner, \`<checkout>\` = Checkout auf ${sha.slice(0, 7)}:`,
    "",
    "```",
    "git clone --depth 1 https://github.com/<owner/name>.git <s>/bezieher",
    "git -C <s>/bezieher remote remove origin",
    "git clone <checkout> <s>/quelle",
    "git -C <s>/quelle remote remove origin",
    `git -C <s>/quelle tag ${tag} ${sha}`,
    `git -C <s>/quelle checkout --detach ${sha}`,
    "node scripts/factory-sync.mjs --quelle <s>/quelle --ziel <s>/bezieher --entwurf --trocken",
    `node scripts/factory-sync.mjs --quelle <s>/quelle --ziel <s>/bezieher --tag ${tag}`,
    `cd <s>/bezieher && ${["node scripts/gate-befehl.mjs install", ...mechanisch, "node scripts/gate-befehl.mjs verifyKompakt"].join(" && ")}`,
    "node scripts/tag-takt.mjs --probe <owner/name>=<exit>|rest",
    "```",
    "",
    "Die Entwurfs-Vorschau ist nur eine Vorschau (Exit ≠ 0 ist ein Blocker); `verifyKompakt` (fährt jeden Schritt auch nach einem Rot, damit die Probe alle Funde auf einmal zeigt) ist erst nach dem Sync mit lokalem Tag und den mechanischen Update-Schritten (" + mechanisch.map((b) => "`" + b + "`").join(", ") + "; Quelle `UPDATE_SCHRITTE`) aussagekräftig, denn nach `--entwurf` ist es per Konstruktion rot. Grün heißt: kein Rot durch Factory-Besitz. Ein Rot, das nur Bezieher-Eigenes betrifft (eigene Docs, Projektkopien von Kern-Tests, Kopien von Dateien des Rings `oberflaeche`, die der Sync nie liefert, Projekt-Block), ist kein Blocker, sondern ein Befund bzw. eine Bezieher-Migration; meldet der Sync `Kontextbudget knapp`, ist das ein Projekt-Rest (`=rest`); ein Rot durch Factory-Besitz (etwa das Kontext-Budget nach dem Sync) ist ein Blocker (als Sammelticket-Zeile „Gate-Lücke“ festhalten, im Pre-Flight nennen). An `--probe` geht 0 (kein Rot durch Factory-Besitz), `rest` (Rot nur im Projekt: grün, aber Befund bzw. Bezieher-Migration festhalten) oder ein Exit ≠ 0 (Blocker).",
    "",
  ];
}

/** Pur: Body des Tag-Tickets. `prs` = `besitzCommits`, `aeltestes` = `{ datum, sha }`, `ci` = `ciZustand`. */
export function tagBody({ tag, letzterTag, sha, prs, aeltestes, ausloeser, ci, entfernt = [], migrationen = [], bezieher = [] }) {
  const wt = `.claude/worktrees/tag-${tag}`;
  const zeilen = prs.slice(0, MAX_ZEILEN).map((c) => `- ${c.pr} ${zelle(c.betreff)} (${c.datum.slice(0, 10)})`);
  if (prs.length > MAX_ZEILEN) zeilen.push(`- … und ${prs.length - MAX_ZEILEN} weitere`);
  return [
    `Besitz-Änderungen liegen ungetaggt auf main. Auslöser: ${ausloeser.join("; ")}.`,
    "",
    `- Vorgeschlagener Tag: \`${tag}\` (Basis ${letzterTag}, Vorschlag nach Conventional Commits)`,
    `- Älteste ungetaggte Änderung: ${aeltestes.datum.slice(0, 10)} (${aeltestes.sha.slice(0, 7)})`,
    `- main-Commit: \`${sha}\``,
    ...entfernt.map((x) => `- Entfernte Exporte (Breaking): \`${x.datei}\`: ${x.namen.join(", ")}`),
    `- CI-Status dieses Commits: ${CI_TEXT[ci.zustand] ?? CI_TEXT.unbekannt}${ci.url ? ` ([Lauf](${ci.url}))` : ""}`,
    "",
    `Besitz-PRs seit ${letzterTag} (${prs.length}):`,
    ...zeilen,
    "",
    "Bezieher-Migration (Commit-Zeilen der Besitz-PRs, vom Bezieher beim Update zu erledigen):",
    ...(migrationen.length > 0 ? migrationen.map((m) => `- ${m.pr} ${zelle(m.text)}`) : ["- keine gemeldet"]),
    "",
    "Befehl (erst nach „ja, taggen“; CI des Commits vorher grün). Der Hook blockiert `git tag` und `git push <tag>` im geteilten Hauptcheckout, darum aus einem eigenen Worktree auf dem Commit (das Entfernen nur mit cwd außerhalb des Worktrees):",
    "",
    "```",
    "git fetch origin --tags",
    `gh run list --commit ${sha} --workflow ci.yml`,
    `git worktree add --detach ${wt} ${sha}`,
    `git -C ${wt} tag -a ${tag} ${sha} -m "${tag}"`,
    `git -C ${wt} push origin ${tag}`,
    `git worktree remove ${wt}`,
    "```",
    "",
    ...(bezieher.length > 0 ? probeAblauf({ tag, sha }) : []),
    "Checkliste:",
    `- [ ] Trockenlauf gegen den Probe-Erstbezug (\`test/fixtures/projekt-probe.json\`, Export im Scratch, nie ein Bezieher-Repo): einen leeren Scratch-Ordner anlegen, die Probe-Config als \`${PROJEKT_CONFIG}\` und eine AGENTS.md mit den Kern-Markern ${markerStart("kern")} und ${markerEnde("kern")} hineinkopieren (ohne sie bricht der Sync ab, weil die Marker im Ziel fehlen), dann \`node scripts/factory-sync.mjs --quelle <checkout auf ${sha.slice(0, 7)}> --ziel <scratch-ordner> --entwurf --trocken\`. Er meldet auch die Kontextgröße gegen das Budget der Quelle`,
    ...(bezieher.length > 0 ? bezieherProbe({ bezieher }).zeilen : []),
    "- [ ] Pre-Flight „ja, taggen“ (Veröffentlichen) bei der Maintainerin einholen",
    `- [ ] Tag \`${tag}\` setzen (Befehl oben)`,
    `- [ ] Bezieher holen das Update selbst (\`factory-update.yml\`, wöchentlich, Issue „🔄 Factory-Update“; ihr Agent fährt \`factory-sync --tag ${tag}\`, die Gates des Beziehers melden tote Verweise und Modul-Kopien). Die Fabrik schreibt in kein Bezieher-Repo: kein Sync-PR, kein Trockenlauf im Bezieher-Checkout, kein Issue, kein Kommentar (${factorySeiteIn(WURZEL, "docs/adr/0031-fabrik-ohne-zugriff-auf-bezieher.md")}). ${WERKZEUG_HINWEIS}`,
    "- [ ] Melden Bezieher Rot durch Factory-Besitz (Kommentar im Sammelticket): Fix upstream per PR, dann Patch-Tag auf den Fix-Commit, ein gesetzter Tag wird nie verschoben",
    "- [ ] Rückmeldungen fremder Bezieher seit dem letzten Tag (Meldestelle) gesichtet: je Auffälligkeit eine Sammelticket-Zeile „Gate-Lücke: …“",
    "- [ ] Auffälligkeit zu einem Bezieher: als Sammelticket-Zeile „Gate-Lücke: welches Bezieher-Gate hätte es melden müssen“, nie als Schreibzugriff auf den Bezieher",
    "- [ ] Ticket schließen, sobald der Tag gepusht ist (ein geclaimtes Ticket schließt der Takt nicht selbst; ohne Assignee schließt er es beim nächsten Lauf)",
    "",
    "Grenze: Die Fabrik schreibt in kein Bezieher-Repo (ADR 0031); geprüft wird nur lesend im Scratch (Probe-Erstbezug, bei gelisteten Bezieherinnen deren Klon), den Rest melden die Gates der Bezieher beim Update. Vorschau dieses Takts: `node scripts/tag-takt.mjs --dry-run`. Mechanik: " + factorySeiteIn(WURZEL, "docs/agent-harness.md", "tag-takt-factory103") + ".",
  ].join("\n");
}

const KOMMENTAR_ERLEDIGT = "Keine ungetaggten Besitz-PRs mehr (Tag gesetzt), automatisch geschlossen.";

/** Entfernte Exporte je verteilter Skript-Datei zwischen Tag und `sha`: `[{ datei, namen }]`. Ohne `io.zeigeDatei` oder wenn die Datei am Tag fehlte (neu): leer. `manifest` = Vereinigung von Tag und HEAD. */
function entfernteJeDatei(io, { letzterTag, besitz, sha, manifest }) {
  if (!io.zeigeDatei) return [];
  const treffer = [];
  for (const datei of verteilteSkripte(besitz, manifest)) {
    const namen = entfernteExporte(io.zeigeDatei(letzterTag, datei), io.zeigeDatei(sha, datei));
    if (namen.length > 0) treffer.push({ datei, namen });
  }
  return treffer;
}

/** Das Manifest am Tag (fehlt oder kaputt: leer), damit eine inzwischen gelöschte oder umbenannte verteilte Datei als verteilt zählt. */
function tagManifest(io, letzterTag) {
  const g = manifestAusText(io.zeigeDatei && letzterTag ? io.zeigeDatei(letzterTag, MANIFEST) : null);
  return g.manifest ?? { eintraege: [] };
}

/**
 * Die seit dem letzten Tag geschlossenen Milestones (factory#194), fail-open: ohne `io.ladeMilestones` leer; unlesbar oder ein nicht parsebares Tag-Datum ergibt eine Warnung ohne Milestone-Auslöser.
 * Das Tag-Datum wird nur gelesen, wenn überhaupt ein Milestone geschlossen ist.
 */
function ladeMilestoneAusloeser(io, letzterTag, log) {
  if (!io.ladeMilestones || !letzterTag) return [];
  try {
    const geschlossen = geschlosseneMilestones(io.ladeMilestones());
    if (geschlossen.length === 0) return [];
    const datum = io.tagDatum(letzterTag);
    if (Number.isNaN(Date.parse(datum))) throw new Error(`Datum von ${letzterTag} nicht lesbar`);
    return geschlossenSeit(geschlossen, datum);
  } catch (err) {
    log(`::warning::Milestones nicht lesbar (${fehlerText(err)}): Milestone-Auslöser entfällt`);
    return [];
  }
}

/** Liest alles Nötige; wirft bei einem Git-Fehler. `io.ladeLaeufe` darf werfen (dann `unbekannt`). */
function sammle(io, log) {
  const letzterTag = vergleicheTags(io.tags());
  const commits = letzterTag ? commitsAusLog(io.ladeLog(letzterTag)) : [];
  const kopf = io.ladeManifest();
  const manifest = { eintraege: [...tagManifest(io, letzterTag).eintraege, ...kopf.eintraege] };
  const besitz = besitzCommits(commits, manifest);
  const sha = io.headSha();
  let ci = { zustand: "unbekannt", url: null };
  try {
    ci = ciZustand(io.ladeLaeufe(sha));
  } catch (err) {
    log(`CI-Status nicht lesbar (${fehlerText(err)}), im Ticket steht „unbekannt“.`);
  }
  return { letzterTag, besitz, sha, ci, milestones: ladeMilestoneAusloeser(io, letzterTag, log), migrationen: io.migrationKey ? bezieherMigrationen(besitz, io.migrationKey) : [], bezieher: io.bezieher ?? [], entfernt: entfernteJeDatei(io, { letzterTag, besitz, sha, manifest }) };
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
function sollTicket(e, { letzterTag, besitz, sha, ci, entfernt, migrationen, bezieher }) {
  const tag = naechsterTag(letzterTag, besitz, entfernt);
  const aeltestes = besitz.reduce((a, c) => (Date.parse(c.datum) < Date.parse(a.datum) ? c : a));
  const ausloeser = e.ausloeser ?? [`${besitz.length} Besitz-PRs seit ${letzterTag}`];
  return { titel: tagTitel(tag), body: tagBody({ tag, letzterTag, sha, prs: besitz, aeltestes, ausloeser, ci, entfernt, migrationen, bezieher }) };
}

/** Checklistenzeile `- [ ] <rest>` bzw. `* [x] <rest>`: Gruppe 1 = Haken, Gruppe 2 = Rest. */
const HAKEN_ZEILE = /^\s*[-*] \[([ xX])\] (.*?)\r?$/;

/**
 * Pur (factory#215): übernimmt die Haken des offenen Tickets in den neu gebauten Body. Eine offene Zeile (`[ ]`) des neuen Bodys wird `[x]`, wenn der alte Body dieselbe Zeile
 * (gleicher Text nach der Checkbox) mit `[x]` oder `[X]` hat; ein geänderter Text verliert den Haken (die Zeile ist neu zu prüfen). Ein Takt-Lauf überschreibt so keine abgehakte Arbeit.
 */
export function uebernimmHaken(altBody, neuBody) {
  const erledigt = new Set();
  for (const zeile of String(altBody ?? "").split("\n")) {
    const m = HAKEN_ZEILE.exec(zeile);
    if (m && m[1] !== " ") erledigt.add(m[2]);
  }
  return String(neuBody)
    .split("\n")
    .map((zeile) => {
      const m = HAKEN_ZEILE.exec(zeile);
      return m && m[1] === " " && erledigt.has(m[2]) ? zeile.replace("[ ]", "[x]") : zeile;
    })
    .join("\n");
}

/** Pur: stimmt das offene Ticket mit dem Soll überein? */
const istAktuell = (offen, soll) => offen?.titel === soll.titel && offen.body === soll.body;

/** Entscheidung samt Soll-Ticket (`soll` bei anlegen/aktualisieren); ein bereits aktuelles Ticket wird zu `nichts`. */
function plane({ io, daten, offene, trocken }) {
  let e = entscheideTagTakt({ letzterTag: daten.letzterTag, besitz: daten.besitz, jetzt: io.jetzt(), offene, dringlichKey: io.dringlichKey, milestones: daten.milestones });
  if (e.aktion === "anlegen" && !trocken) e = bestaetigeTagAnlegen(e, { zweit: io.frischeOffene });
  if (trocken && e.geclaimt && daten.besitz.length > 0) return { ...e, soll: sollTicket(e, daten) };
  if (e.aktion !== "anlegen" && e.aktion !== "aktualisieren") return e;
  const neu = sollTicket(e, daten);
  const offen = e.aktion === "aktualisieren" ? offene.find((i) => i.number === e.nummer) : undefined;
  const soll = offen ? { ...neu, body: uebernimmHaken(offen.body, neu.body) } : neu;
  if (e.aktion === "aktualisieren" && istAktuell(offen, soll)) return { ...e, aktion: "nichts", grund: "Ticket ist aktuell", soll };
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

/** git-Aufruf mit abgefangenem stderr (ein erwarteter Fehlschlag, z. B. `git show` einer neuen Datei, schreibt nichts ins Log); die Meldung bleibt im geworfenen Fehler. */
export const gitEcht = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** Standard-Lader des Manifests unter `wurzel`: wirft die einheitliche Meldung (`manifestAusText`), wenn es fehlt oder kaputt ist. */
export function manifestLaden(wurzel) {
  const voll = join(wurzel, ...MANIFEST.split("/"));
  const g = manifestAusText(existsSync(voll) ? readFileSync(voll, "utf8") : null);
  if (g.fehler !== undefined) throw new Error(g.text);
  return g.manifest;
}

/** Aufrufzeile der Vor-Tag-Probe. */
const PROBE_AUFRUF = "Aufruf: node scripts/tag-takt.mjs --probe <owner/name>=<exit>|rest [--probe …]   (je Bezieher der Liste `bezieher` der Projekt-Config; nicht kombinierbar mit --dry-run)";

/** Pur: `<owner/name>=<exit>` oder `<owner/name>=rest` (Rot nur im Projekt, factory#215) → `{ repo, code }` (`code` = Zahl oder `PROJEKT_REST`) oder `null`. */
const probeWert = (text) => {
  const m = /^([^=\s]+\/[^=\s]+)=(\d{1,3}|rest)$/.exec(text);
  return m ? { repo: m[1], code: m[2] === PROJEKT_REST ? PROJEKT_REST : Number(m[2]) } : null;
};

/** Pur: die `--probe`-Angaben als `{ ergebnisse }` je Bezieher (Name der Config, Schreibweise egal) oder mit `ungueltig` = der ersten unbrauchbaren Angabe (Form, unbekanntes Repo, doppelt). */
export function probeErgebnisse(angaben, bezieher) {
  const ergebnisse = {};
  for (const roh of angaben) {
    const w = probeWert(roh);
    const repo = w ? bezieher.find((b) => gleichesRepo(b, w.repo)) : undefined;
    if (!w || repo === undefined || Object.hasOwn(ergebnisse, repo)) return { ergebnisse, ungueltig: roh };
    ergebnisse[repo] = w.code;
  }
  return { ergebnisse };
}

/**
 * Einstieg `--probe` (factory#188): liest die Ergebnisse der Vor-Tag-Probe und gibt die Checkliste aus; Exit 0 nur, wenn jeder gelistete Bezieher ein Ergebnis 0 hat,
 * 1 bei einem Blocker oder einem ausstehenden Bezieher, 2 bei Aufruf- oder Config-Fehler (unbekanntes Repo, kein Exit-Wert, doppelt). Kein gh-Aufruf.
 */
export function probeEinstieg(argv, { ladeConfig = () => ladeProjektConfig(), log = console.log, err = console.error } = {}) {
  const { werte, fehler } = flagsLesen(argv, { probe: { type: "string", multiple: true } });
  if (fehler) {
    err(`${fehler.text}\n${PROBE_AUFRUF}`);
    return AUFRUF_EXIT;
  }
  let bezieher;
  try {
    bezieher = bezieherAus(ladeConfig());
  } catch (e) {
    log(fehlerMeldung(e, { praefix: "Tag-Takt: Projekt-Config nicht lesbar: " }));
    return AUFRUF_EXIT;
  }
  const { ergebnisse, ungueltig } = probeErgebnisse(werte.probe, bezieher);
  if (ungueltig !== undefined) {
    err(`--probe ${ungueltig}: erwartet wird je Bezieher einmal <owner/name>=<exit>|rest mit einem Repo aus bezieher (${bezieher.join(", ") || "Liste leer"})\n${PROBE_AUFRUF}`);
    return AUFRUF_EXIT;
  }
  const r = bezieherProbe({ bezieher, ergebnisse });
  log(r.zeilen.join("\n"));
  if (r.blocker.length > 0) log(`Vor-Tag-Probe: BLOCKER ${r.blocker.join(", ")}: nicht taggen.`);
  if (r.rest.length > 0) log(`Vor-Tag-Probe: Projekt-Rest bei ${r.rest.join(", ")}: als Befund festhalten.`);
  if (r.offen.length > 0) log(`Vor-Tag-Probe: ausstehend ${r.offen.join(", ")}: nicht taggen, bis die Probe läuft.`);
  return r.blocker.length + r.offen.length === 0 ? 0 : 1;
}

/** Einstieg. `deps` (Tests): `start`, `ladeConfig` (nur `--probe`), `gh`, `log`, `err`, `git` (`args -> stdout`), `wurzel` (Ordner des Sync-Stands), `env` (Standard `process.env`; liefert `PROJECT_TOKEN`), `ladeManifest`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { start = inboxStart, gh = { text: ghText, json: ghJson }, log = console.log, err = console.error, git = gitEcht, wurzel = process.cwd(), env = process.env, ladeManifest = () => manifestLaden(wurzel), ladeConfig } = {}) {
  if (argv.some((a) => a === "--probe" || a.startsWith("--probe="))) {
    if (istBezieher(wurzel)) {
      log("Tag-Takt: Bezieher-Repo (Sync-Stand vorhanden), nichts zu tun.");
      return 0;
    }
    return probeEinstieg(argv, { ladeConfig, log, err });
  }
  const s = await start(argv, { skript: "tag-takt", praefix: "Tag-Takt: Projekt-Config nicht lesbar: ", log, err });
  if (s.code !== undefined) return s.code;
  const { config, libs } = s;
  const { REPO, ladeSammelKontext, vertrauteIssues, frischeOffeneIssues } = libs;
  const { ziel, zielOpt } = zielZugang(libs);
  const aktion = zielAktionen({ gh, libs, label: labelAus(config, "harness"), env });
  const io = {
    log,
    istBezieher: () => istBezieher(wurzel),
    tags: () => git(["tag", "--merged", "HEAD"]).split(/\r?\n/).map((t) => t.trim()).filter(Boolean),
    ladeLog: (tag) => git(["log", "--first-parent", "--format=%x1e%H%x1f%cI%x1f%B%x1f", "--name-only", "--no-renames", `${tag}..HEAD`, "--"]),
    ladeManifest,
    bezieher: bezieherAus(config),
    headSha: () => git(["rev-parse", "HEAD"]).trim(),
    zeigeDatei: (ref, pfad) => {
      try {
        return git(["show", `${ref}:${pfad}`]);
      } catch {
        return null;
      }
    },
    ladeMilestones: () => gh.json(["api", "--paginate", "--slurp", `repos/${REPO}/milestones?state=closed&per_page=100`]),
    tagDatum: (tag) => git(["for-each-ref", "--format=%(creatordate:iso-strict)", `refs/tags/${tag}`]).trim(),
    ladeLaeufe: (sha) => gh.json(["api", `repos/${REPO}/actions/runs?head_sha=${sha}&event=push&per_page=30`, "--jq", ".workflow_runs"]),
    ladeOffene: () => {
      const kontext = ladeSammelKontext({ ladeKommentare: () => [] });
      return vertrauteIssues(kontext.rohe, vertrauterOwner(kontext, libs))
        .filter((i) => i.title.startsWith(TAG_MARKER))
        .map((i) => ({ number: i.number, titel: i.title, assignees: (i.assignees ?? []).map((a) => a?.login).filter(Boolean), body: String(i.body ?? "") }));
    },
    frischeOffene: () => frischeOffeneIssues({ repo: ziel, anzahl: 50, mitBoard: false }, zielOpt),
    dringlichKey: commitZeilenAus(config).syncDringlich,
    migrationKey: commitZeilenAus(config).bezieherMigration,
    jetzt: () => new Date(),
    projectToken: env.PROJECT_TOKEN,
    legeIssueAn: aktion.legeIssueAn,
    sortiereEin: (nr, art) => {
      try {
        aktion.platziere(nr, art);
        return true;
      } catch {
        return false;
      }
    },
    aktualisiere: (nr, titel, body) => aktion.aktualisiere(nr, body, titel),
    schliesse: aktion.schliesse,
  };
  return lauf({ io, trocken: s.trocken });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
