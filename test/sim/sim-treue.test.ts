/* Domänen-Fitness (#1461, verallgemeinert aus #1440): Wächter über ALLE Treue-Matrizen docs/sim-treue/<familie>.json.
 *  1. Schema: jede Datei, generisch (Status, ziel/flag, Schlüssel, Tickets, Grenzen, Doku-Hosts).
 *  2. Familien: jede Familie der Dispatch-Tabelle (`SIM_COMMANDS`) hat eine Matrix oder steht in der Abbauliste.
 *  3. Vollständigkeit: je Familie das Spec-Objekt (Unterbefehls-Familie bzw. Einzelbefehl) gegen die Matrix.
 * Die Prüffunktionen sind rein und geben Problemlisten zurück; die synthetischen Negativtests beweisen, dass
 * jede Regel anschlägt (Red-Green), die Tests über die echten Dateien erwarten `[]`. */
import { test, expect, describe } from "vitest";
import { freshSim } from "./helpers";
import { SIM_COMMANDS } from "../../src/sim";
import { KUBECTL_SUBCOMMANDS } from "../../src/sim/kubectl";
import { KUBEADM_SUBCOMMANDS } from "../../src/sim/kubeadm";
import { NODE_VERSION } from "../../src/sim/nodes";
import { simGrenzen, familienMitGrenzen } from "../../src/hud/helptext";
import { ladeMatrix, ladeRoh, matrixFamilien, type TreueMatrix } from "../support/sim-treue";

const STATUS = ["gleich", "vereinfacht", "abweichend"];
const DATEI_PFLICHT = ["hinweis", "stand", "befehle", "zeilen"];
const DATEI_SCHLUESSEL = [...DATEI_PFLICHT, "clusterVersion"];
const BEFEHL_SCHLUESSEL = ["doku", "dokuZiele"];
const ZEILEN_SCHLUESSEL = ["befehl", "ziel", "flag", "verhalten", "ausgabe", "tickets", "grenzen", "doku"];
/** Exakte Projekt-Hosts der Doku-Links. Kein Subdomain-Match, keine Sammel-Hostings (readthedocs.io, github.io) pauschal. */
const DOKU_HOSTS = [
  "kubernetes.io", "prometheus-operator.dev", "prometheus.io", "grafana.github.io", "argo-cd.readthedocs.io",
  "curl.se", "bind9.readthedocs.io",
];
/** Befehle der Dispatch-Tabelle, die keine Werkzeug-Familie sind (Dateisystem-Helfer des Spiels). */
const METABEFEHLE = ["ls", "cat"];
/** Abbauliste: Familien ohne Matrix, je mit dem offenen Kind-Ticket von #1452. Eine Matrix-Datei dazu legen heißt den Eintrag löschen. */
const OHNE_MATRIX: Record<string, number> = { docker: 1462, helm: 1462, terraform: 1463, aws: 1463, git: 1464, glab: 1464, argocd: 1464 };

type Obj = Record<string, unknown>;
const istObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const unbekannte = (o: Obj, erlaubt: string[]) => Object.keys(o).filter(k => !erlaubt.includes(k));
const sorted = (xs: Iterable<string>) => [...xs].sort();

/** Doku-Link: https auf exakt einem Projekt-Host. */
function dokuLinkProblem(link: unknown): string | null {
  if (typeof link !== "string") return `Doku-Link kein String: ${String(link)}`;
  let u: URL;
  try { u = new URL(link); } catch { return `Doku-Link nicht lesbar: ${link}`; }
  if (u.protocol !== "https:") return `Doku-Link nicht https: ${link}`;
  return DOKU_HOSTS.includes(u.hostname) ? null : `Doku-Host nicht erlaubt: ${u.hostname}`;
}

