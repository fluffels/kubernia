// Kein Shebang — wie check-diffsize.mjs: wird per `node scripts/check-review-nachweis.mjs`
// gestartet (CI + lokal) UND von test/review-nachweis.test.ts importiert.
/**
 * Review- und Plan-Nachweis-Wächter (#1270) — macht Planungspass und Review-Konvergenz
 * pfadunabhängig prüfbar.
 *
 * Hintergrund: Review-Pflicht, Cap 2 Fix-Runden und der Planer waren nur im Workflow
 * (`.claude/workflows/kubernia-ticket.js`) im Code erzwungen. Im Skill-Pfad sind sie
 * Verhaltensregeln: ein PR ohne Review-Runde, mit Überschreitung der Obergrenze oder ohne
 * Planer fiel nirgends auf. Dieser Wächter verlangt im Slice (Commits `<basis>..HEAD`) zwei
 * Zeilen am Zeilenanfang einer Commit-Message, gleiches Muster wie `KQ-Diffsize-Override`:
 *
 *   KQ-Plan: kubernia-planner            |  KQ-Plan: ohne — <Begründung>
 *   KQ-Review: head=<sha> runden=<1..3> lenses=<Brillen des vollen Passes (Runde 1), kommagetrennt>
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
 * Druckventil: `KQ-Review-Override: #<nr> <warum>` (Pflicht-Begründung), z.B. für Revert-PRs.
 * Bewusst KEIN npm-`check:*`-Skript und nicht in `verify`: verify läuft vor dem Review, der
 * Nachweis entsteht erst danach (Vorbild: check-festgefahren.mjs). Lokal:
 *   node scripts/check-review-nachweis.mjs
 *
 * Reines Node-Skript (nur Builtins + check-diffsize.mjs); die Bewertung ist pur exportiert.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveBase } from "./check-diffsize.mjs";
import { meldeUngueltigeOverrides, parseNachweis, parseOverrideTrailers } from "./slice-override.mjs";

// parseNachweis lebt im neutralen Modul slice-override.mjs (auch das Messskript token-baseline.mjs liest die Zeilen);
// hier bleibt der Export für die Aufrufer und Tests dieses Gates.
export { parseNachweis };

/** Obergrenze der Fix-Runden (Cap 2 Fix-Runden, höchstens 3 Pässe); der Workflow trägt dieselbe Zahl (Wächter-Test). */
export const MAX_FIX_RUNDEN = 2;
/** Höchstens so viele Review-Pässe: 1 Erstpass + MAX_FIX_RUNDEN nach je einem Fix. */
export const MAX_REVIEW_PAESSE = MAX_FIX_RUNDEN + 1;

export const OVERRIDE_KEY = "KQ-Review-Override";

const CODE_LENSES = ["architektur", "requirement-treue", "test-adaequanz"];
export const BEKANNTE_LENSES = [...CODE_LENSES, "doku"];

/** Die Vorlage, die bei Rot ausgegeben wird (SSOT des Formats: docs/agent-harness.md §3a). */
export const VORLAGE =
  `KQ-Plan: kubernia-planner\n` +
  `KQ-Review: head=<sha-des-zuletzt-reviewten-Stands> runden=<1..${MAX_REVIEW_PAESSE}> ` +
  `lenses=architektur,requirement-treue,test-adaequanz ` +
  `blocker=architektur:<n>,requirement-treue:<n>,test-adaequanz:<n> verdikt=ok  ` +
  `(bei reinem Markdown-Diff: lenses=doku blocker=doku:<n>)`;

/** Welche Brillen Runde 1 mindestens abdecken muss: nur `*.md` → doku, sonst die drei
 *  Code-Brillen. Leere oder kaputte Dateiliste → voller Code-Satz (fail-closed). Gleiche
 *  Regel wie `lensPlan` im Workflow (Wächter-Test). */
export function pflichtLenses(dateien) {
  if (!Array.isArray(dateien) || dateien.length === 0) return [...CODE_LENSES];
  if (dateien.some((d) => typeof d !== "string" || d.trim() === "")) return [...CODE_LENSES];
  return dateien.every((d) => /\.md$/i.test(d.trim())) ? ["doku"] : [...CODE_LENSES];
}

/** Prüft das optionale Feld `blocker=` (#1123): je Brille die Zahl der Runde-1-Blocker. Fehlt es, ist die
 *  Zeile gültig (alte Zeilen). Pure. */
