/* Harness-Doctor, Wochenlauf (#1800): jede Lücke wird eine Zeile im Harness-Sammelticket, bekannte Punkte nicht noch einmal.
 * Alle IO-Teile sind Fakes (kein Netz); `lauf` ist die öffentliche Einstiegsfunktion, `ermittleLuecken` die Token-Weiche in Actions. */
import { describe, test, vi } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMelden from "../scripts/harness-doctor-melden.mjs";

interface Luecke { punkt: string; befund: string; fix: string }
interface Kommentar { user: { login: string; type: string } | null; body: string }
interface Io {
  ermittle: () => Luecke[];
  kontext: () => { kommentare: Kommentar[]; owner: string; ziel: number | null };
  postZeilen: (nr: number, text: string) => void;
  heute: string;
  log: (s: string) => void;
}
interface Melden {
  lauf(a: { io: Io; trocken?: boolean }): number;
  ermittleLuecken(a: { env: Record<string, string>; repo: string; pruefe: () => { ok: boolean; punkt: string; befund?: string; fix?: string }[] }): Luecke[];
  istBekannt(punkt: string, kommentare: Kommentar[], owner: string): boolean;
  main(argv: string[], deps: { ladeConfig: () => unknown; ladeLibs: () => Promise<unknown>; log: (s: string) => void; err: (s: string) => void; pruefLauf?: (a: Record<string, unknown>) => { ergebnis: unknown[] } }): Promise<number>;
}
const melden = rawMelden as unknown as Melden;

const OWNER = "acme";
const ICH = { login: "acme", type: "User" };
const L1: Luecke = { punkt: "Secret PROJECT_TOKEN", befund: "PROJECT_TOKEN fehlt (ein Workflow liest es)", fix: "gh secret set PROJECT_TOKEN --repo acme/demo" };
const L2: Luecke = { punkt: "Label forum", befund: 'Label "forum" fehlt', fix: 'gh label create "forum" --repo acme/demo' };
const zeile = (l: Luecke, kopf = "- [ ]"): string => `${kopf} 2026-10-01 Harness-Doctor (Wochenlauf): LÜCKE ${l.punkt}: ${l.befund} Fix: ${l.fix}`;

interface Welt { luecken?: Luecke[]; kommentare?: Kommentar[]; ziel?: number | null; postWirft?: boolean; ermittleWirft?: boolean; kontextWirft?: boolean }
function fahre(w: Welt, trocken = false): { code: number; log: string[]; posts: { nr: number; text: string }[] } {
  const log: string[] = [];
  const posts: { nr: number; text: string }[] = [];
  const io: Io = {
    ermittle: () => {
      if (w.ermittleWirft) throw new Error("Projekt-Config fehlt");
      return w.luecken ?? [];
    },
    kontext: () => {
      if (w.kontextWirft) throw new Error("HTTP 502");
      return { kommentare: w.kommentare ?? [], owner: OWNER, ziel: w.ziel === undefined ? 1814 : w.ziel };
    },
    postZeilen: (nr, text) => {
      if (w.postWirft) throw new Error("HTTP 403");
      posts.push({ nr, text });
    },
    heute: "2026-10-21",
    log: (s) => log.push(s),
  };
  return { code: melden.lauf({ io, trocken }), log, posts };
}

