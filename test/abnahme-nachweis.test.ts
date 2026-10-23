/* Abnahme-Nachweis-Wächter (ADR 0022 F13, #1755): die PR-CI erzwingt Urteil je Kriterium, Cap, head-Regel und Spur.
 * Logik aus scripts/check-abnahme-nachweis.mjs importiert; git und gh sind injiziert, ein Fall nutzt echtes git. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-abnahme-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nlRaw from "../scripts/nachweis-lib.mjs";
import { echteSprache } from "./support/echte-sprache";
import { FREMD, FREMD_CONFIG_PFAD, FREMD_OWNER, projektConfig } from "./support/fremd-config";

interface Zeilen {
  abnahme: string;
  abnahmeOverride: string;
}
type Urteil = { k: string; wert: string }[];
type Marker = { durchgang: number; head: string; urteil: Urteil } | null;
type AbnahmeHead = { bekannt: boolean; imSlice: boolean; nachReviewHead: boolean; konfliktMerges: string[]; aenderungsCommits: { sha: string; dateien: string[] }[] };
type Nachweis = { review: { head: string | null; runden: number } | null; abnahme: unknown };
interface Mod {
  verknuepfteTickets: (body: string) => number[];
  vertrauterMarker: (k: unknown[], owner: string, z: Zeilen) => Marker;
  bewerteAbnahme: (o: { nachweis: Nachweis; ticket: { nr: number; kriterien: { k: string; text: string; nachMerge?: boolean }[] } | null; marker: Marker; abnahmeHead: AbnahmeHead; zeilen: Zeilen }) => string[];
  checkAbnahmeNachweis: (o: {
    runGit: (a: string[]) => string;
    gh: (a: string[]) => unknown;
    env: Record<string, string>;
    ladeConfig: () => unknown;
  }) => { ok: boolean; fehler: string[]; override?: string; entwurf?: boolean; skipped?: boolean };
}
const m = raw as unknown as Mod;
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => Zeilen & Record<string, string> };
const { parseNachweis, abnahmeMarker, MAX_REVIEW_PAESSE } = nlRaw as unknown as { parseNachweis: (t: string, z: unknown) => Nachweis; abnahmeMarker: (z: unknown) => string; MAX_REVIEW_PAESSE: number };
const PL = FREMD.agenten.planer;
const Z = commitZeilen(FREMD.praefixe.commitZeile, PL);
const CONFIG = { repo: FREMD.repo, praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PL }, sprache: echteSprache() };

const H = "b".repeat(40);
const R = "a".repeat(40);
const GUT: AbnahmeHead = { bekannt: true, imSlice: true, nachReviewHead: true, konfliktMerges: [], aenderungsCommits: [] };
const kr = (n: number) => Array.from({ length: n }, (_, i) => ({ k: `K${i + 1}`, text: `t${i + 1}`, nachMerge: false }));
const ur = (...w: string[]): Urteil => w.map((wert, i) => ({ k: `K${i + 1}`, wert }));
const marker = (o: Partial<NonNullable<Marker>> = {}): Marker => ({ durchgang: 1, head: H, urteil: ur("erfuellt", "erfuellt"), ...o });
const nachweis = (abnahme: unknown, runden = 2): Nachweis => ({ review: { head: R, runden }, abnahme });
const urteilZeile = (o: { urteil?: Urteil; durchgaenge?: number } = {}) => ({ art: "urteil", head: H, durchgaenge: o.durchgaenge ?? 1, urteil: o.urteil ?? ur("erfuellt", "erfuellt") });
const bewerte = (o: { abnahme?: unknown; runden?: number; ticket?: { nr: number; kriterien: { k: string; text: string; nachMerge?: boolean }[] } | null; marker?: Marker; abnahmeHead?: Partial<AbnahmeHead>; review?: boolean }) =>
  m.bewerteAbnahme({
    nachweis: o.review === false ? { review: null, abnahme: "abnahme" in o ? o.abnahme : urteilZeile() } : nachweis("abnahme" in o ? o.abnahme : urteilZeile(), o.runden),
    ticket: o.ticket === undefined ? { nr: 9, kriterien: kr(2) } : o.ticket,
    marker: o.marker === undefined ? marker() : o.marker,
    abnahmeHead: { ...GUT, ...o.abnahmeHead },
    zeilen: Z,
  });
const rot = (fehler: string[], muster: RegExp) => {
  expect(fehler.length, "muss rot sein").toBeGreaterThan(0);
  expect(fehler.join("\n")).toMatch(muster);
};

describe("bewerteAbnahme: grün", () => {
  test("alles erfüllt, Spur passt (Urteil in anderer Reihenfolge, Kurz-head)", () => {
    expect(bewerte({})).toEqual([]);
    expect(bewerte({ marker: marker({ urteil: ur("erfuellt", "erfuellt").reverse(), head: H.slice(0, 7).toUpperCase() }) })).toEqual([]);
  });
  test("durchgaenge == runden ist grün", () => {
    expect(bewerte({ abnahme: urteilZeile({ durchgaenge: 2 }), runden: 2, marker: marker({ durchgang: 2 }) })).toEqual([]);
  });
});

describe("K1: Zeile und Urteil je Kriterium", () => {
  test("Zeile fehlt", () => rot(bewerte({ abnahme: null }), /Zeile fehlt.*abnahme\.mjs kriterien/));
  test("ungültige Zeile", () => rot(bewerte({ abnahme: { art: "ungueltig", zeile: "Unsinn" } }), /ungültig \(Unsinn\)/));
  test("Urteil für ein Kriterium fehlt", () => rot(bewerte({ ticket: { nr: 9, kriterien: kr(3) } }), /K3: Urteil fehlt/));
  test("unbekanntes Kriterium (über der Anzahl)", () => rot(bewerte({ ticket: { nr: 9, kriterien: kr(1) } }), /K2: unbekannt/));
  test("doppeltes K macht schon der Parser ungültig, die Meldung nennt den Grund (L6a)", () => {
    const n = parseNachweis(`${Z.abnahme}: head=${H} durchgaenge=1 urteil=K1:erfuellt,K2:erfuellt,K2:nicht-erfuellt`, Z);
    rot(bewerte({ abnahme: n.abnahme }), /ungültig \(K2 doppelt: /);
  });
  test("unbekannter Urteilswert macht schon der Parser ungültig, die Meldung nennt den Grund (L6a)", () => {
    const n = parseNachweis(`${Z.abnahme}: head=${H} durchgaenge=1 urteil=K1:gut`, Z);
    rot(bewerte({ abnahme: n.abnahme }), /ungültig \(unbekannter Wert „gut“ bei K1: /);
  });
});

describe("K2: nicht erfüllt, nicht prüfbar", () => {
  test.each(["nicht-erfuellt", "nicht-pruefbar"])("%s ist rot", (wert) => {
    const u = ur("erfuellt", wert);
    rot(bewerte({ abnahme: urteilZeile({ urteil: u }), marker: marker({ urteil: u }) }), new RegExp(`K2: ${wert}`));
  });
});

describe("K3: Cap", () => {
  test("durchgaenge > runden ist rot", () => rot(bewerte({ abnahme: urteilZeile({ durchgaenge: 3 }), runden: 2, marker: marker({ durchgang: 3 }) }), /durchgaenge=3 ist größer als runden=2/));
  test("die Cap-Meldung nennt den Wert der Konstante MAX_REVIEW_PAESSE (L5c)", () => {
    expect(MAX_REVIEW_PAESSE).toBeGreaterThan(0);
    rot(bewerte({ abnahme: urteilZeile({ durchgaenge: 3 }), runden: 2, marker: marker({ durchgang: 3 }) }), new RegExp(`Cap ${MAX_REVIEW_PAESSE} Pässe, darüber nur mit Zusatzpass`));
  });
  test("Review-Zeile fehlt oder runden keine Zahl", () => {
    rot(bewerte({ review: false }), /Review-Zeile fehlt/);
    rot(bewerte({ runden: Number.NaN }), /runden ist keine Zahl/);
  });
});

describe("K4: head-Regel", () => {
  test("head unbekannt, nicht im Slice, kein Nachfahre", () => {
    rot(bewerte({ abnahmeHead: { bekannt: false, imSlice: false } }), /kein bekannter Commit/);
    rot(bewerte({ abnahmeHead: { imSlice: false } }), /nicht im Slice/);
    rot(bewerte({ abnahmeHead: { nachReviewHead: false } }), /kein Nachfahre des Review-head/);
  });
  test("Code-Commit und Konflikt-Merge nach dem Abnahme-head", () => {
    rot(bewerte({ abnahmeHead: { aenderungsCommits: [{ sha: "c1", dateien: ["src/a.ts"] }] } }), /Commit c1 .* ändert Dateien \(src\/a\.ts\)/);
    rot(bewerte({ abnahmeHead: { konfliktMerges: ["m1"] } }), /Konflikt-Merge m1/);
  });
});

describe("K5: Spur", () => {
  test("ohne Marker rot", () => rot(bewerte({ marker: null }), /Spur fehlt/));
  test("kurzer Zeilen-head gegen langen Marker-head ist grün (Präfix in beide Richtungen)", () => {
    expect(bewerte({ abnahme: { ...urteilZeile(), head: H.slice(0, 8) } })).toEqual([]);
  });
  test("head, Durchgang oder Urteil weichen ab", () => {
    rot(bewerte({ marker: marker({ head: "c".repeat(40) }) }), /Marker-head/);
    rot(bewerte({ marker: marker({ durchgang: 2 }) }), /Marker-Durchgang 2/);
    rot(bewerte({ marker: marker({ urteil: ur("erfuellt", "nicht-erfuellt") }) }), /Urteil im Marker weicht/);
  });
});

describe("vertrauterMarker", () => {
  const text = (o: { durchgang?: number; handoff?: boolean } = {}) =>
    `<!-- ${abnahmeMarker(Z)}${o.handoff ? "-handoff" : ""} durchgang=${o.durchgang ?? 1} head=${H} urteil=K1:erfuellt -->`;
  const owner = { login: FREMD_OWNER, type: "User" };
  test("nur vertraute Autoren zählen; ein Bot mit falschem type nicht", () => {
    expect(m.vertrauterMarker([{ user: { login: "fremd", type: "User" }, body: text() }], FREMD_OWNER, Z)).toBeNull();
    expect(m.vertrauterMarker([{ user: { login: "github-actions[bot]", type: "User" }, body: text() }], FREMD_OWNER, Z)).toBeNull();
    expect(m.vertrauterMarker([{ user: owner, body: text() }], FREMD_OWNER, Z)?.durchgang).toBe(1);
  });
  test("ein späterer Kommentar ohne Marker verdrängt den Marker nicht", () => {
    const k = [{ user: owner, body: text({ durchgang: 1 }) }, { user: owner, body: "LGTM, kein Marker" }];
    expect(m.vertrauterMarker(k, FREMD_OWNER, Z)?.durchgang).toBe(1);
  });
  test("ohne Kommentarliste: kein Marker", () => {
    expect(m.vertrauterMarker(undefined as unknown as unknown[], FREMD_OWNER, Z)).toBeNull();
  });
  test("Hand-off-Marker zählt nicht, der jüngste vertraute Marker gewinnt", () => {
    expect(m.vertrauterMarker([{ user: owner, body: text({ handoff: true }) }], FREMD_OWNER, Z)).toBeNull();
    const k = [{ user: owner, body: text({ durchgang: 1 }) }, { user: owner, body: text({ durchgang: 2 }) }, { user: { login: "fremd", type: "User" }, body: text({ durchgang: 3 }) }];
    expect(m.vertrauterMarker(k, FREMD_OWNER, Z)?.durchgang).toBe(2);
  });
});

describe("verknuepfteTickets", () => {
  test("alle Schließ-Schlüsselwörter, Dubletten zusammen, Fremdreferenz ignoriert", () => {
    expect(m.verknuepfteTickets("Closes #5\nfixes #6, Resolved: #7\nCloses #5")).toEqual([5, 6, 7]);
    expect(m.verknuepfteTickets("Closes other/repo#8 und Siehe #9")).toEqual([]);
    expect(m.verknuepfteTickets(undefined as unknown as string)).toEqual([]);
    expect(m.verknuepfteTickets("close #1, Fix #2, fixed #3, resolve #4, resolves #5, RESOLVED #6")).toEqual([1, 2, 3, 4, 5, 6]);
  });
  test("Wortgrenzen: Unclosed, Anhang an der Nummer und Zeilenumbruch zählen nicht", () => {
    expect(m.verknuepfteTickets("Unclosed #5")).toEqual([]);
    expect(m.verknuepfteTickets("Closes #5x")).toEqual([]);
    expect(m.verknuepfteTickets("Closes\n#5")).toEqual([]);
  });
});

describe("checkAbnahmeNachweis (git und gh injiziert)", () => {
  const BODY = (n = 9) => `Closes #${n}`;
  const AK = "## Akzeptanzkriterien\n1. eins\n2. zwei\n";
  const ZEILE = `${Z.abnahme}: head=${H} durchgaenge=1 urteil=K1:erfuellt,K2:erfuellt`;
  const kommentar = { user: { login: FREMD_OWNER, type: "User" }, body: `<!-- ${abnahmeMarker(Z)} durchgang=1 head=${H} urteil=K1:erfuellt,K2:erfuellt -->` };

  function lauf(o: { messages?: string; issue?: unknown; kommentare?: unknown; env?: Record<string, string>; gitFehler?: boolean; ghFehler?: "issue" | "kommentare"; config?: unknown } = {}) {
    const ghAufrufe: string[][] = [];
    const runGit = (a: string[]): string => {
      if (o.gitFehler && a[0] === "merge-base") throw new Error("git kaputt");
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "f".repeat(40);
      if (a[0] === "rev-parse") return a[3].slice(0, 40);
      if (a[0] === "log") return o.messages ?? `Nachweis\n\n${Z.plan}: ${PL}\n${Z.review}: head=${R} runden=1 lenses=a verdikt=ok\n${ZEILE}`;
      if (a[0] === "rev-list" && a[1] === "--merges") return "";
      if (a[0] === "rev-list" && a.includes("--no-merges")) return "";
      if (a[0] === "rev-list") return `${R}\n${H}\n`;
      if (a[0] === "merge-base") return R;
      return "";
    };
    const gh = (a: string[]) => {
      ghAufrufe.push(a);
      if (a.join(" ").includes("/comments")) {
        if (o.ghFehler === "kommentare") throw new Error("gh kaputt");
        return [o.kommentare ?? [kommentar]];
      }
      if (o.ghFehler === "issue") throw new Error("gh kaputt");
      return o.issue ?? { body: AK };
    };
    const env = { FACTORY_DIFF_BASE: "1".repeat(40), FACTORY_PR_BODY: BODY(), FACTORY_PR_NUMBER: "42", ...o.env };
    return { r: m.checkAbnahmeNachweis({ runGit, gh, env, ladeConfig: () => o.config ?? CONFIG }), ghAufrufe };
  }

  test("grün: Urteil, Spur und head passen", () => {
    const { r } = lauf();
    expect(r.fehler).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test("Zeile fehlt: rot", () => rot(lauf({ messages: "nur Code" }).r.fehler, /Zeile fehlt/));
  test("entfaellt: rot bei Kriterien, grün ohne Kriterien und ohne Ticket", () => {
    const messages = `${Z.abnahme}: entfaellt — kein Kriterium`;
    rot(lauf({ messages }).r.fehler, /entfaellt ist bei Ticket #9/);
    expect(lauf({ messages, issue: { body: "ohne" } }).r.ok).toBe(true);
    expect(lauf({ messages, env: { FACTORY_PR_BODY: "kein Ticket" } }).r.ok).toBe(true);
  });
  test("entfaellt braucht weder PR-Nummer noch Kommentar-Abruf", () => {
    const { r, ghAufrufe } = lauf({ messages: `${Z.abnahme}: entfaellt — kein Kriterium`, issue: { body: "ohne" }, env: { FACTORY_PR_NUMBER: "" } });
    expect(r.ok).toBe(true);
    expect(ghAufrufe.some((a) => a.join(" ").includes("/comments"))).toBe(false);
  });
  test("Urteil ohne verknüpftes Ticket ist rot", () => rot(lauf({ env: { FACTORY_PR_BODY: "" } }).r.fehler, /braucht ein verknüpftes Ticket/));
  test("mehrere Tickets und ein PR statt Ticket sind rot", () => {
    rot(lauf({ env: { FACTORY_PR_BODY: "Closes #1 Fixes #2" } }).r.fehler, /Mehr als ein verknüpftes Ticket/);
    rot(lauf({ issue: { body: AK, pull_request: {} } }).r.fehler, /ist ein PR, kein Ticket/);
  });
  test("fehlende PR-Nummer, fremder Kommentar und abweichendes Urteil sind rot", () => {
    rot(lauf({ env: { FACTORY_PR_NUMBER: "" } }).r.fehler, /PR-Nummer fehlt/);
    rot(lauf({ kommentare: [{ ...kommentar, user: { login: "fremd", type: "User" } }] }).r.fehler, /Spur fehlt/);
    rot(lauf({ kommentare: [{ ...kommentar, body: kommentar.body.replace("K2:erfuellt", "K2:nicht-erfuellt") }] }).r.fehler, /Urteil im Marker weicht/);
  });
  test("gh- und git-Fehler sind rot (fail-closed)", () => {
    rot(lauf({ ghFehler: "issue" }).r.fehler, /gh kaputt/);
    rot(lauf({ ghFehler: "kommentare" }).r.fehler, /gh kaputt/);
    rot(lauf({ gitFehler: true }).r.fehler, /git kaputt/);
  });
  test("GITHUB_REPOSITORY bestimmt Repo und vertrauten Owner; ohne Fehler ist es kein Entwurf; FACTORY_PR_DRAFT=false ist rot", () => {
    const { r, ghAufrufe } = lauf({ env: { GITHUB_REPOSITORY: "x/y" } });
    expect(ghAufrufe[0][1]).toBe("repos/x/y/issues/9");
    rot(r.fehler, /Spur fehlt/); // Kommentar von „owner“, vertraut wäre nur „x“
    const gruen = lauf({ env: { FACTORY_PR_DRAFT: "true" } }).r;
    expect(gruen.entwurf).toBe(false);
    rot(lauf({ messages: "nur Code", env: { FACTORY_PR_DRAFT: "false" } }).r.fehler, /Zeile fehlt/);
    expect(lauf({ messages: "nur Code", env: { FACTORY_PR_DRAFT: "false" } }).r.ok).toBe(false);
  });
  test("Negativfall (#1711): ohne sprache in der Config ist der Nachweis rot (fail-closed), mit ihr bleibt er grün", () => {
    const ohne = { ...CONFIG, sprache: undefined };
    const r = lauf({ config: ohne }).r;
    expect(r.ok).toBe(false);
    expect(r.fehler.join("|")).toMatch(/sprache/);
    expect(lauf().r.fehler).toEqual([]);
  });
  test("Nach-Merge-Präfix kommt aus der Config (Ende-zu-Ende): „Danach:“ zählt, „Nach dem Merge:“ nicht mehr", () => {
    const sprache = echteSprache();
    const config = { ...CONFIG, sprache: { ...sprache, spezifikation: { ...(sprache.spezifikation as object), nachMerge: "Danach:" } } };
    const NM = "## Akzeptanzkriterien\n1. eins\n2. Danach: zwei\n3. Nach dem Merge: drei\n";
    const mit = (urteil: string) => ({
      messages: `${Z.plan}: ${PL}\n${Z.review}: head=${R} runden=1 lenses=a verdikt=ok\n${Z.abnahme}: head=${H} durchgaenge=1 urteil=${urteil}`,
      kommentare: [{ ...kommentar, body: `<!-- ${abnahmeMarker(Z)} durchgang=1 head=${H} urteil=${urteil} -->` }],
      issue: { body: NM },
      config,
    });
    expect(lauf(mit("K1:erfuellt,K2:nach-merge,K3:erfuellt")).r.fehler).toEqual([]);
    rot(lauf(mit("K1:erfuellt,K2:erfuellt,K3:nach-merge")).r.fehler, /K3: nach-merge ist nur bei einem Kriterium mit dem Präfix `Danach:` erlaubt/);
    rot(lauf(mit("K1:nach-merge,K2:erfuellt,K3:erfuellt")).r.fehler, /K1: nach-merge ist nur bei einem Kriterium mit dem Präfix `Danach:` erlaubt/);
  });
  test("Nach-Merge-Kriterium Ende-zu-Ende: nach-merge am markierten Kriterium grün, an einem normalen rot", () => {
    const NM = "## Akzeptanzkriterien\n1. eins\n2. Nach dem Merge: zwei\n";
    const mit = (urteil: string) => ({
      messages: `${Z.plan}: ${PL}\n${Z.review}: head=${R} runden=1 lenses=a verdikt=ok\n${Z.abnahme}: head=${H} durchgaenge=1 urteil=${urteil}`,
      kommentare: [{ ...kommentar, body: `<!-- ${abnahmeMarker(Z)} durchgang=1 head=${H} urteil=${urteil} -->` }],
      issue: { body: NM },
    });
    expect(lauf(mit("K1:erfuellt,K2:nach-merge")).r.fehler).toEqual([]);
    rot(lauf(mit("K1:nach-merge,K2:nach-merge")).r.fehler, /K1: nach-merge ist nur bei einem Kriterium/);
    rot(lauf({ ...mit("K1:erfuellt,K2:nach-merge"), issue: { body: AK } }).r.fehler, /K2: nach-merge ist nur bei einem Kriterium/);
  });
  test("unbekannter Abnahme-head (rev-parse scheitert) ist rot", () => {
    const git = (a: string[]): string => {
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "f".repeat(40);
      if (a[0] === "rev-parse" && a[3].startsWith(H)) throw new Error("unknown revision");
      if (a[0] === "rev-parse") return a[3].slice(0, 40);
      if (a[0] === "log") return `${Z.plan}: ${PL}\n${Z.review}: head=${R} runden=1 lenses=a verdikt=ok\n${ZEILE}`;
      return "";
    };
    const r = m.checkAbnahmeNachweis({ runGit: git, gh: (a) => (a.join(" ").includes("/comments") ? [[kommentar]] : { body: AK }), env: { FACTORY_DIFF_BASE: "1".repeat(40), FACTORY_PR_BODY: BODY(), FACTORY_PR_NUMBER: "42" }, ladeConfig: () => CONFIG });
    rot(r.fehler, /kein bekannter Commit/);
  });
  test("Entwurf: nur Bericht, ok mit Fehlern; auch bei gh-Fehler", () => {
    const { r } = lauf({ messages: "nur Code", env: { FACTORY_PR_DRAFT: "true" } });
    expect(r.ok).toBe(true);
    expect(r.entwurf).toBe(true);
    expect(r.fehler.length).toBeGreaterThan(0);
    expect(lauf({ ghFehler: "issue", env: { FACTORY_PR_DRAFT: "true" } }).r.entwurf).toBe(true);
  });
  test("Override: grün ohne gh-Aufruf; Widerruf gilt nicht mehr", () => {
    const ov = `${Z.abnahmeOverride}: #9 Sitzung vor dem Werkzeug gestartet`;
    const { r, ghAufrufe } = lauf({ messages: ov });
    expect(r.ok).toBe(true);
    expect(r.override).toMatch(/#9/);
    expect(ghAufrufe).toEqual([]);
    rot(lauf({ messages: `${ov}\n${Z.abnahmeOverride}: #9 entfällt` }).r.fehler, /Zeile fehlt/);
  });
  test("Basis == HEAD: nichts zu prüfen, kein gh", () => {
    const spy = vi.fn();
    const r = m.checkAbnahmeNachweis({ runGit: () => "a".repeat(40), gh: spy, env: { FACTORY_DIFF_BASE: "a".repeat(40) }, ladeConfig: () => CONFIG });
    expect(r.skipped).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  test("ungültige Config ist rot", () => {
    const r = m.checkAbnahmeNachweis({ runGit: () => "", gh: () => ({}), env: {}, ladeConfig: () => ({}) });
    expect(r.ok).toBe(false);
  });
});

describe("echtes git: head-Regel", { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  /** Basis, Feature-Commit (Review-head), Abnahme-Zeile als leerer Commit; `nachher` baut weitere Commits dahinter. */
  function repo(nachher: (dir: string) => string | void, abnahmeVorReview = false, abnahmeWahl?: (s: { basis: string; erster: string; review: string }) => string) {
    const dir = mkdtempSync(join(tmpdir(), "abnahme-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "a.txt"), "y\n");
    git(dir, "commit", "-q", "-am", "erster");
    const erster = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "a.txt"), "z\n");
    git(dir, "commit", "-q", "-am", "feature");
    const review = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", `Abnahme\n\n${Z.abnahme}: head=${review} durchgaenge=1 urteil=K1:erfuellt`);
    const abnahmeSha = abnahmeWahl ? abnahmeWahl({ basis, erster, review }) : abnahmeVorReview ? erster : review;
    git(dir, "commit", "-q", "--allow-empty", "-m", `Nachweis\n\n${Z.plan}: ${PL}\n${Z.review}: head=${abnahmeVorReview ? review : erster} runden=1 lenses=a verdikt=ok\n${Z.abnahme}: head=${abnahmeSha} durchgaenge=1 urteil=K1:erfuellt`);
    const neueBasis = nachher(dir);
    return { dir, basis: neueBasis || basis, abn: abnahmeSha };
  }
  const pruefe = (r: { dir: string; basis: string; abn: string }, env: Record<string, string> = {}) => {
    const abn = r.abn;
    const kommentar = { user: { login: FREMD_OWNER, type: "User" }, body: `<!-- ${abnahmeMarker(Z)} durchgang=1 head=${abn} urteil=K1:erfuellt -->` };
    return m.checkAbnahmeNachweis({
      runGit: (a) => execFileSync("git", a, { cwd: r.dir, encoding: "utf8" }),
      gh: (a) => (a.join(" ").includes("/comments") ? [[kommentar]] : { body: "## Akzeptanzkriterien\n1. eins\n" }),
      env: { FACTORY_DIFF_BASE: r.basis, FACTORY_PR_BODY: "Closes #9", FACTORY_PR_NUMBER: "42", ...env },
      ladeConfig: () => CONFIG,
    });
  };
  test("Nachfahre des Review-head plus nur leere Commits: grün", () => {
    const r = pruefe(repo(() => undefined));
    expect(r.fehler).toEqual([]);
  });
  test("Abnahme-head vor dem Review-head: rot", () => rot(pruefe(repo(() => undefined, true)).fehler, /kein Nachfahre des Review-head/));
  test("Code-Commit nach dem Abnahme-head: rot", () =>
    rot(
      pruefe(
        repo((dir) => {
          writeFileSync(join(dir, "a.txt"), "spaet\n");
          git(dir, "commit", "-q", "-am", "spaet");
        }),
      ).fehler,
      /ändert Dateien \(a\.txt\)/,
    ));
  /** Seitenzweig ab der Wurzel mit einer Änderung an `datei`, dann Merge in main; die Basis ist danach die Spitze des Seitenzweigs (wie im Betrieb die Spitze von main). */
  const mergeVonMain = (datei: string, inhalt: string, loesung?: string) => (dir: string) => {
    const wurzel = git(dir, "rev-list", "--max-parents=0", "HEAD");
    git(dir, "checkout", "-q", "-b", "side", wurzel);
    writeFileSync(join(dir, datei), inhalt);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "main-aenderung");
    const spitze = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "main");
    try {
      git(dir, "merge", "-q", "--no-edit", "side");
    } catch {
      writeFileSync(join(dir, datei), loesung ?? "");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "--no-edit");
    }
    return spitze;
  };
  test("konfliktfreier Merge von main nach dem Abnahme-head bleibt grün", () => {
    const r = pruefe(repo(mergeVonMain("b.txt", "b\n")));
    expect(r.fehler).toEqual([]);
  });
  test("Konflikt-Merge nach dem Abnahme-head ist rot", () => {
    rot(pruefe(repo(mergeVonMain("a.txt", "SEITE\n", "aufgeloest\n"))).fehler, /Konflikt-Merge [0-9a-f]{40} nach dem Abnahme-head/);
  });
  test("ohne PR-Nummer (lokal): der Konflikt-Merge wird trotzdem gemeldet, dazu die fehlende PR-Nummer (rot, fail-closed)", () => {
    const fehler = pruefe(repo(mergeVonMain("a.txt", "SEITE\n", "aufgeloest\n")), { FACTORY_PR_NUMBER: "" }).fehler;
    rot(fehler, /Konflikt-Merge [0-9a-f]{40} nach dem Abnahme-head/);
    rot(fehler, /PR-Nummer fehlt/);
  });
  test("ohne PR-Nummer und ohne Konflikt: nur die fehlende PR-Nummer, kein Head-Fehler", () => {
    expect(pruefe(repo(() => undefined), { FACTORY_PR_NUMBER: "" }).fehler).toEqual([expect.stringMatching(/PR-Nummer fehlt/)]);
  });
  test("Abnahme-head außerhalb von base..HEAD ist rot (nicht im Slice)", () => {
    rot(pruefe(repo(() => undefined, false, ({ basis }) => basis)).fehler, /liegt nicht im Slice/);
  });
});

