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
  scoreReview,
  resolveTalkTarget,
  type SubmissionTask,
  type SubmissionContext,
} from "../src/viewdecide";

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