describe("harness-doctor-melden: lauf", () => {
  test("keine Lücke: kein Post, Exit 0, der Langfuse-Hinweis steht im Log", () => {
    const r = fahre({});
    assert.equal(r.code, 0);
    assert.deepEqual(r.posts, []);
    assert.ok(r.log.includes("Harness-Doctor (Wochenlauf): nichts Neues"));
    assert.ok(r.log.some((z) => z.startsWith("HINWEIS Langfuse: im Wochenlauf nicht geprüft")));
  });

  test("neue Lücken: genau ein Kommentar im Zeilenformat mit Datum und Fix, an das ungeclaimte Sammelticket", () => {
    const r = fahre({ luecken: [L1, L2] });
    assert.equal(r.code, 0);
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].nr, 1814);
    assert.deepEqual(r.posts[0].text.split("\n"), [zeile(L1).replace("2026-10-01", "2026-10-21"), zeile(L2).replace("2026-10-01", "2026-10-21")]);
  });

  test("ein mehrzeiliger Befund wird einzeilig (eine Zeile pro Lücke)", () => {
    const r = fahre({ luecken: [{ ...L1, befund: "erste\nzweite" }] });
    assert.equal(r.posts[0].text.split("\n").length, 1);
    assert.match(r.posts[0].text, /LÜCKE Secret PROJECT_TOKEN: erste zweite Fix:/);
  });

  test("offene Zeile eines vertrauten Autors: still; abgehakte Zeile, fremder Autor und anderer Punkt: wird gemeldet", () => {
    const still = fahre({ luecken: [L1], kommentare: [{ user: ICH, body: `Notiz\n${zeile(L1)}` }] });
    assert.deepEqual(still.posts, []);
    assert.ok(still.log.some((z) => z.includes("nichts Neues")));
    const erledigt = fahre({ luecken: [L1], kommentare: [{ user: ICH, body: zeile(L1, "- [x]") }] });
    assert.equal(erledigt.posts.length, 1);
    const fremd = fahre({ luecken: [L1], kommentare: [{ user: { login: "fremd", type: "User" }, body: zeile(L1) }] });
    assert.equal(fremd.posts.length, 1);
    const ohneAutor = fahre({ luecken: [L1], kommentare: [{ user: null, body: zeile(L1) }] });
    assert.equal(ohneAutor.posts.length, 1);
    const anderer = fahre({ luecken: [L1, L2], kommentare: [{ user: ICH, body: zeile(L1) }] });
    assert.equal(anderer.posts[0].text.split("\n").length, 1);
    assert.match(anderer.posts[0].text, /LÜCKE Label forum:/);
  });

  test("der Schlüssel ist der Punkt, nicht der Befund; ein Punkt mit gleichem Präfix zählt nicht als bekannt", () => {
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: zeile({ ...L1, befund: "ganz anderer Text" }) }], OWNER), true);
    assert.equal(melden.istBekannt("Secret PROJECT", [{ user: ICH, body: zeile(L1) }], OWNER), false);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: { login: "github-actions[bot]", type: "Bot" }, body: zeile(L1) }], OWNER), true);
  });

  test("offene Zeile mit *-Spiegelstrich, eingerückt oder mit Windows-Zeilenenden zählt als bekannt", () => {
    const z = zeile(L1);
    for (const body of [z.replace("- [ ]", "* [ ]"), `  ${z}`, `Notiz\r\n${z}\r\nEnde`]) {
      assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body }], OWNER), true, body);
    }
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: z.replace("- [ ]", "[ ]") }], OWNER), false);
    // linke Grenze: eine zitierte oder durch eine abgehakte Zeile erwähnte offene Zeile ist keine offene Zeile
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: `> ${z}` }], OWNER), false);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: `- [x] ersetzt ${z}` }], OWNER), false);
  });

  test("ohne ungeclaimtes Sammelticket: alles schon gemeldet bleibt grün (nichts zu posten), eine neue Lücke ist ::error::", () => {
    const still = fahre({ luecken: [L1], ziel: null, kommentare: [{ user: ICH, body: zeile(L1) }] });
    assert.equal(still.code, 0);
    assert.deepEqual(still.posts, []);
    assert.equal(fahre({ luecken: [L1], ziel: null }).code, 1);
  });

  test("zwei Lücken desselben Punkts: beide in Lauf 1, danach in Lauf 2 keine", () => {
    const a: Luecke = { punkt: "Board produkt", befund: "projectId falsch", fix: "prüfen" };
    const b: Luecke = { punkt: "Board produkt", befund: "nummer falsch", fix: "prüfen" };
    const eins = fahre({ luecken: [a, b] });
    assert.equal(eins.posts[0].text.split("\n").length, 2);
    const zwei = fahre({ luecken: [a, b], kommentare: [{ user: ICH, body: eins.posts[0].text }] });
    assert.deepEqual(zwei.posts, []);
  });

  test("Dry-Run: Zeilen im Log, kein Post, Exit 0", () => {
    const r = fahre({ luecken: [L1] }, true);
    assert.equal(r.code, 0);
    assert.deepEqual(r.posts, []);
    assert.ok(r.log.some((z) => z.startsWith("[dry-run] - [ ] 2026-10-21 Harness-Doctor (Wochenlauf): LÜCKE Secret PROJECT_TOKEN:")));
  });

  test("Fehlerfälle sind ::error:: mit Fix und Exit 1: kein Sammelticket, Post wirft, Sammelticket nicht lesbar, Doctor nicht lauffähig", () => {
    const faelle: [Welt, RegExp][] = [
      [{ luecken: [L1], ziel: null }, /::error::.*kein ungeclaimtes Harness-Sammelticket.*Fix: node scripts\/sammelticket-anlegen\.mjs harness/],
      [{ luecken: [L1], postWirft: true }, /::error::.*nicht gepostet.*HTTP 403.*Fix:/],
      [{ luecken: [L1], kontextWirft: true }, /::error::.*Sammelticket nicht lesbar.*HTTP 502.*Fix:/],
      [{ ermittleWirft: true }, /::error::.*Doctor nicht lauffähig.*Projekt-Config fehlt.*Fix:/],
    ];
    for (const [welt, muster] of faelle) {
      const r = fahre(welt);
      assert.equal(r.code, 1, JSON.stringify(welt));
      assert.ok(r.log.some((z) => muster.test(z)), `${JSON.stringify(welt)}: ${r.log.join(" | ")}`);
      assert.deepEqual(r.posts, []);
    }
  });
});

