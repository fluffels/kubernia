// Kein Shebang — wie check-diffsize.mjs: wird per `node scripts/check-review-nachweis.mjs`
// gestartet (CI + lokal) UND von test/review-nachweis.test.ts importiert.
/**
 * Review- und Plan-Nachweis-Wächter (#1270) — macht Planungspass und Review-Konvergenz
 * pfadunabhängig prüfbar.
 *
 * Hintergrund: Review-Pflicht, Cap 2 Fix-Runden und der Planer sind im Skill-Pfad
 * Verhaltensregeln: ein PR ohne Review-Runde, mit Überschreitung der Obergrenze oder ohne
 * Planer fiel nirgends auf. Dieser Wächter verlangt im Slice (Commits `<basis>..HEAD`) zwei
 * Zeilen am Zeilenanfang einer Commit-Message, gleiches Muster wie der Diffsize-Override (Präfix `praefixe.commitZeile`, Planer
 * `agenten.planer` der Projekt-Config; kein Standardwert, ein fehlender Schlüssel ist rot):
 *
 *   <Präfix>Plan: <Planer>               |  <Präfix>Plan: ohne — <Begründung>
 *   <Präfix>Review: head=<sha> runden=<1..3> lenses=<Brillen des vollen Passes (Runde 1), kommagetrennt>
 *                 blocker=<brille>:<n>,… verdikt=ok   (blocker optional, #1123: Runde-1-Blocker je Brille)
 *   Optional `zusatzpass=<anzahl>:<grund>` (#1561): nur wenn die Maintainerin Pässe über das Cap hinaus freigab; erhöht die Obergrenze.
 *
 * Geprüft wird Konsistenz und Existenz, nicht Wahrheit: der Nachweis ist Selbstauskunft.
 * Aus einer stillen Auslassung wird so eine bewusste Falschangabe; die unabhängige Prüfung
 * ist ein CI-Reviewer (#1117). `head` muss im Slice liegen, die Lens-Brillen müssen zur
 * Diff-Art passen (reiner Markdown-Diff → doku, sonst die drei Code-Brillen).
 *
 * Ein Merge von `main` NACH dem Review mit Konflikt-Auflösung ist ungeprüfter Code im PR: der Wächter holt jeden Merge in
 * `<head>..HEAD` und prüft ihn mit `git show --remerge-diff` (git ≥ 2.36). Zeigt der Merge eine Auflösung, ist der Check rot:
 * die Auflösung per Delta-Lens reviewen, dann einen neuen Nachweis setzen (head ≥ Merge). Konfliktfreie Merges (auch der synthetische
 * Merge-Commit des PR-Checkouts) bleiben grün; andere Commits nach dem Review werden weiter nur gemeldet. Ein git-Fehler ist rot.
 *
 * Druckventil: `<Präfix>Review-Override: #<nr> <warum>` (Pflicht-Begründung), z.B. für Revert-PRs.
 * Bewusst KEIN npm-`check:*`-Skript und nicht in `verify`: verify läuft vor dem Review, der
 * Nachweis entsteht erst danach (Vorbild: check-festgefahren.mjs). Lokal:
 *   node scripts/check-review-nachweis.mjs
 *
 * Mit `--config <pfad>` liest der Wächter eine andere Projekt-Config (Test, fremdes Projekt), sonst die des Repos.
 *
 * Reines Node-Skript (nur Builtins + check-basis.mjs); die Bewertung ist pur exportiert.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveBase } from "./check-basis.mjs";
import { trenneConfigArg } from "./projekt-config-lib.mjs";
import { ladeCommitZeilen, meldeUngueltigeOverrides, parseNachweis, parseOverrideTrailers } from "./slice-override.mjs";

// parseNachweis lebt im neutralen Modul slice-override.mjs (auch das Messskript token-baseline.mjs liest die Zeilen);
// hier bleibt der Export für die Aufrufer und Tests dieses Gates.
export { parseNachweis };

/** Obergrenze der Fix-Runden (Cap 2 Fix-Runden, höchstens 3 Pässe); der Skill `review-lenses` trägt dieselbe Zahl (Wächter review-nachweis.test.ts). */
export const MAX_FIX_RUNDEN = 2;
/** Höchstens so viele Review-Pässe: 1 Erstpass + MAX_FIX_RUNDEN nach je einem Fix. */
export const MAX_REVIEW_PAESSE = MAX_FIX_RUNDEN + 1;

const CODE_LENSES = ["architektur", "requirement-treue", "test-adaequanz"];
export const BEKANNTE_LENSES = [...CODE_LENSES, "doku"];

