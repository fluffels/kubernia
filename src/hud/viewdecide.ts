/* ===== Kubernia – Reine Präsentations-Entscheidungen (#500) =====
 * Pure Domäne (Phaser-/DOM-frei, unit-testbar): die Spiel-/Bewertungslogik, die
 * bislang in innerHTML-Methoden der Präsentationsschicht steckte und nur über
 * e2e (nicht Unit) prüfbar war. Wie bei `overlaykbd.ts` bleibt die DOM-Anbindung
 * dünn in `src/ui/*` (liest Zustand, ruft die Funktion hier, setzt innerHTML) –
 * die Entscheidung selbst ist hier isoliert und testbar (siehe AGENTS.md ›
 * Architektur; Muster wie overlaykbd.ts).
 *
 * Drei Entscheidungen leben hier:
 *  1. `funkSessionKind`      – welche Funk-Session ist aktiv? (radio.ts:funkSession)
 *  2. `evaluateSubmission`   – wie ist eine getippte Terminal-Zeile zu werten? (radio.ts:termSubmit)
 *  3. `scoreReview`          – zählt eine Quiz-Antwort als „sicher gekonnt"? (quiz.ts:finishReviewItem)
 *  4. `resolveTalkTarget`    – was passiert beim Ansprechen eines NPC? (hud.ts:talkTo)
 */

import { fmtCmd } from "./markup";
import type { SolvedBy } from "../types";
import {
  lockedAbbrevInInput,
  abbrevLockHint,
  flagNearMissHint,
  longFormsInInput,
} from "../content/abbrev";

/* ---------- 1. Funk-Session-Priorität (radio.ts:funkSession) ---------- */

/**
 * Welche Funk-Session ist aktiv? Bewusste Priorität: eine laufende Übungsrunde
 * geht vor dem Quest-Schritt, ein Quest-Funk-Schritt vor dem freien Ausprobieren.
 * Die DOM-Schicht liefert nur die beiden Booleans (läuft eine Übung? ist der
 * aktuelle Quest-Schritt ein Funk-Schritt?) und holt sich danach das passende
 * Step-Objekt selbst.
 */
export function funkSessionKind(
  practicePending: boolean,
  funkStep: boolean,
): "practice" | "quest" | "free" {
  if (practicePending) return "practice";
  if (funkStep) return "quest";
  return "free";
}

/* ---------- 2. Terminal-Eingabe bewerten (radio.ts:termSubmit) ---------- */

/** Minimaler, DOM-freier Steckbrief einer Terminal-Aufgabe für die Bewertung.
 *  Deckt QuestTask (ohne `why`/`diag`) UND DrillTask (mit `why`, optional `diag`)
 *  strukturell ab. Die Sim-Bedingung (`task.check`) wertet die DOM-Schicht vorab
 *  aus und reicht sie als `checkOk` herein – so bleibt dieses Modul Sim-frei. */
export interface SubmissionTask {
  /** Erlaubte Eingaben; im Modus `accept` muss mindestens eine Regex matchen. */
  accept: RegExp[];
  /** Lösungsmodus (#891): `accept` (Default) verlangt den Musterbefehl, `check`
   *  zählt jeden Weg, der den Sim-Zielzustand erreicht. `accept` steuert dann
   *  nur noch Gating und Feedback. */
  solvedBy?: SolvedBy;
  /** „Warum so?"-Begründung (Drills #233); QuestTasks haben keine → undefined. */
  why?: string;
  /** Diagnose der konkreten Fehleingabe (Drills), Vorrang vor `why`. */
  diag?: (input: string) => string | null;
}

/** Kontext der Bewertung – alles, was die DOM-Schicht vorab kennt/auswertet. */
export interface SubmissionContext {
  /** Warf der Sim-Lauf des Befehls einen Fehler? (`result.error`) */
  simError: boolean;
  /** Ist die optionale Sim-Zusatzbedingung erfüllt? (`!task.check || task.check(sim)`) */
  checkOk: boolean;
  /** Ist eine Abkürzung freigeschaltet? (`Game.isAbbrevUnlocked`) */
  isAbbrevUnlocked: (id: string) => boolean;
  /** Abkürzung, die der laufende Lehr-Schritt selbst freischaltet (#366). */
  unlockAbbrev?: string;
  /** Bisherige Fehlversuche in Folge für diese Aufgabe (`this.failCount`). */
  failCount: number;
}

/** Ergebnis der Bewertung – eine diskriminierte Union statt verschränktem innerHTML:
 *  - `locked`: Befehl trifft, nutzt aber ein noch gesperrtes Profi-Kürzel (#299) –
 *    weder gelöst noch als Fehlversuch gezählt; `feedback` weist zur Langform.
 *  - `solved`: korrekt; `longForms` = Abkürzungs-IDs, deren Langform getippt wurde
 *    (Zähler „verdiente Abkürzung" #313 – die DOM-Schicht bucht sie).
 *  - `failed`: nicht gelöst; `failCount` = fortgeschriebener Fehlerzähler,
 *    `nudge` = nach mehreren Fehlversuchen zum Hinweis-Knopf lotsen (#233). */
