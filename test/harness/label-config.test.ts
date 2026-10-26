/* Board-Werkzeuge, Takte und Kern-Workflows lesen jedes Label aus der Projekt-Config (#1744, ADR 0022 F3, Teil 4).
 *
 * @harness-waechter – einziger Durchsetzer dieser Config-Anbindung, darum im geschützten test/harness/ (#1165).
 *
 * Fixture `FAB` trägt andere Labels als das echte Projekt: gilt ein Verhalten nur mit dem echten Literal, wird der Fall rot.
 * `OHNE_*` lässt je einen Label-Schlüssel weg: jedes Werkzeug bricht mit Schlüssel und Fix-Zeile ab, ein Standardwert fehlt.
 * Der Literal-Scan hält die Einheiten frei von den Werten der echten Config; der Workflow-Wächter verlangt für jeden Config-Aufruf
 * die Guard-Form (`if ! x=$(…); then ::error:: … exit 1`), damit ein fehlender Schlüssel den Lauf rot macht.
 */
import { describe, expect, test } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lies } from "./repo-texte";
import { echteSprache } from "../support/echte-sprache";
import { FREMD_OWNER } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektRaw from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardRaw from "../../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as fremdRaw from "../../scripts/fremdtext-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as festRaw from "../../scripts/check-festgefahren.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as wiedervorlageRaw from "../../scripts/wiedervorlage.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as naechstesRaw from "../../scripts/naechstes-ticket.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as taktRaw from "../../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/ticket-namen.mjs";

type Cfg = Record<string, unknown>;
const ECHT = (projektRaw as unknown as { ladeProjektConfig: () => { labels: Record<string, string> } }).ladeProjektConfig().labels;
const P = projektRaw as unknown as { labelAus: (c: unknown, k: string) => string; ladeProjektConfig: () => { labels: Record<string, string> } };
type It = { number: number; labels: string[]; id?: string; state?: string; status?: string; contentId?: string };
const B = boardRaw as unknown as {
  boardRolleFuer: (l: unknown, c?: unknown) => string;
  seitenListen: (p: It[], f: It[], c?: unknown) => { produkt: It[]; factory: It[]; doppelt: number[]; falsch: number[] };
  umzugsPlan: (p: It[], f: It[], c?: unknown) => { schritte: { number: number; nach: string }[] };
  aufnahmePlan: (n: number[], i: Record<number, unknown>, o?: { config?: unknown }) => { aufnehmen: { rolle: string }[] };
};
const F = fremdRaw as unknown as {
  fremdeingangLabels: (c: unknown) => string[];
  istFremdeingang: (i: unknown, owner: string, o?: { config?: unknown }) => { fremdeingang: boolean; label?: string };
};
const FEST = festRaw as unknown as { main: (o?: { config?: unknown }) => number | undefined; stuckLabel: (c?: unknown) => string; buildStuckComment: (n: number, url: string, label: string) => string };
const W = wiedervorlageRaw as unknown as {
  labelFuer: (e: { label?: string }, standard: string) => string;
  ioAus: (c: unknown, o?: { legen?: (e: { label?: string }, label: string) => number }) => { anlegen: (e: { label?: string }) => number };
};
const N = naechstesRaw as unknown as {
  echteIo: (o?: { config?: Cfg }) => { config: Cfg };
  imBereich: (item: { title: string; labels: string[] }, bereich: string | null, config?: unknown) => boolean;
  waehleUeberBoards: (e: Record<string, unknown>) => unknown;
  waehleNaechstes: (e: Record<string, unknown>) => { ticket: { nr: number } | null; uebersprungen: { nr: number; grund: string }[] };
};
const esc = (namenRaw as unknown as { escapeRegex: (t: string) => string }).escapeRegex;
const T = taktRaw as unknown as { fuehreTaktAus: (a: Record<string, unknown>) => { fehler: boolean } };

