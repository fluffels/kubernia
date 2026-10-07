/* Reine Präsentations-Entscheidungen (#500).
 *
 * Prüft die aus den DOM-Methoden herausgelöste Bewertungslogik ohne DOM/Sim:
 * funkSessionKind (Session-Priorität), evaluateSubmission (Terminal-Wertung inkl.
 * Gating/Near-Miss/Begründung + Fehlerzähler), scoreReview (SR-Sicherheit) und
 * resolveTalkTarget (NPC-Routing). Bewusst mit Negativ-/Grenzfällen, damit die
 * Verdikte gegen echte Regressionen abgesichert sind.
 */
import { test, expect, describe } from "vitest";
import {
  funkSessionKind,
  evaluateSubmission,
  gateSubmission,
  execUnlessLocked,
  scoreReview,
  resolveTalkTarget,
  type SubmissionTask,
  type SubmissionContext,
} from "../src/hud/viewdecide";

/* ---------- funkSessionKind ---------- */

describe("funkSessionKind – Session-Priorität", () => {
  test("laufende Übung geht vor allem", () => {
    expect(funkSessionKind(true, true)).toBe("practice");
    expect(funkSessionKind(true, false)).toBe("practice");
  });
  test("ohne Übung entscheidet der Quest-Funk-Schritt", () => {
    expect(funkSessionKind(false, true)).toBe("quest");
  });
  test("sonst frei", () => {
    expect(funkSessionKind(false, false)).toBe("free");
  });
});

/* ---------- evaluateSubmission ---------- */

// Basis-Kontext: nichts freigeschaltet, kein Sim-Fehler, Bedingung erfüllt, keine Vorfehler.
const baseCtx = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  simError: false,
  checkOk: true,
  isAbbrevUnlocked: () => false,
  unlockAbbrev: undefined,
  failCount: 0,
  ...over,
});
const task = (over: Partial<SubmissionTask> = {}): SubmissionTask => ({
  accept: [/^docker ps$/],
  ...over,
});

describe("evaluateSubmission – gelöst", () => {
  test("Treffer ohne Fehler + erfüllte Bedingung ist gelöst (keine Langform)", () => {
    const v = evaluateSubmission("docker ps", task(), baseCtx());
    expect(v.outcome).toBe("solved");
    if (v.outcome === "solved") expect(v.longForms).toEqual([]);
  });

  test("getippte Langform wird für die Freischaltung gemeldet (#313)", () => {
    const v = evaluateSubmission("docker ps --all", task({ accept: [/^docker ps --all$/] }), baseCtx());
    expect(v.outcome).toBe("solved");
    if (v.outcome === "solved") expect(v.longForms).toContain("docker-ps-all");
  });
});

describe("evaluateSubmission – Abkürzungs-Gating (#299/#366)", () => {
  const poTask = task({ accept: [/^kubectl get po$/] });

  test("gesperrtes Profi-Kürzel → locked (Hinweis, KEIN Fehlversuch)", () => {
    const v = evaluateSubmission("kubectl get po", poTask, baseCtx());
    expect(v.outcome).toBe("locked");
    if (v.outcome === "locked") {
      expect(v.feedback).toContain("🔒");
      expect(v.feedback).toContain("pods"); // Langform-Vorschlag
    }
    // Red-Green: locked trägt bewusst KEINEN failCount (kein Fehlversuch).
    expect("failCount" in v).toBe(false);
  });

  test("freigeschaltet → dasselbe Kürzel ist gelöst statt gesperrt", () => {
    const v = evaluateSubmission("kubectl get po", poTask, baseCtx({ isAbbrevUnlocked: () => true }));
    expect(v.outcome).toBe("solved");
  });

  test("der freischaltende Lehr-Schritt darf sein eigenes Kürzel schon nutzen (#366)", () => {
    const v = evaluateSubmission("kubectl get po", poTask, baseCtx({ unlockAbbrev: "kubectl-pods" }));
    expect(v.outcome).toBe("solved");
  });
});