describe("check-abnahme-nachweis: keine Basis, CLI", { timeout: 30_000 }, () => {
  test("keine Vergleichs-Basis auflösbar ist rot (fail-closed)", () => {
    const r = m.checkAbnahmeNachweis({ runGit: () => { throw new Error("kein git"); }, gh: () => ({}), env: {}, ladeConfig: () => CONFIG });
    expect(r.ok).toBe(false);
    rot(r.fehler, /Keine Vergleichs-Basis/);
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const SKRIPT = fileURLToPath(new URL("../scripts/check-abnahme-nachweis.mjs", import.meta.url));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  /** Temp-Repo mit Basis und einem Feature-Commit, dessen Message `nachricht` trägt; liefert Ordner, Basis und Config-Pfad. */
  function cliRepo(nachricht: string) {
    const dir = mkdtempSync(join(tmpdir(), "abnahme-cli-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "basis");
    const basis = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", nachricht);
    const pfad = join(dir, "config.json");
    writeFileSync(pfad, readFileSync(fileURLToPath(new URL(`../${FREMD_CONFIG_PFAD}`, import.meta.url)), "utf8")); // die Fremd-Config, vollständig
    return { dir, basis, pfad };
  }
  const cli = (r: { dir: string; basis: string; pfad: string }, env: Record<string, string> = {}, args: string[] = ["--config", r.pfad]) =>
    spawnSync(process.execPath, [SKRIPT, ...args], { cwd: r.dir, encoding: "utf8", env: { ...process.env, FACTORY_DIFF_BASE: r.basis, GH_TOKEN: "", FACTORY_PR_BODY: "", FACTORY_PR_NUMBER: "", FACTORY_PR_DRAFT: "", ...env } });

  test("rot: Exit 1, stderr nennt Fehler und Override-Hinweis", () => {
    const r = cli(cliRepo("nur Code"));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Abnahme-Nachweis fehlt oder ist ungültig/);
    expect(r.stderr).toMatch(new RegExp(`${Z.abnahme}: Zeile fehlt`));
  });
  test("grün: entfaellt ohne Ticket, Exit 0", () => {
    const r = cli(cliRepo(`x\n\n${Z.abnahme}: entfaellt — kein Ticket`));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Abnahme-Nachweis ok/);
  });
  test("Standardpfad ohne --config: der Prozess liest die echte Config und ihr Präfix zählt", () => {
    const echt = commitZeilen(projektConfig().praefixe.commitZeile, projektConfig().agenten.planer);
    expect(cli(cliRepo(`x\n\n${echt.abnahme}: entfaellt — kein Ticket`), {}, []).status).toBe(0);
    expect(cli(cliRepo(`x\n\n${commitZeilen("XQ-", "x").abnahme}: entfaellt — kein Ticket`), {}, []).status).toBe(1);
  });
  test("Entwurf: nur Bericht, Exit 0", () => {
    const r = cli(cliRepo("nur Code"), { FACTORY_PR_DRAFT: "true" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Entwurf, nur Bericht/);
    expect(r.stdout).toMatch(/Zeile fehlt/);
  });
  test("Override: Exit 0 und die Begründung steht in der Ausgabe", () => {
    const r = cli(cliRepo(`x\n\n${Z.abnahmeOverride}: #9 Sitzung vor dem Werkzeug`));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`${Z.abnahmeOverride} — #9 Sitzung vor dem Werkzeug`));
  });
  test("kaputte Config und --config ohne Pfad: Exit 1", () => {
    // Mit der echten Config wäre diese Message grün (entfaellt ohne Ticket): Exit 1 kommt nur aus dem --config-Zweig.
    const k = cliRepo(`x\n\n${Z.abnahme}: entfaellt — kein Ticket`);
    expect(cli(k).status).toBe(0);
    writeFileSync(k.pfad, "{}");
    const kaputt = cli(k);
    expect(kaputt.status).toBe(1);
    expect(kaputt.stderr).toMatch(/Projekt-Config/);
    const ohnePfad = cli(k, {}, ["--config"]);
    expect(ohnePfad.status).toBe(1);
    expect(ohnePfad.stderr).toMatch(/--config/);
  });
});