const BASIS = {
  sprache: echteSprache(),
  praefixe: { commitZeile: "AB-", branch: "feature/ab-", worktree: "ab-" },
  agenten: { planer: "ab-planer", umsetzer: "ab-umsetzer", lens: "ab-lens", gruppe: "ab-gruppe", ticketSkill: "ab" },
};
const FAB: Cfg = { ...BASIS, labels: { harness: "bereich:fabrik", festgefahren: "zustand:fest", forum: "f", dependabotInbox: "bereich:fabrik" } };
const ohne = (k: string): Cfg => {
  const labels = { ...(FAB.labels as Record<string, string>) };
  delete labels[k];
  return { ...BASIS, labels };
};
const OHNE_HARNESS = ohne("harness");
const OHNE_FESTGEFAHREN = ohne("festgefahren");
const OHNE_FORUM = ohne("forum");
const FIX = /labels\.\w+[\s\S]*Fix:/;

describe("wiedervorlage: Standard-Label aus der Config (ioAus)", () => {
  const eintrag: { label?: string } = { label: undefined };
  test("anlegen nutzt das Fixture-Label, ein Eintrags-Label geht vor", () => {
    const labels: string[] = [];
    const io = W.ioAus(FAB, { legen: (_e, l) => (labels.push(l), 1) });
    io.anlegen(eintrag);
    io.anlegen({ ...eintrag, label: "area:spiel" });
    expect(labels).toEqual(["bereich:fabrik", "area:spiel"]);
  });
  test("ohne Config oder ohne labels.harness wirft die Fabrik", () => {
    expect(() => W.ioAus(OHNE_HARNESS)).toThrow(/labels.harness/);
    expect(() => W.ioAus(undefined)).toThrow(/labels.harness/);
  });
});

describe("labelAus", () => {
  test("liefert den Wert der Fixture-Config", () => {
    expect(P.labelAus(FAB, "harness")).toBe("bereich:fabrik");
    expect(P.labelAus(FAB, "forum")).toBe("f");
  });
  test.each([
    ["Schlüssel fehlt", { labels: {} }],
    ["Config null", null],
    ["labels fehlt", {}],
    ["leerer String", { labels: { harness: "" } }],
    ["nur Leerraum", { labels: { harness: "  " } }],
    ["kein String", { labels: { harness: 5 } }],
  ])("wirft bei %s mit Schlüssel und Fix-Zeile, ohne das echte Label zu nennen", (_n, cfg) => {
    let text = "";
    try {
      P.labelAus(cfg, "harness");
    } catch (e) {
      text = (e as Error).message;
    }
    expect(text).toMatch(/labels\.harness[\s\S]*Fix:/);
    expect(text).not.toContain(ECHT.harness);
  });
});

describe("boardRolleFuer (K3: Fixture-Label bereich:fabrik)", () => {
  test("das Fixture-Label ergibt factory, auch als { name }-Objekt", () => {
    expect(B.boardRolleFuer(["bereich:fabrik"], FAB)).toBe("factory");
    expect(B.boardRolleFuer([{ name: "bereich:fabrik" }], FAB)).toBe("factory");
  });
  test("das echte Label gilt mit der Fixture-Config nicht (kein eincodiertes Literal)", () => {
    expect(B.boardRolleFuer([ECHT.harness], FAB)).toBe("produkt");
    expect(B.boardRolleFuer([], FAB)).toBe("produkt");
  });
  test("ohne labels.harness wirft die Funktion statt still produkt zu liefern", () => {
    expect(() => B.boardRolleFuer([], OHNE_HARNESS)).toThrow(FIX);
  });
  test("ohne Config-Argument wirft sie mit Schlüssel und Fix-Zeile, ein Standardwert fehlt", () => {
    expect(() => B.boardRolleFuer([P.ladeProjektConfig().labels.harness])).toThrow(FIX);
  });
  test("Board-Funktionen mit Fixture-Config: Fixture-Label ist factory, das echte Label produkt", () => {
    const fab = (nr: number): It => ({ number: nr, labels: ["bereich:fabrik"], id: `I${nr}`, state: "open", status: "Todo", contentId: `C${nr}` });
    const echt = (nr: number): It => ({ number: nr, labels: [ECHT.harness], id: `E${nr}`, state: "open", status: "Todo", contentId: `D${nr}` });
    const s = B.seitenListen([fab(1), echt(2)], [echt(3), fab(4)], FAB);
    expect(s.factory.map((i) => i.number)).toEqual([4, 1]);
    expect(s.produkt.map((i) => i.number)).toEqual([2, 3]);
    expect(B.umzugsPlan([fab(1), echt(2)], [], FAB).schritte.map((x) => [x.number, x.nach])).toEqual([[1, "factory"]]);
    const issue = (n: number, labels: string[]) => ({ number: n, state: "open", node_id: `N${n}`, labels });
    const a = B.aufnahmePlan([1, 2], { 1: issue(1, ["bereich:fabrik"]), 2: issue(2, [ECHT.harness]) }, { config: FAB });
    expect(a.aufnehmen.map((x) => x.rolle)).toEqual(["factory", "produkt"]);
  });
  test("seitenListen, umzugsPlan und aufnahmePlan ohne Config werfen", () => {
    const i: It = { number: 1, labels: [], id: "I", state: "open" };
    expect(() => B.seitenListen([i], [], undefined)).toThrow(FIX);
    expect(() => B.umzugsPlan([i], [], undefined)).toThrow(FIX);
    expect(() => B.aufnahmePlan([1], { 1: { number: 1, state: "open", node_id: "N", labels: [] } })).toThrow(FIX);
  });
});

