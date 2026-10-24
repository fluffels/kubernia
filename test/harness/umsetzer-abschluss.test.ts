/* Umsetzer-Abschluss-Wächter (#1308) – der Abschluss des Umsetzer-Agenten driftet nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Zwei Regeln hängen an Prosa in .claude/agents/factory-umsetzer.md:
 *   1. Vor dem Bericht (`ERGEBNIS:`) stoppt der Umsetzer alle eigenen Hintergrund-Tasks per `TaskStop`
 *      und wartet auf die CI blockierend im Vordergrund (ein Monitor hält den Lauf nicht offen, #1342), auf
 *      Lenses per Turn-Ende; sonst kam derselbe Bericht mehrfach an oder der Lauf endete mitten im Review (#1139).
 *   2. Der Nachweis-Commit (`<praefixe.commitZeile>Plan:`/`<praefixe.commitZeile>Review:`, lokal geprüft mit `check-review-nachweis`) steht im
 *      Ablauf VOR dem PR-Schritt; ohne ihn wird die PR-CI rot (#1270).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { FREMD, FREMD_OWNER, projektConfig } from "../support/fremd-config";
import { liesMitProjektwerten } from "../support/ticket-ablauf";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRaw from "../../scripts/umsetzer-abschluss.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as festRaw from "../../scripts/check-festgefahren.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as stopRaw from "../../scripts/stop-verify-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as preRaw from "../../scripts/pretooluse-hook.mjs";

const stopHookRaw = stopRaw as unknown as { runHook: (s: string, r: string, c: () => object, d: object) => { exit: number; stdout: string; stderr: string } };
const preHookRaw = preRaw as unknown as { dispatch: (t: string, r: string, g?: unknown, s?: unknown, d?: object) => { hookSpecificOutput: { permissionDecision: string } } | null };
const stuckLabel = (c: unknown) => (festRaw as unknown as { stuckLabel: (c: unknown) => string }).stuckLabel(c);
/** Echte Config: nur dort, wo Texte oder der Einstiegspunkt sie selbst lesen; alles andere bekommt `FREMD` injiziert. */
const ECHT = projektConfig();
const { umsetzer: UMS, lens: LENS } = FREMD.agenten;
const STUCK = FREMD.labels.festgefahren;

type Status = { state: string; autoMergeRequest: object | null; labels?: { name: string }[]; isDraft?: boolean };
type Eingabe = { hookEvent?: string; agentType?: string; toolName?: string; lastMessage?: string | null };
const abschluss = abschlussRaw as unknown as {
  abschlussBlockade: (i: Eingabe, d?: { prStatus?: (nr: string) => Status }) => string | null;
  parseErgebnis: (t: string) => { token: string | null; zusatz: string | null; pr: string | null; schnitt: string | null; uebergabe: boolean; festgefahren: string | null };
  ERGEBNIS_WERTE: string[];
  AUDIT_KOPF: string;
  GRAPHQL_DATEIEN_GRENZE: number;
  ghPrDateien: (nr: string, status?: { files?: { path: string }[] }, diff?: (nr: string) => string) => string[];
  ghPrKommentare: (nr: string, status?: object, ansicht?: (nr: string) => object) => object;
  PR_FELDER: string;
  FESTGEFAHREN_ARTEN: string[];
  parseAbnahme: (t: string) => { head: string; worktree: string } | null;
  parseAbschlussInput: (t: string, r?: (p: string) => string | null) => Eingabe;
  letzteNachrichtAusTranskript: (p: string) => string | null;
};
const { parseErgebnis, parseAbschlussInput } = abschluss;
// hermetisch: ohne eigene Injektion ruft der Leitplanken-Audit (#1067) nie das echte gh auf; die Config lädt der Einstiegspunkt, der Kern bekommt sie
const blockade: typeof abschluss.abschlussBlockade = (i, d = {}) => abschluss.abschlussBlockade(i, { config: FREMD, prDateien: () => [], ...d } as never);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UMSETZER = liesMitProjektwerten(".claude/agents/factory-umsetzer.md");

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

/** Probleme beim Nachweis: die Plan- und Review-Zeile der Config und check-review-nachweis stehen im Ablauf vor dem PR-Schritt. */
function nachweisProbleme(md: string): string[] {
  const a = abschnitt(md, /^## Ablauf/);
  if (!a) return ["Abschnitt „## Ablauf“ fehlt"];
  const prPos = a.indexOf("**PR bis zum Merge**");
  if (prPos < 0) return ["Schritt „PR bis zum Merge“ fehlt"];
  const davor = a.slice(0, prPos);
  return [`${ECHT.praefixe.commitZeile}Plan:`, `${ECHT.praefixe.commitZeile}Review:`, "check-review-nachweis"].filter((s) => !davor.includes(s)).map((s) => `${s} steht nicht vor dem PR-Schritt`);
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
    assert.equal(nachweisProbleme(`## Ablauf\n\n4. **PR bis zum Merge** x\n3. ${ECHT.praefixe.commitZeile}Plan: ${ECHT.praefixe.commitZeile}Review: check-review-nachweis\n`).length, 3);
    assert.deepEqual(nachweisProbleme(UMSETZER.replace(/check-review-nachweis/g, "x")), ["check-review-nachweis steht nicht vor dem PR-Schritt"]);
  });
});

