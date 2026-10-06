// Kein Shebang — wie check-diffsize.mjs: wird per `node scripts/check-review-nachweis.mjs`
// gestartet (CI + lokal) UND von test/review-nachweis.test.ts importiert.
/**
 * Review- und Plan-Nachweis-Wächter (#1270) — macht Planungspass und Review-Konvergenz
 * pfadunabhängig prüfbar.
 *
 * Hintergrund: Review-Pflicht, Cap 2 und der Planer waren nur im Workflow
 * (`.claude/workflows/kubernia-ticket.js`) im Code erzwungen. Im Skill-Pfad sind sie
 * Verhaltensregeln: ein PR ohne Review-Runde, mit Überschreitung der Obergrenze oder ohne
 * Planer fiel nirgends auf. Dieser Wächter verlangt im Slice (Commits `<basis>..HEAD`) zwei
 * Zeilen am Zeilenanfang einer Commit-Message, gleiches Muster wie `KQ-Diffsize-Override`:
 *
 *   KQ-Plan: kubernia-planner            |  KQ-Plan: ohne — <Begründung>
 *   KQ-Review: head=<sha> runden=<1..3> lenses=<Brillen des vollen Passes (Runde 1), kommagetrennt> verdikt=ok
 *
 * Geprüft wird Konsistenz und Existenz, nicht Wahrheit: der Nachweis ist Selbstauskunft.
 * Aus einer stillen Auslassung wird so eine bewusste Falschangabe; die unabhängige Prüfung
 * ist ein CI-Reviewer (#1117). `head` muss im Slice liegen, die Lens-Brillen müssen zur
 * Diff-Art passen (reiner Markdown-Diff → doku, sonst die drei Code-Brillen).
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
import { parseOverrideTrailers, resolveBase } from "./check-diffsize.mjs";

/** Obergrenze der Fix-Runden (Cap 2); der Workflow trägt dieselbe Zahl (Wächter-Test). */
export const MAX_FIX_RUNDEN = 2;
/** Höchstens so viele Review-Pässe: 1 Erstpass + MAX_FIX_RUNDEN nach je einem Fix. */
export const MAX_REVIEW_PAESSE = MAX_FIX_RUNDEN + 1;

export const OVERRIDE_KEY = "KQ-Review-Override";

const CODE_LENSES = ["architektur", "requirement-treue", "test-adaequanz"];

/** Die Vorlage, die bei Rot ausgegeben wird (SSOT des Formats: docs/agent-harness.md §3a). */
export const VORLAGE =
  `KQ-Plan: kubernia-planner\n` +
  `KQ-Review: head=<sha-des-zuletzt-reviewten-Stands> runden=<1..${MAX_REVIEW_PAESSE}> ` +
  `lenses=<Brillen des vollen Passes (Runde 1), kommagetrennt> verdikt=ok`;

/** Welche Brillen Runde 1 mindestens abdecken muss: nur `*.md` → doku, sonst die drei
 *  Code-Brillen. Leere oder kaputte Dateiliste → voller Code-Satz (fail-closed). Gleiche
 *  Regel wie `lensPlan` im Workflow (Wächter-Test). */
export function pflichtLenses(dateien) {
  if (!Array.isArray(dateien) || dateien.length === 0) return [...CODE_LENSES];
  if (dateien.some((d) => typeof d !== "string" || d.trim() === "")) return [...CODE_LENSES];
  return dateien.every((d) => /\.md$/i.test(d.trim())) ? ["doku"] : [...CODE_LENSES];
}

function lastLine(text, key) {
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "gm");
  const all = [...String(text).replace(/\r/g, "").matchAll(re)];
  return all.length > 0 ? all[all.length - 1][1].trim() : null;
}

/** Parst die letzte `KQ-Plan:`- und die letzte `KQ-Review:`-Zeile (am Zeilenanfang, nicht
 *  eingerückt) aus beliebigem Message-Text. Pure. Felder, die fehlen oder kaputt sind, bleiben
 *  null bzw. NaN; bewertet wird erst in bewerteNachweis. */