describe("evaluateSubmission – Fehlversuch", () => {
  test("Bedingung nicht erfüllt → failed mit 'Fast'-Prefix, Zähler +1", () => {
    const v = evaluateSubmission("docker ps", task(), baseCtx({ checkOk: false }));
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") {
      expect(v.failCount).toBe(1);
      expect(v.feedback).toContain("Fast");
    }
  });

  test("Sim-Fehler trotz Treffer → failed, nüchternes ❌ ohne 'Fast'", () => {
    const v = evaluateSubmission("docker ps", task(), baseCtx({ simError: true }));
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.feedback.startsWith("❌ ") && !v.feedback.includes("Fast")).toBe(true);
  });

  test("Beinahe-Flag (#367) → gezielter Hinweis statt generischer Meldung", () => {
    const v = evaluateSubmission("docker ps -all", task({ accept: [/^docker ps -a$/] }), baseCtx());
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") {
      expect(v.feedback).toContain("gibt es nicht");
      expect(v.feedback).toContain("--all");
    }
  });

  test("ab dem 3. Fehlversuch zum Hinweis lotsen + Zähler zurücksetzen (#233)", () => {
    const v = evaluateSubmission("bloedsinn", task(), baseCtx({ failCount: 2 }));
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") {
      expect(v.nudge).toBe(true);
      expect(v.failCount).toBe(0);
      expect(v.feedback).toContain("Tippfehler");
    }
  });

  test("diag hat Vorrang vor why (Drill-Diagnose)", () => {
    const v = evaluateSubmission("falsch", task({ accept: [/^x$/], why: "Prinzip", diag: (i) => "Diag:" + i }), baseCtx());
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.feedback).toContain("Diag:falsch");
  });

  test("ohne diag begründet why das Prinzip (#233)", () => {
    const v = evaluateSubmission("falsch", task({ accept: [/^x$/], why: "Weil-Prinzip" }), baseCtx());
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.feedback).toContain("Weil-Prinzip");
  });

  test("ohne diag/why fällt der docker-run-Hinweis ein", () => {
    const v = evaluateSubmission("docker run foo", task({ accept: [/^never$/] }), baseCtx());
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.feedback).toContain("docker run");
  });
});

/* ---------- scoreReview ---------- */

describe("scoreReview – sicher gekonnt (#234)", () => {
  test("ohne Hilfe richtig ist sicher", () => {
    expect(scoreReview(true, false)).toEqual({ secure: true, bucket: "right" });
  });
  test("mit Hilfe richtig zählt NICHT als sicher", () => {
    expect(scoreReview(true, true)).toEqual({ secure: false, bucket: "assisted" });
  });
  test("falsch ist nie sicher (auch ohne Hilfe)", () => {
    expect(scoreReview(false, false)).toEqual({ secure: false, bucket: "wrong" });
    expect(scoreReview(false, true)).toEqual({ secure: false, bucket: "wrong" });
  });
});

/* ---------- resolveTalkTarget ---------- */

describe("resolveTalkTarget – NPC-Routing", () => {
  const ctx = {
    shopNpcId: "pelle",
    reviewNpcId: "kralle",
    questStepNpc: "ole" as string | null,
    reviewGatePending: false,
  };

  test("Händler öffnet den Shop", () => {
    expect(resolveTalkTarget("pelle", ctx)).toBe("shop");
  });
  test("Quiz-Krabbe öffnet das Review", () => {
    expect(resolveTalkTarget("kralle", ctx)).toBe("review");
  });
  test("aktiver Quest-Schritt dieses NPC → Quest-Schritt", () => {
    expect(resolveTalkTarget("ole", ctx)).toBe("questStep");
  });
  test("mit fälligem Gate erst das Wiederholungs-Gate (#222)", () => {
    expect(resolveTalkTarget("ole", { ...ctx, reviewGatePending: true })).toBe("reviewGate");
  });
  test("NPC ohne aktiven Schritt → Menü", () => {
    expect(resolveTalkTarget("bo", ctx)).toBe("menu");
    expect(resolveTalkTarget("ole", { ...ctx, questStepNpc: null })).toBe("menu");
  });
  test("Shop/Review haben Vorrang vor Gate/Schritt", () => {
    expect(resolveTalkTarget("pelle", { ...ctx, questStepNpc: "pelle", reviewGatePending: true })).toBe("shop");
  });
});

/* ---------- evaluateSubmission – solvedBy: "check" (#891) ---------- */

describe("evaluateSubmission – solvedBy: check (#891)", () => {
  const checkTask = (over: Partial<SubmissionTask> = {}): SubmissionTask =>
    task({ accept: [/^docker ps$/], solvedBy: "check", ...over });

  test("anderer Weg, Zielzustand erreicht → gelöst (Red-Green: Default-Modus → failed)", () => {
    const alt = "docker container ls";
    expect(evaluateSubmission(alt, checkTask(), baseCtx()).outcome).toBe("solved");
    expect(evaluateSubmission(alt, task(), baseCtx()).outcome).toBe("failed");
  });

  test("accept trifft, Zielzustand aber nicht erreicht → failed mit 'Fast'", () => {
    const v = evaluateSubmission("docker ps", checkTask(), baseCtx({ checkOk: false }));
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.feedback).toContain("Fast");
  });

  test("Sim-Fehler, Zielzustand dennoch erreicht → gelöst (Default-Modus: failed)", () => {
    expect(evaluateSubmission("docker ps", checkTask(), baseCtx({ simError: true })).outcome).toBe("solved");
    expect(evaluateSubmission("docker ps", task(), baseCtx({ simError: true })).outcome).toBe("failed");
  });

  test("Ziel über gesperrtes Kürzel erreicht → locked, kein Fehlversuch", () => {
    const v = evaluateSubmission("kubectl get po", checkTask({ accept: [/^kubectl get pods$/] }), baseCtx());
    expect(v.outcome).toBe("locked");
    expect("failCount" in v).toBe(false);
  });

  test("Ziel nicht erreicht → Feedback-Kette wie bisher (Nudge ab dem 3. Fehlversuch)", () => {
    const v = evaluateSubmission("bloedsinn", checkTask(), baseCtx({ checkOk: false, failCount: 2 }));
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") expect(v.nudge).toBe(true);
  });
});