/** Die Vorlage, die bei Rot ausgegeben wird (SSOT des Formats: docs/agent-harness.md §3a); Schlüssel und Planer aus `zeilen`. */
export const vorlage = (zeilen) =>
  `${zeilen.plan}: ${zeilen.planer}\n` +
  `${zeilen.review}: head=<sha-des-zuletzt-reviewten-Stands> runden=<1..${MAX_REVIEW_PAESSE}> ` +
  `lenses=architektur,requirement-treue,test-adaequanz ` +
  `blocker=architektur:<n>,requirement-treue:<n>,test-adaequanz:<n> verdikt=ok  ` +
  `(bei reinem Markdown-Diff: lenses=doku blocker=doku:<n>)`;

/** Welche Brillen Runde 1 mindestens abdecken muss: nur `*.md` → doku, sonst die drei
 *  Code-Brillen. Leere oder kaputte Dateiliste → voller Code-Satz (fail-closed). Gleiche
 *  Regel der Review-Staffel (Skill `review-lenses`, Wächter review-staffel.test.ts). */
export function pflichtLenses(dateien) {
  if (!Array.isArray(dateien) || dateien.length === 0) return [...CODE_LENSES];
  if (dateien.some((d) => typeof d !== "string" || d.trim() === "")) return [...CODE_LENSES];
  return dateien.every((d) => /\.md$/i.test(d.trim())) ? ["doku"] : [...CODE_LENSES];
}

/** Prüft das optionale Feld `blocker=` (#1123): je Brille die Zahl der Runde-1-Blocker. Fehlt es, ist die
 *  Zeile gültig (alte Zeilen). Pure. */