function zeilenProbleme(zeile: unknown, i: number, grenzIds: string[]): { probleme: string[]; schluessel: string | null; grenzen: string[] } {
  if (!istObj(zeile)) return { probleme: [`zeilen[${i}]: kein Objekt`], schluessel: null, grenzen: [] };
  const name = `${String(zeile.befehl)} ${String(zeile.ziel ?? zeile.flag)}`;
  const p: string[] = unbekannte(zeile, ZEILEN_SCHLUESSEL).map(k => `${name}: unbekannter Schlüssel ${k}`);
  if (typeof zeile.befehl !== "string") p.push(`zeilen[${i}]: befehl fehlt`);
  if ((zeile.ziel === undefined) === (zeile.flag === undefined)) p.push(`${name}: genau eins von ziel/flag`);
  for (const z of ["verhalten", "ausgabe"]) if (!STATUS.includes(zeile[z] as string)) p.push(`${name}: ${z} ungültig`);
  const zellen = [zeile.verhalten, zeile.ausgabe];
  const tickets = Array.isArray(zeile.tickets) ? zeile.tickets : [];
  if (zellen.includes("abweichend") && !(tickets.length > 0 && tickets.every(Number.isInteger))) p.push(`${name}: abweichend ohne Ticket`);
  const grenzen = Array.isArray(zeile.grenzen) ? zeile.grenzen as string[] : [];
  if (zellen.includes("vereinfacht") && grenzen.length === 0) p.push(`${name}: vereinfacht ohne Grenze`);
  for (const g of grenzen) if (!grenzIds.includes(g)) p.push(`${name}: unbekannte Grenze ${g}`);
  if (zeile.doku !== undefined) { const d = dokuLinkProblem(zeile.doku); if (d) p.push(`${name}: ${d}`); }
  const art = zeile.ziel !== undefined ? "ziel" : "flag";
  return { probleme: p, schluessel: `${String(zeile.befehl)}|${art}|${String(zeile.ziel ?? zeile.flag)}`, grenzen };
}

/** Schema einer Matrix-Datei; `grenzIds` = `simGrenzen(familie)`-IDs. */
function schemaProbleme(familie: string, roh: unknown, grenzIds: string[], clusterVersion: string = NODE_VERSION): string[] {
  if (!istObj(roh)) return [`${familie}: Wurzel ist kein Objekt`];
  const p: string[] = unbekannte(roh, DATEI_SCHLUESSEL).map(k => `${familie}: unbekannter Datei-Schlüssel ${k}`);
  for (const k of DATEI_PFLICHT) if (roh[k] === undefined) p.push(`${familie}: Datei-Schlüssel ${k} fehlt`);
  if (roh.clusterVersion !== undefined && roh.clusterVersion !== clusterVersion) p.push(`${familie}: clusterVersion ${JSON.stringify(roh.clusterVersion)} ≠ ${clusterVersion}`);
  if (istObj(roh.befehle)) {
    for (const [b, e] of Object.entries(roh.befehle)) {
      if (!istObj(e)) { p.push(`befehle.${b}: kein Objekt`); continue; }
      p.push(...unbekannte(e, BEFEHL_SCHLUESSEL).map(k => `befehle.${b}: unbekannter Schlüssel ${k}`));
      const d = dokuLinkProblem(e.doku);
      if (d) p.push(`befehle.${b}: ${d}`);
    }
  }
  const zeilen = Array.isArray(roh.zeilen) ? roh.zeilen : [];
  const keys: string[] = [];
  const benutzt = new Set<string>();
  zeilen.forEach((z, i) => {
    const r = zeilenProbleme(z, i, grenzIds);
    p.push(...r.probleme);
    if (r.schluessel) keys.push(r.schluessel);
    r.grenzen.forEach(g => benutzt.add(g));
  });
  p.push(...keys.filter((k, i) => keys.indexOf(k) !== i).map(k => `${familie}: doppelter Schlüssel ${k}`));
  p.push(...grenzIds.filter(id => !benutzt.has(id)).map(id => `${familie}: Grenze ${id} wird von keiner Zeile benutzt`));
  return p;
}

/** Familien-Wächter: Dispatch-Tabelle gegen Matrix-Dateien und Abbauliste. */
function familienProbleme(simCommands: readonly string[], matrix: string[], ohne: Record<string, number>, meta: string[], mitGrenzen: string[]): string[] {
  const p: string[] = [];
  for (const m of meta) if (!simCommands.includes(m)) p.push(`Metabefehl ${m} steht nicht in SIM_COMMANDS`);
  const familien = simCommands.filter(c => !meta.includes(c));
  for (const f of familien) if (!matrix.includes(f) && !(f in ohne)) p.push(`Familie ${f} hat weder Matrix noch Eintrag in OHNE_MATRIX`);
  for (const f of Object.keys(ohne)) {
    if (matrix.includes(f)) p.push(`OHNE_MATRIX: ${f} hat schon eine Matrix (stale)`);
    if (!familien.includes(f)) p.push(`OHNE_MATRIX: ${f} ist keine Familie der Dispatch-Tabelle (stale)`);
  }
  for (const f of matrix) if (!familien.includes(f)) p.push(`Matrix ${f}.json ohne Familie in SIM_COMMANDS`);
  for (const f of mitGrenzen) if (!matrix.includes(f)) p.push(`Familie ${f} nennt grenzen in helptext.ts, hat aber keine Matrix`);
  return p;
}