const bericht = (ergebnis: string, pr = "https://github.com/x/y/pull/1330") => `ERGEBNIS: ${ergebnis}
TICKET: #1
PR: ${pr}
BEFUNDE: keine
`;
const offenMitAuto = () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" }, labels: [] });
const stuck = { name: STUCK };
const eingabe = (lastMessage: string | null, extra = {}) => ({ hookEvent: "SubagentStop", agentType: UMS, lastMessage, ...extra });
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
    assert.equal(blockade(eingabe(bericht("gemergt"), { agentType: LENS }), d), null);
    assert.equal(blockade(eingabe(bericht("gemergt"), { agentType: undefined }), d), null);
    assert.equal(blockade(vorher("kaputt", { toolName: "Bash" }), d), null);
    assert.equal(blockade(vorher("kaputt", { agentType: LENS }), d), null);
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
    assert.match(g ?? "", new RegExp(`Label ${STUCK} fehlt`));
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
    test("review verlangt das Label am offenen PR wie ci, in beiden Ereignissen (L3d, umgedreht: früher ohne Label frei)", () => {
      for (const e of [eingabe, vorher]) assert.match(blockade(e(mitArt("review")), { prStatus: offenMitAuto }) ?? "", new RegExp(`Label ${STUCK} fehlt`));
      assert.equal(blockade(eingabe(mitArt("review")), { prStatus: mitLabel }), null);
      assert.equal(blockade(vorher(mitArt("review")), { prStatus: mitLabel }), null);
      assert.equal(blockade(eingabe(bericht("festgefahren", "-") + "FESTGEFAHREN: review" + String.fromCharCode(10)), { prStatus: offenMitAuto }), null, "ohne PR kann der Hook nichts prüfen");
    });
    test("ci und die fehlende Zeile verlangen das Label weiter (Standard ci)", () => {
      assert.match(blockade(eingabe(mitArt("ci")), { prStatus: offenMitAuto }) ?? "", new RegExp(`Label ${STUCK} fehlt`));
      assert.match(blockade(eingabe(festgefahren), { prStatus: offenMitAuto }) ?? "", new RegExp(`Label ${STUCK} fehlt`));
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

  test("Negativfall: ohne übergebene Config lädt der Kern keine selbst und blockiert fail-closed (auch für fremde Agenten, wie bei unbrauchbarer Config)", () => {
    const g = abschluss.abschlussBlockade({ hookEvent: "SubagentStop", agentType: "Explore", lastMessage: "x" }, {});
    assert.match(g ?? "", /fail-closed/);
    assert.match(g ?? "", /keine Config übergeben/);
    // andere Ereignisse und Tools bleiben frei, sie brauchen keine Config
    assert.equal(abschluss.abschlussBlockade({ hookEvent: "Stop", agentType: "Explore", lastMessage: "x" }, {}), null);
  });
  test("Negativfall: der Einstiegspunkt pretooluse-hook lädt die Config und blockiert bei unbrauchbarem Pfad fail-closed", () => {
    const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: "x", tool_input: { message: "ERGEBNIS: abgebrochen\nPR: -\nBEFUNDE: keine" } });
    const deny = preHookRaw.dispatch(payload, "/x", undefined, undefined, { pfad: "/gibt/es/nicht.json" });
    assert.equal(deny?.hookSpecificOutput.permissionDecision, "deny");
    assert.match((deny as unknown as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason, /fail-closed/);
  });
  test("Negativfall: eine Config ohne labels.festgefahren blockiert fail-closed mit Fix-Zeile, ohne zu werfen, in Wächter und beiden Hooks (kein stiller Standardwert)", () => {
    const echt = FREMD;
    const { festgefahren: _weg, ...rest } = echt.labels;
    const ohneLabel = { ...echt, labels: rest };
    const eingaben = [
      { hookEvent: "SubagentStop", agentType: echt.agenten.umsetzer, lastMessage: "ERGEBNIS: abgebrochen\nPR: -" },
      { hookEvent: "PreToolUse", toolName: "SubagentHandback", agentType: echt.agenten.umsetzer, lastMessage: "ERGEBNIS: abgebrochen\nPR: -\nBEFUNDE: keine" },
    ];
    for (const e of eingaben) {
      const g = abschluss.abschlussBlockade(e, { config: ohneLabel, prDateien: () => [] } as never);
      assert.match(g ?? "", /fail-closed/);
      assert.match(g ?? "", /labels\.festgefahren/);
      assert.match(g ?? "", /Fix:/);
      // mit der Config samt Label läuft derselbe Aufruf ohne Blockade durch
      assert.equal(abschluss.abschlussBlockade(e, { config: echt, prDateien: () => [] } as never), null);
    }
    // stop-verify-hook: Exit 2 mit decision block statt Wurf
    const stop = stopHookRaw.runHook(JSON.stringify({ hook_event_name: "SubagentStop", agent_type: echt.agenten.umsetzer, last_assistant_message: "ERGEBNIS: abgebrochen\nPR: -" }), "/x", () => ({ blocked: false }), { config: ohneLabel });
    assert.equal(stop.exit, 2);
    assert.equal((JSON.parse(stop.stdout) as { decision: string }).decision, "block");
    assert.match(stop.stderr, /labels\.festgefahren/);
    // pretooluse-hook: deny statt stillem Durchlass
    const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: echt.agenten.umsetzer, tool_input: { message: "ERGEBNIS: abgebrochen\nPR: -\nBEFUNDE: keine" } });
    const deny = preHookRaw.dispatch(payload, "/x", undefined, undefined, { config: ohneLabel });
    assert.equal(deny?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(preHookRaw.dispatch(payload, "/x", undefined, undefined, { config: echt, prDateien: () => [] }), null);
  });
  test("Standardpfad: der pretooluse-Hook lädt ohne injizierte Config die echte Projekt-Config und wendet den Wächter auf deren Umsetzer an", () => {
    const echt = projektConfig();
    const bericht = (agentType: string, message: string) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: agentType, tool_input: { message } });
    const frei = preHookRaw.dispatch(bericht(echt.agenten.umsetzer, "ERGEBNIS: abgebrochen\nPR: -\nBEFUNDE: keine"), "/x", undefined, undefined, { prDateien: () => [] });
    assert.equal(frei, null, "gültiger Abbruch-Bericht des echten Umsetzers geht durch");
    // Negativ: derselbe Umsetzer mit unzulässigem Ergebnis-Wert wird blockiert (der Wächter greift also wirklich, nicht nur ein Durchlass)
    const deny = preHookRaw.dispatch(bericht(echt.agenten.umsetzer, "ERGEBNIS: unsinn\nPR: -\nBEFUNDE: keine"), "/x", undefined, undefined, { prDateien: () => [] });
    assert.equal(deny?.hookSpecificOutput.permissionDecision, "deny");
    // Ein Agent, der in der echten Config nicht der Umsetzer ist (der Fremd-Umsetzer), ist nicht zuständig
    assert.equal(preHookRaw.dispatch(bericht(FREMD.agenten.umsetzer, "ERGEBNIS: unsinn\nPR: -\nBEFUNDE: keine"), "/x", undefined, undefined, { prDateien: () => [] }), null);
  });
  test("Bindungen: stuckLabel und ERGEBNIS_WERTE stimmen mit check-festgefahren und dem Formatblock überein", () => {
    // Beide Skripte lesen das Label aus der Projekt-Config (#1742, #1744): ein Fixture-Label muss bei check-festgefahren ankommen.
    const fixture = { labels: { festgefahren: "zustand:fest" } };
    assert.equal(stuckLabel(fixture), fixture.labels.festgefahren, "check-festgefahren liest labels.festgefahren");
    assert.equal(stuckLabel(FREMD), FREMD.labels.festgefahren);
    assert.match(readFileSync(resolve(ROOT, "scripts/umsetzer-abschluss.mjs"), "utf8"), /labels\.festgefahren/);
    assert.match(readFileSync(resolve(ROOT, "scripts/check-festgefahren.mjs"), "utf8"), /labelAus\(config, "festgefahren"\)/);
    const format = /^ERGEBNIS: (.+)$/m.exec(abschnitt(UMSETZER, /^## Letzte Nachricht/).split("```")[1])?.[1].split(" | ");
    assert.deepEqual(abschluss.ERGEBNIS_WERTE, format);
    // gh pr view muss die Felder liefern, die R1 bis R3 lesen; fehlte `labels`, verweigerte R3 jedes festgefahren (alle Tests injizieren prStatus).
    assert.deepEqual([...abschluss.PR_FELDER.split(",")].sort(), ["author", "autoMergeRequest", "comments", "files", "isDraft", "labels", "state"]);
    assert.match(readFileSync(resolve(ROOT, "scripts/umsetzer-abschluss.mjs"), "utf8"), /"--json", PR_FELDER/);
  });

  test("Bindung: jeder ERGEBNIS-Wert hat einen Bullet im Ticket-Ablauf `.agents/skills/factory/ablauf.md` (#1740 L1)", () => {
    const skill = readFileSync(resolve(ROOT, ".agents/skills/factory/ablauf.md"), "utf8");
    for (const wert of abschluss.ERGEBNIS_WERTE) {
      assert.ok(skill.includes(`- **\`${wert}\`**`), `.agents/skills/factory/ablauf.md ohne Bullet **\`${wert}\`**`);
    }
  });

  // Bekannte Grenze: ob eine Entscheidung im konkreten PR-Text steht, ist nicht prüfbar; gebunden ist nur der Auftrag in der Prosa.
  test("Bindung: Entscheidungen kommen in den PR-Text, auch die der Gruppen-Umsetzer (#1740 L3)", () => {
    assert.match(UMSETZER, /im PR-Text \(„Entscheidung: X, weil Y“\)/);
    assert.match(abschnitt(UMSETZER, /^\*\*Gruppen \(#1647/), /ENTSCHEIDUNGEN[^.]*PR-Text/);
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

describe("abnahme: Holdout-Abnahme auf dem Entwurfs-PR (#1754)", () => {
  const NL = String.fromCharCode(10);
  const PR = "https://github.com/x/y/pull/9";
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const abnahme = (zeile: string | null = `ABNAHME: head=${SHA} worktree=/w/x-1`, pr = PR) => [`ERGEBNIS: abnahme`, "TICKET: #1", `PR: ${pr}`, "BEFUNDE: keine", ...(zeile === null ? [] : [zeile])].join(NL);
  const entwurf = () => ({ state: "OPEN", autoMergeRequest: null, isDraft: true });
  const keinGh = () => {
    throw new Error("kein gh");
  };

  test("parseErgebnis kennt das Token; parseAbnahme liest head und Worktree (Rest der Zeile, auch mit Leerzeichen)", () => {
    assert.equal(parseErgebnis(abnahme()).token, "abnahme");
    assert.deepEqual(abschluss.parseAbnahme(abnahme()), { head: SHA, worktree: "/w/x-1" });
    assert.deepEqual(abschluss.parseAbnahme(abnahme(`ABNAHME: head=abc1234 worktree=C:/dev/mein ordner/w`)), { head: "abc1234", worktree: "C:/dev/mein ordner/w" });
  });

  test("parseAbnahme: fehlende Zeile, zu kurzer oder kein Hex-Head, fehlender Worktree, Zeile mitten im Satz sind null", () => {
    assert.equal(abschluss.parseAbnahme(abnahme(null)), null);
    assert.equal(abschluss.parseAbnahme(abnahme("ABNAHME: head=abc123 worktree=/w")), null, "6 Zeichen sind zu kurz");
    assert.equal(abschluss.parseAbnahme(abnahme(`ABNAHME: head=${SHA}0 worktree=/w`)), null, "41 Zeichen sind zu lang");
    assert.equal(abschluss.parseAbnahme(abnahme("ABNAHME: head=xyzxyzxyz worktree=/w")), null);
    assert.equal(abschluss.parseAbnahme(abnahme(`ABNAHME: head=${SHA}`)), null);
    assert.equal(abschluss.parseAbnahme(abnahme(`Text ABNAHME: head=${SHA} worktree=/w`)), null);
    assert.equal(abschluss.parseAbnahme(null as unknown as string), null);
  });

  test("parseAbnahme: eingerückte Zeile gilt, Großbuchstaben im Head werden klein, Leerzeichen am Zeilenende fallen weg", () => {
    assert.deepEqual(abschluss.parseAbnahme(abnahme(`  ABNAHME: head=ABC1234 worktree=/w/x   `)), { head: "abc1234", worktree: "/w/x" });
    assert.deepEqual(abschluss.parseAbnahme(abnahme(`	ABNAHME: head=abc1234 worktree=/w`)), { head: "abc1234", worktree: "/w" });
  });

  test("R7: Entwurf ohne Auto-Merge mit ABNAHME-Zeile ist frei, in beiden Ereignissen", () => {
    assert.equal(blockade(eingabe(abnahme()), { prStatus: entwurf }), null);
    assert.equal(blockade(vorher(abnahme()), { prStatus: entwurf }), null);
  });

  test("R7: ohne ABNAHME-Zeile, ohne PR-Nummer, mit Auto-Merge, ohne Entwurf oder bei MERGED/CLOSED blockiert", () => {
    for (const mk of [eingabe, vorher]) {
      assert.match(blockade(mk(abnahme(null)), { prStatus: entwurf }) ?? "", /ABNAHME:-Zeile fehlt oder ist ungültig/);
      assert.match(blockade(mk(abnahme("ABNAHME: head=zz worktree=/w")), { prStatus: entwurf }) ?? "", /ABNAHME:-Zeile fehlt oder ist ungültig/);
      assert.match(blockade(mk(abnahme(undefined, "-")), { prStatus: keinGh }) ?? "", /braucht eine PR:-Zeile/);
      assert.match(blockade(mk(abnahme()), { prStatus: () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" }, isDraft: true }) }) ?? "", /Auto-Merge ja/);
      assert.match(blockade(mk(abnahme()), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null, isDraft: false }) }) ?? "", /Entwurf nein/);
      for (const state of ["MERGED", "CLOSED"]) assert.match(blockade(mk(abnahme()), { prStatus: () => ({ state, autoMergeRequest: null, isDraft: true }) }) ?? "", new RegExp(`Status ${state}`));
    }
  });

  test("R7: gh-Fehler und leerer Status geben frei (fail-open); R1 bis R3 feuern für abnahme nicht", () => {
    assert.equal(blockade(eingabe(abnahme()), { prStatus: keinGh }), null);
    assert.equal(blockade(eingabe(abnahme()), { prStatus: () => null as unknown as Status }), null);
  });

  test("R0 gilt weiter: abnahme mit Zusatz oder ohne PR-Zeile wird vor der Zustellung verweigert", () => {
    assert.match(blockade(vorher(abnahme().replace("abnahme", "abnahme (bereit)")), { prStatus: keinGh }) ?? "", /Zusatz hinter dem Token/);
    assert.match(blockade(vorher(abnahme().split("PR: " + PR).join("")), { prStatus: keinGh }) ?? "", /PR:-Zeile fehlt/);
  });

  const stuckAbnahme = (pr = PR) => bericht("festgefahren", pr) + "FESTGEFAHREN: abnahme" + NL;
  const entwurfMitLabel = () => ({ state: "OPEN", autoMergeRequest: null, isDraft: true, labels: [stuck] });
  test("R8: festgefahren/abnahme braucht den Entwurf ohne Auto-Merge UND das Label, in beiden Ereignissen (L3g, umgedreht: früher ohne Label frei)", () => {
    assert.equal(blockade(eingabe(stuckAbnahme()), { prStatus: entwurfMitLabel }), null);
    assert.equal(blockade(vorher(stuckAbnahme()), { prStatus: entwurfMitLabel }), null);
    for (const e of [eingabe, vorher]) assert.match(blockade(e(stuckAbnahme()), { prStatus: entwurf }) ?? "", new RegExp(`FESTGEFAHREN: abnahme.*Label ${STUCK} fehlt`));
    assert.equal(parseErgebnis(stuckAbnahme()).festgefahren, "abnahme");
  });

  test("R8: festgefahren/abnahme bei Auto-Merge oder ohne Entwurf wird abgelehnt; gh-Fehler, ohne PR und MERGED/CLOSED frei", () => {
    assert.match(blockade(eingabe(stuckAbnahme()), { prStatus: () => ({ state: "OPEN", autoMergeRequest: { enabledAt: "x" }, isDraft: true }) }) ?? "", /FESTGEFAHREN: abnahme.*Auto-Merge ja/);
    assert.match(blockade(eingabe(stuckAbnahme()), { prStatus: () => ({ state: "OPEN", autoMergeRequest: null, isDraft: false }) }) ?? "", /Entwurf nein/);
    assert.equal(blockade(eingabe(stuckAbnahme()), { prStatus: keinGh }), null);
    assert.equal(blockade(eingabe(stuckAbnahme("-")), { prStatus: keinGh }), null);
    for (const state of ["MERGED", "CLOSED"]) assert.equal(blockade(eingabe(stuckAbnahme()), { prStatus: () => ({ state, autoMergeRequest: null, isDraft: false }) }), null, state);
  });

  test("Bindungen: FESTGEFAHREN_ARTEN, ABNAHME-Zeile und Entwurf-Befehle stehen im Formatblock und in der Umsetzer-Definition", () => {
    assert.deepEqual(abschluss.FESTGEFAHREN_ARTEN, ["review", "ci", "abnahme"]);
    const block = abschnitt(UMSETZER, /^## Letzte Nachricht/).split("```")[1] ?? "";
    assert.match(block, /^ABNAHME:/m);
    assert.match(block, /FESTGEFAHREN: .*review.*ci.*abnahme/);
    assert.match(UMSETZER, /gh pr create --draft/);
    assert.match(UMSETZER, /gh pr ready/);
    assert.match(UMSETZER, /handoff[^\n]*Festgefahren-Label[^\n]*labels\.festgefahren/);
  });
});

describe("Nachrichtenquelle (#1342)", () => {
  const p = (extra: object) => JSON.stringify({ hook_event_name: "SubagentStop", agent_type: UMS, ...extra });

  test("parseAbschlussInput: PreToolUse liest tool_input.message, SubagentStop Transkript vor last_assistant_message, kaputtes JSON", () => {
    const pre = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "SubagentHandback", agent_type: UMS, tool_input: { message: "M" } });
    assert.deepEqual(parseAbschlussInput(pre), { hookEvent: "PreToolUse", agentType: UMS, toolName: "SubagentHandback", lastMessage: "M" });
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
    const p = join(mkdtempSync(join(tmpdir(), "abschluss-")), "t.jsonl");
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

describe("Kernregeln der Umsetzer-Definition (#1460 Z10)", () => {
  // Diese Regeln stehen in der Agenten-Definition; die Gruppen-Rolle trägt die Red-Green-Regel mit.
  const GRUPPE = readFileSync(resolve(ROOT, ".claude/agents/factory-gruppe.md"), "utf8");
  const KERNPHRASEN = [
    "nie über stdin", // Skripte nie über stdin starten
    "eigenen Negativtest, der genau diese Regel verfälscht", // je neue Guard-/Gate-Regel ein Negativtest
    "das betroffene Gate erneut", // Gate verschärft: origin/main einmergen (#1449)
    "git checkout <datei>", // Red-Green-Probe nie so zurücknehmen (verwirft ungesicherte Änderungen)
  ];

  test("jede Kernphrase steht in der Agenten-Definition, die Red-Green-Regel auch in der Gruppen-Rolle", () => {
    for (const phrase of KERNPHRASEN) assert.ok(UMSETZER.includes(phrase), `factory-umsetzer.md ohne „${phrase}“`);
    assert.ok(GRUPPE.includes("git checkout <datei>"), "factory-gruppe.md ohne die Red-Green-Rücknahme-Regel");
    assert.ok(!UMSETZER.replace("nie über stdin", "").includes("nie über stdin"), "Negativfall: die Prüfung erkennt eine fehlende Phrase");
  });

  test("Verschobener-Code-Prüfung: der Skill trägt die Befehle für Diff der alten Datei und Merge-Basis (#1501, #1508)", () => {
    const skill = readFileSync(resolve(ROOT, ".agents/skills/review-lenses/SKILL.md"), "utf8");
    assert.ok(skill.includes("git diff <basis> <M>^2 -- <alte datei>"), "review-lenses ohne Diff der alten Datei gegen die Merge-Basis");
    assert.ok(skill.includes("git merge-base <M>^1 <M>^2"), "review-lenses ohne Merge-Basis-Befehl");
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

describe("Selbstcheck vor jedem Commit (#1625)", () => {
  const GRUPPE = readFileSync(resolve(ROOT, ".claude/agents/factory-gruppe.md"), "utf8");
  const LENS = readFileSync(resolve(ROOT, ".claude/agents/factory-lens.md"), "utf8");
  const SKILL = readFileSync(resolve(ROOT, ".agents/skills/review-lenses/SKILL.md"), "utf8");
  /** Verlangt der Text den sichtbaren Block `Selbstcheck:` mit den Urteilen ok/gefixt/n.a. und der Lens-3-Quelle? */
  const verlangtSelbstcheck = (s: string) => /Block `Selbstcheck:`/.test(s) && /`ok`, `gefixt` oder `n.a.`/.test(s) && /Lens 3/.test(s);

  test("Umsetzer und Gruppen-Rolle verlangen den Block, der Umsetzer übernimmt ihn in den PR-Text", () => {
    assert.ok(verlangtSelbstcheck(UMSETZER), "factory-umsetzer.md");
    assert.ok(/Selbstcheck/.test(GRUPPE), "factory-gruppe.md");
    assert.match(UMSETZER, /derselbe Block steht im PR-Text, kein neues Gate/);
  });

  test("darf NICHT passieren: die Lenses bekommen den Selbstcheck als Vorgabe (sie prüfen unvoreingenommen)", () => {
    assert.doesNotMatch(LENS, /Selbstcheck/);
    assert.doesNotMatch(SKILL, /Selbstcheck/);
  });

  test("Red-Green: ohne die Urteile oder ohne Block-Kopf greift das Prädikat nicht", () => {
    assert.ok(!verlangtSelbstcheck(UMSETZER.replace("`ok`, `gefixt` oder `n.a.`", "ein Urteil")));
    assert.ok(!verlangtSelbstcheck(UMSETZER.replace("Block `Selbstcheck:`", "Hinweis")));
    assert.ok(!verlangtSelbstcheck(""));
  });

  /** Der Umsetzer holt die Blöcke aus den Commit-Bodies in den PR-Text und holt einen fehlenden vor `gh pr create` nach; die Gruppen-Berichte tragen ihn mit. */
  const uebernimmtBloecke = (s: string) =>
    s.includes("git log origin/main..HEAD --format=%B") && /fehlt der Block im letzten Commit, vor `gh pr create` nachholen/.test(s) && /`SELBSTCHECK`[^.]*PR-Text|PR-Text[^.]*`SELBSTCHECK`/.test(s);
  const gruppeTraegtBlock = (s: string) => /Block `Selbstcheck:` im Commit-Body/.test(s) && /übernimmt ihn in den PR-Text/.test(s);

  test("Umsetzer übernimmt die Selbstcheck-Blöcke aus den Commits in den PR-Text; Gruppe trägt den Block im Commit-Body", () => {
    assert.ok(uebernimmtBloecke(UMSETZER), "factory-umsetzer.md");
    assert.ok(gruppeTraegtBlock(GRUPPE), "factory-gruppe.md");
  });

  test("Red-Green: ohne Befehl, Nachhol-Satz, Gruppen-Bezug oder Commit-Body greifen die Prädikate nicht", () => {
    assert.ok(!uebernimmtBloecke(UMSETZER.replaceAll("git log origin/main..HEAD --format=%B", "git log")));
    assert.ok(!uebernimmtBloecke(UMSETZER.replaceAll("vor `gh pr create` nachholen", "ignorieren")));
    assert.ok(!uebernimmtBloecke(UMSETZER.replaceAll("`SELBSTCHECK`", "x")));
    assert.ok(!gruppeTraegtBlock(GRUPPE.replace("im Commit-Body", "irgendwo")));
    assert.ok(!gruppeTraegtBlock(GRUPPE.replace("übernimmt ihn in den PR-Text", "liest ihn")));
    assert.ok(!uebernimmtBloecke("") && !gruppeTraegtBlock(""));
  });
});

describe("Permission-Blockaden: kein rm -rf in den Agent-Definitionen mit Scratch", () => {
  const ABNAHME = readFileSync(resolve(ROOT, ".claude/agents/holdout-abnahme.md"), "utf8");
  const GRUPPE = readFileSync(resolve(ROOT, ".claude/agents/factory-gruppe.md"), "utf8");
  const LENS = readFileSync(resolve(ROOT, ".claude/agents/factory-lens.md"), "utf8");
  /** Nennt die Definition `rm -rf` als gesperrt und sagt, dass Scratch liegen bleibt? */
  const verbietetRmRf = (s: string) => /`rm -rf`/.test(s) && /Scratch/.test(s) && /`deny`|gesperrt/.test(s) && /liegen/.test(s);

  test("Umsetzer, Gruppe, Lens und Abnahme tragen die Regel", () => {
    for (const [name, text] of [["umsetzer", UMSETZER], ["gruppe", GRUPPE], ["lens", LENS], ["abnahme", ABNAHME]] as const) {
      assert.ok(verbietetRmRf(text), name);
    }
  });

  test("Abnahme: Dev-Server per PID beenden, kein git checkout/restore/reset auf Dateien", () => {
    assert.match(ABNAHME, /Kein `rm -rf`, kein Scratch-Aufräumen/);
    assert.match(ABNAHME, /kein `git checkout`, `git restore` und `git reset`/);
  });

  test("Red-Green: ohne eines der Merkmale greift das Prädikat nicht", () => {
    assert.ok(!verbietetRmRf(ABNAHME.replaceAll("`rm -rf`", "rm")));
    assert.ok(!verbietetRmRf(ABNAHME.replaceAll("Scratch", "Müll")));
    assert.ok(!verbietetRmRf(ABNAHME.replaceAll("`deny`", "x").replaceAll("gesperrt", "x")));
    assert.ok(!verbietetRmRf(ABNAHME.replaceAll("liegen", "x")));
    assert.ok(!verbietetRmRf(""));
  });
});

describe("Leitplanken-Audit (#1067)", () => {
  type Kommentare = { author?: { login: string }; comments?: { author?: { login: string }; body: string }[] };
  type AuditDeps = { prStatus?: (nr: string) => Status; prDateien?: (nr: string) => string[]; prKommentare?: (nr: string) => Kommentare };
  const audit = abschlussRaw as unknown as {
    trifftLeitplanke: (pfad: string, muster: string[]) => boolean;
    leitplankenMuster: () => string[];
    AUDIT_KOPF: string;
  };
  const ruf = (text: string, d: AuditDeps) =>
    (blockade as (i: Eingabe, d: AuditDeps) => string | null)({ hookEvent: "SubagentStop", agentType: UMS, lastMessage: text }, {
      prStatus: () => ({ state: "MERGED", autoMergeRequest: null }),
      ...d,
    });
  const gemergt = (d: AuditDeps) => ruf("ERGEBNIS: gemergt\nPR: #7", d);
  const mit = (body: string, login = FREMD_OWNER): Kommentare => ({ author: { login: FREMD_OWNER }, comments: [{ author: { login }, body }] });
  const treffer = (pfad: string, muster: string[]) => audit.trifftLeitplanke(pfad, muster);

  test("Matcher: verankert, Verzeichnis-Präfix, Stern, jede Ebene", () => {
    assert.ok(treffer(".claude/agents/x.md", ["/.claude/"]));
    assert.ok(treffer("AGENTS.md", ["AGENTS.md"]));
    assert.ok(treffer("src/content/AGENTS.md", ["AGENTS.md"]));
    assert.ok(treffer("scripts/check-size.mjs", ["/scripts/check-*.mjs"]));
    assert.ok(!treffer("scripts/sub/check-x.mjs", ["/scripts/check-*.mjs"]));
    assert.ok(treffer("scripts/docs-gen.mjs", ["/scripts/docs-gen*"]));
    assert.ok(treffer("scripts/docs-gen/config.json", ["/scripts/docs-gen*"]));
    assert.ok(!treffer("src/main.ts", ["/.claude/", "AGENTS.md", "/scripts/check-*.mjs"]));
    assert.ok(!treffer("docs/CLAUDE.md", ["/CLAUDE.md"]));
    assert.ok(!treffer(".claude", ["/.claude/"]));
  });

  test("Matcher teilt die Muster-Semantik mit der Extraktionsliste (musterRegex): Regex-Zeichen sind wörtlich, der Stern bleibt im Segment", () => {
    assert.ok(treffer("scripts/a+b.mjs", ["/scripts/a+b.*"]));
    assert.ok(!treffer("scripts/aab.mjs", ["/scripts/a+b.*"]), "das Plus ist wörtlich");
    assert.ok(!treffer("scripts/aXmjs", ["/scripts/a.mjs"]), "der Punkt ist wörtlich");
    assert.ok(treffer("scripts/(x).mjs", ["/scripts/(x).mjs"]), "Klammern sind wörtlich");
  });

  test("echte Liste aus .github/protected-paths.json", () => {
    const liste = audit.leitplankenMuster();
    assert.ok(liste.includes("AGENTS.md") && liste.includes("/test/harness/"));
    assert.ok(treffer("scripts/umsetzer-abschluss.mjs", liste));
    assert.ok(!treffer("src/main.ts", liste));
  });

  test("Audit-Kopfzeile steht wörtlich in AGENTS.md", () => {
    const agents = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(`„${audit.AUDIT_KOPF}`), "AGENTS.md nennt die Kopfzeile nicht wörtlich");
  });

  describe("ein gh-Aufruf liefert Status, Dateien und Kommentare (#1740 L4)", () => {
    const merged = { state: "MERGED", autoMergeRequest: null, labels: [] };
    const alles = (files: string[], comments: Kommentare["comments"]) => ({ ...merged, files: files.map((path) => ({ path })), author: { login: FREMD_OWNER }, comments });
    // Der Diff-Rückfall (`gh pr diff`) ist injiziert und zählt: der echte Aufruf liefe gegen das Netz; ein Status mit `files` darf ihn nie auslösen.
    const abschlussOhneInjektion = (status: object) => {
      let aufrufe = 0;
      let diffAufrufe = 0;
      const nichtAufrufen = () => {
        diffAufrufe++;
        throw new Error("kein gh pr diff erwartet");
      };
      const r = abschluss.abschlussBlockade(
        { hookEvent: "SubagentStop", agentType: UMS, lastMessage: "ERGEBNIS: gemergt\nPR: #7" },
        { config: FREMD, prStatus: () => (aufrufe++, status), prDateien: (nr: string, st: never) => abschluss.ghPrDateien(nr, st, nichtAufrufen) } as never,
      );
      assert.equal(diffAufrufe, 0, "der Status trägt die Dateien, der Diff-Rückfall bleibt ungenutzt");
      return { r, aufrufe };
    };

    test("Leitplanken-Datei ohne Audit-Kommentar im selben Status: blockiert, genau ein Status-Aufruf", () => {
      const { r, aufrufe } = abschlussOhneInjektion(alles(["src/main.ts", "AGENTS.md"], [{ author: { login: FREMD_OWNER }, body: "LGTM" }]));
      assert.match(r ?? "", /AGENTS\.md/);
      assert.equal(aufrufe, 1);
    });

    test("Audit-Kommentar des Autors im selben Status: frei; PR ohne Leitplanken-Datei: frei", () => {
      assert.equal(abschlussOhneInjektion(alles(["AGENTS.md"], [{ author: { login: FREMD_OWNER }, body: audit.AUDIT_KOPF }])).r, null);
      assert.equal(abschlussOhneInjektion(alles(["src/main.ts"], [])).r, null);
    });

    test("ghPrDateien: files unter der Grenze ohne Rückfall; genau 100 und fehlendes files lösen den Rückfall aus; ein Fehler wird weitergereicht", () => {
      const nichtAufrufen = () => {
        throw new Error("kein gh pr diff erwartet");
      };
      const dateien = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts` }));
      assert.deepEqual(abschluss.ghPrDateien("7", { files: dateien(2) }, nichtAufrufen), ["f0.ts", "f1.ts"]);
      assert.equal(abschluss.GRAPHQL_DATEIEN_GRENZE, 100);
      assert.equal(abschluss.ghPrDateien("7", { files: dateien(99) }, nichtAufrufen).length, 99);
      assert.deepEqual(abschluss.ghPrDateien("7", { files: dateien(100) }, () => "a.ts\n b.ts \n\n"), ["a.ts", "b.ts"]);
      assert.deepEqual(abschluss.ghPrDateien("7", {}, () => "c.ts"), ["c.ts"]);
      assert.deepEqual(abschluss.ghPrDateien("7", undefined, () => "d.ts"), ["d.ts"]);
      assert.throws(() => abschluss.ghPrDateien("7", { files: dateien(100) }, nichtAufrufen), /kein gh pr diff/);
    });
  });

  test("ghPrKommentare: ein Status mit author und comments dient als Quelle; fehlt eines von beiden, kommt der eigene Aufruf", () => {
    const nichtAufrufen = () => {
      throw new Error("kein eigener Aufruf erwartet");
    };
    const voll = { author: { login: "a" }, comments: [] };
    assert.equal(abschluss.ghPrKommentare("7", voll, nichtAufrufen), voll);
    const eigen = { author: { login: "b" }, comments: [{ body: "x" }] };
    assert.equal(abschluss.ghPrKommentare("7", { author: { login: "a" } }, () => eigen), eigen);
    assert.equal(abschluss.ghPrKommentare("7", { comments: [] }, () => eigen), eigen);
    assert.equal(abschluss.ghPrKommentare("7", undefined, () => eigen), eigen);
  });

  test("gemergt + Leitplanke ohne Audit-Kommentar: blockiert, nennt Treffer", () => {
    const r = gemergt({ prDateien: () => ["src/main.ts", "AGENTS.md", "scripts/check-x.mjs"], prKommentare: () => mit("LGTM") });
    assert.match(r ?? "", /AGENTS\.md/);
    assert.match(r ?? "", /scripts\/check-x\.mjs/);
    assert.doesNotMatch(r ?? "", /src\/main\.ts/);
  });

  test("gemergt + Leitplanke mit Audit-Kommentar des PR-Autors: frei", () => {
    const r = gemergt({ prDateien: () => ["AGENTS.md"], prKommentare: () => mit(`${audit.AUDIT_KOPF}\n\nwas, warum, revert`) });
    assert.equal(r, null);
  });

  test("Kopfzeile von anderem Login zählt nicht", () => {
    const r = gemergt({ prDateien: () => ["AGENTS.md"], prKommentare: () => mit(audit.AUDIT_KOPF, "fremder") });
    assert.ok(r);
  });

  test("Kopfzeile nur mitten im Text zitiert: zählt nicht als Audit", () => {
    const r = gemergt({ prDateien: () => ["AGENTS.md"], prKommentare: () => mit(`fehlt noch: ${audit.AUDIT_KOPF}`) });
    assert.ok(r);
  });

  test("PR ohne Autor-Angabe: Kommentar ohne Autor zählt nicht als Audit", () => {
    const r = gemergt({ prDateien: () => ["AGENTS.md"], prKommentare: () => ({ comments: [{ body: audit.AUDIT_KOPF }] }) });
    assert.ok(r);
  });

  test("Muster mit innerem Schrägstrich ist verankert (nicht auf jeder Ebene)", () => {
    assert.ok(treffer("test/harness/x.ts", ["test/harness/"]));
    assert.ok(!treffer("src/test/harness/x.ts", ["test/harness/"]));
  });

  test("keine Treffer: frei, ohne Kommentare zu lesen", () => {
    const r = gemergt({
      prDateien: () => ["src/main.ts"],
      prKommentare: () => {
        throw new Error("nicht nötig");
      },
    });
    assert.equal(r, null);
  });

  test("gh-Fehler: frei (fail-open)", () => {
    const wirft = () => {
      throw new Error("gh kaputt");
    };
    assert.equal(gemergt({ prDateien: wirft, prKommentare: () => mit("x") }), null);
    assert.equal(gemergt({ prDateien: () => ["AGENTS.md"], prKommentare: wirft }), null);
  });

  test("abgebrochen, festgefahren, uebergabe sind nicht betroffen", () => {
    const deps: AuditDeps = { prDateien: () => ["AGENTS.md"], prKommentare: () => mit("x") };
    assert.equal(ruf("ERGEBNIS: abgebrochen\nPR: #7", deps), null);
    assert.equal(ruf("ERGEBNIS: festgefahren\nPR: #7", deps), null);
    assert.equal(ruf("ERGEBNIS: uebergabe\nPR: #7\nSCHNITT: pr\nUEBERGABE: x", deps), null);
  });
});