function bewerteBlocker(review, zeilen) {
  const R = zeilen.review;
  const fehler = [];
  const eintraege = review.blocker;
  if (eintraege.length === 0) return [`${R}: blocker ist leer (erwartet: blocker=<brille>:<n>,… je Brille der Runde 1).`];
  const gesehen = new Set();
  for (const { lens, n } of eintraege) {
    if (!BEKANNTE_LENSES.includes(lens)) fehler.push(`${R}: blocker nennt unbekannte Brille "${lens}" (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
    if (!Number.isInteger(n) || n < 0) fehler.push(`${R}: blocker=${lens}:${n} ist keine ganze Zahl ≥ 0.`);
    if (gesehen.has(lens)) fehler.push(`${R}: blocker nennt die Brille ${lens} doppelt.`);
    gesehen.add(lens);
  }
  if (review.runden === 1) {
    const summe = eintraege.reduce((a, e) => a + (Number.isInteger(e.n) ? e.n : 0), 0);
    if (summe > 0) fehler.push(`${R}: Runde 1 meldete Blocker, aber es gab kein Fix-Pass (runden=1).`);
    const gleich = eintraege.length === review.lenses.length && review.lenses.every((l) => gesehen.has(l));
    if (!gleich) fehler.push(`${R}: runden=1, aber die Brillen von blocker (${[...gesehen].join(",")}) weichen von lenses (${review.lenses.join(",")}) ab.`);
  }
  return fehler;
}

/** Prüft `runden` gegen die Obergrenze samt optionalem `zusatzpass=<anzahl>:<grund>` (#1561): nur die Maintainerin gibt Pässe
 *  über das Cap hinaus frei; der Nachweis bleibt Selbstauskunft. Ohne Überschreitung ist ein Zusatzpass ein Fehler. Pure. */
function bewerteRunden(review, zeilen) {
  const R = zeilen.review;
  const zp = review.zusatzpass ?? null;
  if (zp && "ungueltig" in zp) {
    return [`${R}: zusatzpass=${zp.ungueltig} ungültig (erwartet: zusatzpass=<anzahl ≥ 1>:<Grund der Freigabe>).`];
  }
  const erlaubt = MAX_REVIEW_PAESSE + (zp ? zp.anzahl : 0);
  if (review.runden > erlaubt) {
    return [
      `${R}: runden=${review.runden} überschreitet die Obergrenze (Cap ${MAX_FIX_RUNDEN} Fix-Runden = höchstens ${erlaubt} Pässe). ` +
        `Gab die Maintainerin einen Zusatzpass frei: zusatzpass=<anzahl>:<Grund> in die ${R}-Zeile.`,
    ];
  }
  if (zp && review.runden <= MAX_REVIEW_PAESSE) {
    return [`${R}: zusatzpass ist nur bei runden > ${MAX_REVIEW_PAESSE} zulässig (runden=${review.runden}).`];
  }
  return [];
}

/** Bewertet einen geparsten Nachweis. `headBekannt`: der SHA lässt sich als Commit auflösen;
 *  `headImSlice`: er liegt in `<basis>..HEAD`. Liefert alle Fehler (leer = ok). Pure. */
export function bewerteNachweis({ nachweis, dateien, headBekannt, headImSlice, konfliktMerges = [], zeilen }) {
  if (!zeilen) throw new Error("bewerteNachweis braucht die Commit-Zeilen (commitZeilen), keinen Standardwert");
  const R = zeilen.review;
  const fehler = [];
  for (const sha of konfliktMerges) {
    fehler.push(
      `Konflikt-Merge ${sha} nach dem Review: Auflösung per Delta-Lens prüfen, dann neuer Nachweis (head ≥ ${sha}). ` +
        `Besser: main VOR Runde 1 oder erst nach dem Nachweis einmergen, wenn der Merge konfliktfrei ist. ` +
        `Schritte: Skill review-lenses › Nach jedem Merge von main.`,
    );
  }
  const { plan, review } = nachweis;
  if (!plan) fehler.push(`${zeilen.plan}-Zeile fehlt (Planungspass nicht nachgewiesen).`);
  else if (plan.art === "ungueltig") {
    fehler.push(`${zeilen.plan} ungültig: "${plan.zeile}" (erlaubt: "${zeilen.planer}" oder "ohne — <Begründung>").`);
  }
  if (!review) {
    fehler.push(`${R}-Zeile fehlt (Review-Konvergenz nicht nachgewiesen).`);
    return fehler;
  }
  if (review.head === null) fehler.push(`${R}: head fehlt oder ist kein SHA.`);
  else if (!headBekannt) fehler.push(`${R}: head=${review.head} ist kein bekannter Commit.`);
  else if (!headImSlice) {
    fehler.push(`${R}: head=${review.head} liegt nicht im Slice dieses PRs (Rebase/Amend nach dem Review?).`);
  }
  if (!Number.isInteger(review.runden) || review.runden < 1) {
    fehler.push(`${R}: runden fehlt oder ist keine Zahl ≥ 1.`);
  } else {
    fehler.push(...bewerteRunden(review, zeilen));
  }
  const pflicht = pflichtLenses(dateien);
  const fehlend = pflicht.filter((l) => !review.lenses.includes(l));
  const codeVoll = CODE_LENSES.every((l) => review.lenses.includes(l));
  if (fehlend.length > 0 && !codeVoll) {
    fehler.push(
      `${R}: lenses fehlt ${fehlend.join(", ")} (Pflicht für diese Diff-Art: ${pflicht.join(", ")}). ` +
        `Erwartet: lenses=${pflicht.join(",")} (kleingeschrieben, ASCII, ae/oe/ue statt Umlaute).`,
    );
  }
  const unbekannt = review.lenses.filter((l) => !BEKANNTE_LENSES.includes(l));
  if (unbekannt.length > 0) {
    fehler.push(`${R}: lenses enthält unbekannte Brille(n) ${unbekannt.join(", ")} (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
  }
  if (review.blocker !== null) fehler.push(...bewerteBlocker(review, zeilen));
  if (review.verdikt !== "ok") fehler.push(`${R}: verdikt=${review.verdikt ?? "(fehlt)"} ist nicht ok.`);
  return fehler;
}

/**
 * Merges in `<headSha>..HEAD`, deren Auflösung vom automatischen Merge abweicht (Konflikt-Auflösung). `git show --remerge-diff` zeigt
 * genau diese Abweichung; die Ausgabe ist bei einem konfliktfreien Merge leer. Wirft bei einem git-Fehler (z.B. git < 2.36), der
 * Aufrufer wertet das als rot (fail-closed).
 */
export function konfliktMergesNach(git, headSha) {
  const merges = git(["rev-list", "--merges", `${headSha}..HEAD`]).split(/\r?\n/).filter((l) => l.trim() !== "");
  return merges.filter((sha) => git(["show", "--remerge-diff", "--format=", sha]).trim() !== "");
}

/** Führt die Prüfung gegen git aus. `runGit`/`env`/`ladeZeilen` injizierbar (Test; `ladeZeilen` liest standardmäßig die echte Projekt-Config).
 *  Fail-closed: ein Ladefehler der Config, eine nicht auflösbare Basis oder ein git-Fehler ist rot. Basis == HEAD ist grün (nichts zu prüfen). */
export function checkReviewNachweis({ runGit, env = process.env, ladeZeilen = ladeCommitZeilen } = {}) {
  let zeilen;
  try {
    zeilen = ladeZeilen();
  } catch (e) {
    return { ok: false, fehler: [e instanceof Error ? e.message : String(e)] };
  }
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const base = resolveBase(git, env);
  if (!base) return { ok: false, fehler: ["Keine Vergleichs-Basis auflösbar (flacher Checkout?) — Nachweis nicht prüfbar."] };
  try {
    const head = git(["rev-parse", "HEAD"]).trim();
    if (head === base) return { ok: true, skipped: true, fehler: [] };
    // `--reverse`: chronologisch, damit der JÜNGSTE Nachweis (`lastLine`) und die jüngste Override-Zeile gelten (Z8a).
    const messages = git(["log", "--reverse", "--format=%B", `${base}..HEAD`]);
    const ov = parseOverrideTrailers(messages, zeilen.reviewOverride);
    if (ov.valid.length > 0) {
      return { ok: true, override: ov.valid[ov.valid.length - 1].reason, fehler: [], invalid: ov.invalid, zeilen };
    }
    const nachweis = parseNachweis(messages, zeilen);
    const dateien = git(["diff", "--name-only", `${base}...HEAD`])
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    let headSha = null;
    let headImSlice = false;
    let commitsNachReview = null;
    let konfliktMerges = [];
    if (nachweis.review?.head) {
      try {
        headSha = git(["rev-parse", "--verify", "--quiet", `${nachweis.review.head}^{commit}`]).trim() || null;
      } catch {
        headSha = null;
      }
      if (headSha) {
        headImSlice = git(["rev-list", `${base}..HEAD`]).split(/\r?\n/).includes(headSha);
        if (headImSlice) {
          commitsNachReview = Number(git(["rev-list", "--count", "--no-merges", `${headSha}..HEAD`]).trim());
          konfliktMerges = konfliktMergesNach(git, headSha);
        }
      }
    }
    const fehler = bewerteNachweis({ nachweis, dateien, headBekannt: headSha !== null, headImSlice, konfliktMerges, zeilen });
    return {
      ok: fehler.length === 0,
      fehler,
      invalid: ov.invalid,
      zeilen,
      commitsNachReview,
      blockerFehlt: nachweis.review?.blocker === null,
      zusatzpass: nachweis.review?.zusatzpass && "grund" in nachweis.review.zusatzpass ? nachweis.review.zusatzpass : null,
    };
  } catch (e) {
    return { ok: false, fehler: [`git-Fehler beim Prüfen des Nachweises: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** CLI-Zeile zum Zusatzpass (Freigabe der Maintainerin); `null` ohne gültigen Zusatzpass. Pur. */
export const zusatzpassZeile = (r) => (r.zusatzpass ? `• Zusatzpass (Freigabe der Maintainerin): ${r.zusatzpass.grund}` : null);

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv = process.argv.slice(2)) {
  const getrennt = trenneConfigArg(argv);
  if (getrennt.fehler) {
    console.error(getrennt.fehler);
    process.exit(1);
  }
  // Die Config wird vor jedem git-Aufruf geladen: ein Ladefehler endet mit Exit 1 und der Meldung des Laders (Pfad, Schlüssel, Fix:).
  let zeilen;
  try {
    zeilen = ladeCommitZeilen({ pfad: getrennt.pfad });
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const r = checkReviewNachweis({ ladeZeilen: () => zeilen });
  if (r.skipped) {
    console.log("• check-review-nachweis: Basis == HEAD, nichts zu prüfen.");
    return;
  }
  if (r.override) {
    console.log(`• geduldet: ${zeilen.reviewOverride} — ${r.override}`);
    console.log("✔ Review-/Plan-Nachweis ok (Override mit Begründung).");
    return;
  }
  meldeUngueltigeOverrides(r.invalid);
  if (r.ok) {
    if (typeof r.commitsNachReview === "number") {
      console.log(`• ${r.commitsNachReview} Commit(s) nach dem reviewten Stand (inkl. Nachweis-Commit).`);
    }
    if (r.blockerFehlt) console.log("• Hinweis: blocker= fehlt (Messung #1123).");
    const zusatz = zusatzpassZeile(r);
    if (zusatz) console.log(zusatz);
    console.log("✔ Review-/Plan-Nachweis ok.");
    return;
  }
  console.error("✖ Review-/Plan-Nachweis fehlt oder ist ungültig (#1270):");
  for (const f of r.fehler) console.error(`  - ${f}`);
  console.error(
    `\nNach Konvergenz des Reviews einen leeren Nachweis-Commit setzen (Format: docs/agent-harness.md §3a), ` +
      `beide Zeilen in einer Commit-Message:\nVorlage:\n${vorlage(zeilen).replace(/^/gm, "  ")}\n` +
      `Bewusste Ausnahme (z.B. Revert-PR) mit Pflicht-Begründung: ${zeilen.reviewOverride}: #<nr> <warum>`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