type Spec = { form: "unterbefehl"; registry: readonly string[]; unbekannt: RegExp } | { form: "einzel" };

/** Vollständigkeit einer Familie gegen die Matrix (die Sanity-Probe des „unbekannt“-Texts läuft im eigenen Test). */
function vollstaendigkeitProbleme(familie: string, spec: Spec, m: TreueMatrix): string[] {
  const p: string[] = [];
  const befehleKeys = Object.keys(m.befehle);
  const zeilenBefehle = new Set(m.zeilen.map(z => z.befehl));
  if (m.zeilen.length === 0) p.push(`${familie}: keine Zeile`);
  if (spec.form === "einzel") {
    if (befehleKeys.length !== 1 || befehleKeys[0] !== familie) p.push(`${familie}: befehle muss nur "${familie}" enthalten, ist [${befehleKeys.join(", ")}]`);
    for (const b of zeilenBefehle) if (b !== familie) p.push(`${familie}: Zeile mit fremdem befehl ${b}`);
    return p;
  }
  const reg = sorted(spec.registry);
  for (const b of reg) {
    if (!befehleKeys.includes(b)) p.push(`${familie}: Unterbefehl ${b} fehlt in befehle`);
    if (!zeilenBefehle.has(b)) p.push(`${familie}: Unterbefehl ${b} hat keine Zeile`);
  }
  for (const b of befehleKeys) if (!reg.includes(b)) p.push(`${familie}: befehle.${b} ist kein registrierter Unterbefehl`);
  for (const b of zeilenBefehle) if (!reg.includes(b)) p.push(`${familie}: Zeile für unregistrierten Unterbefehl ${b}`);
  return p;
}

/** Spec je Familie mit Matrix: Schlüssel = Matrix-Dateien. */
const SPECS: Record<string, Spec> = {
  kubectl: { form: "unterbefehl", registry: KUBECTL_SUBCOMMANDS, unbekannt: /unknown command "zzz-nichtda"/ },
  kubeadm: { form: "unterbefehl", registry: KUBEADM_SUBCOMMANDS, unbekannt: /unbekannter Unterbefehl 'zzz-nichtda'/ },
  curl: { form: "einzel" },
  nslookup: { form: "einzel" },
};

// ---------- Negativtests mit synthetischen Daten (jede Regel schlägt an) ----------

const zeile = (extra: Obj = {}): Obj => ({ befehl: "x", ziel: "a", verhalten: "gleich", ausgabe: "gleich", ...extra });
const datei = (extra: Obj = {}, zeilen: Obj[] = [zeile()]): Obj => ({
  hinweis: "h", stand: "2026-10-08", befehle: { x: { doku: "https://curl.se/docs/manpage.html" } }, zeilen, ...extra,
});
const probleme = (roh: unknown, grenzIds: string[] = ["g1"], cv?: string) => schemaProbleme("x", roh, grenzIds, cv).filter(s => !s.includes("Grenze g1 wird"));