export function parseNachweis(text) {
  const planWert = lastLine(text, "KQ-Plan");
  let plan = null;
  if (planWert !== null) {
    const ohne = /^ohne\s*[—–-]+\s*(\S.*)$/.exec(planWert);
    if (planWert === "kubernia-planner") plan = { art: "planer" };
    else if (ohne) plan = { art: "ohne", grund: ohne[1].trim() };
    else plan = { art: "ungueltig", zeile: planWert };
  }
  const reviewWert = lastLine(text, "KQ-Review");
  let review = null;
  if (reviewWert !== null) {
    const felder = {};
    for (const tok of reviewWert.split(/\s+/)) {
      const m = /^([a-z]+)=(.*)$/.exec(tok);
      if (m) felder[m[1]] = m[2];
    }
    review = {
      zeile: reviewWert,
      head: /^[0-9a-f]{7,40}$/i.test(felder.head ?? "") ? felder.head.toLowerCase() : null,
      runden: /^\d+$/.test(felder.runden ?? "") ? Number(felder.runden) : Number.NaN,
      lenses: (felder.lenses ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      verdikt: felder.verdikt ?? null,
    };
  }
  return { plan, review };
}

/** Bewertet einen geparsten Nachweis. `headBekannt`: der SHA lässt sich als Commit auflösen;
 *  `headImSlice`: er liegt in `<basis>..HEAD`. Liefert alle Fehler (leer = ok). Pure. */
export function bewerteNachweis({ nachweis, dateien, headBekannt, headImSlice }) {
  const fehler = [];
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
  } else if (review.runden > MAX_REVIEW_PAESSE) {
    fehler.push(
      `KQ-Review: runden=${review.runden} überschreitet die Obergrenze (Cap ${MAX_FIX_RUNDEN} Fix-Runden = höchstens ${MAX_REVIEW_PAESSE} Pässe).`,
    );
  }
  const pflicht = pflichtLenses(dateien);
  const fehlend = pflicht.filter((l) => !review.lenses.includes(l));
  const codeVoll = CODE_LENSES.every((l) => review.lenses.includes(l));
  if (fehlend.length > 0 && !codeVoll) {
    fehler.push(`KQ-Review: lenses fehlt ${fehlend.join(", ")} (Pflicht für diese Diff-Art: ${pflicht.join(", ")}).`);
  }
  if (review.verdikt !== "ok") fehler.push(`KQ-Review: verdikt=${review.verdikt ?? "(fehlt)"} ist nicht ok.`);
  return fehler;
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
    const messages = git(["log", "--format=%B", `${base}..HEAD`]);
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
    if (nachweis.review?.head) {
      try {
        headSha = git(["rev-parse", "--verify", "--quiet", `${nachweis.review.head}^{commit}`]).trim() || null;
      } catch {
        headSha = null;
      }
      if (headSha) {
        headImSlice = git(["rev-list", `${base}..HEAD`]).split(/\r?\n/).includes(headSha);
        if (headImSlice) commitsNachReview = Number(git(["rev-list", "--count", "--no-merges", `${headSha}..HEAD`]).trim());
      }
    }
    const fehler = bewerteNachweis({ nachweis, dateien, headBekannt: headSha !== null, headImSlice });
    return { ok: fehler.length === 0, fehler, invalid: ov.invalid, commitsNachReview };
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
  for (const line of r.invalid ?? []) {
    console.log(`• ungültige Override-Zeile ignoriert (braucht "#<nr> <warum>"): ${line}`);
  }
  if (r.ok) {
    if (typeof r.commitsNachReview === "number") {
      console.log(`• ${r.commitsNachReview} Commit(s) nach dem reviewten Stand (inkl. Nachweis-Commit).`);
    }
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
