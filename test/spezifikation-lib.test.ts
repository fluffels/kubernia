/* Spezifikations-Gate (#1615, ADR 0022 F12): pure Prüffunktion; jeder Mangel mit Negativfall. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/spezifikation-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw2 from "../scripts/projekt-config-lib.mjs";
import { echteSpezifikation } from "./support/echte-sprache";

type Art = { art: "ausgenommen" | "ok" | "bestand" | "hart"; fehlt?: string[] };
type Sprache = Record<string, unknown>;
const R = raw as unknown as {
  spezifikationsMaengel: (body: unknown, sprache?: unknown) => string[];
  istEpicTitel: (titel: unknown) => boolean;
  pruefeEingang: (i: { nummer: number; titel: string; body: unknown }, o?: { ausgenommen?: (i: unknown) => boolean; hartAb?: number; sprache?: unknown }) => Art;
  verloreneZeilen: (alt: unknown, neu: unknown) => string[];
  kriterien: (body: unknown, sprache?: unknown) => { k: string; text: string; nachMerge: boolean }[];
};

/** Die echte Sprach-Config des Projekts (deutsch): die Tests unten laufen gegen sie, die Englisch-Tests gegen `EN`. */
const SPRACHE = echteSpezifikation();
const S = {
  ...R,
  spezifikationsMaengel: (body: unknown) => R.spezifikationsMaengel(body, SPRACHE),
  pruefeEingang: (i: { nummer: number; titel: string; body: unknown }, o: { ausgenommen?: (i: unknown) => boolean; hartAb?: number } = {}) => R.pruefeEingang(i, { ...o, sprache: SPRACHE }),
  kriterien: (body: unknown) => R.kriterien(body, SPRACHE),
};

/** Eine gültige Projekt-Config ohne sprache (nur die Form zählt). */
const gueltigeConfig = (): Record<string, unknown> => {
  const b = (rolle: string, n: number) => ({ rolle, besitzer: "acme", besitzerTyp: "org", nummer: n, projectId: `p${n}`, statusFeldId: 5, statusFeldNodeId: "x", todoOptionId: "a" });
  return {
    version: 2,
    repo: "acme/demo",
    boards: [b("produkt", 7), b("factory", 8)],
    praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
    labels: { harness: "a", festgefahren: "b", forum: "c", dependabotInbox: "a" },
    agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" },
  };
};

const GUT = "## Ziel\nDas Gate prüft.\n\n## Akzeptanzkriterien\n1. Es prüft.\n2. Negativfall: ohne Format wird übersprungen.\n";

