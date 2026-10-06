/**
 * Gemeinsamer Vollauf-Stub der Workflow-Wächter (#1311): führt das echte Skript
 * `.claude/workflows/kubernia-ticket.js` per node:vm gegen Stub-Globals aus und zeichnet jeden
 * `agent()`-Aufruf samt Optionen auf. Vorher hatten model-routing.test.ts und review-staffel.test.ts
 * je einen eigenen Stub; ein dritter (Resume, Lernkandidaten, Entscheidungsblöcke) wäre die nächste
 * Drift-Quelle gewesen.
 *
 * Liegt bewusst in test/harness/ (geschützter Pfad, Audit-Kommentar), wie workflow-block.ts.
 * Unbekannte Labels brechen laut ab: ein neuer Aufruf im Workflow muss den Stub bewusst erweitern.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const WORKFLOW = new URL("../../.claude/workflows/kubernia-ticket.js", import.meta.url);

export type Bericht = {
  lens: string;
  verdikt: string;
  findings: { schwere: string; befund?: string; ort?: string; begruendung?: string }[];
  ausserhalbScope?: string[];
};
export type Aufruf = { label: string; agentType?: string; model?: string; effort?: string; prompt: string };

export interface LaufOptionen {
  art?: "epic" | "dependabot" | "normal";
  /** Liefert der Planer einen Plan (true, Standard) oder nichts (false)? */
  planerDa?: boolean;
  /** Antwort des Pre-Flight-Agenten; Standard: keine Klärung nötig, keine Entscheidung. */
  preflight?: Record<string, unknown>;
  /** Wert des Workflow-Globals `args` (Standard: undefined). */
  args?: unknown;
  /** "abbrechen": der Umsetzen-Agent meldet `abgebrochen` (Lauf endet dort); sonst committet er mit diesen Dateien. */
  umsetzen?: "abbrechen" | { dateien: string[]; extra?: Record<string, unknown> };
  /** Lens-Berichte je Runde, Schlüssel = Lens-Key. Fehlt eine Lens, liefert der Stub „ok“, bei `null` nichts. */
  runden?: Record<string, Bericht | null>[];
  nachbessern?: { deltaPfad?: string; deltaDateien?: string[] };
}

const ok = (lens: string): Bericht => ({ lens, verdikt: "ok", findings: [] });

export interface Endstand {
  ergebnis: string;
  review?: { lens: string; verdikt: string }[];
  ausserhalbScope?: string[];
  hinweiseOffen?: number;
  lernkandidaten?: string[];
}

export async function workflowLauf(o: LaufOptionen = {}) {
  const art = o.art ?? "normal";
  const planerDa = o.planerDa ?? true;
  const umsetzen = o.umsetzen ?? { dateien: ["src/a.ts"] };
  const quelle = readFileSync(WORKFLOW, "utf8").replace("export const meta", "const meta");
  const aufrufe: Aufruf[] = [];
  let runde = 0;
  let head = 1;
  const diff = (dateien: string[]) => ({ diffPfad: `/tmp/kq-42-r${runde + 1}.patch`, diffStat: "stat", diffHead: `h${head}`, diffDateien: dateien });
  const agent = (prompt: string, opt: { label: string; agentType?: string; model?: string; effort?: string }) => {
    aufrufe.push({ prompt, label: opt.label, agentType: opt.agentType, model: opt.model, effort: opt.effort });
    const l = opt.label;
    if (l === "auswahl+claim") {
      return Promise.resolve({ ergebnis: "ticket-geclaimt", claimVerifiziert: true, nummer: 42, titel: "Testticket", body: "Body", art });
    }
    if (opt.agentType === "kubernia-planner") return Promise.resolve(planerDa ? "PLAN-TEXT" : null);
    if (l.startsWith("preflight")) return Promise.resolve(o.preflight ?? { brauchtKlaerung: false });
    if (l.startsWith("umsetzen")) {
      if (umsetzen === "abbrechen") return Promise.resolve({ ergebnis: "abgebrochen", verifyGruen: false, abbruchgrund: "Stub: Test endet nach dem Umsetzen-Prompt" });
      return Promise.resolve({ ergebnis: "committet", verifyGruen: true, worktree: "/w", branch: "b", zusammenfassung: "z", ...diff(umsetzen.dateien), ...umsetzen.extra });
    }
    if (l.startsWith("epic-anlegen") || l.startsWith("dependabot")) return Promise.resolve("erledigt");
    if (l.startsWith("lens:")) {
      const key = l.slice("lens:".length).split(":")[0];
      const b = o.runden?.[runde]?.[key];
      return Promise.resolve(b === undefined ? ok(key) : b);
    }
    if (l.startsWith("nachbessern")) {
      runde += 1;
      head += 1;
      const dateien = umsetzen === "abbrechen" ? [] : umsetzen.dateien;
      return Promise.resolve({ verifyGruen: true, zusammenfassung: "fix", ...diff(dateien), ...o.nachbessern });
    }
    if (l.startsWith("review-festgefahren")) return Promise.resolve("ok");
    if (l.startsWith("pr+merge")) return Promise.resolve({ ergebnis: "gemergt", prNummer: 7 });
    if (l.startsWith("cleanup")) return Promise.resolve("ok");
    return Promise.reject(new Error(`Stub kennt das Label "${l}" nicht – in workflowLauf() erweitern.`));
  };
  const parallel = (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t()));
  const kontext = { agent, parallel, phase: () => undefined, log: () => undefined, args: o.args };
  const endstand = (await runInNewContext(`(async () => {\n${quelle}\nreturn endstand\n})()`, kontext)) as Endstand;
  return {
    aufrufe,
    lenses: aufrufe.filter((a) => a.label.startsWith("lens:")),
    ergebnis: endstand.ergebnis,
    // Ergebnis stammt aus einem fremden vm-Realm: über JSON normalisieren.
    endstand: JSON.parse(JSON.stringify(endstand)) as Endstand,
  };
}