describe("harness-doctor-melden: ermittleLuecken", () => {
  const ergebnis = [{ ok: true, punkt: "Labels" }, { ok: false, punkt: "Ruleset", befund: "fehlt", fix: "anlegen" }];
  test("in Actions ohne PROJECT_TOKEN: genau die Secret-Lücke, der Doctor wird nie gefragt", () => {
    const l = melden.ermittleLuecken({ env: { GITHUB_ACTIONS: "true" }, repo: "acme/demo", pruefe: () => assert.fail("kein Prüfaufruf ohne Token") });
    assert.deepEqual(l, [{ punkt: "Secret PROJECT_TOKEN", befund: "im Wochenlauf leer, der Doctor kann nicht prüfen", fix: "gh secret set PROJECT_TOKEN --repo acme/demo" }]);
  });
  test("mit Token oder außerhalb von Actions: nur die Lücken des Doctors", () => {
    const umgebungen: Record<string, string>[] = [{ GITHUB_ACTIONS: "true", PROJECT_TOKEN: "x" }, {}];
    for (const env of umgebungen) {
      assert.deepEqual(melden.ermittleLuecken({ env, repo: "acme/demo", pruefe: () => ergebnis }).map((l) => l.punkt), ["Ruleset"]);
    }
  });
});

describe("harness-doctor-melden: main (W15 Vorprüfung vor dem dynamischen Import)", () => {
  test("kaputte Config → ::error:: mit Exit 2, die Board-Libs werden nie importiert", async () => {
    const log: string[] = [];
    let importiert = false;
    const code = await melden.main([], {
      ladeConfig: () => { throw new Error("Projekt-Config fehlt: x\nFix: anlegen"); },
      ladeLibs: () => { importiert = true; return Promise.resolve({}); },
      log: (s) => log.push(s),
      err: () => undefined,
    });
    assert.equal(code, 2);
    assert.equal(importiert, false);
    assert.match(log.join("\n"), /^::error::Harness-Doctor \(Wochenlauf\): Projekt-Config nicht lesbar: Projekt-Config fehlt: x\nFix: anlegen$/);
  });
  test("ein Import-Fehler der Libs (z. B. Config beim Import) → ebenfalls ::error:: Exit 2", async () => {
    const log: string[] = [];
    const code = await melden.main([], { ladeConfig: () => ({}), ladeLibs: () => Promise.reject(new Error("Import kaputt")), log: (s) => log.push(s), err: () => undefined });
    assert.equal(code, 2);
    assert.match(log[0], /^::error::.*Import kaputt/);
  });
  test("Gutfall (#1821 L23d): Config lesbar, injizierte Libs, Lücke aus dem leeren Token → Zeile geht an das Sammelticket", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("PROJECT_TOKEN", "");
    try {
      const gepostet: [number, string][] = [];
      const log: string[] = [];
      const libs = {
        REPO: "acme/proj",
        OWNER: "acme",
        ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [] }),
        waehleSammelticket: (offene: { number: number }[]) => offene[0],
        postZeilen: (nr: number, text: string) => gepostet.push([nr, text]),
      };
      const deps = { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: (s: string) => log.push(s), err: () => undefined };
      assert.equal(await melden.main(["--dry-run"], deps), 0);
      assert.deepEqual(gepostet, [], "Trockenlauf schreibt nichts");
      assert.match(log.join("\n"), /\[dry-run\] - \[ \] .*LÜCKE Secret PROJECT_TOKEN/);
      assert.equal(await melden.main([], deps), 0);
      assert.equal(gepostet.length, 1);
      assert.equal(gepostet[0][0], 55);
      assert.match(gepostet[0][1], /LÜCKE Secret PROJECT_TOKEN.*gh secret set PROJECT_TOKEN --repo acme\/proj/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  test("Wochenlauf ruft den Doctor-Lauf mit rootDir und gh, langfuse null und ohne umgebung", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "");
    try {
      const aufrufe: Record<string, unknown>[] = [];
      const libs = { REPO: "acme/proj", OWNER: "acme", ladeSammelKontext: () => ({ offene: [], kommentare: [] }), waehleSammelticket: () => undefined, postZeilen: () => assert.fail("keine Lücke, nichts zu posten") };
      const code = await melden.main(["--dry-run"], {
        ladeConfig: () => ({}),
        ladeLibs: () => Promise.resolve(libs),
        log: () => undefined,
        err: () => undefined,
        pruefLauf: (a) => {
          aufrufe.push(a);
          return { ergebnis: [] };
        },
      });
      assert.equal(code, 0);
      assert.equal(aufrufe.length, 1);
      assert.equal(typeof aufrufe[0].rootDir, "string");
      assert.equal(typeof aufrufe[0].gh, "function");
      assert.equal(aufrufe[0].langfuse, null);
      assert.equal("umgebung" in aufrufe[0], false, "der Wochenlauf prüft keine Altnamen der Runner-Umgebung");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  test("unbekanntes Flag → Exit 2 vor jeder Config", async () => {
    const code = await melden.main(["--quatsch"], { ladeConfig: () => assert.fail("keine Config"), ladeLibs: () => assert.fail("kein Import"), log: () => undefined, err: () => undefined });
    assert.equal(code, 2);
  });
});
