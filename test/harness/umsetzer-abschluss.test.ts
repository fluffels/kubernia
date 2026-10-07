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
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRaw from "../../scripts/umsetzer-abschluss.mjs";

type Status = { state: string; autoMergeRequest: object | null };
type Eingabe = { hookEvent?: string; agentType?: string; lastMessage?: string | null };
const abschluss = abschlussRaw as unknown as {
  abschlussBlockade: (i: Eingabe, d?: { prStatus?: (nr: string) => Status }) => string | null;
  parseErgebnis: (t: string) => { ergebnis: string | null; pr: string | null };
  parseAbschlussInput: (t: string, r?: (p: string) => string | null) => Eingabe;
  letzteNachrichtAusTranskript: (p: string) => string | null;
};
const { abschlussBlockade: blockade, parseErgebnis, parseAbschlussInput } = abschluss;

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

/** Probleme beim Abschluss: Hintergrund-Tasks vor dem Bericht stoppen (die Tool-Whitelist bindet model-routing.test.ts). */
function abschlussProbleme(md: string): string[] {
  const probleme: string[] = [];
  const a = abschnitt(md, /^## Letzte Nachricht/);
  if (!a) return ["Abschnitt „## Letzte Nachricht“ fehlt"];
  const vorBericht = a.split("```")[0];
  if (!/TaskStop/.test(vorBericht)) probleme.push("TaskStop steht nicht vor dem Berichtsformat");
  if (!/tick/.test(vorBericht) || !/until/.test(vorBericht)) probleme.push("Monitor-Regel (until-Schleife, keine Zwischenmeldungen) fehlt");
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

  test("rot: TaskStop-Satz gestrichen, nur hinter dem Format oder Monitor-Regel fehlt", () => {
    const ohneSatz = UMSETZER.replace(/Vorher beendest du alle eigenen Hintergrund-Tasks[^\n]*\n/, "");
    assert.notEqual(ohneSatz, UMSETZER, "Muster muss treffen");
    assert.ok(abschlussProbleme(ohneSatz).some((p) => p.includes("TaskStop")));
    // Nur das Wort TaskStop wandert hinter das Format; Monitor-Regel bleibt davor: genau EIN Problem.
    const hinten = UMSETZER.replace("per `TaskStop`", "per Stopp") + "\nTaskStop\n";
    assert.notEqual(hinten, UMSETZER + "\nTaskStop\n", "Muster muss treffen");
    assert.deepEqual(abschlussProbleme(hinten), ["TaskStop steht nicht vor dem Berichtsformat"]);
    const ohneTick = UMSETZER.replace("wie „tick“", "wie „x“"); // gezielt die Monitor-Regel, nicht die erste Fundstelle von „tick“ (z. B. in „Sammelticket“)
    const ohneUntil = UMSETZER.replace("einer until-Schleife", "einer Schleife");
    assert.notEqual(ohneTick, UMSETZER, "Muster tick muss treffen");
    assert.notEqual(ohneUntil, UMSETZER, "Muster until muss treffen");
    for (const md of [ohneTick, ohneUntil]) assert.deepEqual(abschlussProbleme(md), ["Monitor-Regel (until-Schleife, keine Zwischenmeldungen) fehlt"]);
    assert.ok(abschlussProbleme(UMSETZER.replace(/Wartest du per `Monitor` auf die CI[^\n]*/, "")).some((p) => p.includes("Monitor-Regel")));
  });

  test("rot: Abschnitt fehlt, Nachweis hinter dem PR-Schritt oder gestrichen", () => {
    assert.deepEqual(abschlussProbleme("# x\n"), ["Abschnitt „## Letzte Nachricht“ fehlt"]);
    assert.deepEqual(nachweisProbleme("# x\n"), ["Abschnitt „## Ablauf“ fehlt"]);
    assert.deepEqual(nachweisProbleme("## Ablauf\n\n1. nichts\n"), ["Schritt „PR bis zum Merge“ fehlt"]);
    assert.equal(nachweisProbleme("## Ablauf\n\n4. **PR bis zum Merge** x\n3. KQ-Plan: KQ-Review: check-review-nachweis\n").length, 3);
    assert.deepEqual(nachweisProbleme(UMSETZER.replace(/check-review-nachweis/g, "x")), ["check-review-nachweis steht nicht vor dem PR-Schritt"]);
  });
});

const bericht = (ergebnis: string, pr = "https://github.com/x/y/pull/1330") => `ERGEBNIS: ${ergebnis}
TICKET: #1
PR: ${pr}
`;
const offenMitAuto = () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" } });
const eingabe = (lastMessage: string | null, extra = {}) => ({ hookEvent: "SubagentStop", agentType: "kubernia-umsetzer", lastMessage, ...extra });

