/* Umsetzer-Abschluss-Wächter (#1308) – der Abschluss des `kubernia-umsetzer` driftet nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Zwei Regeln hängen an Prosa in .claude/agents/kubernia-umsetzer.md:
 *   1. Vor dem Bericht (`ERGEBNIS:`) stoppt der Umsetzer alle eigenen Hintergrund-Tasks per `TaskStop`
 *      und wartet auf die CI ohne periodische Zwischenmeldungen; sonst kam derselbe Bericht dreimal an
 *      und `Monitor` lieferte veraltete „tick“-Meldungen (#1139).
 *   2. Der Nachweis-Commit (`KQ-Plan:`/`KQ-Review:`, lokal geprüft mit `check-review-nachweis`) steht im
 *      Ablauf VOR dem PR-Schritt; ohne ihn wird die PR-CI rot (#1270).
 *
 * Jede Prüfung ist ein benanntes Prädikat, das gegen das echte Artefakt UND ein rotes Gegenbeispiel läuft
 * (Vorbild langfuse-erfassung.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UMSETZER = readFileSync(resolve(ROOT, ".claude/agents/kubernia-umsetzer.md"), "utf8");

const abschnitt = (md: string, kopf: RegExp): string => {
  const zeilen = md.split("\n");
  const start = zeilen.findIndex((z) => kopf.test(z));
  if (start < 0) return "";
  const ebene = /^#+/.exec(zeilen[start])?.[0].length ?? 1;
  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    const m = /^(#+)\s/.exec(zeilen[i]);
    if (m && m[1].length <= ebene) {
      ende = i;
      break;
    }
  }
  return zeilen.slice(start, ende).join("\n");
};

const toolsZeile = (md: string): string => /^tools:\s*(.*)$/m.exec(md)?.[1] ?? "";

/** Probleme beim Abschluss: Hintergrund-Tasks vor dem Bericht stoppen, Tools dafür vorhanden. */
function abschlussProbleme(md: string): string[] {
  const probleme: string[] = [];
  const a = abschnitt(md, /^## Letzte Nachricht/);
  if (!a) return ["Abschnitt „## Letzte Nachricht“ fehlt"];
  const vorBericht = a.split("```")[0];
  if (!/TaskStop/.test(vorBericht)) probleme.push("TaskStop steht nicht vor dem Berichtsformat");
  if (!/tick/.test(vorBericht) || !/until/.test(vorBericht)) probleme.push("Monitor-Regel (until-Schleife, keine Zwischenmeldungen) fehlt");
  const tools = toolsZeile(md).split(",").map((t) => t.trim());
  for (const t of ["TaskStop", "Monitor"]) if (!tools.includes(t)) probleme.push(`Tool ${t} fehlt in der Whitelist`);
  return probleme;
}

/** Probleme beim Nachweis: KQ-Plan/KQ-Review/check-review-nachweis stehen im Ablauf vor dem PR-Schritt. */
function nachweisProbleme(md: string): string[] {
  const a = abschnitt(md, /^## Ablauf/);
  if (!a) return ["Abschnitt „## Ablauf“ fehlt"];
  const prPos = a.indexOf("**PR bis zum Merge**");
  if (prPos < 0) return ["Schritt „PR bis zum Merge“ fehlt"];
  const davor = a.slice(0, prPos);
  return ["KQ-Plan:", "KQ-Review:", "check-review-nachweis"].filter((s) => !davor.includes(s)).map((s) => `${s} steht nicht vor dem PR-Schritt`);
}

describe("Umsetzer-Abschluss (#1308)", () => {
  test("echtes Artefakt: Abschluss und Nachweis sind gebunden", () => {
    assert.deepEqual(abschlussProbleme(UMSETZER), []);
    assert.deepEqual(nachweisProbleme(UMSETZER), []);
  });

  test("rot: TaskStop-Satz gestrichen", () => {
    const ohne = UMSETZER.replace(/Vorher beendest du alle eigenen Hintergrund-Tasks[^\n]*\n/, "");
    assert.notEqual(ohne, UMSETZER, "Muster muss treffen");
    assert.ok(abschlussProbleme(ohne).some((p) => p.includes("TaskStop")));
  });

  test("rot: TaskStop nur hinter dem Berichtsformat", () => {
    const hinten = UMSETZER.replace(/Vorher beendest du[^\n]*\n\n/, "") + "\nTaskStop\n";
    assert.ok(abschlussProbleme(hinten).length > 0);
  });

  test("rot: Monitor-Regel ohne until-Schleife / tick", () => {
    const ohne = UMSETZER.replace(/Auf die CI wartest du[^\n]*/, "");
    assert.ok(abschlussProbleme(ohne).some((p) => p.includes("Monitor-Regel")));
  });

  test("rot: Whitelist ohne TaskStop oder Monitor", () => {
    const ohneStop = UMSETZER.replace(/^(tools:.*)\bTaskStop, /m, "$1");
    assert.ok(abschlussProbleme(ohneStop).some((p) => p.includes("Tool TaskStop")));
    const ohneMon = UMSETZER.replace(/^(tools:.*)\bMonitor, /m, "$1");
    assert.ok(abschlussProbleme(ohneMon).some((p) => p.includes("Tool Monitor")));
  });

  test("rot: Abschnitt fehlt", () => {
    assert.deepEqual(abschlussProbleme("# x\n"), ["Abschnitt „## Letzte Nachricht“ fehlt"]);
    assert.deepEqual(nachweisProbleme("# x\n"), ["Abschnitt „## Ablauf“ fehlt"]);
  });

  test("rot: Nachweis hinter dem PR-Schritt oder gestrichen", () => {
    const spaet = "## Ablauf\n\n4. **PR bis zum Merge** x\n3. KQ-Plan: KQ-Review: check-review-nachweis\n";
    assert.equal(nachweisProbleme(spaet).length, 3);
    const ohne = UMSETZER.replace(/check-review-nachweis/g, "x");
    assert.deepEqual(nachweisProbleme(ohne), ["check-review-nachweis steht nicht vor dem PR-Schritt"]);
    assert.deepEqual(nachweisProbleme("## Ablauf\n\n1. nichts\n"), ["Schritt „PR bis zum Merge“ fehlt"]);
  });
});