export type SubmissionVerdict =
  | { outcome: "locked"; feedback: string }
  | { outcome: "solved"; longForms: string[] }
  | { outcome: "failed"; failCount: number; feedback: string; nudge?: boolean };

/** Ist die Aufgabe gelöst? Modus `check` (#891): der Zielzustand allein; sonst
 *  der Musterbefehl ohne Sim-Fehler bei erfüllter Zusatzbedingung. */
function isReached(task: SubmissionTask, ctx: SubmissionContext, cmdOk: boolean): boolean {
  if (task.solvedBy === "check") return ctx.checkOk;
  return cmdOk && !ctx.simError && ctx.checkOk;
}

/** Hinweistext im Terminal-Log, wenn ein gesperrter Befehl gar nicht erst ausgeführt wurde. */
export const LOCKED_TERMINAL_NOTE = "nicht ausgeführt – Profi-Abkürzung noch gesperrt";

/** Teil des Kontexts, den das Gating braucht. */
export type GateContext = Pick<SubmissionContext, "isAbbrevUnlocked" | "unlockAbbrev">;
/** Urteil `locked` der Bewertung. */
export type LockedVerdict = Extract<SubmissionVerdict, { outcome: "locked" }>;

/**
 * Abkürzungs-Gating (#299/#366), VOR `sim.exec` aufrufbar (#1297): ein abgelehnter Befehl darf
 * den Cluster-Zustand nicht ändern. Gegated wird, wenn der Befehl trifft (accept) bzw. im Modus
 * `check` konservativ jede Eingabe (ob der Weg das Ziel erreicht, ist vor dem Lauf offen).
 */
export function gateSubmission(
  input: string,
  task: SubmissionTask,
  ctx: GateContext,
): LockedVerdict | undefined {
  const norm = input.trim().replace(/\s+/g, " ");
  if (!norm) return undefined;
  const cmdOk = task.accept.some((re) => re.test(norm));
  if (!cmdOk && task.solvedBy !== "check") return undefined;
  const hit = lockedAbbrevInInput(norm, ctx.isAbbrevUnlocked, ctx.unlockAbbrev);
  return hit ? { outcome: "locked", feedback: abbrevLockHint(hit) } : undefined;
}

/**
 * Führt `exec` nur aus, wenn das Gating nicht greift. Ohne Aufgabe (freie Session) wird
 * immer ausgeführt. Bei `locked` läuft `exec` nicht, der Zustand bleibt unverändert.
 */
export function execUnlessLocked<R>(
  input: string,
  task: SubmissionTask | null,
  ctx: GateContext,
  exec: () => R,
): { locked: LockedVerdict } | { result: R } {
  const locked = task ? gateSubmission(input, task, ctx) : undefined;
  return locked ? { locked } : { result: exec() };
}

/** Begründung für einen Fehlversuch: diag → why → docker-run-Muster → Standardtext. */
function failureTip(norm: string, task: SubmissionTask): string {
  return (
    (task.diag ? task.diag(norm) : null) ??
    task.why ??
    (/^docker\s+run\b/.test(norm)
      ? "Bei <code>docker run</code>: hinter <code>--name</code> steht dein Wunschname, das Image kommt ganz zuletzt – Muster <code>docker run -d --name <name> <image></code>."
      : "Vergleich ihn mit dem Muster oben – Reihenfolge und Namen genau prüfen.")
  );
}

/**
 * Bewertet eine im Funk-Terminal abgesendete Zeile gegen die aktuelle Aufgabe.
 * Reine Entscheidung + fertiger Feedback-Text (die DOM-Schicht umschließt ihn nur
 * mit `<div class="tt-feedback">…</div>` und setzt innerHTML).
 *
 * Reihenfolge:
 * 1. Trifft der Befehl (accept, im Modus `check` jede Eingabe) und nutzt ein gesperrtes
 *    Kürzel → `locked` (`gateSubmission`, greift in der UI schon VOR `sim.exec`, #1297)
 *    (freundlicher Hinweis statt „falsch", kein Fehlversuch, #299/#366).
 * 2. Gelöst → `solved`. Modus `accept` (Default): Befehl trifft, kein Sim-Fehler,
 *    Zusatzbedingung erfüllt. Modus `check` (#891): allein der Sim-Zielzustand
 *    zählt, auch bei einem Sim-Fehler (Vorarbeit macht die Wiederholung zur
 *    AlreadyExists-Sackgasse); `accept` steuert hier nur das Gating (1.).
 * 3. Sonst `failed`: erst eine „Beinahe"-Flag-Schreibweise gezielt erklären
 *    (#367), sonst nach dem 3. Fehlversuch zum Hinweis-Knopf lotsen (#233),
 *    sonst die Aufgabe begründen (diag → why → Muster; „nie nur falsch" #233/#307).
 */