describe("spezifikationsMaengel", () => {
  test("vollständig: keine Mängel", () => {
    expect(S.spezifikationsMaengel(GUT)).toEqual([]);
  });
  test("leerer, null und undefined Body: Ziel und Akzeptanzkriterien fehlen", () => {
    for (const b of ["", null, undefined]) {
      expect(S.spezifikationsMaengel(b)).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
    }
  });
  test("Ziel fehlt", () => {
    expect(S.spezifikationsMaengel("## Akzeptanzkriterien\n- Negativfall: x\n")).toEqual(["`## Ziel` fehlt"]);
  });
  test("Ziel leer", () => {
    expect(S.spezifikationsMaengel("## Ziel\n\n## Akzeptanzkriterien\n- Negativfall: x\n")).toEqual(["`## Ziel` ist leer"]);
  });
  test("Akzeptanzkriterien ohne Listenpunkt", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\nNegativfall im Fließtext\n")).toEqual(["`## Akzeptanzkriterien` ohne Listenpunkt"]);
  });
  test("kein Negativfall in den Akzeptanzkriterien", () => {
    const m = S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- nur Happy Path\n");
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("kein Negativfall");
  });
  test("„Negativfall“ nur unter `## Ziel` ist ein Mangel", () => {
    const m = S.spezifikationsMaengel("## Ziel\nNegativfall hier\n## Akzeptanzkriterien\n- Happy\n");
    expect(m.some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
  test("Schreibweisen Negativ-Fall und Negativfälle zählen", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n* Negativ-Fall: a\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfälle: a\n")).toEqual([]);
  });
  test("zu breites Wort zählt nicht: „negativ“ ohne „Fall“ ist kein Negativfall", () => {
    const m = S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Negativer Saldo wird angezeigt\n- negative Zahl abgelehnt\n");
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("kein Negativfall");
  });
  test("`## Teil-Akzeptanzkriterien` (gebündelte Befund-Issues) gilt als Akzeptanzkriterien", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teil-Akzeptanzkriterien\n- Negativfall: x\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teil-Akzeptanzkriterien\n- Happy\n")).toHaveLength(1);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Teilakzeptanz\n- Negativfall: x\n")).toContain("`## Akzeptanzkriterien` fehlt");
  });
  test("`## Zielgruppe` und `### Ziel` sind kein `## Ziel`", () => {
    expect(S.spezifikationsMaengel("## Zielgruppe\nX\n## Akzeptanzkriterien\n- Negativfall\n")).toContain("`## Ziel` fehlt");
    expect(S.spezifikationsMaengel("### Ziel\nX\n## Akzeptanzkriterien\n- Negativfall\n")).toContain("`## Ziel` fehlt");
  });
  test("`###` gehört zum Abschnitt: Negativfall und Listenpunkt unter Unterüberschrift zählen", () => {
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n### Teil\n- Negativfall: a\n")).toEqual([]);
  });
  test("Überschrift im Code-Fence zählt nicht", () => {
    const body = "```\n## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfall\n```\n";
    expect(S.spezifikationsMaengel(body)).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
  });
  test("Negativfall im Code-Fence der Akzeptanzkriterien zählt nicht", () => {
    const body = "## Ziel\nZ\n## Akzeptanzkriterien\n- Happy\n```\n- Negativfall\n```\n";
    expect(S.spezifikationsMaengel(body).some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
  test("CRLF wird toleriert", () => {
    expect(S.spezifikationsMaengel(GUT.replace(/\n/g, "\r\n"))).toEqual([]);
  });
  test("der nächste `## `-Abschnitt beendet die Akzeptanzkriterien", () => {
    const body = "## Ziel\nZ\n## Akzeptanzkriterien\n- Happy\n## Hinweise\n- Negativfall\n";
    expect(S.spezifikationsMaengel(body).some((x) => x.includes("kein Negativfall"))).toBe(true);
  });
});

describe("istEpicTitel", () => {
  test("Epic und Phase, auch mit 📦", () => {
    expect(S.istEpicTitel("📦 Epic: Welt 2")).toBe(true);
    expect(S.istEpicTitel("Epic Foo")).toBe(true);
    expect(S.istEpicTitel("Phase 3: Bau")).toBe(true);
  });
  test("normale Titel nicht", () => {
    expect(S.istEpicTitel("Epische Reise")).toBe(false);
    expect(S.istEpicTitel("feat: Epic später")).toBe(false);
    expect(S.istEpicTitel(undefined)).toBe(false);
  });
});

describe("pruefeEingang", () => {
  const i = (nummer: number, body: unknown = "") => ({ nummer, titel: `T${nummer}`, body });
  test("vollständig: ok", () => {
    expect(S.pruefeEingang(i(5, GUT), { hartAb: 1 })).toEqual({ art: "ok" });
  });
  test("Grenze: nummer === hartAb ist hart, hartAb - 1 ist Bestand", () => {
    expect(S.pruefeEingang(i(10), { hartAb: 10 }).art).toBe("hart");
    expect(S.pruefeEingang(i(9), { hartAb: 10 }).art).toBe("bestand");
    expect(S.pruefeEingang(i(10), { hartAb: 10 }).fehlt).toContain("`## Ziel` fehlt");
  });
  test("Default hartAb 0: alles hart", () => {
    expect(S.pruefeEingang(i(1)).art).toBe("hart");
  });
  test("Ausnahme gewinnt auch bei unvollständigem Body", () => {
    expect(S.pruefeEingang(i(1), { ausgenommen: () => true, hartAb: 0 })).toEqual({ art: "ausgenommen" });
  });
});

describe("verloreneZeilen (Inhaltsverlust beim Reparieren)", () => {
  test("nichts verloren: leere Liste", () => {
    expect(S.verloreneZeilen("Text\nzweite Zeile", "## Ziel\nText\nzweite Zeile\n")).toEqual([]);
  });
  test("verlorene Zeile wird gemeldet", () => {
    expect(S.verloreneZeilen("Alpha\nBeta", "## Ziel\nAlpha\n")).toEqual(["Beta"]);
  });
  test("ergänzte Listenzeichen und Checkboxen sind kein Verlust", () => {
    expect(S.verloreneZeilen("Alpha\n[ ] Beta\n1. Gamma", "- Alpha\n- [x] Beta\n* Gamma")).toEqual([]);
  });
  test("Überschrift des Alten zählt nicht, eine umbenannte verliert nichts", () => {
    expect(S.verloreneZeilen("## Alt\nAlpha", "## Neu\nAlpha")).toEqual([]);
  });
  test("„Akzeptanzkriterien:“ wird zur Überschrift", () => {
    expect(S.verloreneZeilen("Akzeptanzkriterien:\n- Eins", "## Akzeptanzkriterien\n- Eins")).toEqual([]);
  });
  test("Überschrift des neuen Bodys zählt als Treffer für eine Textzeile", () => {
    expect(S.verloreneZeilen("Ziel", "## Ziel\nx")).toEqual([]);
  });
  test("Trennlinien auch mit Leerzeichen (- - -, * * *, ___) zählen nicht als Inhalt", () => {
    expect(S.verloreneZeilen("A\n- - -\n* * *\n___\n  -  -  - \nB", "A\nB")).toEqual([]);
  });
  test("ein einzelnes Listenzeichen ohne Text und echter Text mit Strichen sind Inhalt", () => {
    expect(S.verloreneZeilen("A\n- -x-", "A")).toEqual(["- -x-"]);
  });
  test("CRLF und LF sind gleich", () => {
    expect(S.verloreneZeilen("A\r\nB", "A\nB")).toEqual([]);
  });
  test("Code-Fence-Inhalt zählt", () => {
    expect(S.verloreneZeilen("```\nnode x\n```", "## Ziel\nnichts")).toEqual(["node x"]);
    expect(S.verloreneZeilen("~~~\nnode y\n~~~", "## Ziel\nnichts")).toEqual(["node y"]);
  });
  test("Überschrift Ebene 3 mit Inhalt geht nicht still verloren, Ebene 1-2 darf umbenannt werden", () => {
    expect(S.verloreneZeilen("### Wichtig: nie X löschen\nText", "## Ziel\nText")).toEqual(["### Wichtig: nie X löschen"]);
    expect(S.verloreneZeilen("# Titel\n## Alt\nText", "## Ziel\nText")).toEqual([]);
  });
  test("Trennlinien sind kein Inhalt", () => {
    expect(S.verloreneZeilen("---\n-\n***\nText", "## Ziel\nText")).toEqual([]);
  });
  test("null und undefined als alter Body: nichts verloren", () => {
    expect(S.verloreneZeilen(null, "x")).toEqual([]);
    expect(S.verloreneZeilen(undefined, "x")).toEqual([]);
  });
  test("leerer neuer Body verliert alles", () => {
    expect(S.verloreneZeilen("A", "")).toEqual(["A"]);
  });
});

describe("kriterien (#1753): K1…KN aus den Akzeptanzkriterien", () => {
  const K = S.kriterien;
  const ak = (liste: string) => `## Ziel\nZ\n\n## Akzeptanzkriterien\n${liste}`;
  test("nummerierte und Strich-Listen, Position statt Autorenziffer", () => {
    expect(K(ak("1. a\n3. b\n3. c\n"))).toEqual([
      { k: "K1", text: "a", nachMerge: false },
      { k: "K2", text: "b", nachMerge: false },
      { k: "K3", text: "c", nachMerge: false },
    ]);
    expect(K(ak("- x\n* y\n"))).toEqual([
      { k: "K1", text: "x", nachMerge: false },
      { k: "K2", text: "y", nachMerge: false },
    ]);
  });
  test("Unterpunkte, lazy und eingerückte Folgezeilen gehören zum Oberpunkt", () => {
    const r = K(ak("1. erst\n   - unter\n   weiter\n\n   nach Leerzeile\n2. zweit\n"));
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("erst\nunter\nweiter\nnach Leerzeile");
    expect(r[1]).toEqual({ k: "K2", text: "zweit", nachMerge: false });
  });
  test("Tab-Einzug zählt als Unterpunkt, Checkbox wird entfernt", () => {
    expect(K(ak("- [ ] a\n\t- b\n- [x] c\n")).map((e) => e.text)).toEqual(["a\nb", "c"]);
  });
  test("Prosa nach Leerzeile und ###-Zeile beenden den Punkt (zählen nicht zum Text)", () => {
    const r = K(ak("1. a\n\nProsa\n   eingerückt nach Prosa\n2. b\n### Unter\n   verwaist\n"));
    expect(r.map((e) => e.text)).toEqual(["a", "b"]);
  });
  test("Überschrift Teil-Akzeptanzkriterien und Liste im Code-Fence", () => {
    expect(K("## Teil-Akzeptanzkriterien\n- a\n")).toHaveLength(1);
    expect(K(ak("```\n- im Fence\n```\n- echt\n"))).toEqual([{ k: "K1", text: "echt", nachMerge: false }]);
  });
  test("Negativfall: fehlender Abschnitt, Abschnitt ohne Liste, null und leer ergeben eine leere Liste", () => {
    for (const b of [null, undefined, "", "## Ziel\nZ\n", ak("nur Prosa\n"), ak("```\n- fence\n```\n")]) expect(K(b), String(b)).toEqual([]);
  });
  test("leer genau dann, wenn das Gate „fehlt“ oder „ohne Listenpunkt“ meldet", () => {
    for (const b of ["", ak("Prosa\n"), ak("- a\n"), GUT]) {
      const leer = K(b).length === 0;
      const mangel = S.spezifikationsMaengel(b).some((m) => /fehlt$|ohne Listenpunkt/.test(m) && m.includes("Akzeptanz"));
      expect(leer, String(b)).toBe(mangel);
    }
  });
});

describe("kriterien: Einzug und Fortsetzung (Lens-Runde 1)", () => {
  const K = (S as unknown as { kriterien: (b: unknown) => { k: string; text: string; nachMerge: boolean }[] }).kriterien;
  test("eingerückte Oberebene zählt, das Gate und kriterien stimmen überein (kein stilles „entfällt“)", () => {
    const b = "## Ziel\nZ\n\n## Akzeptanzkriterien\n  - a\n  - b\n";
    expect(S.spezifikationsMaengel(b).some((m) => /ohne Listenpunkt/.test(m))).toBe(false);
    expect(K(b).map((e) => e.text)).toEqual(["a", "b"]);
  });
  test("nicht eingerückte Folgezeile direkt nach dem Punkt gehört dazu", () => {
    expect(K("## Akzeptanzkriterien\n1. a\nFortsetzung\n2. b\n").map((e) => e.text)).toEqual(["a\nFortsetzung", "b"]);
  });
});

describe("Allquantor-Kriterien auf Heuristik-Wächter (#1808)", () => {
  const mit = (k: string) => `## Ziel\nZ\n\n## Akzeptanzkriterien\n1. ${k}\n2. Negativfall: x.\n`;
  test("„jede … die … liest“ ohne Begrenzung ist ein Mangel mit K-Nummer", () => {
    const m = S.spezifikationsMaengel(mit("Der Wächter findet jede Voraussetzung, die ein Skript liest."));
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("K1");
    expect(m[0]).toContain("bekannte Muster");
  });
  test("„alle … die … verwendet“, Folgezeile und „gelesen werden“ zählen", () => {
    expect(S.spezifikationsMaengel(mit("Er erkennt alle Variablen,\n   die ein Workflow verwendet."))).toHaveLength(1);
    expect(S.spezifikationsMaengel(mit("Er meldet alle Dateien, die gelesen werden."))).toHaveLength(1);
  });
  test("Begrenzung „bekannte Muster:“ im Kriterium: kein Mangel", () => {
    expect(S.spezifikationsMaengel(mit("Er findet jede Voraussetzung, die ein Skript liest (bekannte Muster: A, B; Grenze im Kopfkommentar)."))).toEqual([]);
  });
  test("ohne Relativsatz und ohne echten Allquantor (Wortgrenze): kein Mangel", () => {
    expect(S.spezifikationsMaengel(mit("Jede Datei wird vom Skript gelesen."))).toEqual([]);
    // linke Wortgrenze von „alle“ und Grenzen um die Artikelwörter („oder“, „wieder“ enthalten „der“)
    expect(S.spezifikationsMaengel(mit("Er prüft Intervalle, die das Skript liest."))).toEqual([]);
    expect(S.spezifikationsMaengel(mit("Jede Datei wird vom Skript oder Hook gelesen."))).toEqual([]);
    expect(S.spezifikationsMaengel(mit("Jede Datei wird wieder gelesen."))).toEqual([]);
    // rechte Grenze der Artikelwörter und beide Grenzen um das Lesewort
    expect(S.spezifikationsMaengel(mit("Jede Datei wird derzeit gelesen."))).toEqual([]);
    expect(S.spezifikationsMaengel(mit("Jede Nachricht, die ungelesen bleibt, wird markiert."))).toEqual([]);
    expect(S.spezifikationsMaengel(mit("Alle Texte, die lesenswert sind, stehen oben."))).toEqual([]);
    expect(S.spezifikationsMaengel(mit("Allerdings meldet der Wächter die Datei, die er liest."))).toEqual([]);
  });
  test("Kriterium ohne Allquantor: kein Mangel", () => {
    expect(S.spezifikationsMaengel(mit("Der Wächter findet die Voraussetzung, die das Skript liest."))).toEqual([]);
  });
  test("Allquantor ohne „liest“-Kontext: kein Mangel", () => {
    expect(S.spezifikationsMaengel(mit("Alle Tests, die laufen, sind grün."))).toEqual([]);
  });
  test("Allquantor und Lesewort in getrennten Sätzen: kein Mangel", () => {
    expect(S.spezifikationsMaengel(mit("Jede Datei, die geprüft wird. Das Skript liest sie."))).toEqual([]);
  });
});

describe("Sprache als Projektwert (#1711)", () => {
  const EN: Sprache = {
    ziel: "Goal",
    akzeptanzkriterien: ["Acceptance criteria", "Partial acceptance criteria"],
    nachMerge: "After merge:",
    negativfall: { wort: "Negative case", muster: "negative case" },
    begrenzung: { wort: "known patterns:", muster: "known patterns:" },
    allquantor: { wort: "every/all … that … reads", muster: "(?:every|all) [^.!?]*that [^.!?]*(?:reads|read)" },
  };
  const BODY_EN = "## Goal\nThe gate checks.\n\n## Acceptance criteria\n1. It checks.\n2. Negative case: without format it is skipped.\n";

  test("englischer Body ist mit englischem Vokabular vollständig, der deutsche meldet den englischen Abschnitt als fehlend", () => {
    expect(R.spezifikationsMaengel(BODY_EN, EN)).toEqual([]);
    expect(R.spezifikationsMaengel(GUT, EN)).toEqual(["`## Goal` fehlt", "`## Acceptance criteria` fehlt"]);
    expect(R.spezifikationsMaengel(BODY_EN, SPRACHE)).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
  });
  test("Meldungen setzen die Wörter der Sprache ein, der Rahmentext bleibt deutsch", () => {
    expect(R.spezifikationsMaengel("## Goal\nG\n## Acceptance criteria\n- happy only\n", EN)).toEqual([
      "kein Negative case in den Acceptance criteria (ein Kriterium mit dem Wort „Negative case“)",
    ]);
    expect(R.spezifikationsMaengel("## Goal\nG\n## Acceptance criteria\n- After merge: a\n- After merge: Negative case b\n", EN)).toEqual([
      "alle Acceptance criteria beginnen mit „After merge:“: die Abnahme hätte nichts zu prüfen (mindestens ein Kriterium muss vor dem Merge prüfbar sein)",
    ]);
    const m = R.spezifikationsMaengel("## Goal\nG\n## Acceptance criteria\n- Negative case: all files that the script reads\n", EN);
    expect(m).toEqual(["K1: Allquantor („every/all … that … reads“) auf einen Heuristik-Wächter ist unbegrenzt: die Begrenzung als geschlossene Liste nennen („known patterns: …“)"]);
    expect(R.spezifikationsMaengel("## Goal\nG\n## Acceptance criteria\n- Negative case: all files that the script reads (known patterns: a)\n", EN)).toEqual([]);
  });
  test("Alternativ-Überschrift und Nach-Merge-Präfix kommen aus der Sprache", () => {
    expect(R.spezifikationsMaengel("## Goal\nG\n## Partial acceptance criteria\n- Negative case\n", EN)).toEqual([]);
    const k = R.kriterien("## Goal\nG\n## Acceptance criteria\n- After merge: a\n- Nach dem Merge: b\n", EN);
    expect(k.map((c) => c.nachMerge)).toEqual([true, false]);
  });
  test("Überschrift Ebene 1 im Body ist kein Fehler und beendet den Abschnitt; Groß-/Kleinschreibung und Leerraum am Ende sind egal", () => {
    expect(S.spezifikationsMaengel("# Titel\n## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfall\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n# Anhang\n## Akzeptanzkriterien\n- Negativfall\n# Anhang\n- Happy\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## ziel\nZ\n## AKZEPTANZKRITERIEN\n- Negativfall\n")).toEqual([]);
    expect(S.spezifikationsMaengel("## Ziel   \nZ\n## Akzeptanzkriterien \t\n- Negativfall\n")).toEqual([]);
    expect(S.kriterien("## Akzeptanzkriterien\n- a\n# Anhang\n- b\n").map((c) => c.text)).toEqual(["a"]);
  });
  test("Regex-Sonderzeichen in den Abschnittsnamen sind Text, keine Regex", () => {
    const sonder = { ...EN, ziel: "Goal (v2)+", akzeptanzkriterien: ["AC.*"] };
    expect(R.spezifikationsMaengel("## Goal (v2)+\nG\n## AC.*\n- Negative case\n", sonder)).toEqual([]);
    expect(R.spezifikationsMaengel("## Goal (v2)\nG\n## ACDC\n- Negative case\n", sonder)).toEqual(["`## Goal (v2)+` fehlt", "`## AC.*` fehlt"]);
  });
  test("Golden: mit der echten Config sind alle Mängeltexte wortgleich zu den früheren Konstanten", () => {
    expect(S.spezifikationsMaengel("")).toEqual(["`## Ziel` fehlt", "`## Akzeptanzkriterien` fehlt"]);
    expect(S.spezifikationsMaengel("## Ziel\n\n## Akzeptanzkriterien\nProsa\n")).toEqual(["`## Ziel` ist leer", "`## Akzeptanzkriterien` ohne Listenpunkt", "kein Negativfall in den Akzeptanzkriterien (ein Kriterium mit dem Wort „Negativfall“)"]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Nach dem Merge: Negativfall\n")).toEqual([
      "alle Akzeptanzkriterien beginnen mit „Nach dem Merge:“: die Abnahme hätte nichts zu prüfen (mindestens ein Kriterium muss vor dem Merge prüfbar sein)",
    ]);
    expect(S.spezifikationsMaengel("## Ziel\nZ\n## Akzeptanzkriterien\n- Negativfall: jede Datei, die das Skript liest\n")).toEqual([
      "K1: Allquantor („jede/alle … die … liest“) auf einen Heuristik-Wächter ist unbegrenzt: die Begrenzung als geschlossene Liste nennen („bekannte Muster: …“)",
    ]);
  });
  test("ohne sprache wirft jeder Einstieg mit Fix-Zeile, kein stiller Deutsch-Standardwert", () => {
    for (const leer of [undefined, null, {}, { ziel: "Ziel" }]) {
      expect(() => R.spezifikationsMaengel(GUT, leer)).toThrow(/sprache[\s\S]*Fix:/);
      expect(() => R.kriterien(GUT, leer)).toThrow(/sprache[\s\S]*Fix:/);
      expect(() => R.pruefeEingang({ nummer: 1, titel: "T", body: GUT }, { sprache: leer })).toThrow(/sprache[\s\S]*Fix:/);
    }
    expect(() => R.pruefeEingang({ nummer: 1, titel: "T", body: GUT }, { ausgenommen: () => true })).toThrow(/sprache/);
  });
  test("ein Muster ohne Wort oder eine leere Kriterienliste ist unvollständig", () => {
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, negativfall: { muster: "x" } })).toThrow(/negativfall/);
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, akzeptanzkriterien: [] })).toThrow(/akzeptanzkriterien/);
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, akzeptanzkriterien: ["Akzeptanzkriterien", " "] })).toThrow(/akzeptanzkriterien/);
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, nachMerge: "" })).toThrow(/nachMerge/);
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, akzeptanzkriterien: "Akzeptanzkriterien" })).toThrow(/akzeptanzkriterien/);
    // ein fehlendes Muster darf nicht zu einer Regex werden, die alles trifft (stiller Standardwert)
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, negativfall: { wort: "x" } })).toThrow(/negativfall/);
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, begrenzung: { wort: "x", muster: " " } })).toThrow(/begrenzung/);
    for (const k of ["negativfall", "begrenzung", "allquantor"]) {
      expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, [k]: undefined }), k).toThrow(new RegExp(k));
    }
    expect(() => R.spezifikationsMaengel(GUT, { ...SPRACHE, ziel: undefined })).toThrow(/ziel/);
  });
});