describe("fremdtext-lib: Fremdeingang-Label aus labels.forum", () => {
  const eigen = { login: FREMD_OWNER, type: "User" };
  test("das Fixture-Label macht Fremdeingang, das echte Forum-Label nicht", () => {
    expect(F.fremdeingangLabels(FAB)).toEqual(["f"]);
    expect(F.istFremdeingang({ user: eigen, labels: ["f"] }, FREMD_OWNER, { config: FAB })).toMatchObject({ fremdeingang: true, label: "f" });
    expect(F.istFremdeingang({ user: eigen, labels: [ECHT.forum] }, FREMD_OWNER, { config: FAB }).fremdeingang).toBe(false);
  });
  test("ohne labels.forum wirft die Prüfung (fail-closed)", () => {
    expect(() => F.fremdeingangLabels(OHNE_FORUM)).toThrow(FIX);
    expect(() => F.istFremdeingang({ user: eigen, labels: [] }, FREMD_OWNER, { config: OHNE_FORUM })).toThrow(/labels\.forum/);
  });
});

describe("check-festgefahren: Label aus labels.festgefahren", () => {
  test("stuckLabel liefert das Fixture-Label, ohne Schlüssel wirft es", () => {
    expect(FEST.stuckLabel(FAB)).toBe("zustand:fest");
    expect(() => FEST.stuckLabel(OHNE_FESTGEFAHREN)).toThrow(FIX);
    expect(() => FEST.stuckLabel()).toThrow(FIX);
  });
  test("der Kommentar nennt das übergebene Label, nicht das echte", () => {
    const text = FEST.buildStuckComment(4, "https://example.com/run", "zustand:fest");
    expect(text).toContain("zustand:fest");
    expect(text).not.toContain(ECHT.festgefahren);
  });
});

describe("wiedervorlage: Standard-Label", () => {
  test("ohne eigenes label gilt der Standard, ein eigenes gewinnt", () => {
    expect(W.labelFuer({}, "bereich:fabrik")).toBe("bereich:fabrik");
    expect(W.labelFuer({ label: "sonder" }, "bereich:fabrik")).toBe("sonder");
  });
});

