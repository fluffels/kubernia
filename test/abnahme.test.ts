/* Holdout-Abnahme, Auswertung (#1753, ADR 0022 F13): Bericht prüfen, Spur posten, bestanden/fix/handoff entscheiden.
 * Alles über injizierte io (kein gh, kein git). Red-Green: Dubletten-Prüfung, istVertraut, porcelain-Prüfung, Vorrang, Beleg-Pflicht je entfernen -> rot. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/abnahme.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as so from "../scripts/slice-override.mjs";

type User = { login: string; type?: string } | null;
type Issue = { state?: string; body?: string | null; user?: User; labels?: ({ name: string } | string)[]; pull_request?: object };
type Kommentar = { user: User; body: string };
type Zeilen = unknown;
type Io = {
  owner: string;
  zeilen: Zeilen;
  leseDatei: (p: string) => string;
  ladeIssue: (nr: number) => Issue;
  ladeKommentare: (pr: number) => Kommentar[];
  poste: (nr: number, body: string) => void;
  git: (cwd: string, args: string[]) => string;
};
const A = raw as unknown as {
  fuehreAus: (argv: string[], io: Io) => { code: number; out: string; err: string };
  parseBericht: (t: string, nr: number, k: { k: string; text: string }[]) => { urteile?: { k: string; wert: string; beleg: string }[]; fehler?: string[] };
  entscheide: (u: { wert: string }[]) => string;
  zaehleDurchgang: (k: Kommentar[], owner: string, z: Zeilen) => number;
  ABNAHME_AGENT: string;
};
const commitZeilen = (so as unknown as { commitZeilen: (p: string, pl: string) => Zeilen }).commitZeilen;
const Z = commitZeilen("KQ-", "kubernia-planner");

const HEAD = "a".repeat(40);
const BODY = "## Ziel\nZ\n\n## Akzeptanzkriterien\n1. Erstes Kriterium.\n   - mit Unterpunkt\n2. Zweites Kriterium.\n3. Negativfall: Drittes.\n";
const VERTRAUT: User = { login: "fluffels", type: "User" };
const BERICHT = (zeilen: string[], kopf = "ABNAHME #7 · holdout-abnahme") => [kopf, "", "Szenario: geheim", ...zeilen].join("\n");
const ALLE_OK = BERICHT(["K1: erfuellt — Beleg eins", "K2: erfuellt — Beleg zwei", "K3: erfuellt — Beleg drei"]);

type Aufruf = { nr: number; body: string };
function umgebung(bericht: string, extra: Partial<Io> = {}, kommentare: Kommentar[] = []) {
  const posts: Aufruf[] = [];
  const aufrufe: string[] = [];
  const io: Io = {
    owner: "fluffels",
    zeilen: Z,
    leseDatei: (p) => {
      if (p !== "b.md") throw new Error("ENOENT");
      return bericht;
    },
    ladeIssue: (nr) => {
      aufrufe.push(`issue:${nr}`);
      return { state: "open", body: BODY, user: VERTRAUT, labels: [] };
    },
    ladeKommentare: (pr) => {
      aufrufe.push(`kommentare:${pr}`);
      return kommentare;
    },
    poste: (nr, body) => void posts.push({ nr, body }),
    git: (_cwd, args) => (args[0] === "status" ? "" : `${HEAD}\n`),
    ...extra,
  };
  return { io, posts, aufrufe };
}
const AUSWERTEN = ["auswerten", "7", "--pr", "70", "--bericht", "b.md", "--worktree", "/wt", "--head", HEAD.slice(0, 7)];
const lauf = (bericht: string, extra: Partial<Io> = {}, kommentare: Kommentar[] = [], argv = AUSWERTEN) => {
  const u = umgebung(bericht, extra, kommentare);
  return { ...A.fuehreAus(argv, u.io), posts: u.posts, aufrufe: u.aufrufe };
};

describe("auswerten: Entscheidung und Spur", () => {
  test("bestanden: ein PR-Kommentar mit Marker (Durchgang 1, volle SHA), Abnahme-Zeile, kein Ticket-Kommentar", () => {
    const r = lauf(ALLE_OK);
    expect(r.code).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].nr).toBe(70);
    expect(r.posts[0].body).toContain(`<!-- kq-abnahme durchgang=1 head=${HEAD} urteil=K1:erfuellt,K2:erfuellt,K3:erfuellt -->`);
    expect(r.posts[0].body).toContain("| K1: Erstes Kriterium. | erfuellt | Beleg eins |");
    expect(r.out).toBe(`ENTSCHEIDUNG: bestanden\nKQ-Abnahme: head=${HEAD} durchgaenge=1 urteil=K1:erfuellt,K2:erfuellt,K3:erfuellt\n`);
    const gelesen = (so as unknown as { parseNachweis: (t: string, z: Zeilen) => { abnahme: { art: string } } }).parseNachweis(r.out, Z);
    expect(gelesen.abnahme.art).toBe("urteil");
  });
  test("fix: PR-Kommentar, Belege der nicht erfüllten Kriterien, kein Ticket-Kommentar", () => {
    const r = lauf(BERICHT(["K1: erfuellt — a", "K2: nicht-erfuellt — Rot weil X", "K3: nicht-erfuellt — Rot weil Y"]));
    expect(r.code).toBe(0);
    expect(r.out).toBe("ENTSCHEIDUNG: fix\nK2 nicht erfüllt: Rot weil X\nK3 nicht erfüllt: Rot weil Y\n");
    expect(r.posts.map((p) => p.nr)).toEqual([70]);
  });
  test("handoff hat Vorrang vor fix: genau ein Ticket-Kommentar mit Marker, beiden Kriterien, Grund und Reparaturweg", () => {
    const r = lauf(BERICHT(["K1: nicht-erfuellt — rot", "K2: nicht-pruefbar — keine Messgröße", "K3: nicht-pruefbar — nicht beobachtbar"]));
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("ENTSCHEIDUNG: handoff");
    expect(r.posts.map((p) => p.nr)).toEqual([70, 7]);
    const t = r.posts[1].body;
    expect(t.startsWith("<!-- kq-abnahme-handoff -->")).toBe(true);
    expect(t).toContain("K2");
    expect(t).toContain("Grund: keine Messgröße");
    expect(t).toContain("K3");
    expect(t).toContain("Grund: nicht beobachtbar");
    expect(t).not.toContain("K1");
    expect(t).toContain("spezifikation.mjs reparieren");
    expect(r.posts[0].body).not.toContain("kq-abnahme-handoff");
  });
  test("entscheide: Vorrang handoff > fix > bestanden", () => {
    expect(A.entscheide([{ wert: "erfuellt" }])).toBe("bestanden");
    expect(A.entscheide([{ wert: "erfuellt" }, { wert: "nicht-erfuellt" }])).toBe("fix");
    expect(A.entscheide([{ wert: "nicht-erfuellt" }, { wert: "nicht-pruefbar" }])).toBe("handoff");
  });
  test("Szenarien und andere Berichtszeilen stehen nicht im Kommentar; Beleg wird escaped", () => {
    const r = lauf(BERICHT(["K1: erfuellt — a | b <!-- x -->", "K2: erfuellt — c", "K3: erfuellt — d"]));
    expect(r.posts[0].body).not.toContain("geheim");
    expect(r.posts[0].body).toContain("a \\| b &lt;!-- x --&gt;");
    expect(r.posts[0].body.match(/<!--/g)).toHaveLength(1);
  });
  test("Präfix steuert Marker und Zeile (nichts hartkodiert)", () => {
    const r = lauf(ALLE_OK, { zeilen: commitZeilen("AB-", "p") });
    expect(r.posts[0].body.startsWith(`<!-- ab-abnahme durchgang=1 head=${HEAD}`)).toBe(true);
    expect(r.out).toContain("AB-Abnahme: head=");
  });
  test("tolerante Berichtswerte: Listenzeichen, Groß/Klein, Trenner", () => {
    const r = A.parseBericht(BERICHT(["- K1: Erfüllt – ok", "* K2: NICHT-ERFUELLT - rot", "K3: erfuellt — x"]), 7, [
      { k: "K1", text: "a" },
      { k: "K2", text: "b" },
      { k: "K3", text: "c" },
    ]);
    expect(r.urteile?.map((u) => u.wert)).toEqual(["erfuellt", "nicht-erfuellt", "erfuellt"]);
  });
});

describe("auswerten: ungültiger Bericht oder Worktree, Exit 1, nichts gepostet", () => {
  const ok = ["K1: erfuellt — a", "K2: erfuellt — b", "K3: erfuellt — c"];
  test.each([
    ["Kriterium fehlt", BERICHT(ok.slice(0, 2)), "K3: fehlt"],
    ["Kriterium doppelt", BERICHT([...ok, "K2: erfuellt — nochmal"]), "K2: doppelt"],
    ["unbekanntes Kriterium", BERICHT([...ok, "K9: erfuellt — x"]), "K9: unbekanntes"],
    ["unbekannter Wert", BERICHT(["K1: gut — a", ok[1], ok[2]]), "unbekanntes Urteil"],
    ["Beleg fehlt", BERICHT(["K1: erfuellt", ok[1], ok[2]]), "ohne Beleg"],
    ["Beleg nur Trenner", BERICHT(["K1: erfuellt —", ok[1], ok[2]]), "ohne Beleg"],
    ["Kopf fehlt", ok.join("\n"), "Kopf"],
    ["falsche Nummer im Kopf", BERICHT(ok, "ABNAHME #8 · holdout-abnahme"), "Kopf"],
    ["falscher Agentenname", BERICHT(ok, "ABNAHME #7 · anderer-agent"), "Kopf"],
    ["leerer Bericht", "", "Kopf"],
  ])("%s", (_n, bericht, meldung) => {
    const r = lauf(bericht);
    expect(r.code).toBe(1);
    expect(r.err).toContain(meldung);
    expect(r.posts).toEqual([]);
  });
  test("ein erfundenes Kriterium kann ein fehlendes nicht ersetzen", () => {
    const r = lauf(BERICHT(["K1: erfuellt — a", "K2: erfuellt — b", "K4: erfuellt — c"]));
    expect(r.code).toBe(1);
    expect(r.err).toContain("K3: fehlt");
    expect(r.err).toContain("K4: unbekanntes");
  });
  test("Worktree verändert (porcelain nicht leer, auch untracked): kein Urteil", () => {
    const r = lauf(ALLE_OK, { git: (_c, a) => (a[0] === "status" ? "?? neu.txt\n" : `${HEAD}\n`) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("?? neu.txt");
    expect(r.posts).toEqual([]);
  });
  test("HEAD weicht von --head ab: kein Urteil", () => {
    const r = lauf(ALLE_OK, { git: (_c, a) => (a[0] === "status" ? "" : `${"b".repeat(40)}\n`) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("weicht von --head");
    expect(r.posts).toEqual([]);
  });
  test("git wirft: Exit 1, nichts gepostet; git bekommt den Worktree-Pfad", () => {
    const cwds: string[] = [];
    const r = lauf(ALLE_OK, {
      git: (c) => {
        cwds.push(c);
        throw new Error("kein Repo");
      },
    });
    expect(r.code).toBe(1);
    expect(r.posts).toEqual([]);
    expect(cwds).toEqual(["/wt"]);
  });
  test("--head wird ohne Beachtung der Großschreibung verglichen", () => {
    const argv = [...AUSWERTEN.slice(0, -1), HEAD.slice(0, 7).toUpperCase()];
    expect(lauf(ALLE_OK, {}, [], argv).code).toBe(0);
  });
});

describe("Durchgang aus früheren Marker-Kommentaren", () => {
  const marker = (d: number, extra = "") => `<!-- kq-abnahme durchgang=${d} head=${HEAD} urteil=K1:erfuellt ${extra}-->`;
  test("zählt nur vertraute Autoren mit gültigem Marker; Fremde, Bot-Spoof, Hand-off und Prosa zählen nicht", () => {
    const k: Kommentar[] = [
      { user: VERTRAUT, body: marker(1) },
      { user: VERTRAUT, body: `Text davor\n${marker(2)}` },
      { user: { login: "fremd", type: "User" }, body: marker(3) },
      { user: { login: "github-actions[bot]", type: "User" }, body: marker(4) },
      { user: VERTRAUT, body: "<!-- kq-abnahme-handoff -->" },
      { user: VERTRAUT, body: "nur Text ohne Marker" },
      { user: VERTRAUT, body: "<!-- kq-abnahme durchgang=x -->" },
      { user: null, body: marker(5) },
    ];
    expect(A.zaehleDurchgang(k, "fluffels", Z)).toBe(3);
    const r = lauf(ALLE_OK, {}, k);
    expect(r.posts[0].body).toContain(`<!-- kq-abnahme durchgang=3 head=${HEAD}`);
    expect(r.out).toContain("durchgaenge=3");
  });
  test("vertrauter Bot (type Bot) zählt, ohne Kommentare ist es Durchgang 1", () => {
    expect(A.zaehleDurchgang([{ user: { login: "github-actions[bot]", type: "Bot" }, body: marker(1) }], "fluffels", Z)).toBe(2);
    expect(A.zaehleDurchgang([], "fluffels", Z)).toBe(1);
  });
});

describe("Aufruf-, gh- und Vertrauensfehler", () => {
  test.each([
    ["Flag fehlt", ["auswerten", "7", "--pr", "70", "--bericht", "b.md", "--head", HEAD]],
    ["head kein Hex", [...AUSWERTEN.slice(0, -1), "xyz"]],
    ["head zu kurz", [...AUSWERTEN.slice(0, -1), "abc12"]],
    ["pr keine Zahl", ["auswerten", "7", "--pr", "x", "--bericht", "b.md", "--worktree", "/wt", "--head", HEAD]],
    ["Flag ohne Wert", ["auswerten", "7", "--pr"]],
    ["unbekannter Befehl", ["foo"]],
    ["kein Befehl", []],
    ["kriterien ohne Nummer", ["kriterien"]],
  ])("%s: Exit 2", (_n, argv) => {
    const r = lauf(ALLE_OK, {}, [], argv);
    expect(r.code).toBe(2);
    expect(r.posts).toEqual([]);
  });
  test("Issue ist ein PR: Exit 2", () => {
    expect(lauf(ALLE_OK, { ladeIssue: () => ({ body: BODY, user: VERTRAUT, pull_request: {} }) }).code).toBe(2);
    expect(lauf("", { ladeIssue: () => ({ body: BODY, user: VERTRAUT, pull_request: {} }) }, [], ["kriterien", "7"]).code).toBe(2);
  });
  test("auswerten bei Ticket ohne Kriterien: Exit 2 mit Hinweis", () => {
    const r = lauf(ALLE_OK, { ladeIssue: () => ({ body: "## Ziel\nZ\n", user: VERTRAUT }) });
    expect(r.code).toBe(2);
    expect(r.err).toContain("kriterien 7");
    expect(r.posts).toEqual([]);
  });
  test.each([
    ["ladeIssue wirft", { ladeIssue: () => { throw new Error("404"); } }],
    ["ladeKommentare wirft", { ladeKommentare: () => { throw new Error("500"); } }],
    ["Bericht nicht lesbar", { leseDatei: () => { throw new Error("ENOENT"); } }],
  ] as [string, Partial<Io>][])("%s: Exit 2, nichts gepostet", (_n, extra) => {
    const r = lauf(ALLE_OK, extra);
    expect(r.code).toBe(2);
    expect(r.posts).toEqual([]);
  });
  test("poste wirft beim PR-Kommentar: Exit 2", () => {
    expect(lauf(ALLE_OK, { poste: () => { throw new Error("403"); } }).code).toBe(2);
  });
  test("handoff: scheitert der Ticket-Kommentar, Exit 2 mit ausdrücklicher Meldung", () => {
    const posts: number[] = [];
    const r = lauf(BERICHT(["K1: erfuellt — a", "K2: nicht-pruefbar — b", "K3: erfuellt — c"]), {
      poste: (nr) => {
        posts.push(nr);
        if (nr === 7) throw new Error("403");
      },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("PR-Kommentar gepostet, Hand-off-Kommentar fehlt");
    expect(posts).toEqual([70, 7]);
  });
  test.each([
    ["fremder Autor", { user: { login: "fremd", type: "User" }, labels: [] }],
    ["Label forum", { user: VERTRAUT, labels: [{ name: "forum" }] }],
    ["Autor null", { user: null, labels: [] }],
  ])("Fremdeingang (%s): Exit 3 bei auswerten und kriterien, nichts gepostet, kein Body auf stderr", (_n, f) => {
    const io = { ladeIssue: () => ({ body: BODY, ...f }) };
    for (const argv of [AUSWERTEN, ["kriterien", "7"]]) {
      const r = lauf(ALLE_OK, io, [], argv);
      expect(r.code).toBe(3);
      expect(r.out).toBe("");
      expect(r.err).not.toContain("Erstes Kriterium");
      expect(r.posts).toEqual([]);
    }
  });
});

describe("kriterien", () => {
  test("gibt K1…KN mit Text aus, Unterpunkte eingerückt", () => {
    const r = lauf("", {}, [], ["kriterien", "7"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("K1: Erstes Kriterium.\n    mit Unterpunkt\nK2: Zweites Kriterium.\nK3: Negativfall: Drittes.\n");
  });
  test("ohne Kriterien: Hinweis und fertige entfaellt-Zeile, Exit 0", () => {
    const r = lauf("", { ladeIssue: () => ({ body: "## Ziel\nZ\n", user: VERTRAUT }) }, [], ["kriterien", "7"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("KQ-Abnahme: entfaellt — Ticket ohne Akzeptanzkriterien");
  });
  test("ABNAHME_AGENT ist holdout-abnahme", () => {
    expect(A.ABNAHME_AGENT).toBe("holdout-abnahme");
  });
});

describe("Lens-Runde 1: CRLF, Argumente der io, Grenzen der Aufrufprüfung", () => {
  test("Bericht mit CRLF (Windows) wird gelesen", () => {
    const r = lauf(ALLE_OK.replace(/\n/g, "\r\n"));
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("ENTSCHEIDUNG: bestanden");
  });
  test("Kommentare kommen vom PR (70), das Ticket ist #7: io bekommt die richtigen Nummern", () => {
    const r = lauf(ALLE_OK);
    expect(r.aufrufe).toEqual(["issue:7", "kommentare:70"]);
  });
  test("Umlaute im Urteil werden toleriert (Erfüllt)", () => {
    const r = A.parseBericht(BERICHT(["K1: Erfüllt — a", "K2: erfuellt — b", "K3: erfuellt — c"]), 7, [
      { k: "K1", text: "a" },
      { k: "K2", text: "b" },
      { k: "K3", text: "c" },
    ]);
    expect(r.urteile?.[0].wert).toBe("erfuellt");
  });
  test("ein unbekannter Wert meldet nur sich selbst, nicht zusätzlich „fehlt“", () => {
    const r = lauf(BERICHT(["K1: gut — a", "K2: erfuellt — b", "K3: erfuellt — c"]));
    expect(r.err).toContain("K1: unbekanntes Urteil");
    expect(r.err).not.toContain("K1: fehlt");
  });
  test.each([
    ["Nummer 0 bei auswerten", ["auswerten", "0", ...AUSWERTEN.slice(2)]],
    ["Nummer fehlt bei auswerten", ["auswerten", ...AUSWERTEN.slice(2)]],
    ["--pr 0", ["auswerten", "7", "--pr", "0", ...AUSWERTEN.slice(4)]],
    ["--bericht fehlt", ["auswerten", "7", "--pr", "70", "--worktree", "/wt", "--head", HEAD]],
    ["kriterien 0", ["kriterien", "0"]],
    ["head 6 Zeichen", [...AUSWERTEN.slice(0, -1), "a".repeat(6)]],
    ["head 41 Zeichen", [...AUSWERTEN.slice(0, -1), "a".repeat(41)]],
  ])("Aufruf ungültig: %s: Exit 2", (_n, argv) => {
    const r = lauf(ALLE_OK, {}, [], argv);
    expect(r.code).toBe(2);
    expect(r.posts).toEqual([]);
  });
  test.each([7, 40])("head mit %i Zeichen ist gültig", (n) => {
    expect(lauf(ALLE_OK, {}, [], [...AUSWERTEN.slice(0, -1), "a".repeat(n)]).code).toBe(0);
  });
  test("lange Kriteriumstexte werden in der Tabelle gekürzt", () => {
    const lang = "x".repeat(300);
    const r = lauf(ALLE_OK, { ladeIssue: () => ({ body: `## Ziel\nZ\n\n## Akzeptanzkriterien\n1. ${lang}\n2. b\n3. c\n`, user: VERTRAUT }) });
    expect(r.posts[0].body).toContain(`${"x".repeat(100)}…`);
    expect(r.posts[0].body).not.toContain("x".repeat(101));
  });
});