describe("Umsetzer endet nicht bei offenem PR mit Auto-Merge (#1331)", () => {
  test("Prosa im Umsetzer: kein Ende bei Auto-Merge, Timeout kein Abbruchgrund, Hook genannt", () => {
    const a = abschnitt(UMSETZER, /^## Letzte Nachricht/);
    assert.match(a, /offener PR mit Auto-Merge ist kein Ende/);
    assert.match(a, /Tool-Timeout beim CI-Warten ist kein Abbruchgrund/);
    assert.match(a, /timeout: 600000/);
    assert.match(a, /umsetzer-abschluss\.mjs/);
    assert.doesNotMatch(abschnitt(UMSETZER.replace("ist kein Ende.", "ist ok."), /^## Letzte Nachricht/), /ist kein Ende\./);
  });

  test("parseErgebnis liest ERGEBNIS und PR, fehlende Zeilen sind null", () => {
    assert.deepEqual(parseErgebnis(bericht("Gemergt")), { ergebnis: "gemergt", pr: "https://github.com/x/y/pull/1330" });
    assert.deepEqual(parseErgebnis("Text ohne Format"), { ergebnis: null, pr: null });
  });

  test("blockiert: gemergt oder abgebrochen bei offenem PR mit Auto-Merge", () => {
    for (const e of ["gemergt", "abgebrochen"]) {
      const g = blockade(eingabe(bericht(e)), { prStatus: offenMitAuto });
      assert.match(g ?? "", /noch offen und hat Auto-Merge/);
    }
  });

  test("blockiert: gemergt, aber PR nicht MERGED (auch ohne Auto-Merge)", () => {
    assert.match(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null }) }) ?? "", /Status OPEN/);
    assert.match(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "CLOSED", autoMergeRequest: null }) }) ?? "", /Status CLOSED/);
  });

  test("frei: MERGED, festgefahren, entscheidung-noetig, abgebrochen ohne Auto-Merge", () => {
    assert.equal(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "MERGED", autoMergeRequest: null }) }), null);
    assert.equal(blockade(eingabe(bericht("festgefahren")), { prStatus: offenMitAuto }), null);
    assert.equal(blockade(eingabe(bericht("entscheidung-noetig")), { prStatus: offenMitAuto }), null);
    assert.equal(blockade(eingabe(bericht("abgebrochen")), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null }) }), null);
  });

  test("frei: anderes Ereignis, anderer Agent, kein PR, keine Nachricht, gh-Fehler", () => {
    const d = { prStatus: offenMitAuto };
    assert.equal(blockade(eingabe(bericht("gemergt"), { hookEvent: "Stop" }), d), null);
    assert.equal(blockade(eingabe(bericht("gemergt"), { agentType: "kubernia-lens" }), d), null);
    assert.equal(blockade(eingabe(bericht("abgebrochen", "-")), d), null);
    assert.equal(blockade(eingabe(null), d), null);
    assert.equal(blockade(eingabe(bericht("gemergt")), { prStatus: () => { throw new Error("kein gh"); } }), null);
  });

  test("parseAbschlussInput: last_assistant_message, Transkript-Fallback, kaputtes JSON", () => {
    const p = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", last_assistant_message: "A" });
    assert.deepEqual(parseAbschlussInput(p), { hookEvent: "SubagentStop", agentType: "kubernia-umsetzer", lastMessage: "A" });
    const q = JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", agent_transcript_path: "/x" });
    assert.equal(parseAbschlussInput(q, () => "B").lastMessage, "B");
    assert.deepEqual(parseAbschlussInput("{kaputt"), {});
  });
});

describe("Transkript-Fallback des Abschluss-Wächters (#1331)", () => {
  const zeile = (role: string, content: unknown) => JSON.stringify({ type: role, message: { role, content } });
  const lies = abschluss.letzteNachrichtAusTranskript;
  const datei = (zeilen: string[]) => {
    const p = join(mkdtempSync(join(tmpdir(), "kq-abschluss-")), "t.jsonl");
    writeFileSync(p, zeilen.join(String.fromCharCode(10)) + String.fromCharCode(10));
    return p;
  };

  test("liefert den letzten Assistant-Text, übergeht Tool-Blöcke und abgeschnittene Zeilen", () => {
    const p = datei([
      zeile("assistant", [{ type: "text", text: "ERGEBNIS: abgebrochen" }]),
      zeile("user", "egal"),
      zeile("assistant", [{ type: "tool_use", name: "Bash" }]),
      '{"abgeschnitten',
    ]);
    assert.equal(lies(p), "ERGEBNIS: abgebrochen");
    assert.equal(lies(datei([zeile("assistant", "reiner Text")])), "reiner Text");
  });

  test("fehlende Datei oder kein Assistant-Text ergeben null (fail-open)", () => {
    assert.equal(lies(join(tmpdir(), "gibt-es-nicht-kq.jsonl")), null);
    assert.equal(lies(datei([zeile("user", "x")])), null);
  });
});