describe("naechstes-ticket: Harness- und Forum-Label aus der Config", () => {
  test("echteIo ohne labels.harness oder labels.forum wirft mit Schlüssel und Fix-Zeile", () => {
    expect(() => N.echteIo({ config: OHNE_HARNESS })).toThrow(/labels\.harness[\s\S]*Fix:/);
    expect(() => N.echteIo({ config: OHNE_FORUM })).toThrow(/labels\.forum[\s\S]*Fix:/);
    expect(N.echteIo({ config: FAB }).config).toBe(FAB);
  });
  test("imBereich ordnet agentic nach dem Fixture-Label zu", () => {
    const item = { title: "T", labels: ["bereich:fabrik"] };
    expect(N.imBereich(item, "agentic", FAB)).toBe(true);
    expect(N.imBereich(item, "produkt", FAB)).toBe(false);
    expect(N.imBereich({ title: "T", labels: [ECHT.harness] }, "agentic", FAB)).toBe(false);
  });
  test("imBereich und waehleNaechstes ohne Config oder ohne labels.harness werfen (kein stiller Standardwert)", () => {
    const item = { title: "T", labels: [ECHT.harness] };
    for (const c of [undefined, OHNE_HARNESS]) {
      expect(() => N.imBereich(item, "agentic", c)).toThrow(/labels.harness/);
      expect(() => N.waehleNaechstes({ items: [], offene: new Set(), config: c })).toThrow(/labels.harness/);
    }
    expect(N.imBereich(item, null, undefined)).toBe(true); // ohne Bereich wird kein Label gebraucht
  });
  test("waehleNaechstes mit Fixture-Config: bereich:fabrik ist Factory, das Forum-Label f ein Fremdeingang", () => {
    const eigen = FREMD_OWNER;
    const mk = (number: number, labels: string[]) => ({ number, title: `T${number}`, status: "Todo", state: "open", labels, assignees: [], autor: { login: eigen, type: "User" }, body: "" });
    const r = N.waehleNaechstes({ items: [mk(1, ["f"]), mk(2, [ECHT.harness]), mk(3, ["bereich:fabrik"])], offene: new Set(), owner: eigen, bereich: "agentic", config: FAB, hartAb: 1_000_000 });
    expect(r.ticket?.nr).toBe(3);
    expect(N.waehleNaechstes({ items: [mk(1, ["f"])], offene: new Set(), owner: eigen, config: FAB }).uebersprungen[0]?.grund).toMatch(/Fremdeingang/);
  });
});

describe("board-takt: Harness-Label der Abfrage", () => {
  test("fuehreTaktAus fragt die geschlossenen Issues mit dem kodierten Fixture-Label ab", () => {
    const aufrufe: string[] = [];
    const io = {
      ghJson: (a: string[]) => {
        aufrufe.push(a.join(" "));
        return [[]];
      },
      loadItems: () => [],
      loadOpenIssuePages: () => [[]],
      positionLautAgentsMd: () => 4,
      fuehreStatusAus: () => ({ ok: true }),
      fuehreHarnessAus: () => true,
      log: () => undefined,
    };
    T.fuehreTaktAus({ jetzt: new Date("2026-10-08T12:00:00Z"), dry: true, config: FAB, io });
    const abfrage = aufrufe.find((a) => a.includes("state=closed")) ?? "";
    expect(abfrage).toContain("labels=bereich%3Afabrik&since=");
    // Der Label-Parameter selbst wird geprüft, nicht ein Teilstring der URL (der Repo-Name kann „harness“ enthalten).
    const query = abfrage.split("?")[1]?.split(/\s/)[0] ?? "";
    const labels = new URLSearchParams(query).getAll("labels");
    expect(labels).toEqual(["bereich:fabrik"]);
    expect(labels).not.toContain(ECHT.harness);
  });

  test("ohne Config oder ohne labels.harness wirft der Lauf, bevor gh aufgerufen wird", () => {
    const io = {
      ghJson: () => {
        throw new Error("kein gh-Aufruf erwartet");
      },
    };
    for (const config of [undefined, OHNE_HARNESS]) {
      expect(() => T.fuehreTaktAus({ jetzt: new Date("2026-10-08T12:00:00Z"), dry: true, config, io })).toThrow(/labels.harness/);
    }
  });
});

describe("check-festgefahren main: fehlendes Label ist rot (K2)", () => {
  test("ohne labels.festgefahren: Exit-Code 1, Meldung mit Schlüssel", () => {
    const fehler: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void fehler.push(a.join(" "));
    try {
      expect(FEST.main({ config: OHNE_FESTGEFAHREN })).toBe(1);
    } finally {
      console.error = orig;
    }
    expect(fehler.join("\n")).toContain("labels.festgefahren");
  });
});