describe("spracheMaengel: eine Prüfung für Gate und Projekt-Config (#1843)", () => {
  const P = raw as unknown as { spracheMaengel: (sp: unknown) => string[] };
  const cfg = raw2 as unknown as { pruefeProjektConfig: (w: unknown) => string[] };
  const mitSprache = (sp: unknown): string[] => cfg.pruefeProjektConfig({ ...gueltigeConfig(), sprache: { umschrift: ["fuer"], spezifikation: sp } });

  test("die echte Sprach-Config hat keine Mängel", () => {
    expect(P.spracheMaengel(SPRACHE)).toEqual([]);
  });
  test("Meldungen stehen auf den Schlüsselpfaden sprache.spezifikation.<k>", () => {
    expect(P.spracheMaengel({ ...SPRACHE, ziel: " ", nachMerge: 3 })).toEqual([
      "sprache.spezifikation.ziel muss ein nicht-leerer String sein",
      "sprache.spezifikation.nachMerge muss ein nicht-leerer String sein",
    ]);
    expect(P.spracheMaengel({ ...SPRACHE, akzeptanzkriterien: [] })).toEqual(["sprache.spezifikation.akzeptanzkriterien muss eine nicht-leere Liste nicht-leerer Strings sein"]);
    expect(P.spracheMaengel({ ...SPRACHE, begrenzung: { wort: "x", muster: "(" } })).toEqual(["sprache.spezifikation.begrenzung.muster ist keine gültige Regex"]);
    expect(P.spracheMaengel({ ...SPRACHE, allquantor: undefined })).toEqual(["sprache.spezifikation.allquantor muss ein Objekt mit nicht-leerem wort und muster sein"]);
  });
  test("kein Objekt (null, Liste, Text): ein Mangel", () => {
    for (const falsch of [undefined, null, [], "x", 3]) expect(P.spracheMaengel(falsch)).toEqual(["sprache.spezifikation muss ein Objekt sein"]);
  });
  test("dieselbe ungültige Eingabe ergibt über Gate und Projekt-Config dieselben Meldungen", () => {
    const eingaben: unknown[] = [
      { ...SPRACHE, ziel: "" },
      { ...SPRACHE, nachMerge: undefined, akzeptanzkriterien: [" "] },
      { ...SPRACHE, negativfall: { wort: "x" }, allquantor: { wort: "y", muster: "(" } },
      {},
      null,
    ];
    for (const e of eingaben) {
      const maengel = P.spracheMaengel(e);
      expect(maengel.length, JSON.stringify(e)).toBeGreaterThan(0);
      expect(mitSprache(e).filter((m) => m.startsWith("sprache.spezifikation")), JSON.stringify(e)).toEqual(maengel);
      expect(() => R.spezifikationsMaengel(GUT, e), JSON.stringify(e)).toThrow(maengel.join("; "));
    }
  });
});
