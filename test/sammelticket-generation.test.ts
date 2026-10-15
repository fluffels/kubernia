/* Generationsgrenze für Sammeltickets (#1647, ADR 0025): Zeilen zählen, Grenze entscheiden, Nachfolger direkt hinter dem Vorgänger
 * anlegen. Alles pur bzw. mit injizierten Abrufen; die gh-Aufrufe laufen im Glue von scripts/sammelticket-anlegen.mjs.
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace über `unknown` auf ein lokales Interface. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sammelticket-anlegen.mjs";

type User = { login: string; type?: string } | null;
type Komm = { user: User; body: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Args = { art: string; vorgaenger: number | null; top: boolean; dry: boolean; generation: boolean };
type Roh = { state: string; assignees: unknown[] };
type Plan = { art: "nichts"; grund: string } | { art: "nachfolger"; vorgaenger: number; zeilen: number };
type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Schritt = { art: "ok" | "warte" | "setze" | "falsch"; k?: { nr: number; id: string; afterId: string | null } };
type G = {
  SAMMEL_ZEILEN_GRENZE: number;
  zaehleBefundZeilen: (k: Komm[], o: { vertraut: (u: User) => boolean; nurOffen?: boolean }) => number;
  entscheideGeneration: (a: { zeilen: number; grenze?: number }) => "nachfolger" | "nichts";
  kandidatenSammelticket: (offene: Offen[], titel: string, o?: { nach?: number | null }) => Offen[];
  dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[]; vorgaenger?: number | null }) => { art: string; aelter?: number };
  parseArgs: (argv: string[]) => Args | null;
  planeGeneration: (a: { offene: Offen[]; einzeln: (nr: number) => Roh; kommentareVon: (nr: number) => Komm[]; vertraut: (u: User) => boolean; grenze?: number }) => Plan;
  pruefSchritt: (a: { items: B[]; nr: number; position: number; neuGesetzt?: number; dry?: boolean; hinter?: number | null }) => Schritt;
  generationsKommentar: (a: { zeilen: number; nachfolger: number }) => string;
};
const G = raw as unknown as G;

const fluffels = { login: "fluffels", type: "User" };
const vertraut = (u: User) => u?.login === "fluffels";
const k = (body: string, user: User = fluffels): Komm => ({ user, body });

describe("zaehleBefundZeilen", () => {
  test("leer → 0; Kommentar ohne Checkbox → 0", () => {
    expect(G.zaehleBefundZeilen([], { vertraut })).toBe(0);
    expect(G.zaehleBefundZeilen([k("Nur Text, kein Befund")], { vertraut })).toBe(0);
  });

  test("zählt `- [ ]`, auch mehrere je Kommentar, `*` und eingerückt", () => {
    expect(G.zaehleBefundZeilen([k("- [ ] eins")], { vertraut })).toBe(1);
    expect(G.zaehleBefundZeilen([k("Kopf\n- [ ] a\n- [ ] b\n  - [ ] c\n* [ ] d")], { vertraut })).toBe(4);
    expect(G.zaehleBefundZeilen([k("- [ ] a"), k("- [ ] b\n- [ ] c")], { vertraut })).toBe(3);
  });

  test("`- [x]` zählt nur mit nurOffen: false", () => {
    const kk = [k("- [ ] a\n- [x] b\n- [X] c")];
    expect(G.zaehleBefundZeilen(kk, { vertraut })).toBe(1);
    expect(G.zaehleBefundZeilen(kk, { vertraut, nurOffen: true })).toBe(1);
    expect(G.zaehleBefundZeilen(kk, { vertraut, nurOffen: false })).toBe(3);
  });

  test("Kommentar eines nicht vertrauten Autors (auch ohne user) zählt nicht", () => {
    expect(G.zaehleBefundZeilen([k("- [ ] fremd", { login: "fremder" }), k("- [ ] anonym", null), k("- [ ] eigen")], { vertraut })).toBe(1);
  });

  test("keine Checkbox, wenn `[ ]` mitten im Satz steht", () => {
    expect(G.zaehleBefundZeilen([k("Text mit - [ ] mittendrin")], { vertraut })).toBe(0);
  });
});

describe("entscheideGeneration", () => {
  test("11 → nichts, 12 → nachfolger, 13 → nachfolger (Standardgrenze 12)", () => {
    expect(G.SAMMEL_ZEILEN_GRENZE).toBe(12);
    expect(G.entscheideGeneration({ zeilen: 11 })).toBe("nichts");
    expect(G.entscheideGeneration({ zeilen: 12 })).toBe("nachfolger");
    expect(G.entscheideGeneration({ zeilen: 13 })).toBe("nachfolger");
    expect(G.entscheideGeneration({ zeilen: 0 })).toBe("nichts");
  });

  test("eigene Grenze; ungültige Grenze (0, negativ, keine Ganzzahl) wirft", () => {
    expect(G.entscheideGeneration({ zeilen: 3, grenze: 3 })).toBe("nachfolger");
    expect(G.entscheideGeneration({ zeilen: 2, grenze: 3 })).toBe("nichts");
    for (const grenze of [0, -1, 1.5, Number.NaN]) expect(() => G.entscheideGeneration({ zeilen: 5, grenze }), String(grenze)).toThrow(/Grenze/);
  });
});

describe("Vorgänger-Ausschluss (--vorgaenger X, X ungeclaimt)", () => {
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, assignees: string[] = []): Offen => ({ number, titel: T, assignees, createdAt: "2026-10-01T00:00:00Z" });

  test("kandidatenSammelticket: nur strikt jüngere als der Vorgänger zählen (auch ältere volle Generationen nicht)", () => {
    expect(G.kandidatenSammelticket([o(5), o(9), o(12)], T, { nach: 9 }).map((i) => i.number)).toEqual([12]);
    expect(G.kandidatenSammelticket([o(5), o(9)], T, { nach: 9 }).map((i) => i.number)).toEqual([]);
    expect(G.kandidatenSammelticket([o(5), o(9)], T, { nach: null }).map((i) => i.number)).toEqual([9, 5]);
    expect(G.kandidatenSammelticket([o(5), o(9)], T).map((i) => i.number)).toEqual([9, 5]);
  });

  test("dublettenEntscheidung: der Vorgänger ist keine ältere Dublette", () => {
    expect(G.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("Generationskette: ein älteres volles Ticket W vor dem Vorgänger X ist keine Dublette des Nachfolgers", () => {
    expect(G.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15), o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("ein echtes älteres Duplikat (zwischen Vorgänger und Nachfolger) bleibt eine Dublette (Wettlauf #1560/#1561)", () => {
    expect(G.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18), o(19)], vorgaenger: 18 })).toEqual({ art: "eigenes-schliessen", aelter: 19 });
    expect(G.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15)] })).toEqual({ art: "eigenes-schliessen", aelter: 15 });
  });
});

describe("parseArgs --generation", () => {
  test("nur bei harness, mit --dry-run kombinierbar", () => {
    expect(G.parseArgs(["harness", "--generation"])).toEqual({ art: "harness", vorgaenger: null, top: false, dry: false, generation: true });
    expect(G.parseArgs(["--dry-run", "harness", "--generation"])).toMatchObject({ generation: true, dry: true });
    expect(G.parseArgs(["harness"])).toMatchObject({ generation: false });
  });

  test("falsche Benutzung → null: langfuse, mit --vorgaenger, doppelt", () => {
    for (const bad of [["langfuse", "--generation"], ["harness", "--generation", "--vorgaenger", "5"], ["harness", "--vorgaenger", "5", "--generation"], ["harness", "--generation", "--generation"], ["harness", "--generation", "x"]]) {
      expect(G.parseArgs(bad), bad.join(" ")).toBeNull();
    }
  });
});

describe("planeGeneration", () => {
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, assignees: string[] = [], titel = T): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const offenRoh = (): Roh => ({ state: "open", assignees: [] });
  const zeilen = (n: number): Komm[] => [k(Array.from({ length: n }, (_, i) => `- [ ] Zeile ${i}`).join("\n"))];
  const lauf = (offene: Offen[], n: number, einzeln: (nr: number) => Roh = offenRoh) => G.planeGeneration({ offene, einzeln, kommentareVon: () => zeilen(n), vertraut });

  test("12 offene Zeilen im jüngsten ungeclaimten → nachfolger (nennt Vorgänger und Zahl)", () => {
    expect(lauf([o(5), o(9)], 12)).toEqual({ art: "nachfolger", vorgaenger: 9, zeilen: 12 });
  });

  test("11 Zeilen → nichts", () => {
    expect(lauf([o(9)], 11).art).toBe("nichts");
  });

  test("erledigte Zeilen zählen nicht (nurOffen)", () => {
    const gemischt = [k(`${Array.from({ length: 11 }, () => "- [ ] a").join("\n")}\n- [x] b\n- [x] c`)];
    expect(G.planeGeneration({ offene: [o(9)], einzeln: offenRoh, kommentareVon: () => gemischt, vertraut }).art).toBe("nichts");
  });

  test("kein ungeclaimtes Sammelticket / nur geclaimtes / anderer Titel → nichts", () => {
    expect(lauf([], 20).art).toBe("nichts");
    expect(lauf([o(9, ["fluffels"])], 20).art).toBe("nichts");
    expect(lauf([o(9, [], "Langfuse-Befunde (gesammelt)")], 20).art).toBe("nichts");
  });

  test("der Einzelabruf entscheidet: laut Liste offen, laut Direktabruf geschlossen → nichts", () => {
    expect(lauf([o(9)], 20, () => ({ state: "closed", assignees: [] })).art).toBe("nichts");
  });

  test("der Nachfolger ist schon das jüngste und unter der Grenze → nichts (die volle Vorgängerin zählt nicht erneut)", () => {
    const abgefragt: number[] = [];
    const r = G.planeGeneration({
      offene: [o(5), o(9)],
      einzeln: offenRoh,
      kommentareVon: (nr) => {
        abgefragt.push(nr);
        return zeilen(nr === 9 ? 2 : 14);
      },
      vertraut,
    });
    expect(r.art).toBe("nichts");
    expect(abgefragt).toEqual([9]);
  });

  test("ein werfender Kommentar-Abruf wirft weiter (nichts wird angelegt)", () => {
    expect(() =>
      G.planeGeneration({
        offene: [o(9)],
        einzeln: offenRoh,
        kommentareVon: () => {
          throw new Error("gh kaputt");
        },
        vertraut,
      }),
    ).toThrow(/gh kaputt/);
  });

  test("nur fremde Zeilen (nicht vertraute Autoren) → nichts, auch bei 12 offenen Zeilen", () => {
    const fremd = [k(Array.from({ length: 12 }, () => "- [ ] x").join("\n"), { login: "fremder" })];
    expect(G.planeGeneration({ offene: [o(9)], einzeln: offenRoh, kommentareVon: () => fremd, vertraut }).art).toBe("nichts");
  });

  test("eine eigene Grenze wird durchgereicht", () => {
    expect(G.planeGeneration({ offene: [o(9)], einzeln: offenRoh, kommentareVon: () => zeilen(3), vertraut, grenze: 3 }).art).toBe("nachfolger");
    expect(G.planeGeneration({ offene: [o(9)], einzeln: offenRoh, kommentareVon: () => zeilen(3), vertraut, grenze: 4 }).art).toBe("nichts");
  });

  test("Kommentar an den Vorgänger nennt Zahl und Nachfolger", () => {
    expect(G.generationsKommentar({ zeilen: 12, nachfolger: 30 })).toBe("Generation voll (12 Zeilen), neue Zeilen in #30");
  });
});

describe("pruefSchritt mit Ziel „hinter X“", () => {
  const T = "Harness-Härtung (gesammelt)";
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: T, ...extra });

  test("direkt hinter X → ok, auch wenn der Rang über der Position liegt", () => {
    const items = [b(1), b(2), b(3), b(4), sammel(10), sammel(20), b(5)];
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10 }).art).toBe("ok");
    // ohne Ziel „hinter“ würde dieselbe Lage neu gesetzt (Rang 5 > 4, X steht an Position 5): der Test fasst genau den neuen Zweig
    expect(G.pruefSchritt({ items, nr: 20, position: 4 }).art).toBe("setze");
  });

  test("nicht direkt hinter X → setze direkt hinter X; Trockenlauf und Limit → falsch", () => {
    const items = [b(1), b(2), b(3), sammel(10), b(4), sammel(20)];
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10 })).toMatchObject({ art: "setze", k: { nr: 20, afterId: "I10" } });
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10, dry: true }).art).toBe("falsch");
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10, neuGesetzt: 2 }).art).toBe("falsch");
  });

  test("steht der Nachfolger VOR X → setze hinter X", () => {
    const items = [b(1), sammel(20), sammel(10)];
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10 })).toMatchObject({ art: "setze", k: { afterId: "I10" } });
  });

  test("X steht im Board, ist aber geclaimt oder geschlossen → keine „setze hinter X“, normale Positionsprüfung", () => {
    const geclaimt = [b(1), sammel(10, { assignees: ["fluffels"] }), b(2), sammel(20), b(3)];
    expect(G.pruefSchritt({ items: geclaimt, nr: 20, position: 4, hinter: 10 }).art).toBe("ok");
    const geschlossen = [b(1), sammel(10, { state: "closed" }), b(2), b(3), b(4), b(5), sammel(20)];
    expect(G.pruefSchritt({ items: geschlossen, nr: 20, position: 4, hinter: 10 })).toMatchObject({ art: "setze", k: { nr: 20 } });
    expect(G.pruefSchritt({ items: geschlossen, nr: 20, position: 4, hinter: 10 }).k?.afterId).not.toBe("I10");
  });

  test("X nicht (mehr) im Board → normale Positionsprüfung", () => {
    const items = [b(1), b(2), sammel(20)];
    expect(G.pruefSchritt({ items, nr: 20, position: 4, hinter: 10 }).art).toBe("ok");
  });
});

describe("Verdrahtung der Generationsgrenze (#1647)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const yml = lies(".github/workflows/board-takt.yml");

  test("der Board-Takt fährt `harness --generation` nach dem Takt-Skript, mit Board-Token; fehlt er, wird nur gewarnt", () => {
    expect(yml).toMatch(/node scripts\/board-takt\.mjs[\s\S]*node scripts\/sammelticket-anlegen\.mjs harness --generation/);
    expect(yml).toMatch(/GH_TOKEN: \$\{\{ secrets\.PROJECT_TOKEN \}\}/);
    // best effort: ein Fehler macht den Takt nicht rot (am Generations-Schritt selbst, nicht an irgendeinem)
    expect(yml).toMatch(/- name: Generationsgrenze des Harness-Sammeltickets\n\s+continue-on-error: true\n\s+env:/);
    expect(yml).toMatch(/if \[ -z "\$GH_TOKEN" \]; then\n\s+echo "::warning::PROJECT_TOKEN fehlt[^\n]*\n\s+exit 0/);
  });

  test("das Skript zählt Zeilen über die Vertrauensliste aus fremdtext-lib (keine eigene Liste) und paginiert die Kommentare", () => {
    const skript = lies("scripts/sammelticket-anlegen.mjs");
    expect(skript).toMatch(/import \{ istVertraut \} from "\.\/fremdtext-lib\.mjs"/);
    expect(skript).toMatch(/"--paginate", "--slurp", `repos\/\$\{REPO\}\/issues\/\$\{nr\}\/comments/);
    expect(skript).not.toMatch(/from "\.\/fremdtext\.mjs"/); // kein Skript importiert aus einem Einstiegsskript (#1398)
  });

  test("befehle.md nennt das Flag", () => {
    expect(lies("docs/referenz/befehle.md")).toMatch(/sammelticket-anlegen\.mjs harness \[--vorgaenger <nr> \\| --generation\]/);
  });
});
