/* Umsetzer-Abschluss-Wächter (#1308) – der Abschluss des `kubernia-umsetzer` driftet nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Zwei Regeln hängen an Prosa in .claude/agents/kubernia-umsetzer.md:
 *   1. Vor dem Bericht (`ERGEBNIS:`) stoppt der Umsetzer alle eigenen Hintergrund-Tasks per `TaskStop`
 *      und wartet auf die CI blockierend im Vordergrund (ein Monitor hält den Lauf nicht offen, #1342), auf
 *      Lenses per Turn-Ende; sonst kam derselbe Bericht mehrfach an oder der Lauf endete mitten im Review (#1139).
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

type Status = { state: string; autoMergeRequest: object | null; labels?: { name: string }[] };
type Eingabe = { hookEvent?: string; agentType?: string; toolName?: string; lastMessage?: string | null };
const abschluss = abschlussRaw as unknown as {
  abschlussBlockade: (i: Eingabe, d?: { prStatus?: (nr: string) => Status }) => string | null;
  parseErgebnis: (t: string) => { token: string | null; zusatz: string | null; pr: string | null; schnitt: string | null; uebergabe: boolean; festgefahren: string | null };
  ERGEBNIS_WERTE: string[];
  PR_FELDER: string;
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
  if (!/blockierend im Vordergrund/.test(vorBericht) || !/hält deinen Lauf nicht offen/.test(vorBericht) || !/node scripts\/pr-warten\.mjs/.test(vorBericht))
    probleme.push("Warte-Regel (blockierend im Vordergrund, Monitor hält den Lauf nicht offen) fehlt");
  if (/per `Monitor`/.test(vorBericht)) probleme.push("Monitor als CI-Warteweg ist verboten (hält den Lauf nicht offen)");
  if (!/Turn mit einer kurzen Statuszeile/.test(vorBericht)) probleme.push("Warten auf Lenses per Turn-Ende mit Statuszeile fehlt");
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

  test("rot: TaskStop-Satz gestrichen, nur hinter dem Format, Warte-Regel fehlt oder Monitor-Weg zurück", () => {
    const ohneSatz = UMSETZER.replace(/Vorher beendest du alle eigenen Hintergrund-Tasks[^\n]*\n/, "");
    assert.notEqual(ohneSatz, UMSETZER, "Muster muss treffen");
    assert.ok(abschlussProbleme(ohneSatz).some((p) => p.includes("TaskStop")));
    // Nur das Wort TaskStop wandert hinter das Format; Monitor-Regel bleibt davor: genau EIN Problem.
    const hinten = UMSETZER.replace("per `TaskStop`", "per Stopp") + "\nTaskStop\n";
    assert.notEqual(hinten, UMSETZER + "\nTaskStop\n", "Muster muss treffen");
    assert.deepEqual(abschlussProbleme(hinten), ["TaskStop steht nicht vor dem Berichtsformat"]);
    const ohneVordergrund = UMSETZER.replace("blockierend im Vordergrund", "irgendwie");
    assert.notEqual(ohneVordergrund, UMSETZER, "Muster Vordergrund muss treffen");
    assert.deepEqual(abschlussProbleme(ohneVordergrund), ["Warte-Regel (blockierend im Vordergrund, Monitor hält den Lauf nicht offen) fehlt"]);
    const mitMonitor = UMSETZER.replace("Ein Tool-Timeout beim CI-Warten ist kein Abbruchgrund:", "Ein Tool-Timeout beim CI-Warten ist kein Abbruchgrund: per `Monitor`-Wartebefehl oder");
    assert.notEqual(mitMonitor, UMSETZER, "Muster Monitor muss treffen");
    assert.deepEqual(abschlussProbleme(mitMonitor), ["Monitor als CI-Warteweg ist verboten (hält den Lauf nicht offen)"]);
    const ohneLensRegel = UMSETZER.replace("Turn mit einer kurzen Statuszeile", "Turn");
    assert.notEqual(ohneLensRegel, UMSETZER, "Muster Lens muss treffen");
    assert.deepEqual(abschlussProbleme(ohneLensRegel), ["Warten auf Lenses per Turn-Ende mit Statuszeile fehlt"]);
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
BEFUNDE: keine
`;
const offenMitAuto = () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" }, labels: [] });
const stuck = { name: "status:festgefahren" };
const eingabe = (lastMessage: string | null, extra = {}) => ({ hookEvent: "SubagentStop", agentType: "kubernia-umsetzer", lastMessage, ...extra });
const vorher = (lastMessage: string | null, extra = {}) => eingabe(lastMessage, { hookEvent: "PreToolUse", toolName: "SubagentHandback", ...extra });

describe("Umsetzer endet nicht bei offenem PR mit Auto-Merge (#1331)", () => {
  test("Prosa im Umsetzer: kein Ende bei Auto-Merge, Timeout kein Abbruchgrund, Hook genannt", () => {
    const a = abschnitt(UMSETZER, /^## Letzte Nachricht/);
    assert.match(a, /offener PR mit Auto-Merge ist kein Ende/);
    assert.match(a, /Tool-Timeout beim CI-Warten ist kein Abbruchgrund/);
    assert.match(a, /timeout: 300000/);
    assert.match(a, /umsetzer-abschluss\.mjs/);
    assert.doesNotMatch(abschnitt(UMSETZER.replace("ist kein Ende.", "ist ok."), /^## Letzte Nachricht/), /ist kein Ende\./);
  });

  test("parseErgebnis: Token, Zusatz und PR; fehlende Zeilen und unbekannte Werte sind null", () => {
    assert.deepEqual(parseErgebnis(bericht("Gemergt")), { token: "gemergt", zusatz: "", pr: "https://github.com/x/y/pull/1330", schnitt: null, uebergabe: false, festgefahren: null });
    assert.deepEqual(parseErgebnis(bericht("festgefahren (NICHT gemergt, Lauf beendet)")), {
      token: "festgefahren",
      zusatz: "(NICHT gemergt, Lauf beendet)",
      pr: "https://github.com/x/y/pull/1330",
      schnitt: null,
      uebergabe: false,
      festgefahren: null,
    });
    assert.deepEqual(parseErgebnis("Text ohne Format"), { token: null, zusatz: null, pr: null, schnitt: null, uebergabe: false, festgefahren: null });
    assert.equal(parseErgebnis(bericht("fertig")).token, null);
    assert.equal(parseErgebnis(bericht("gemergt | abgebrochen")).zusatz, "| abgebrochen");
  });

  test("blockiert: gemergt oder abgebrochen bei offenem PR mit Auto-Merge, auch mit Zusatz; Grund nennt keinen Monitor-Weg", () => {
    for (const e of ["gemergt", "abgebrochen", "abgebrochen (Zwischenstand)"]) {
      const g = blockade(eingabe(bericht(e)), { prStatus: offenMitAuto });
      assert.match(g ?? "", /noch offen und hat Auto-Merge/);
      assert.match(g ?? "", /node scripts\/pr-warten\.mjs 1330/);
      assert.match(g ?? "", /Monitor hält deinen Lauf nicht offen/);
      assert.doesNotMatch(g ?? "", /Monitor-until|per `Monitor`/);
    }
  });

  test("blockiert: gemergt, aber PR nicht MERGED (auch ohne Auto-Merge)", () => {
    assert.match(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null }) }) ?? "", /Status OPEN/);
    assert.match(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "CLOSED", autoMergeRequest: null }) }) ?? "", /Status CLOSED/);
  });

  test("frei: MERGED, entscheidung-noetig, abgebrochen ohne Auto-Merge", () => {
    assert.equal(blockade(eingabe(bericht("gemergt")), { prStatus: () => ({ state: "MERGED", autoMergeRequest: null }) }), null);
    assert.equal(blockade(eingabe(bericht("entscheidung-noetig")), { prStatus: offenMitAuto }), null);
    assert.equal(blockade(eingabe(bericht("abgebrochen")), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null }) }), null);
  });

  test("frei: anderes Ereignis, anderer oder fehlender Agent, fremdes Tool, kein PR, keine Nachricht, gh-Fehler", () => {
    const d = { prStatus: offenMitAuto };
    assert.equal(blockade(eingabe(bericht("gemergt"), { hookEvent: "Stop" }), d), null);
    assert.equal(blockade(eingabe(bericht("gemergt"), { agentType: "kubernia-lens" }), d), null);
    assert.equal(blockade(eingabe(bericht("gemergt"), { agentType: undefined }), d), null);
    assert.equal(blockade(vorher("kaputt", { toolName: "Bash" }), d), null);
    assert.equal(blockade(vorher("kaputt", { agentType: "kubernia-lens" }), d), null);
    assert.equal(blockade(eingabe(bericht("abgebrochen", "-")), d), null);
    assert.equal(blockade(eingabe(null), d), null);
    assert.equal(
      blockade(eingabe(bericht("gemergt")), {
        prStatus: () => {
          throw new Error("kein gh");
        },
      }),
      null,
    );
  });

  test("PR-Angabe als URL, #Nummer oder Zahl wird erkannt; Status null gibt frei", () => {
    for (const pr of ["https://github.com/x/y/pull/7", "#7", "7"])
      assert.match(
        blockade(eingabe(bericht("gemergt", pr)), {
          prStatus: (nr) => {
            assert.equal(nr, "7");
            return offenMitAuto();
          },
        }) ?? "",
        /PR #7/,
        pr,
      );
    assert.equal(blockade(eingabe(bericht("gemergt")), { prStatus: () => null as unknown as Status }), null);
  });
});

describe("R0: Format des Handbacks vor der Zustellung (#1342)", () => {
  const d = { prStatus: () => ({ state: "MERGED", autoMergeRequest: null }) };

  test("verweigert: Zusatz (echter #1334-Text), fehlende ERGEBNIS-Zeile, ungültiges Token, fehlende PR-Zeile", () => {
    const g = blockade(vorher("ERGEBNIS: abgebrochen (Zwischenstand, kein Abschluss)\nTICKET: #1\nPR: -\nBEFUNDE: keine"), d);
    assert.match(g ?? "", /Zusatz hinter dem Token/);
    assert.match(g ?? "", /Laufen deine Lenses noch, beende den Turn mit einer kurzen Statuszeile ohne SubagentHandback/);
    assert.match(blockade(vorher("Fertig, alles gemergt."), d) ?? "", /kein gültiges ERGEBNIS-Token/);
    assert.match(blockade(vorher("ERGEBNIS: fertig\nPR: -\nBEFUNDE: keine"), d) ?? "", /kein gültiges ERGEBNIS-Token/);
    assert.match(blockade(vorher("ERGEBNIS: abgebrochen\nTICKET: #1\nBEFUNDE: keine"), d) ?? "", /PR:-Zeile fehlt/);
    assert.match(blockade(vorher(null), d) ?? "", /kein gültiges/);
  });

  test("durch: exaktes Token (auch groß geschrieben) mit PR-Zeile; nicht bei SubagentStop", () => {
    assert.equal(blockade(vorher("ERGEBNIS: abgebrochen\nPR: -\nBEFUNDE: keine"), d), null);
    assert.equal(blockade(vorher("ERGEBNIS: GEMERGT\nPR: https://github.com/x/y/pull/5\nBEFUNDE: keine"), d), null);
    assert.equal(blockade(eingabe("ERGEBNIS: abgebrochen (Zwischenstand)\nPR: -"), d), null);
  });

  test("R1 greift auch vor der Zustellung", () => {
    assert.match(blockade(vorher(bericht("gemergt")), { prStatus: offenMitAuto }) ?? "", /noch offen und hat Auto-Merge/);
  });

  describe("BEFUNDE-Zeile (#1723)", () => {
    const mit = (befunde: string | null) => ["ERGEBNIS: gemergt", "TICKET: #1", "PR: https://github.com/x/y/pull/5", ...(befunde === null ? [] : [befunde])].join("\n");

    test("verweigert: BEFUNDE-Zeile fehlt (Zwischen-Hand-off), Grund nennt das Format", () => {
      const g = blockade(vorher(mit(null)), d);
      assert.match(g ?? "", /BEFUNDE:-Zeile fehlt/);
      assert.match(g ?? "", /BEFUNDE: \(je Befund/);
    });

    test("verweigert: Angebot oder Frage statt eingetragener Befunde, auch in einer Folgezeile", () => {
      for (const w of [
        "BEFUNDE: Messauffälligkeit, soll ich das eintragen?",
        "BEFUNDE: X offen, sag Bescheid",
        "BEFUNDE: sag mir Bescheid, wenn es rein soll",
        "BEFUNDE: wenn du willst trage ich es ein",
        "BEFUNDE: X offen, wenn du möchtest, trage ich es ein",
        "BEFUNDE: soll ich das eintragen.",
        "BEFUNDE: Soll ich das eintragen.",
        "BEFUNDE: Wenn du willst, trage ich es ein.",
        "BEFUNDE:\n  - Zeile A → #1\n  - Zeile B, tragen wir das ein?",
      ])
        assert.match(blockade(vorher(mit(w)), d) ?? "", /BEFUNDE bietet an statt einzutragen/, w);
    });

    test("durch: keine, -, ein Befund mit Ziel, mehrzeilig eingerückt; SubagentStop prüft die Zeile nicht", () => {
      for (const w of ["BEFUNDE: keine", "BEFUNDE: -", "BEFUNDE: Messwert X → #1700", "BEFUNDE:\n  - A → #1\n  - B → #2\nLERNKANDIDATEN: -"])
        assert.equal(blockade(vorher(mit(w)), d), null, w);
      assert.equal(blockade(eingabe(mit(null)), d), null);
    });

    test("verweigert: leere BEFUNDE-Zeile (auch mit leeren Folgezeilen)", () => {
      for (const w of ["BEFUNDE:", "BEFUNDE:   ", "BEFUNDE:\n\nLERNKANDIDATEN: -"]) assert.match(blockade(vorher(mit(w)), d) ?? "", /BEFUNDE: ist leer/, w);
    });

    test("durch: ? in Code oder URL ist keine Frage (nur ? am Wortende vor Leerraum oder Zeilenende)", () => {
      for (const w of ["BEFUNDE: `a?.b` ohne Null-Test → #1700", "BEFUNDE: Trace https://x/y?observation=1 auffällig → #1700"]) assert.equal(blockade(vorher(mit(w)), d), null, w);
      assert.match(blockade(vorher(mit("BEFUNDE: Warum flakt X? → #1700")), d) ?? "", /bietet an/);
    });

    test("eine Frage in der Zeile nach BEFUNDE (LERNKANDIDATEN) zählt nicht dazu", () => {
      assert.equal(blockade(vorher(mit("BEFUNDE: keine\nLERNKANDIDATEN: warum eigentlich?")), d), null);
    });

    test("FORMAT nennt BEFUNDE", () => {
      assert.match(blockade(vorher("ERGEBNIS: fertig\nPR: -"), d) ?? "", /BEFUNDE: \(je Befund/);
    });
  });
});

describe("R3: festgefahren bei offenem PR nur mit Label (#1342)", () => {
  const festgefahren = bericht("festgefahren");
  const mitLabel = () => ({ state: "OPEN", autoMergeRequest: null, labels: [stuck] });

  test("verweigert ohne Label, in beiden Ereignissen, auch mit dem echten #1327-Zusatz", () => {
    for (const e of [eingabe(festgefahren), vorher(festgefahren)]) {
      const g = blockade(e, { prStatus: offenMitAuto });
      assert.match(g ?? "", /festgefahren bei offenem PR #1330/);
      assert.match(g ?? "", /node scripts\/pr-warten\.mjs 1330/);
    }
    const g = blockade(eingabe(bericht("festgefahren (NICHT gemergt, Lauf vom System beendet)")), { prStatus: offenMitAuto });
    assert.match(g ?? "", /Label status:festgefahren fehlt/);
  });

  test("erlaubt mit Label, ohne PR, bei MERGED/CLOSED", () => {
    assert.equal(blockade(eingabe(festgefahren), { prStatus: mitLabel }), null);
    assert.equal(blockade(vorher(festgefahren), { prStatus: mitLabel }), null);
    assert.equal(blockade(eingabe(bericht("festgefahren", "-")), { prStatus: offenMitAuto }), null);
    for (const state of ["MERGED", "CLOSED"]) assert.equal(blockade(eingabe(festgefahren), { prStatus: () => ({ state, autoMergeRequest: null, labels: [] }) }), null, state);
  });

  describe("FESTGEFAHREN: review|ci (#1663 L46)", () => {
    const mitArt = (art: string) => bericht("festgefahren") + "FESTGEFAHREN: " + art + String.fromCharCode(10);
    test("parseErgebnis liest den Wert klein geschrieben, fehlende Zeile ist null", () => {
      assert.equal(parseErgebnis(mitArt("Review")).festgefahren, "review");
      assert.equal(parseErgebnis(bericht("festgefahren")).festgefahren, null);
    });
    test("review braucht kein Label am offenen PR, in beiden Ereignissen", () => {
      assert.equal(blockade(eingabe(mitArt("review")), { prStatus: offenMitAuto }), null);
      assert.equal(blockade(vorher(mitArt("review")), { prStatus: offenMitAuto }), null);
    });
    test("ci und die fehlende Zeile verlangen das Label weiter (Standard ci)", () => {
      assert.match(blockade(eingabe(mitArt("ci")), { prStatus: offenMitAuto }) ?? "", /Label status:festgefahren fehlt/);
      assert.match(blockade(eingabe(festgefahren), { prStatus: offenMitAuto }) ?? "", /Label status:festgefahren fehlt/);
      assert.equal(blockade(eingabe(mitArt("ci")), { prStatus: mitLabel }), null);
    });
    test("Negativ: ein ungültiger Wert wird verweigert, auch ohne PR-Aufruf und bei fehlendem PR", () => {
      const nichts = () => {
        throw new Error("kein gh");
      };
      for (const e of [eingabe, vorher]) {
        const g = blockade(e(mitArt("egal")), { prStatus: nichts });
        assert.match(g ?? "", /FESTGEFAHREN: egal/);
        assert.match(g ?? "", /review | ci/);
      }
      assert.match(blockade(eingabe(bericht("festgefahren", "-") + "FESTGEFAHREN: x"), {}) ?? "", /FESTGEFAHREN: x/);
    });
    test("die Zeile gilt nur für festgefahren: bei anderen Ergebnissen bleibt ein beliebiger Wert unbeachtet", () => {
      assert.equal(blockade(eingabe(bericht("gemergt", "-") + "FESTGEFAHREN: egal"), {}), null);
    });
  });

  test("Bindungen: STUCK_LABEL und ERGEBNIS_WERTE stimmen mit check-festgefahren und dem Formatblock überein", () => {
    const label = /export const STUCK_LABEL = "([^"]+)"/.exec(readFileSync(resolve(ROOT, "scripts/check-festgefahren.mjs"), "utf8"))?.[1];
    assert.equal(label, "status:festgefahren");
    assert.ok(readFileSync(resolve(ROOT, "scripts/umsetzer-abschluss.mjs"), "utf8").includes(`"${label}"`), "umsetzer-abschluss nutzt dasselbe Label");
    const format = /^ERGEBNIS: (.+)$/m.exec(abschnitt(UMSETZER, /^## Letzte Nachricht/).split("```")[1])?.[1].split(" | ");
    assert.deepEqual(abschluss.ERGEBNIS_WERTE, format);
    // gh pr view muss die Felder liefern, die R1 bis R3 lesen; fehlte `labels`, verweigerte R3 jedes festgefahren (alle Tests injizieren prStatus).
    assert.deepEqual([...abschluss.PR_FELDER.split(",")].sort(), ["autoMergeRequest", "labels", "state"]);
    assert.match(readFileSync(resolve(ROOT, "scripts/umsetzer-abschluss.mjs"), "utf8"), /"--json", PR_FELDER/);
  });
});

describe("uebergabe: Phasen-Schnitt (#1592)", () => {
  const uebergabe = (schnitt: string | null, pr = "-", block = true) =>
    ["ERGEBNIS: uebergabe", "TICKET: #1", `PR: ${pr}`, "BEFUNDE: keine", ...(schnitt === null ? [] : [`SCHNITT: ${schnitt}`]), ...(block ? ["UEBERGABE:", "  Worktree: /x", "  HEAD: abc"] : [])].join(String.fromCharCode(10));
  const PR = "https://github.com/x/y/pull/9";
  const ohneAuto = () => ({ state: "OPEN", autoMergeRequest: null });
  const nichtAufrufen = () => {
    throw new Error("gh darf nicht gefragt werden");
  };

  test("parseErgebnis: Token, SCHNITT (case-insensitiv normalisiert) und UEBERGABE-Zeile", () => {
    assert.deepEqual(parseErgebnis(uebergabe("pr", PR)), { token: "uebergabe", zusatz: "", pr: PR, schnitt: "pr", uebergabe: true, festgefahren: null });
    assert.equal(parseErgebnis(uebergabe("Verify")).schnitt, "verify");
    assert.equal(parseErgebnis(uebergabe("pr", PR, false)).uebergabe, false);
    assert.equal(parseErgebnis(uebergabe(null)).schnitt, null);
  });

  test("R4: ohne SCHNITT, mit unbekanntem Schnitt (auch mit Zusatz) oder ohne UEBERGABE-Zeile blockiert, in beiden Ereignissen", () => {
    for (const mk of [eingabe, vorher]) {
      assert.match(blockade(mk(uebergabe(null)), { prStatus: nichtAufrufen }) ?? "", /SCHNITT: fehlt oder ist unbekannt/);
      assert.match(blockade(mk(uebergabe("review")), { prStatus: nichtAufrufen }) ?? "", /SCHNITT: fehlt oder ist unbekannt/);
      assert.match(blockade(mk(uebergabe("pr (fertig)", PR)), { prStatus: offenMitAuto }) ?? "", /SCHNITT: fehlt oder ist unbekannt/);
      assert.match(blockade(mk(uebergabe("verify", "-", false)), { prStatus: nichtAufrufen }) ?? "", /UEBERGABE:-Zeile fehlt/);
    }
  });

  test("R5: pr ohne Auto-Merge, CLOSED oder ohne PR-Nummer blockiert; OPEN mit Auto-Merge frei; gh-Fehler frei", () => {
    assert.match(blockade(eingabe(uebergabe("pr", PR)), { prStatus: ohneAuto }) ?? "", /nicht OPEN mit Auto-Merge \(Status OPEN, Auto-Merge nein\)/);
    for (const state of ["CLOSED"]) assert.match(blockade(eingabe(uebergabe("pr", PR)), { prStatus: () => ({ state, autoMergeRequest: { enabledAt: "x" } }) }) ?? "", new RegExp(`Status ${state}`));
    assert.match(blockade(eingabe(uebergabe("pr", "-")), { prStatus: nichtAufrufen }) ?? "", /braucht eine PR:-Zeile/);
    assert.equal(blockade(eingabe(uebergabe("pr", PR)), { prStatus: offenMitAuto }), null);
    assert.equal(blockade(vorher(uebergabe("pr", PR)), { prStatus: offenMitAuto }), null, "R1 feuert für uebergabe nicht");
    assert.equal(blockade(eingabe(uebergabe("pr", PR)), { prStatus: nichtAufrufen }), null, "gh-Fehler: fail-open");
    assert.equal(blockade(eingabe(uebergabe("pr", PR)), { prStatus: () => null as unknown as Status }), null);
  });

  test("R5: ein schon gemergter PR gibt den Weg frei (#1646), CLOSED ohne Merge und OPEN ohne Auto-Merge sperren", () => {
    assert.equal(blockade(eingabe(uebergabe("pr", PR)), { prStatus: () => ({ state: "MERGED", autoMergeRequest: null }) }), null);
    assert.equal(blockade(eingabe(uebergabe("pr", PR)), { prStatus: () => ({ state: "MERGED", autoMergeRequest: { enabledAt: "x" } }) }), null);
    assert.match(blockade(eingabe(uebergabe("pr", PR)), { prStatus: () => ({ state: "CLOSED", autoMergeRequest: null }) }) ?? "", /Status CLOSED/);
    assert.match(blockade(eingabe(uebergabe("pr", PR)), { prStatus: ohneAuto }) ?? "", /Status OPEN/);
  });

  test("UEBERGABE: zählt nur am Zeilenanfang (eingerückt ok), nicht mitten in der Zeile", () => {
    const text = (zeile: string) => ["ERGEBNIS: uebergabe", "PR: -", "SCHNITT: verify", zeile].join(String.fromCharCode(10));
    assert.equal(parseErgebnis(text("Text UEBERGABE: x")).uebergabe, false);
    assert.equal(parseErgebnis(text("  UEBERGABE: x")).uebergabe, true);
    assert.match(blockade(eingabe(text("Text UEBERGABE: x")), { prStatus: nichtAufrufen }) ?? "", /UEBERGABE:-Zeile fehlt/);
  });

  test("verify mit PR: - ist frei und fragt gh nicht", () => {
    assert.equal(blockade(eingabe(uebergabe("verify")), { prStatus: nichtAufrufen }), null);
    assert.equal(blockade(vorher(uebergabe("verify")), { prStatus: nichtAufrufen }), null);
  });

  test("R0 gilt weiter: uebergabe mit Zusatz oder ohne PR-Zeile wird vor der Zustellung verweigert", () => {
    assert.match(blockade(vorher(uebergabe("verify").replace("uebergabe", "uebergabe (Schnitt)")), { prStatus: nichtAufrufen }) ?? "", /Zusatz hinter dem Token/);
    assert.match(blockade(vorher(uebergabe("verify").split("PR: -").join("")), { prStatus: nichtAufrufen }) ?? "", /PR:-Zeile fehlt/);
  });

  test("Bindung: SCHNITTE stimmen mit dem Formatblock des Umsetzers überein", () => {
    const block = abschnitt(UMSETZER, /^## Letzte Nachricht/).split("```")[1] ?? "";
    assert.match(block, /SCHNITT: .*pr.*verify|SCHNITT: .*verify.*pr/);
    assert.match(block, /^UEBERGABE:/m);
    assert.deepEqual((abschluss as unknown as { SCHNITTE: string[] }).SCHNITTE, ["pr", "verify"]);
  });
});

describe("Nachrichtenquelle (#1342)", () => {
  const p = (extra: object) => JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "kubernia-umsetzer", ...extra });

  test("parseAbschlussInput: PreToolUse liest tool_input.message, SubagentStop Transkript vor last_assistant_message, kaputtes JSON", () => {
    const pre = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: "kubernia-umsetzer", tool_input: { message: "M" } });
    assert.deepEqual(parseAbschlussInput(pre), { hookEvent: "PreToolUse", agentType: "kubernia-umsetzer", toolName: "SubagentHandback", lastMessage: "M" });
    assert.equal(parseAbschlussInput(p({ last_assistant_message: "A" })).lastMessage, "A");
    assert.equal(parseAbschlussInput(p({ last_assistant_message: "A", agent_transcript_path: "/x" }), () => "B").lastMessage, "B");
    assert.equal(parseAbschlussInput(p({ last_assistant_message: "A", agent_transcript_path: "/x" }), () => null).lastMessage, "A", "ohne ERGEBNIS im Transkript gilt last_assistant_message");
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

  test("liefert die jüngste Nachricht mit ERGEBNIS-Zeile, übergeht Tool-Blöcke und abgeschnittene Zeilen", () => {
    const p = datei([
      zeile("assistant", [{ type: "text", text: "ERGEBNIS: abgebrochen" }]),
      zeile("user", "egal"),
      zeile("assistant", [{ type: "tool_use", name: "Bash" }]),
      zeile("assistant", [{ type: "text", text: "nur eine Statuszeile" }]),
      '{"abgeschnitten',
    ]);
    assert.equal(lies(p), "ERGEBNIS: abgebrochen");
    assert.equal(lies(datei([zeile("assistant", "ERGEBNIS: gemergt")])), "ERGEBNIS: gemergt");
  });

  test("Handback-Nachricht und Text: die jüngere gewinnt, in beide Richtungen", () => {
    const handback = (message: string) => zeile("assistant", [{ type: "tool_use", name: "SubagentHandback", input: { message } }]);
    const text = (t: string) => zeile("assistant", [{ type: "text", text: t }]);
    assert.equal(lies(datei([text("ERGEBNIS: abgebrochen"), handback("ERGEBNIS: gemergt")])), "ERGEBNIS: gemergt");
    assert.equal(lies(datei([handback("ERGEBNIS: gemergt"), text("ERGEBNIS: festgefahren")])), "ERGEBNIS: festgefahren");
    assert.equal(lies(datei([zeile("assistant", [{ type: "tool_use", name: "Bash", input: { message: "ERGEBNIS: gemergt" } }])])), null, "nur SubagentHandback zählt");
    // dieselbe Assistant-Zeile: der spätere Block gewinnt, in beide Richtungen
    const block = [
      { type: "text", text: "ERGEBNIS: abgebrochen" },
      { type: "tool_use", name: "SubagentHandback", input: { message: "ERGEBNIS: gemergt" } },
    ];
    assert.equal(lies(datei([zeile("assistant", block)])), "ERGEBNIS: gemergt");
    assert.equal(lies(datei([zeile("assistant", [...block].reverse())])), "ERGEBNIS: abgebrochen");
  });

  test("fehlende Datei oder kein Bericht ergeben null (fail-open)", () => {
    assert.equal(lies(join(tmpdir(), "gibt-es-nicht-kq.jsonl")), null);
    assert.equal(lies(datei([zeile("user", "x")])), null);
    assert.equal(lies(datei([zeile("assistant", "kein Bericht")])), null);
  });
});

describe("Gleichlauf Umsetzer-Definition und Workflow (#1460 Z10)", () => {
  // Die Workflow-Umsetzung nutzt nicht den Agenten `kubernia-umsetzer`, sondern einen eigenen Prompt: drei Regeln müssen dort
  // genauso stehen wie in der Agenten-Definition, sonst driften sie auseinander.
  const WORKFLOW = readFileSync(resolve(ROOT, ".claude/workflows/kubernia-ticket.js"), "utf8");
  const KERNPHRASEN = [
    "nie über stdin", // Skripte nie über stdin starten
    "eigenen Negativtest, der genau diese Regel verfälscht", // je neue Guard-/Gate-Regel ein Negativtest
    "das betroffene Gate erneut", // Gate verschärft: origin/main einmergen (#1449)
    "git checkout <datei>", // Red-Green-Probe nie so zurücknehmen (verwirft ungesicherte Änderungen)
  ];

  test("jede Kernphrase steht in der Agenten-Definition und im Workflow", () => {
    for (const phrase of KERNPHRASEN) {
      assert.ok(UMSETZER.includes(phrase), `kubernia-umsetzer.md ohne „${phrase}“`);
      assert.ok(WORKFLOW.includes(phrase), `kubernia-ticket.js ohne „${phrase}“`);
    }
  });

  test("Verschobener-Code-Prüfung: eine Konstante, Gates- und Push-Absatz interpolieren sie, Skill trägt dieselben Befehle (#1501, #1508)", () => {
    const diffBefehl = "git diff <basis> <M>^2 -- <alte datei>";
    const basisBefehl = "git merge-base <M>^1 <M>^2";
    const def = WORKFLOW.match(/^const VERSCHOBEN_DIFF = `(.*)`/m)?.[1] ?? "";
    assert.ok(def.includes(diffBefehl), "Konstante ohne Diff der alten Datei gegen die Merge-Basis");
    assert.ok(def.includes(basisBefehl), "Konstante ohne Merge-Basis-Befehl");
    // der Befehl steht im Workflow genau einmal (keine Literal-Kopie neben der Konstante)
    assert.equal(WORKFLOW.split(diffBefehl).length - 1, 1, "Diff-Befehl außerhalb der Konstante kopiert");
    const gates = WORKFLOW.slice(WORKFLOW.indexOf("Gates: vor dem ersten verify"), WORKFLOW.indexOf("Beim Iterieren gezielt prüfen"));
    assert.match(gates, /\$\{VERSCHOBEN_DIFF\}/, "Gates-Absatz ohne die Konstante");
    const von = WORKFLOW.indexOf("Vor dem Push: verschärft der Diff ein Gate oder Schema");
    const bis = WORKFLOW.indexOf("Nachweis-Commit", von);
    assert.ok(von >= 0 && bis > von, "Merge-Absatz vor dem Push nicht gefunden");
    const absatz = WORKFLOW.slice(von, bis);
    assert.match(absatz, /\$\{VERSCHOBEN_DIFF\}/, "Push-Absatz ohne die Konstante");
    assert.match(absatz, /verschobene Funktion, ergebnis="fehler"/, "Fehler-Ergebnis für die geänderte verschobene Funktion fehlt");
    const skill = readFileSync(resolve(ROOT, ".claude/skills/review-lenses/SKILL.md"), "utf8");
    assert.ok(skill.includes(diffBefehl) && skill.includes(basisBefehl), "review-lenses trägt andere Befehle als der Workflow");
  });

  test("Red-Green-Rücknahme per git checkout gehört auch in AGENTS.md und die Langfassung (#1501)", () => {
    for (const datei of ["AGENTS.md", "docs/agent-harness.md"]) {
      const text = readFileSync(resolve(ROOT, datei), "utf8");
      // beide Dateien nennen dieselben Befehle und die Ausnahme für den sauberen Lens-Worktree
      for (const teil of ["git checkout <datei>", "git restore <datei>", "Lens-Worktree", "git -C <lens-worktree> checkout -- <datei>"]) {
        assert.ok(text.includes(teil), `${datei} ohne „${teil}“`);
      }
    }
  });
});