describe("Schema-Wächter: Negativfälle (synthetisch)", () => {
  test("eine gültige Datei hat keine Probleme", () => {
    expect(schemaProbleme("x", datei(), [])).toEqual([]);
  });
  test.each<[string, Obj, RegExp]>([
    ["unbekannter Datei-Schlüssel", datei({ extra: 1 }), /unbekannter Datei-Schlüssel extra/],
    ["fehlender Pflicht-Schlüssel hinweis", (() => { const d = datei(); delete d.hinweis; return d; })(), /Datei-Schlüssel hinweis fehlt/],
    ["unbekannter Schlüssel im befehle-Eintrag", datei({ befehle: { x: { doku: "https://curl.se/x", doc: "y" } } }), /befehle\.x: unbekannter Schlüssel doc/],
    ["befehle-Eintrag ohne doku", datei({ befehle: { x: {} } }), /befehle\.x: Doku-Link kein String/],
    ["unbekannter Zeilen-Schlüssel", datei({}, [zeile({ foo: 1 })]), /unbekannter Schlüssel foo/],
    ["ziel und flag zugleich", datei({}, [zeile({ flag: "-f" })]), /genau eins von ziel\/flag/],
    ["weder ziel noch flag", datei({}, [(() => { const z = zeile(); delete z.ziel; return z; })()]), /genau eins von ziel\/flag/],
    ["falscher Status", datei({}, [zeile({ verhalten: "ok" })]), /verhalten ungültig/],
    ["doppelter Schlüssel", datei({}, [zeile(), zeile()]), /doppelter Schlüssel x\|ziel\|a/],
    ["abweichend ohne Ticket", datei({}, [zeile({ ausgabe: "abweichend" })]), /abweichend ohne Ticket/],
    ["abweichend mit Nicht-Zahl als Ticket", datei({}, [zeile({ ausgabe: "abweichend", tickets: ["x"] })]), /abweichend ohne Ticket/],
    ["vereinfacht ohne Grenze", datei({}, [zeile({ ausgabe: "vereinfacht" })]), /vereinfacht ohne Grenze/],
    ["unbekannte Grenze", datei({}, [zeile({ ausgabe: "vereinfacht", grenzen: ["xyz"] })]), /unbekannte Grenze xyz/],
    ["http statt https", datei({ befehle: { x: { doku: "http://curl.se/x" } } }), /nicht https/],
    ["Sammel-Hosting als Subdomain", datei({ befehle: { x: { doku: "https://evil.readthedocs.io/x" } } }), /Doku-Host nicht erlaubt: evil\.readthedocs\.io/],
    ["Subdomain eines erlaubten Hosts", datei({ befehle: { x: { doku: "https://x.kubernetes.io/y" } } }), /Doku-Host nicht erlaubt: x\.kubernetes\.io/],
    ["Doku-Link in der Zeile", datei({}, [zeile({ doku: "https://example.org/" })]), /Doku-Host nicht erlaubt/],
    ["clusterVersion ≠ NODE_VERSION", datei({ clusterVersion: "v0.0.1" }), /clusterVersion "v0\.0\.1"/],
  ])("%s ist rot", (_n, roh, muster) => {
    expect(probleme(roh).join("\n")).toMatch(muster);
  });

  test("unbenutzte Grenze der Familie ist rot", () => {
    expect(schemaProbleme("x", datei(), ["g1"])).toEqual(["x: Grenze g1 wird von keiner Zeile benutzt"]);
  });
  test("clusterVersion = NODE_VERSION ist erlaubt", () => {
    expect(schemaProbleme("x", datei({ clusterVersion: NODE_VERSION }), [])).toEqual([]);
  });
});

describe("Familien-Wächter: Negativfälle (synthetisch)", () => {
  const ok = () => familienProbleme(["kubectl", "curl", "ls"], ["kubectl"], { curl: 1 }, ["ls"], ["kubectl"]);
  test("passende Lage hat keine Probleme", () => expect(ok()).toEqual([]));
  test("neue Familie ohne Matrix und ohne Abbauliste ist rot", () => {
    expect(familienProbleme(["kubectl", "neu"], ["kubectl"], {}, [], [])).toEqual(["Familie neu hat weder Matrix noch Eintrag in OHNE_MATRIX"]);
  });
  test("stale Abbaulisten-Eintrag (Matrix existiert) ist rot", () => {
    expect(familienProbleme(["kubectl"], ["kubectl"], { kubectl: 1 }, [], [])).toEqual(["OHNE_MATRIX: kubectl hat schon eine Matrix (stale)"]);
  });
  test("Abbaulisten-Eintrag ohne Familie ist rot", () => {
    expect(familienProbleme(["kubectl"], ["kubectl"], { weg: 1 }, [], [])).toEqual(["OHNE_MATRIX: weg ist keine Familie der Dispatch-Tabelle (stale)"]);
  });
  test("Matrix ohne Familie ist rot", () => {
    expect(familienProbleme(["kubectl"], ["kubectl", "geist"], {}, [], [])).toEqual(["Matrix geist.json ohne Familie in SIM_COMMANDS"]);
  });
  test("Metabefehl nicht in SIM_COMMANDS ist rot", () => {
    expect(familienProbleme(["kubectl"], ["kubectl"], {}, ["ls"], [])).toEqual(["Metabefehl ls steht nicht in SIM_COMMANDS"]);
  });
  test("Familie mit Grenzen ohne Matrix ist rot", () => {
    expect(familienProbleme(["kubectl", "curl"], ["kubectl"], { curl: 1 }, [], ["curl"])).toEqual(["Familie curl nennt grenzen in helptext.ts, hat aber keine Matrix"]);
  });
});