/* ---------- gateSubmission / execUnlessLocked (#1297) ---------- */

describe("gateSubmission – Gate vor sim.exec (#1297)", () => {
  const gctx = (over: Partial<SubmissionContext> = {}) => {
    const c = baseCtx(over);
    return { isAbbrevUnlocked: c.isAbbrevUnlocked, unlockAbbrev: c.unlockAbbrev };
  };
  const poTask = task({ accept: [/^kubectl get po$/] });
  const checkTask = task({ accept: [/^kubectl get pods$/], solvedBy: "check" });

  test("accept trifft + gesperrtes Kürzel → locked ohne failCount", () => {
    const v = gateSubmission("kubectl get po", poTask, gctx());
    expect(v?.outcome).toBe("locked");
    expect(v && "failCount" in v).toBe(false);
  });
  test("freigeschaltet → undefined", () => {
    expect(gateSubmission("kubectl get po", poTask, gctx({ isAbbrevUnlocked: () => true }))).toBeUndefined();
  });
  test("unlockAbbrev des Lehrschritts → undefined (#366)", () => {
    expect(gateSubmission("kubectl get po", poTask, gctx({ unlockAbbrev: "kubectl-pods" }))).toBeUndefined();
  });
  test("Modus accept, accept trifft nicht → undefined", () => {
    expect(gateSubmission("kubectl get po -A", poTask, gctx())).toBeUndefined();
  });
  test("Modus check, accept trifft nicht, gesperrtes Kürzel → locked", () => {
    expect(gateSubmission("kubectl get po", checkTask, gctx())?.outcome).toBe("locked");
  });
  test("Modus check ohne Kürzel → undefined", () => {
    expect(gateSubmission("kubectl get pods", checkTask, gctx())).toBeUndefined();
  });
  test("leere Eingabe → undefined", () => {
    expect(gateSubmission("   ", checkTask, gctx())).toBeUndefined();
  });
  test("evaluateSubmission Modus check, gesperrtes Kürzel, checkOk false → locked", () => {
    expect(evaluateSubmission("kubectl get po", checkTask, baseCtx({ checkOk: false })).outcome).toBe("locked");
  });

  test("Gleichlauf: evaluateSubmission locked ⇔ gateSubmission liefert Urteil", () => {
    for (const solvedBy of [undefined, "check"] as const) {
      for (const input of ["kubectl get po", "kubectl get pods", "kubectl get po -A", "docker ps"]) {
        for (const unlocked of [false, true]) {
          for (const checkOk of [false, true]) {
            for (const simError of [false, true]) {
              const t = task({ accept: [/^kubectl get po$/, /^kubectl get pods$/], solvedBy });
              const ctx = baseCtx({ isAbbrevUnlocked: () => unlocked, checkOk, simError });
              const locked = evaluateSubmission(input, t, ctx).outcome === "locked";
              expect(locked).toBe(gateSubmission(input, t, ctx) !== undefined);
            }
          }
        }
      }
    }
  });
});

describe("execUnlessLocked (#1297)", () => {
  const gctx = { isAbbrevUnlocked: () => false };
  const poTask = task({ accept: [/^kubectl get po$/] });

  test("locked → exec läuft nicht", () => {
    let calls = 0;
    const r = execUnlessLocked("kubectl get po", poTask, gctx, () => ++calls);
    expect("locked" in r).toBe(true);
    expect(calls).toBe(0);
  });
  test("offen → exec läuft genau einmal", () => {
    let calls = 0;
    const r = execUnlessLocked("kubectl get po", poTask, { isAbbrevUnlocked: () => true }, () => ++calls);
    expect(r).toEqual({ result: 1 });
    expect(calls).toBe(1);
  });
  test("ohne Aufgabe (freie Session) wird immer ausgeführt", () => {
    let calls = 0;
    const r = execUnlessLocked("kubectl get po", null, gctx, () => ++calls);
    expect("result" in r).toBe(true);
    expect(calls).toBe(1);
  });
});
