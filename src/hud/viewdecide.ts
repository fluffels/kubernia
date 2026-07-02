/* ===== KubeQuest – Reine Präsentations-Entscheidungen (#500) =====
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
  /** Erlaubte Eingaben; mindestens eine Regex muss matchen. */
  accept: RegExp[];
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

/**
 * Bewertet eine im Funk-Terminal abgesendete Zeile gegen die aktuelle Aufgabe.
 * Reine Entscheidung + fertiger Feedback-Text (die DOM-Schicht umschließt ihn nur
 * mit `<div class="tt-feedback">…</div>` und setzt innerHTML).
 *
 * Reihenfolge wie im bisherigen `termSubmit`:
 * 1. Trifft der Befehl (`accept`), nutzt aber ein gesperrtes Kürzel → `locked`
 *    (freundlicher Hinweis statt „falsch", kein Fehlversuch, #299/#366).
 * 2. Trifft der Befehl, kein Sim-Fehler, Zusatzbedingung erfüllt → `solved`.
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

  // #299/#366: Befehl trifft, nutzt aber ein noch gesperrtes Profi-Kürzel →
  // Langform-Hinweis, nicht als gelöst UND nicht als Fehlversuch werten.
  const lockedHit = cmdOk
    ? lockedAbbrevInInput(norm, ctx.isAbbrevUnlocked, ctx.unlockAbbrev)
    : undefined;
  if (lockedHit) {
    return { outcome: "locked", feedback: abbrevLockHint(lockedHit) };
  }

  if (cmdOk && !ctx.simError && ctx.checkOk) {
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
  const tip =
    (task.diag ? task.diag(norm) : null) ??
    task.why ??
    (/^docker\s+run\b/.test(norm)
      ? "Bei <code>docker run</code>: hinter <code>--name</code> steht dein Wunschname, das Image kommt ganz zuletzt – Muster <code>docker run -d --name <name> <image></code>."
      : "Vergleich ihn mit dem Muster oben – Reihenfolge und Namen genau prüfen.");
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
