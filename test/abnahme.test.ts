/* Holdout-Abnahme, Auswertung (#1753, ADR 0022 F13): Bericht prüfen, Spur posten, bestanden/fix/handoff entscheiden.
 * Alles über injizierte io (kein gh, kein git). Red-Green: Dubletten-Prüfung, istVertraut, porcelain-Prüfung, Vorrang, Beleg-Pflicht je entfernen -> rot. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/abnahme.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as so from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNl from "../scripts/nachweis-lib.mjs";
import { echteSprache } from "./support/echte-sprache";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";
import { FREMD_ABNAHME_MARKER } from "./support/ticket-ablauf";

type User = { login: string; type?: string } | null;
type Issue = { state?: string; body?: string | null; user?: User; labels?: ({ name: string } | string)[]; pull_request?: object };
type Kommentar = { user: User; body: string };
type Zeilen = unknown;
type Io = {
  owner: string;
  config: unknown;
  zeilen: Zeilen;
  leseDatei: (p: string) => string;
  ladeIssue: (nr: number) => Issue;
  ladeKommentare: (pr: number) => Kommentar[];
  poste: (nr: number, body: string) => void;
  git: (cwd: string, args: string[]) => string;
};
const A = raw as unknown as {
  prKommentar: (o: {
    zeilen: Zeilen;
    nr: number;
    durchgang: number;
    head: string;
    urteile: { k: string; wert: string; beleg: string }[];
    kriterienListe: { k: string; text: string }[];
    max?: number;
  }) => string;
  fuehreAus: (argv: string[], io: Io) => { code: number; out: string; err: string };
  parseBericht: (t: string, nr: number, k: { k: string; text: string }[]) => { urteile?: { k: string; wert: string; beleg: string }[]; fehler?: string[] };
  entscheide: (u: { wert: string }[]) => string;
  zaehleDurchgang: (k: Kommentar[], owner: string, z: Zeilen) => number;
  ABNAHME_AGENT: string;
};
const nl = rawNl as unknown as { parseAbnahmeMarker: (z: Zeilen, text: string) => { urteil: unknown[] } | null };
const commitZeilen =(so as unknown as { commitZeilen: (p: string, pl: string) => Zeilen }).commitZeilen;
const Z = commitZeilen(FREMD.praefixe.commitZeile, FREMD.agenten.planer) as { praefix: string; abnahme: string };
const MARKER = FREMD_ABNAHME_MARKER;

const HEAD = "a".repeat(40);
const BODY = "## Ziel\nZ\n\n## Akzeptanzkriterien\n1. Erstes Kriterium.\n   - mit Unterpunkt\n2. Zweites Kriterium.\n3. Negativfall: Drittes.\n";
const VERTRAUT: User = { login: FREMD_OWNER, type: "User" };
const BERICHT = (zeilen: string[], kopf = "ABNAHME #7 · holdout-abnahme") => [kopf, "", "Szenario: geheim", ...zeilen].join("\n");
const ALLE_OK = BERICHT(["K1: erfuellt — Beleg eins", "K2: erfuellt — Beleg zwei", "K3: erfuellt — Beleg drei"]);

type Aufruf = { nr: number; body: string };
function umgebung(bericht: string, extra: Partial<Io> = {}, kommentare: Kommentar[] = []) {
  const posts: Aufruf[] = [];
  const aufrufe: string[] = [];
  const io: Io = {
    owner: FREMD_OWNER,
    config: { labels: { forum: FREMD.labels.forum }, sprache: echteSprache() },
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
    expect(r.posts[0].body).toContain(`<!-- ${MARKER} durchgang=1 head=${HEAD} urteil=K1:erfuellt,K2:erfuellt,K3:erfuellt -->`);
    expect(r.posts[0].body).toContain("| K1: Erstes Kriterium. | erfuellt | Beleg eins |");
    expect(r.out).toBe(`ENTSCHEIDUNG: bestanden\n${Z.abnahme}: head=${HEAD} durchgaenge=1 urteil=K1:erfuellt,K2:erfuellt,K3:erfuellt\n`);
    const gelesen = (nl as unknown as { parseNachweis: (t: string, z: Zeilen) => { abnahme: { art: string } } }).parseNachweis(r.out, Z);
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
    expect(t.startsWith(`<!-- ${MARKER}-handoff -->`)).toBe(true);
    expect(t).toContain("K2");
    expect(t).toContain("Grund: keine Messgröße");
    expect(t).toContain("K3");
    expect(t).toContain("Grund: nicht beobachtbar");
    expect(t).not.toContain("K1");
    expect(t).toContain("spezifikation.mjs reparieren");
    expect(r.posts[0].body).not.toContain(`${MARKER}-handoff`);
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

describe("Kommentar-Grenzen: Beleg und Gesamtkörper (#1762)", () => {
  const A2 = A as unknown as { BELEG_MAX: number; KOMMENTAR_MAX: number };
  const beleg = (n: number) => "x".repeat(n);
  const mitBeleg = (b: string) => lauf(BERICHT([`K1: erfuellt — ${b}`, "K2: erfuellt — b", "K3: erfuellt — c"])).posts[0].body;
  test("Konstanten: 1.000 je Beleg, 65.000 gesamt (unter dem GitHub-Limit 65.536)", () => {
    expect(A2.BELEG_MAX).toBe(1000);
    expect(A2.KOMMENTAR_MAX).toBe(65000);
  });
  test("ein Beleg mit genau 1.000 Zeichen bleibt, mit 1.001 wird gekürzt", () => {
    expect(mitBeleg(beleg(1000))).not.toContain("gekürzt");
    const b = mitBeleg(beleg(1001));
    expect(b).toContain("… (gekürzt)");
    expect(b).not.toContain(beleg(1001));
    expect(b).toContain(beleg(1000));
  });
  test("ein Beleg mit 70.000 Zeichen: Body unter 65.536, Marker und Kopf vollständig", () => {
    const b = mitBeleg(beleg(70000));
    expect(b.length).toBeLessThanOrEqual(65536);
    expect(b).toContain("gekürzt");
    expect(b).toContain("| Kriterium | Urteil | Beleg |");
    expect(nl.parseAbnahmeMarker(Z, b)?.urteil).toHaveLength(3);
  });
  test("sehr viele Kriterien: Gesamtkörper ≤ 65.000, Tabellenkopf und Marker nie gekürzt, Hinweis auf entfallene Zeilen", () => {
    const n = 120;
    const body = ["## Ziel", "Z", "", "## Akzeptanzkriterien", ...Array.from({ length: n }, (_, i) => `${i + 1}. Kriterium ${i + 1}.`), ""].join("\n");
    const zeilen = Array.from({ length: n }, (_, i) => `K${i + 1}: erfuellt — ${beleg(2000)}`);
    const r = lauf(BERICHT(zeilen), { ladeIssue: () => ({ state: "open", body, user: VERTRAUT, labels: [] }) });
    const b = r.posts[0].body;
    expect(b.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
    expect(b).toContain("| Kriterium | Urteil | Beleg |");
    expect(b).toContain("gekürzt");
    expect(nl.parseAbnahmeMarker(Z, b)?.urteil).toHaveLength(n);
  });
  const viele = (n: number, belegLaenge: number) => {
    const body = ["## Ziel", "Z", "", "## Akzeptanzkriterien", ...Array.from({ length: n }, (_, i) => `${i + 1}. Kriterium ${i + 1}.`), ""].join("\n");
    const zeilen = Array.from({ length: n }, (_, i) => `K${i + 1}: erfuellt — ${beleg(belegLaenge)}`);
    return lauf(BERICHT(zeilen), { ladeIssue: () => ({ state: "open", body, user: VERTRAUT, labels: [] }) }).posts[0].body;
  };
  test("der Hinweis auf entfallene Zeilen steht am Zeilenanfang und nennt die Zahl; die Belegkürzung allein löst ihn nicht aus", () => {
    const b = viele(120, 2000);
    expect(b).toMatch(/^… \(gekürzt\): \d+ weitere Zeilen entfallen \(die Urteile stehen im Marker\)$/m);
    // Es entfallen nur so viele Zeilen wie nötig: die Zahl stimmt mit den verbliebenen Zeilen überein, und die nächste hätte nicht mehr gepasst.
    const entfallen = Number(/^… \(gekürzt\): (\d+) weitere/m.exec(b)?.[1]);
    const verblieben = (b.match(/^\| K\d+: /gm) ?? []).length;
    expect(verblieben).toBeGreaterThan(0);
    expect(verblieben + entfallen).toBe(120);
    // Die nächste Zeile hätte nicht mehr gepasst: Schwelle aus der längsten verbliebenen Zeile (+1 Zeilenumbruch, +1 für den Ziffernsprung des Hinweises).
    const laengste = Math.max(...(b.match(/^\| K\d+: .*$/gm) ?? []).map((z) => z.length));
    expect(b.length).toBeGreaterThan(A2.KOMMENTAR_MAX - (laengste + 2));
    const ohne = viele(3, 2000);
    expect(ohne).toContain("… (gekürzt)");
    expect(ohne).not.toMatch(/weitere Zeilen entfallen/);
  });
  test("Grenze der Kürzung über prKommentar: genau KOMMENTAR_MAX bleibt ungekürzt, ein Zeichen mehr lässt eine Zeile entfallen (L2a)", () => {
    const n = 63;
    const kriterienListe = Array.from({ length: n }, (_, i) => ({ k: `K${i + 1}`, text: "t" }));
    const bau = (letzterBeleg: number) =>
      A.prKommentar({
        zeilen: Z,
        nr: 7,
        durchgang: 1,
        head: HEAD,
        urteile: kriterienListe.map(({ k }, i) => ({ k, wert: "erfuellt", beleg: beleg(i === n - 1 ? letzterBeleg : 1000) })),
        kriterienListe,
      });
    const grundLaenge = bau(1).length;
    expect(grundLaenge).toBeLessThan(A2.KOMMENTAR_MAX);
    const luecke = A2.KOMMENTAR_MAX - grundLaenge;
    expect(1 + luecke).toBeLessThanOrEqual(A2.BELEG_MAX);
    const genau = bau(1 + luecke);
    expect(genau.length).toBe(A2.KOMMENTAR_MAX);
    expect(genau).not.toMatch(/weitere Zeilen entfallen/);
    const eins = bau(2 + luecke);
    expect(eins).toMatch(/^… \(gekürzt\): 1 weitere Zeilen entfallen/m);
    expect(eins.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
    expect(eins.match(/^\| K\d+: /gm) ?? []).toHaveLength(n - 1);
  });
  test("Zeichengenau: passt der gekürzte Körper mit Hinweis auf genau KOMMENTAR_MAX, bleibt die Zeile; ein Zeichen mehr, entfällt sie (L2a)", () => {
    const n = 64;
    const kriterienListe = Array.from({ length: n }, (_, i) => ({ k: `K${i + 1}`, text: "t" }));
    // Alle Belege 1.000 (der Körper ist zu lang, die letzte Zeile entfällt); `x` stellt den Beleg der vorletzten, noch verbleibenden Zeile ein.
    const bau = (x: number) =>
      A.prKommentar({
        zeilen: Z,
        nr: 7,
        durchgang: 1,
        head: HEAD,
        urteile: kriterienListe.map(({ k }, i) => ({ k, wert: "erfuellt", beleg: beleg(i === n - 2 ? x : 1000) })),
        kriterienListe,
      });
    const x = 1 + (A2.KOMMENTAR_MAX - bau(1).length);
    expect(x).toBeGreaterThan(1);
    expect(x).toBeLessThanOrEqual(A2.BELEG_MAX);
    const genau = bau(x);
    expect(genau.length).toBe(A2.KOMMENTAR_MAX);
    expect(genau).toMatch(/^… \(gekürzt\): 1 weitere Zeilen entfallen/m);
    const eins = bau(x + 1);
    expect(eins).toMatch(/^… \(gekürzt\): 2 weitere Zeilen entfallen/m);
    expect(eins.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
  });
  test("ein Körper knapp unter 65.000 Zeichen bleibt ungekürzt (untere Grenze der Kürzung)", () => {
    const b = viele(55, 1000);
    expect(b.length).toBeGreaterThan(55000);
    expect(b.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
    expect(b).not.toMatch(/weitere Zeilen entfallen/);
    expect(b).not.toContain("… (gekürzt)");
    expect(b.match(/^\| K\d+: /gm) ?? []).toHaveLength(55);
  });
  test("passt schon der Kopf mit dem Marker nicht, entfallen alle Zeilen und die Kürzung endet (kein Endlosschleifen-Fall)", () => {
    // Kleiner Grenzwert statt 7.000 Zeilen (die große Fixture lief unter Coverage ins 5-s-Limit): `max` ist über prKommentar injizierbar.
    const n = 60;
    const kriterienListe = Array.from({ length: n }, (_, i) => ({ k: `K${i + 1}`, text: "t" }));
    const bau = (max: number) =>
      A.prKommentar({ zeilen: Z, nr: 7, durchgang: 1, head: HEAD, urteile: kriterienListe.map(({ k }) => ({ k, wert: "erfuellt", beleg: "b" })), kriterienListe, max });
    const b = bau(100); // schon Kopf mit Marker (60 Urteile) sprengt 100 Zeichen: alle Zeilen entfallen, Kopf und Marker bleiben
    expect(b).toContain(`${n} weitere Zeilen entfallen`);
    expect(b.match(/^\| K\d+: /gm)).toBeNull();
    expect(nl.parseAbnahmeMarker(Z, b)?.urteil).toHaveLength(n);
    // Gegenprobe: mit Standard-Grenzwert bleibt alles stehen.
    expect(bau(A2.KOMMENTAR_MAX)).not.toMatch(/weitere Zeilen entfallen/);
  });
  test("Hand-off-Kommentar nimmt denselben injizierbaren Grenzwert", () => {
    const A3 = A as unknown as { handoffKommentar: (o: { zeilen: Zeilen; nr: number; urteile: { k: string; wert: string; beleg: string }[]; kriterienListe: { k: string; text: string }[]; max?: number }) => string };
    const kriterienListe = [{ k: "K1", text: "t" }, { k: "K2", text: "t" }];
    const urteile = kriterienListe.map(({ k }) => ({ k, wert: "nicht-pruefbar", beleg: "grund" }));
    const knapp = A3.handoffKommentar({ zeilen: Z, nr: 7, urteile, kriterienListe, max: 200 });
    expect(knapp).toMatch(/weitere Zeilen entfallen/);
    expect(knapp).toContain("Der Reparaturweg");
    expect(A3.handoffKommentar({ zeilen: Z, nr: 7, urteile, kriterienListe })).not.toMatch(/weitere Zeilen entfallen/);
  });
  test("Hand-off-Kommentar: der Schluss bleibt bei aktiver Kürzung erhalten", () => {
    const zeilen = Array.from({ length: 80 }, (_, i) => `K${i + 1}: nicht-pruefbar — ${beleg(2000)}`);
    const body = ["## Ziel", "Z", "", "## Akzeptanzkriterien", ...Array.from({ length: 80 }, (_, i) => `${i + 1}. Kriterium ${i + 1}.`), ""].join("\n");
    const r = lauf(BERICHT(zeilen), { ladeIssue: () => ({ state: "open", body, user: VERTRAUT, labels: [] }) });
    const h = r.posts.find((p) => p.nr === 7)?.body ?? "";
    expect(h).toMatch(/^… \(gekürzt\): \d+ weitere Zeilen entfallen/m);
    expect(h.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
    expect(h).toContain("Der Reparaturweg");
    expect(h.endsWith("\n")).toBe(true);
  });
  test("Hand-off-Kommentar: Grund über 1.000 Zeichen gekürzt, Gesamtkörper begrenzt", () => {
    const r = lauf(BERICHT([`K1: nicht-pruefbar — ${beleg(5000)}`, "K2: erfuellt — b", "K3: erfuellt — c"]));
    const h = r.posts.find((p) => p.nr === 7)?.body ?? "";
    expect(h).toContain("… (gekürzt)");
    expect(h.length).toBeLessThanOrEqual(A2.KOMMENTAR_MAX);
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
  const marker = (d: number, extra = "") => `<!-- ${MARKER} durchgang=${d} head=${HEAD} urteil=K1:erfuellt ${extra}-->`;
  test("zählt nur vertraute Autoren mit gültigem Marker; Fremde, Bot-Spoof, Hand-off und Prosa zählen nicht", () => {
    const k: Kommentar[] = [
      { user: VERTRAUT, body: marker(1) },
      { user: VERTRAUT, body: `Text davor\n${marker(2)}` },
      { user: { login: "fremd", type: "User" }, body: marker(3) },
      { user: { login: "github-actions[bot]", type: "User" }, body: marker(4) },
      { user: VERTRAUT, body: `<!-- ${MARKER}-handoff -->` },
      { user: VERTRAUT, body: "nur Text ohne Marker" },
      { user: VERTRAUT, body: `<!-- ${MARKER} durchgang=x -->` },
      { user: null, body: marker(5) },
    ];
    expect(A.zaehleDurchgang(k, FREMD_OWNER, Z)).toBe(3);
    const r = lauf(ALLE_OK, {}, k);
    expect(r.posts[0].body).toContain(`<!-- ${MARKER} durchgang=3 head=${HEAD}`);
    expect(r.out).toContain("durchgaenge=3");
  });
  test("vertrauter Bot (type Bot) zählt, ohne Kommentare ist es Durchgang 1", () => {
    expect(A.zaehleDurchgang([{ user: { login: "github-actions[bot]", type: "Bot" }, body: marker(1) }], FREMD_OWNER, Z)).toBe(2);
    expect(A.zaehleDurchgang([], FREMD_OWNER, Z)).toBe(1);
  });
  test("Lücke und Duplikat: höchster Durchgang plus 1, nicht die Anzahl (#1821 L18)", () => {
    const m = (n: number) => ({ user: VERTRAUT, body: marker(n) });
    expect(A.zaehleDurchgang([m(1), m(3)], FREMD_OWNER, Z)).toBe(4);
    expect(A.zaehleDurchgang([m(2), m(2)], FREMD_OWNER, Z)).toBe(3);
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
  test.each([
    ["unbekanntes Flag", [...AUSWERTEN, "--bogus", "x"], "Unbekanntes Argument: --bogus"],
    ["doppeltes Flag", [...AUSWERTEN, "--pr", "71"], "--pr ist doppelt angegeben"],
    ["Flag von auswerten bei kriterien", ["kriterien", "7", "--pr", "1"], "Unbekanntes Argument: --pr"],
    ["zweite Nummer bei kriterien", ["kriterien", "7", "8"], "Unbekanntes Argument: 8"],
    ["zweite Nummer bei auswerten", [...AUSWERTEN, "8"], "Unbekanntes Argument: 8"],
    ["Flag ohne Wert", ["auswerten", "7", "--pr"], "--pr braucht einen Wert"],
    ["unbekannter Befehl", ["foo"], "unbekannter Befehl „foo“"],
    ["kein Befehl", [], "unbekannter Befehl (keiner)"],
    ["Prototyp-Schlüssel toString", ["toString"], "unbekannter Befehl „toString“"],
    ["Prototyp-Schlüssel constructor", ["constructor", "7"], "unbekannter Befehl „constructor“"],
  ])("Aufruf-Fehler %s: Exit 2 mit Text und Aufruf, nichts gepostet", (_n, argv, text) => {
    const r = lauf(ALLE_OK, {}, [], argv);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`✖ abnahme: ${text}\nAufruf:`);
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
    ["Label forum", { user: VERTRAUT, labels: [{ name: FREMD.labels.forum }] }],
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
    expect(r.out).toContain(`${Z.abnahme}: entfaellt — Ticket ohne Akzeptanzkriterien`);
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
    expect(r.err).toContain(_n.startsWith("kriterien") ? "kriterien braucht" : "auswerten braucht");
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

describe("Beleg-Escaping (CodeQL js/incomplete-sanitization, #1796)", () => {
  const B = raw as unknown as {
    BELEG_MAX: number;
    KOMMENTAR_MAX: number;
    handoffKommentar: (o: { zeilen: Zeilen; nr: number; urteile: { k: string; wert: string; beleg: string }[]; kriterienListe: { k: string; text: string }[] }) => string;
  };
  const baue = (belege: string[]) => {
    const kriterienListe = belege.map((_, i) => ({ k: `K${i + 1}`, text: "t" }));
    return A.prKommentar({
      zeilen: Z,
      nr: 7,
      durchgang: 1,
      head: HEAD,
      urteile: kriterienListe.map(({ k }, i) => ({ k, wert: "erfuellt", beleg: belege[i] })),
      kriterienListe,
    });
  };
  const ROH = ["a\\|b", "x\\\\|y", "ende\\", "C:\\x", "a | b <b>"];

  test("Backslash vor Pipe öffnet keine Zelle: je Zeile genau die 4 Tabellen-Pipes", () => {
    const zeilen = baue(ROH).match(/^\| K\d+: .*$/gm) ?? [];
    expect(zeilen).toHaveLength(ROH.length);
    for (const z of zeilen) expect(z.match(/(?<!\\)(?:\\\\)*\|/g)).toHaveLength(4);
  });

  test("Round-Trip: die maskierte Beleg-Zelle ergibt den Rohbeleg zurück", () => {
    const zeilen = baue(ROH).match(/^\| K\d+: .*$/gm) ?? [];
    const zellen = zeilen.map((z) => (/ \| erfuellt \| (.*) \|$/.exec(z) as RegExpExecArray)[1]);
    const dekodiert = zellen.map((c) => c.replace(/\\([\\|])/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    expect(dekodiert).toEqual(ROH);
  });

  test("Grenzfall Länge: Belege aus lauter Backslashes bleiben unter KOMMENTAR_MAX, der Marker ganz", () => {
    const body = baue(Array.from({ length: 70 }, () => "\\".repeat(B.BELEG_MAX)));
    expect(body.length).toBeLessThanOrEqual(B.KOMMENTAR_MAX);
    expect(body.match(/<!--/g)).toHaveLength(1);
    expect(body).toMatch(/weitere Zeilen entfallen/);
  });

  test("Hand-off-Liste: kein Pipe- und kein Backslash-Escaping, spitze Klammern bleiben maskiert", () => {
    const body = B.handoffKommentar({
      zeilen: Z,
      nr: 7,
      urteile: [{ k: "K1", wert: "nicht-pruefbar", beleg: "`a|b` C:\\x <!-- y -->" }],
      kriterienListe: [{ k: "K1", text: "t" }],
    });
    expect(body).toContain("Grund: `a|b` C:\\x &lt;!-- y --&gt;");
    expect(body.match(/<!--/g)).toHaveLength(1);
  });

  test("Zeilenumbruch im Beleg wird zu einem Leerzeichen: Tabellenzeile und Listenpunkt bleiben eine Zeile", () => {
    expect(baue(["z1\nz2\nz3"])).toMatch(/^\| K1: .* \| erfuellt \| z1 z2 z3 \|$/m);
    const body = B.handoffKommentar({
      zeilen: Z,
      nr: 7,
      urteile: [{ k: "K1", wert: "nicht-pruefbar", beleg: "z1\r\nz2\r\nz3" }],
      kriterienListe: [{ k: "K1", text: "t" }],
    });
    expect(body).toMatch(/Grund: z1 z2 z3$/m);
    expect(body).not.toContain("\r");
  });
});