describe("fremdtext-lib: Config ist Pflicht", () => {
  const issue = { user: { login: FREMD_OWNER }, labels: ["f"] };
  test("ohne Config oder ohne labels.forum wirft die Funktion (kein Rückfall auf die Platte)", () => {
    expect(() => F.istFremdeingang(issue, FREMD_OWNER)).toThrow(/labels.forum/);
    expect(() => F.istFremdeingang(issue, FREMD_OWNER, {})).toThrow(/labels.forum/);
    expect(() => F.istFremdeingang(issue, FREMD_OWNER, { config: OHNE_FORUM })).toThrow(/forum/);
  });
  test("mit Config liefert sie das Fixture-Label", () => {
    const r = F.istFremdeingang(issue, FREMD_OWNER, { config: FAB });
    expect(r.fremdeingang).toBe(true);
    expect(r.label).toBe("f");
  });
});

/* ---- Workflow-Wächter (K2): jeder Config-Aufruf in der Guard-Form, kein stiller Standardwert ---- */

/** Pur: Probleme eines Workflow-Texts mit Aufrufen von `node scripts/projekt-config.mjs`; leer = ok. */
function configAufrufProbleme(yml: string): string[] {
  const probleme: string[] = [];
  const aufruf = /node scripts\/projekt-config\.mjs [\w.]+/g;
  const guard = /if ! \w+=\$\(node scripts\/projekt-config\.mjs [\w.]+\); then\n\s*echo "::error::[^\n]*"\n\s*exit 1\n\s*fi/g;
  const anzahlAufrufe = yml.match(aufruf)?.length ?? 0;
  if (anzahlAufrufe === 0) return []; // ohne Config-Aufruf gibt es keinen Standardwert zu verbieten
  const anzahlGuards = yml.match(guard)?.length ?? 0;
  if (anzahlGuards !== anzahlAufrufe) probleme.push(`${anzahlAufrufe} Aufrufe, aber ${anzahlGuards} in der Guard-Form (if ! x=$(…); then echo "::error::…"; exit 1; fi)`);
  if (/projekt-config\.mjs[^\n]*\|\|/.test(yml)) probleme.push("`|| …`-Fallback hinter dem Config-Aufruf");
  if (/\$\{[^}\n]*:-[^}\n]+\}/.test(yml)) probleme.push("`${…:-…}`-Standardwert mit nicht-leerem Ersatz");
  if (/echo "[^"\n]*\$\(node scripts\/projekt-config\.mjs/.test(yml)) probleme.push("Substitution im echo verschluckt den Fehlschlag");
  return probleme;
}

const GUT = [
  "      - run: |",
  "          if ! wert=$(node scripts/projekt-config.mjs labels.x); then",
  '            echo "::error::labels.x fehlt (Fix: eintragen)"',
  "            exit 1",
  "          fi",
  '          echo "wert=$wert" >> "$GITHUB_OUTPUT"',
  "",
].join("\n");