function bewerteBlocker(review) {
  const fehler = [];
  const eintraege = review.blocker;
  if (eintraege.length === 0) return ["KQ-Review: blocker ist leer (erwartet: blocker=<brille>:<n>,… je Brille der Runde 1)."];
  const gesehen = new Set();
  for (const { lens, n } of eintraege) {
    if (!BEKANNTE_LENSES.includes(lens)) fehler.push(`KQ-Review: blocker nennt unbekannte Brille "${lens}" (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
    if (!Number.isInteger(n) || n < 0) fehler.push(`KQ-Review: blocker=${lens}:${n} ist keine ganze Zahl ≥ 0.`);
    if (gesehen.has(lens)) fehler.push(`KQ-Review: blocker nennt die Brille ${lens} doppelt.`);
    gesehen.add(lens);
  }
  if (review.runden === 1) {
    const summe = eintraege.reduce((a, e) => a + (Number.isInteger(e.n) ? e.n : 0), 0);
    if (summe > 0) fehler.push("KQ-Review: Runde 1 meldete Blocker, aber es gab kein Fix-Pass (runden=1).");
    const gleich = eintraege.length === review.lenses.length && review.lenses.every((l) => gesehen.has(l));
    if (!gleich) fehler.push(`KQ-Review: runden=1, aber die Brillen von blocker (${[...gesehen].join(",")}) weichen von lenses (${review.lenses.join(",")}) ab.`);
  }
  return fehler;
}

/** Prüft `runden` gegen die Obergrenze samt optionalem `zusatzpass=<anzahl>:<grund>` (#1561): nur die Maintainerin gibt Pässe
 *  über das Cap hinaus frei; der Nachweis bleibt Selbstauskunft. Ohne Überschreitung ist ein Zusatzpass ein Fehler. Pure. */
function bewerteRunden(review) {
  const zp = review.zusatzpass ?? null;
  if (zp && "ungueltig" in zp) {
    return [`KQ-Review: zusatzpass=${zp.ungueltig} ungültig (erwartet: zusatzpass=<anzahl ≥ 1>:<Grund der Freigabe>).`];
  }
  const erlaubt = MAX_REVIEW_PAESSE + (zp ? zp.anzahl : 0);
  if (review.runden > erlaubt) {
    return [
      `KQ-Review: runden=${review.runden} überschreitet die Obergrenze (Cap ${MAX_FIX_RUNDEN} Fix-Runden = höchstens ${erlaubt} Pässe). ` +
        `Gab die Maintainerin einen Zusatzpass frei: zusatzpass=<anzahl>:<Grund> in die KQ-Review-Zeile.`,
    ];
  }
  if (zp && review.runden <= MAX_REVIEW_PAESSE) {
    return [`KQ-Review: zusatzpass ist nur bei runden > ${MAX_REVIEW_PAESSE} zulässig (runden=${review.runden}).`];
  }
  return [];
}

/** Bewertet einen geparsten Nachweis. `headBekannt`: der SHA lässt sich als Commit auflösen;
 *  `headImSlice`: er liegt in `<basis>..HEAD`. Liefert alle Fehler (leer = ok). Pure. */
export function bewerteNachweis({ nachweis, dateien, headBekannt, headImSlice, konfliktMerges = [] }) {
  const fehler = [];
  for (const sha of konfliktMerges) {
    fehler.push(
      `Konflikt-Merge ${sha} nach dem Review: Auflösung per Delta-Lens prüfen, dann neuer Nachweis (head ≥ ${sha}). ` +
        `Besser: main VOR Runde 1 oder erst nach dem Nachweis einmergen, wenn der Merge konfliktfrei ist. ` +
        `Schritte: Skill review-lenses › Nach jedem Merge von main.`,
    );
  }
  const { plan, review } = nachweis;
  if (!plan) fehler.push("KQ-Plan-Zeile fehlt (Planungspass nicht nachgewiesen).");
  else if (plan.art === "ungueltig") {
    fehler.push(`KQ-Plan ungültig: "${plan.zeile}" (erlaubt: "kubernia-planner" oder "ohne — <Begründung>").`);
  }
  if (!review) {
    fehler.push("KQ-Review-Zeile fehlt (Review-Konvergenz nicht nachgewiesen).");
    return fehler;
  }
  if (review.head === null) fehler.push("KQ-Review: head fehlt oder ist kein SHA.");
  else if (!headBekannt) fehler.push(`KQ-Review: head=${review.head} ist kein bekannter Commit.`);
  else if (!headImSlice) {
    fehler.push(`KQ-Review: head=${review.head} liegt nicht im Slice dieses PRs (Rebase/Amend nach dem Review?).`);
  }
  if (!Number.isInteger(review.runden) || review.runden < 1) {
    fehler.push("KQ-Review: runden fehlt oder ist keine Zahl ≥ 1.");
  } else {
    fehler.push(...bewerteRunden(review));
  }
  const pflicht = pflichtLenses(dateien);
  const fehlend = pflicht.filter((l) => !review.lenses.includes(l));
  const codeVoll = CODE_LENSES.every((l) => review.lenses.includes(l));
  if (fehlend.length > 0 && !codeVoll) {
    fehler.push(
      `KQ-Review: lenses fehlt ${fehlend.join(", ")} (Pflicht für diese Diff-Art: ${pflicht.join(", ")}). ` +
        `Erwartet: lenses=${pflicht.join(",")} (kleingeschrieben, ASCII, ae/oe/ue statt Umlaute).`,
    );
  }
  const unbekannt = review.lenses.filter((l) => !BEKANNTE_LENSES.includes(l));
  if (unbekannt.length > 0) {
    fehler.push(`KQ-Review: lenses enthält unbekannte Brille(n) ${unbekannt.join(", ")} (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
  }
  if (review.blocker !== null) fehler.push(...bewerteBlocker(review));
  if (review.verdikt !== "ok") fehler.push(`KQ-Review: verdikt=${review.verdikt ?? "(fehlt)"} ist nicht ok.`);
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

/** Führt die Prüfung gegen git aus. `runGit`/`env` injizierbar (Test). Fail-closed: eine nicht
 *  auflösbare Basis oder ein git-Fehler ist rot. Basis == HEAD ist grün (nichts zu prüfen). */
export function checkReviewNachweis({ runGit, env = process.env } = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const base = resolveBase(git, env);
  if (!base) return { ok: false, fehler: ["Keine Vergleichs-Basis auflösbar (flacher Checkout?) — Nachweis nicht prüfbar."] };
  try {
    const head = git(["rev-parse", "HEAD"]).trim();
    if (head === base) return { ok: true, skipped: true, fehler: [] };
    // `--reverse`: chronologisch, damit der JÜNGSTE Nachweis (`lastLine`) und die jüngste Override-Zeile gelten (Z8a).
    const messages = git(["log", "--reverse", "--format=%B", `${base}..HEAD`]);
    const ov = parseOverrideTrailers(messages, OVERRIDE_KEY);
    if (ov.valid.length > 0) {
      return { ok: true, override: ov.valid[ov.valid.length - 1].reason, fehler: [], invalid: ov.invalid };
    }
    const nachweis = parseNachweis(messages);
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
    const fehler = bewerteNachweis({ nachweis, dateien, headBekannt: headSha !== null, headImSlice, konfliktMerges });
    return {
      ok: fehler.length === 0,
      fehler,
      invalid: ov.invalid,
      commitsNachReview,
      blockerFehlt: nachweis.review?.blocker === null,
      zusatzpass: nachweis.review?.zusatzpass && "grund" in nachweis.review.zusatzpass ? nachweis.review.zusatzpass : null,
    };
  } catch (e) {
    return { ok: false, fehler: [`git-Fehler beim Prüfen des Nachweises: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const r = checkReviewNachweis();
  if (r.skipped) {
    console.log("• check-review-nachweis: Basis == HEAD, nichts zu prüfen.");
    return;
  }
  if (r.override) {
    console.log(`• geduldet: ${OVERRIDE_KEY} — ${r.override}`);
    console.log("✔ Review-/Plan-Nachweis ok (Override mit Begründung).");
    return;
  }
  meldeUngueltigeOverrides(r.invalid);
  if (r.ok) {
    if (typeof r.commitsNachReview === "number") {
      console.log(`• ${r.commitsNachReview} Commit(s) nach dem reviewten Stand (inkl. Nachweis-Commit).`);
    }
    if (r.blockerFehlt) console.log("• Hinweis: blocker= fehlt (Messung #1123).");
    if (r.zusatzpass) console.log(`• Zusatzpass (Freigabe der Maintainerin): ${r.zusatzpass.grund}`);
    console.log("✔ Review-/Plan-Nachweis ok.");
    return;
  }
  console.error("✖ Review-/Plan-Nachweis fehlt oder ist ungültig (#1270):");
  for (const f of r.fehler) console.error(`  - ${f}`);
  console.error(
    `\nNach Konvergenz des Reviews einen leeren Nachweis-Commit setzen (Format: docs/agent-harness.md §3a), ` +
      `beide Zeilen in einer Commit-Message:\nVorlage:\n${VORLAGE.replace(/^/gm, "  ")}\n` +
      `Bewusste Ausnahme (z.B. Revert-PR) mit Pflicht-Begründung: ${OVERRIDE_KEY}: #<nr> <warum>`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