describe("Vollständigkeits-Wächter: Negativfälle (synthetisch)", () => {
  const m = (befehle: string[], zeilen: string[]): TreueMatrix => ({
    hinweis: "h", stand: "s",
    befehle: Object.fromEntries(befehle.map(b => [b, { doku: "https://curl.se/" }])),
    zeilen: zeilen.map(b => ({ befehl: b, ziel: "a", verhalten: "gleich", ausgabe: "gleich" })),
  });
  const unter: Spec = { form: "unterbefehl", registry: ["a", "b"], unbekannt: /x/ };
  test("passende Unterbefehls-Familie ist grün", () => expect(vollstaendigkeitProbleme("f", unter, m(["a", "b"], ["a", "b"]))).toEqual([]));
  test("fehlende Unterbefehl-Zeile ist rot", () => {
    expect(vollstaendigkeitProbleme("f", unter, m(["a", "b"], ["a"]))).toEqual(["f: Unterbefehl b hat keine Zeile"]);
  });
  test("fehlender befehle-Eintrag ist rot", () => {
    expect(vollstaendigkeitProbleme("f", unter, m(["a"], ["a", "b"]))).toEqual(["f: Unterbefehl b fehlt in befehle"]);
  });
  test("überzähliger befehle-Schlüssel und überzählige Zeile sind rot", () => {
    expect(vollstaendigkeitProbleme("f", unter, m(["a", "b", "c"], ["a", "b", "d"])).join("|")).toBe("f: befehle.c ist kein registrierter Unterbefehl|f: Zeile für unregistrierten Unterbefehl d");
  });
  test("Einzelbefehl: nur der Familienname, mindestens eine Zeile", () => {
    const e: Spec = { form: "einzel" };
    expect(vollstaendigkeitProbleme("f", e, m(["f"], ["f"]))).toEqual([]);
    expect(vollstaendigkeitProbleme("f", e, m(["f"], []))).toEqual(["f: keine Zeile"]);
    expect(vollstaendigkeitProbleme("f", e, m(["f", "g"], ["f"]))[0]).toMatch(/befehle muss nur "f" enthalten/);
    expect(vollstaendigkeitProbleme("f", e, m(["f"], ["f", "g"]))).toEqual(["f: Zeile mit fremdem befehl g"]);
  });
});

// ---------- Die echten Dateien ----------

const FAMILIEN = matrixFamilien();

describe("Treue-Matrizen: Schema (jede Datei)", () => {
  test("es gibt Matrix-Dateien", () => expect(FAMILIEN.length).toBeGreaterThan(0));
  test.each(FAMILIEN)("%s.json", f => {
    expect(schemaProbleme(f, ladeRoh(f), simGrenzen(f).map(g => g.id))).toEqual([]);
  });
});

describe("Treue-Matrizen: Familien der Dispatch-Tabelle", () => {
  test("SIM_COMMANDS minus Metabefehle = Matrix-Dateien ∪ OHNE_MATRIX", () => {
    expect(familienProbleme(SIM_COMMANDS, FAMILIEN, OHNE_MATRIX, METABEFEHLE, familienMitGrenzen())).toEqual([]);
  });
});

describe("Treue-Matrizen: Vollständigkeit je Familie", () => {
  test("Spec-Schlüssel = Matrix-Dateien", () => expect(sorted(Object.keys(SPECS))).toEqual(FAMILIEN));
  test.each(FAMILIEN)("%s: Matrix deckt die Familie", f => {
    expect(SPECS[f], `${f}: Spec fehlt`).toBeDefined();
    expect(vollstaendigkeitProbleme(f, SPECS[f], ladeMatrix(f))).toEqual([]);
  });

  test.each(Object.entries(SPECS).filter(([, s]) => s.form === "unterbefehl"))("%s: Sanity: der „unbekannt“-Text trifft nur den unbekannten Unterbefehl (fail-closed)", (f, spec) => {
    if (spec.form !== "unterbefehl") return;
    expect(freshSim().exec(`${f} zzz-nichtda`).output ?? "", `${f} zzz-nichtda`).toMatch(spec.unbekannt);
    for (const k of spec.registry) expect(freshSim().exec(`${f} ${k}`).output ?? "", `${f} ${k}`).not.toMatch(spec.unbekannt);
  });
});