describe("Workflow-Wächter: Config-Aufrufe", () => {
  test("die Guard-Form ist ok", () => {
    expect(configAufrufProbleme(GUT)).toEqual([]);
  });
  test("ein Workflow ohne Aufruf ist ok", () => {
    expect(configAufrufProbleme("run: echo hallo\n")).toEqual([]);
  });
  test.each([
    ["ohne exit 1", GUT.replace("            exit 1\n", "")],
    ["ohne ::error::", GUT.replace(/echo "::error::[^\n]*"/, "echo kaputt")],
    ["|| echo als Fallback", GUT.replace("labels.x); then", "labels.x || echo bereich:fabrik); then")],
    ["Standardwert ${…:-…}", `${GUT}          x="\${LABEL:-bereich:fabrik}"\n`],
    ["Aufruf im echo", '          echo "wert=$(node scripts/projekt-config.mjs labels.x)" >> "$GITHUB_OUTPUT"\n'],
    ["zweiter Aufruf ohne Guard", `${GUT}          y=$(node scripts/projekt-config.mjs labels.y)\n`],
  ])("meldet %s", (_n, yml) => {
    expect(configAufrufProbleme(yml).length).toBeGreaterThan(0);
  });
  test("alle Workflows des Repos erfüllen die Guard-Form", () => {
    for (const w of ALLE_WORKFLOWS) expect(configAufrufProbleme(lies(w)), w).toEqual([]);
  });
  test("dependabot-inbox: Label-Schritt vor dem Hauptschritt, Konsument über steps.label.outputs, kein continue-on-error", () => {
    const yml = lies(".github/workflows/dependabot-inbox.yml");
    expect(yml).toContain("node scripts/projekt-config.mjs labels.dependabotInbox");
    expect(yml.indexOf("id: label")).toBeGreaterThan(yml.indexOf("actions/checkout"));
    expect(yml.indexOf("id: label")).toBeLessThan(yml.indexOf("INBOX_LABEL:"));
    expect(yml).toContain("INBOX_LABEL: ${{ steps.label.outputs.wert }}");
    expect(yml).not.toMatch(/\$\{[^}\n]*:-[^}\n]+\}/);
    expect(yml).not.toContain("continue-on-error");
  });
});

/* ---- Literal-Scan (K1): kein Wert aus labels.* in den Einheiten ---- */

const SKRIPTE = [
  "board-lib", "board-takt", "board-place", "langfuse-takt", "sammelticket-anlegen", "wiedervorlage", "fremdtext-lib",
  "check-festgefahren", "naechstes-ticket", "spielquote-lib", "fremdtext", "spezifikation",
].map((n) => `scripts/${n}.mjs`);
const WORKFLOWS = ["festgefahren", "wiedervorlage", "dependabot-inbox", "board-takt", "internalrefs-pr-text"].map((n) => `.github/workflows/${n}.yml`);
const WORKFLOW_ORDNER = fileURLToPath(new URL("../../.github/workflows", import.meta.url));
const ALLE_WORKFLOWS = readdirSync(WORKFLOW_ORDNER).filter((n) => n.endsWith(".yml")).map((n) => `.github/workflows/${n}`);

/** Pur: Fundstellen der Label-Werte im Text. Werte mit `:` überall verboten, Werte ohne `:` nur in Anführungszeichen, Backticks oder nach `--label `. */
function labelLiterale(rohText: string, werte: string[]): string[] {
  const treffer: string[] = [];
  // Der Schlüsselname im Aufruf `labelAus(cfg, "forum")` und die Notfall-Art `art: "forum"` sind keine Label-Werte.
  const text = rohText.replace(/labelAus\([^)]*\)/g, "").replace(/art: "[\w-]+"/g, "");
  for (const w of werte) {
    const muster = w.includes(":") ? new RegExp(esc(w)) : new RegExp(`["'\`]${esc(w)}["'\`]|--label ${esc(w)}\\b`);
    if (muster.test(text)) treffer.push(w);
  }
  return treffer;
}

describe("Literal-Scan: keine Label-Werte in den Einheiten", () => {
  const werte = [...new Set(Object.values(ECHT))];
  test("der Scan erkennt Werte mit und ohne Doppelpunkt", () => {
    expect(labelLiterale(`const x = "${ECHT.harness}";`, werte)).toEqual([ECHT.harness]);
    expect(labelLiterale(`# das Label ${ECHT.festgefahren}`, werte)).toEqual([ECHT.festgefahren]);
    expect(labelLiterale(`const l = "${ECHT.forum}";`, werte)).toEqual([ECHT.forum]);
    expect(labelLiterale(`gh issue create --label ${ECHT.forum}`, werte)).toEqual([ECHT.forum]);
    expect(labelLiterale(`das ${ECHT.forum}-inbox.yml und labels.forum`, werte)).toEqual([]);
    expect(labelLiterale(`labelAus(cfg, "${ECHT.forum}")`, werte)).toEqual([]);
  });
  test.each([...SKRIPTE, ...WORKFLOWS])("%s enthält kein Label-Literal", (pfad) => {
    expect(labelLiterale(lies(pfad), werte)).toEqual([]);
  });
});
