/* Nach-Merge-Kriterium (#1787): ein Akzeptanzkriterium mit Präfix `Nach dem Merge:` ist erst nach dem Merge erfüllbar. Die Holdout-Abnahme
 * prüft es nicht (kein Fehl-Hand-off), der Umsetzer liefert den Beleg als PR-Kommentar nach dem Merge.
 *
 * @harness-waechter – einziger Durchsetzer der Klasse `nach-merge` über Spezifikation, Abnahme-Auswertung und CI-Nachweis, darum im geschützten test/harness/.
 *
 * Regeln:
 *   1. `kriterien()` markiert Kriterien mit dem Präfix `Nach dem Merge:` (`nachMerge: true`); `spezifikationsMaengel` meldet ein Ticket, dessen Kriterien alle so markiert sind.
 *   2. `abnahme.mjs`: `kriterien` zeigt die Markierung, der Bericht braucht für sie keine Zeile (eine vorhandene wird ignoriert), das Skript setzt
 *      selbst den Zeilenwert `nach-merge`, `entscheide` ignoriert ihn; der Abnahme-Agent kann `nach-merge` nicht selbst setzen.
 *   3. `check-abnahme-nachweis.mjs`: `nach-merge` ist nur an markierten Kriterien erlaubt (dort auch `erfuellt`), an normalen rot.
 *   4. Doku-Pin: Ticket-Format-Abschnitt und Skill nennen `Nach dem Merge:`.
 *
 * Bewusste Grenzen: der Präfix wird nicht gegen Missbrauch geprüft (ein Autor kann ein prüfbares Kriterium als Nach-Merge markieren; das sieht das
 * Review der Spezifikation); ob der Umsetzer den Beleg nach dem Merge tatsächlich postet, prüft kein Gate; die Doku-Pins sind Wortpins, keine Sinnprüfung.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abnahmeRaw from "../../scripts/abnahme.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkRaw from "../../scripts/check-abnahme-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nlRaw from "../../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as specRaw from "../../scripts/spezifikation-lib.mjs";
import { echteSprache, echteSpezifikation } from "../support/echte-sprache";
import { FREMD, FREMD_OWNER } from "../support/fremd-config";

type Krit = { k: string; text: string; nachMerge?: boolean };
type Urteil = { k: string; wert: string }[];
const SPRACHE = echteSpezifikation();
const SR = specRaw as unknown as { kriterien: (b: string, s: unknown) => Krit[]; spezifikationsMaengel: (b: string, s: unknown) => string[] };
const S = { kriterien: (b: string) => SR.kriterien(b, SPRACHE), spezifikationsMaengel: (b: string) => SR.spezifikationsMaengel(b, SPRACHE) };
const A = abnahmeRaw as unknown as {
  parseBericht: (t: string, nr: number, k: Krit[]) => { urteile?: { k: string; wert: string; beleg: string }[]; fehler?: string[] };
  entscheide: (u: { wert: string }[]) => string;
  fuehreAus: (argv: string[], io: unknown) => { code: number; out: string; err: string };
};
const C = checkRaw as unknown as {
  bewerteAbnahme: (o: { nachweis: unknown; ticket: { nr: number; kriterien: Krit[]; nachMerge: string } | null; marker: unknown; abnahmeHead: unknown; zeilen: unknown }) => string[];
};
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => Record<string, string> };
const { abnahmeMarker } = nlRaw as unknown as { abnahmeMarker: (z: unknown) => string };
const Z = commitZeilen(FREMD.praefixe.commitZeile, FREMD.agenten.planer);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(ROOT + rel, "utf8");

const BODY = "## Ziel\nZ\n\n## Akzeptanzkriterien\n1. Erstes.\n2. Nach dem Merge: ein workflow_dispatch-Lauf ist belegt.\n3. Negativfall: Drittes.\n";
const KRIT: Krit[] = S.kriterien(BODY);
const KOPF = "ABNAHME #7 · holdout-abnahme";

describe("Regel 1: Spezifikation", () => {
  test("nur das Kriterium mit dem Präfix ist markiert, auch hinter Listen- und Checkbox-Zeichen", () => {
    expect(KRIT.map((c) => c.nachMerge)).toEqual([false, true, false]);
    const cb = S.kriterien("## Akzeptanzkriterien\n- [ ] Nach dem Merge: x\n- Nach dem Merge nicht am Anfang: y\n- nach dem merge: klein\n");
    expect(cb.map((c) => c.nachMerge)).toEqual([true, false, false]);
  });
  test("Negativfall: alle Kriterien nach dem Merge ist ein Mangel, ein einziges normales genügt", () => {
    const alle = "## Ziel\nZ\n\n## Akzeptanzkriterien\n1. Nach dem Merge: a\n2. Nach dem Merge: Negativfall b\n";
    expect(S.spezifikationsMaengel(alle).join("\n")).toMatch(/Nach dem Merge/);
    expect(S.spezifikationsMaengel(BODY)).toEqual([]);
  });
});

describe("Regel 2: Abnahme-Auswertung", () => {
  const bericht = (zeilen: string[]) => [KOPF, ...zeilen].join("\n");
  test("der Bericht braucht für das Nach-Merge-Kriterium keine Zeile; das Skript setzt `nach-merge`", () => {
    const r = A.parseBericht(bericht(["K1: erfuellt — a", "K3: erfuellt — c"]), 7, KRIT);
    expect(r.fehler).toBeUndefined();
    expect(r.urteile?.map((u) => `${u.k}:${u.wert}`)).toEqual(["K1:erfuellt", "K2:nach-merge", "K3:erfuellt"]);
  });
  test("eine vorhandene Zeile zum Nach-Merge-Kriterium wird ignoriert, auch eine fehlerhafte", () => {
    for (const z of ["K2: nicht-erfuellt — später", "K2: unsinn", "K2: nach-merge — x"]) {
      const r = A.parseBericht(bericht(["K1: erfuellt — a", z, "K3: erfuellt — c"]), 7, KRIT);
      expect(r.fehler, z).toBeUndefined();
      expect(r.urteile?.[1].wert, z).toBe("nach-merge");
    }
  });
  test("Negativfall: für ein normales Kriterium kann der Agent `nach-merge` nicht setzen, eine fehlende Zeile bleibt ein Fehler", () => {
    const r = A.parseBericht(bericht(["K1: nach-merge — a", "K3: erfuellt — c"]), 7, KRIT);
    expect(r.fehler?.join("\n")).toMatch(/K1: unbekanntes Urteil/);
    const fehlt = A.parseBericht(bericht(["K1: erfuellt — a"]), 7, KRIT);
    expect(fehlt.fehler).toEqual(["K3: fehlt im Bericht"]);
  });
  test("entscheide ignoriert nach-merge, Vorrang der übrigen Werte bleibt", () => {
    expect(A.entscheide([{ wert: "erfuellt" }, { wert: "nach-merge" }])).toBe("bestanden");
    expect(A.entscheide([{ wert: "nach-merge" }, { wert: "nicht-erfuellt" }])).toBe("fix");
    expect(A.entscheide([{ wert: "nach-merge" }, { wert: "nicht-pruefbar" }, { wert: "nicht-erfuellt" }])).toBe("handoff");
  });
  test("`auswerten` Ende-zu-Ende: Ergebnis bestanden, Abnahme-Zeile und Marker tragen K2:nach-merge", () => {
    const HEAD = "a".repeat(40);
    const posts: { nr: number; body: string }[] = [];
    const io = {
      owner: FREMD_OWNER,
      config: { labels: { forum: "forum" }, sprache: echteSprache() },
      zeilen: Z,
      leseDatei: () => bericht(["K1: erfuellt — a", "K3: erfuellt — c"]),
      ladeIssue: () => ({ state: "open", body: BODY, user: { login: FREMD_OWNER, type: "User" }, labels: [] }),
      ladeKommentare: () => [],
      poste: (nr: number, body: string) => void posts.push({ nr, body }),
      git: (_cwd: string, args: string[]) => (args[0] === "status" ? "" : `${HEAD}\n`),
    };
    const r = A.fuehreAus(["auswerten", "7", "--pr", "70", "--bericht", "b.md", "--worktree", "/wt", "--head", HEAD.slice(0, 7)], io);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`ENTSCHEIDUNG: bestanden\n${Z.abnahme}: head=${HEAD} durchgaenge=1 urteil=K1:erfuellt,K2:nach-merge,K3:erfuellt\n`);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain(`<!-- ${abnahmeMarker(Z)} durchgang=1 head=${HEAD} urteil=K1:erfuellt,K2:nach-merge,K3:erfuellt -->`);
  });
  test("`kriterien <nr>` kennzeichnet das Kriterium für den Abnahme-Agenten", () => {
    const io = { owner: FREMD_OWNER, config: { labels: { forum: "forum" }, sprache: echteSprache() }, zeilen: Z, ladeIssue: () => ({ state: "open", body: BODY, user: { login: FREMD_OWNER, type: "User" }, labels: [] }) };
    const out = A.fuehreAus(["kriterien", "7"], io).out;
    expect(out).toContain("K2 (nach dem Merge, nicht prüfen): Nach dem Merge: ein workflow_dispatch-Lauf");
    expect(out).toMatch(/^K1: Erstes\./m);
    expect(out).toMatch(/^K3: Negativfall/m);
  });
});

describe("Regel 3: CI-Nachweis", () => {
  const H = "b".repeat(40);
  const GUT = { bekannt: true, imSlice: true, nachReviewHead: true, konfliktMerges: [], aenderungsCommits: [] };
  const bewerte = (urteil: Urteil) =>
    C.bewerteAbnahme({
      nachweis: { review: { head: "a".repeat(40), runden: 2 }, abnahme: { art: "urteil", head: H, durchgaenge: 1, urteil } },
      ticket: { nr: 9, kriterien: KRIT, nachMerge: SPRACHE.nachMerge as string },
      marker: { durchgang: 1, head: H, urteil },
      abnahmeHead: GUT,
      zeilen: Z,
    });
  const ur = (...w: string[]): Urteil => w.map((wert, i) => ({ k: `K${i + 1}`, wert }));
  test("nach-merge am markierten Kriterium ist grün, ebenso erfuellt dort", () => {
    expect(bewerte(ur("erfuellt", "nach-merge", "erfuellt"))).toEqual([]);
    expect(bewerte(ur("erfuellt", "erfuellt", "erfuellt"))).toEqual([]);
  });
  test("Negativfall: nach-merge an einem normalen Kriterium ist rot", () => {
    expect(bewerte(ur("nach-merge", "nach-merge", "erfuellt")).join("\n")).toMatch(/K1: nach-merge ist nur bei einem Kriterium mit dem Präfix/);
  });
  test("ein markiertes Kriterium, das nicht erfüllt ist, bleibt rot; ein fehlendes Urteil auch", () => {
    expect(bewerte(ur("erfuellt", "nicht-erfuellt", "erfuellt")).join("\n")).toMatch(/K2: nicht-erfuellt/);
    expect(bewerte(ur("erfuellt", "nach-merge")).join("\n")).toMatch(/K3: Urteil fehlt/);
  });
});

describe("Regel 4: Doku-Pin", () => {
  test.each(["docs/ticket-reihenfolge.md", ".agents/skills/factory/ablauf.md", "docs/harness-glossar.md"])("%s nennt den Präfix `Nach dem Merge:`", (rel) => {
    expect(lies(rel)).toContain("`Nach dem Merge:`");
  });
  test("der Skill verlangt den Nach-Merge-Beleg und bindet Szenario- und Abnahme-Prompts an Szenarien und Kriterien", () => {
    const skill = lies(".agents/skills/factory/ablauf.md");
    expect(skill).toContain("Nach-Merge-Beleg #<nr> K<i>");
    expect(skill).toContain("nur aus Szenarien und Kriterien");
  });
  test("der Umsetzer kennt den Nach-Merge-Beleg", () => {
    expect(lies(".claude/agents/factory-umsetzer.md")).toContain("Nach-Merge-Beleg #<nr> K<i>");
  });
});

describe("Sprache als Projektwert (#1711)", () => {
  const H = "b".repeat(40);
  const urteil: Urteil = [{ k: "K1", wert: "nach-merge" }];
  test("die Meldung nennt das Präfix der Sprache, nicht ein festes", () => {
    const fehler = C.bewerteAbnahme({
      nachweis: { review: { head: "a".repeat(40), runden: 2 }, abnahme: { art: "urteil", head: H, durchgaenge: 1, urteil } },
      ticket: { nr: 9, kriterien: [{ k: "K1", text: "x", nachMerge: false }], nachMerge: "After merge:" },
      marker: { durchgang: 1, head: H, urteil },
      abnahmeHead: { bekannt: true, imSlice: true, nachReviewHead: true, konfliktMerges: [], aenderungsCommits: [] },
      zeilen: Z,
    });
    expect(fehler.join("\n")).toContain("Präfix `After merge:` erlaubt");
  });
  test("Negativfall: ohne sprache bricht `abnahme.mjs` mit klarer Meldung ab (Exit 1, kein Deutsch-Standardwert)", () => {
    for (const befehl of [["kriterien", "7"], ["auswerten", "7", "--pr", "70", "--bericht", "b.md", "--worktree", "/wt", "--head", "abcdef1"]]) {
      const io = { owner: FREMD_OWNER, config: { labels: { forum: "forum" } }, zeilen: Z, ladeIssue: () => ({ state: "open", body: BODY, user: { login: FREMD_OWNER, type: "User" }, labels: [] }) };
      const r = A.fuehreAus(befehl, io);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/sprache[\s\S]*Fix:/);
      expect(r.err).not.toContain("Error:");
    }
  });
});