export function evaluateSubmission(
  input: string,
  task: SubmissionTask,
  ctx: SubmissionContext,
): SubmissionVerdict {
  const norm = input.trim().replace(/\s+/g, " ");
  const cmdOk = task.accept.some((re) => re.test(norm));

  // #299/#366/#1297: gesperrtes Profi-Kürzel → Langform-Hinweis, nicht als gelöst UND nicht
  // als Fehlversuch werten (dieselbe Regel, die vor `sim.exec` greift: `gateSubmission`).
  const gate = gateSubmission(norm, task, ctx);
  if (gate) return gate;

  const reached = isReached(task, ctx, cmdOk);
  if (reached) {
    return { outcome: "solved", longForms: longFormsInInput(norm) };
  }

  // Fehlversuch: Zähler hochsetzen und die passende Begründung wählen.
  const failCount = ctx.failCount + 1;

  // #367: Beinahe-Schreibweise eines Flags (z.B. „-all") gezielt erklären.
  const nearMiss = flagNearMissHint(norm, ctx.isAbbrevUnlocked, ctx.unlockAbbrev);
  if (nearMiss) {
    return { outcome: "failed", failCount, feedback: nearMiss };
  }

  // Nach mehreren Fehlversuchen zum Hinweis-Knopf lotsen (Zähler zurücksetzen).
  if (failCount >= 3) {
    return {
      outcome: "failed",
      failCount: 0,
      nudge: true,
      feedback:
        "💪 Tippfehler sind der häufigste Stolperstein. Der 🔭 Hinweis unten hilft – das ist keine Schande!",
    };
  }

  // Immer begründen (#233/#307), auch wenn der Befehl einen Sim-Fehler warf.
  const tip = failureTip(norm, task);
  const prefix = ctx.simError
    ? "❌ "
    : "❌ Fast – der Befehl lief durch, erfüllt die Aufgabe aber noch nicht. ";
  return { outcome: "failed", failCount, feedback: prefix + fmtCmd(tip) };
}

/* ---------- 3. Quiz-Antwort werten (quiz.ts:finishReviewItem) ---------- */

/** In welchen Zähler fällt eine Antwort: richtig / mit-Hilfe / falsch. */
export type ReviewBucket = "right" | "assisted" | "wrong";

/** Ergebnis von {@link scoreReview}. `secure` steuert das Spaced Repetition. */
export interface ReviewScore {
  /** Zählt fürs SR als „sicher gekonnt"? Nur wahr, wenn OHNE Hilfe richtig. */
  secure: boolean;
  bucket: ReviewBucket;
}

/**
 * Wertet eine Quiz-/Review-Antwort. Kernregel (#234): „mit Hilfe gelöst" (erst
 * nach Retry richtig / Lösung gezeigt) zählt NICHT als sicher gekonnt – die Karte
 * soll bald wiederkommen. Nur eine ohne Hilfe richtige Antwort ist `secure`.
 */
export function scoreReview(correct: boolean, assisted: boolean): ReviewScore {
  const secure = correct && !assisted;
  const bucket: ReviewBucket = correct ? (secure ? "right" : "assisted") : "wrong";
  return { secure, bucket };
}

/* ---------- 4. NPC ansprechen: Routing (hud.ts:talkTo) ---------- */

/** Wohin ein NPC-Gespräch führt. */
export type TalkTarget = "shop" | "review" | "reviewGate" | "questStep" | "menu";

/** Kontext des Talk-Routings – von der DOM-Schicht vorab bestimmt. */
export interface TalkContext {
  /** NPC-ID des Händlers (öffnet den Shop). */
  shopNpcId: string;
  /** NPC-ID der Quiz-Krabbe (öffnet das Review). */
  reviewNpcId: string;
  /** NPC-ID eines aktiven Dialog-/Choice-Quest-Schritts, sonst null. */
  questStepNpc: string | null;
  /** Soll vor dem Start dieses Schritts erst ein Review-Gate greifen (#222)? */
  reviewGatePending: boolean;
}

/**
 * Routing fürs Ansprechen eines NPC: Händler→Shop, Quiz-Krabbe→Review, sonst der
 * laufende Dialog-/Choice-Quest-Schritt dieses NPC (davor ggf. das Wiederholungs-
 * Gate #222), sonst das NPC-Menü. Bewusste Priorität in dieser Reihenfolge.
 */
export function resolveTalkTarget(npcId: string, ctx: TalkContext): TalkTarget {
  if (npcId === ctx.shopNpcId) return "shop";
  if (npcId === ctx.reviewNpcId) return "review";
  if (ctx.questStepNpc === npcId) {
    return ctx.reviewGatePending ? "reviewGate" : "questStep";
  }
  return "menu";
}
