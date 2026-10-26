/* Wächter für die berichtenden Sicherheits-Workflows (#875): `codeql.yml` und `scorecard.yml`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regeln, darum im geschützten test/harness/ (#1165).
 *
 * Erzwungen wird: minimale Permissions (oben kein `write`, `security-events: write` nur im Job mit `codeql-action/analyze`),
 * Actions per Commit-SHA mit Versionskommentar gepinnt, Scorecard ohne Veröffentlichung (`publish_results: false`, kein PAT,
 * kein `id-token`), keine PR-Trigger bei Scorecard und `persist-credentials: false` am Checkout. Dass kein
 * Jobname einen Required-Check beschattet, erzwingt required-check-shadowing-projekt.test.ts für alle Workflows.
 *
 * Gelesen wird mit der `yaml`-Bibliothek (Struktur: Trigger, Permissions, Jobs, Schritte, `with`). Ehrliche Grenzen:
 * (1) Die Pin-Prüfung liest zeilenweise, weil der Versionskommentar im Syntaxbaum nicht steht; sie kennt nur `uses:` in einer
 * Zeile. (2) `secrets.`-Verwendung wird im kommentarbereinigten Text gesucht, nicht strukturell. (3) Pin-Pflicht gilt nur
 * für `PIN_PFLICHT`; die übrigen Workflows pinnt #983.
 *
 * Ausführen mit:  npm test
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const lies = (...teile: string[]) => readFileSync(join(ROOT, ...teile), "utf8");

/** Workflows mit Pin-Pflicht; #983 erweitert die Liste auf alle. */
const PIN_PFLICHT = ["codeql.yml", "scorecard.yml", "codescanning-inbox.yml"] as const;

type Obj = Record<string, unknown>;
const istObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Text ohne Kommentarzeilen und Kommentar-Endungen. */
function ohneKommentare(yml: string): string {
  return String(yml ?? "")
    .split(/\r?\n/)
    .map((z) => (/^\s*#/.test(z) ? "" : z.replace(/\s+#.*$/, "")))
    .join("\n");
}

/** Schreibrechte eines `permissions`-Werts: `write-all` oder jede Eigenschaft mit Wert `write`. */
function schreibRechte(p: unknown): string[] {
  if (p === "write-all") return ["write-all"];
  if (!istObj(p)) return [];
  return Object.entries(p).filter(([, v]) => v === "write").map(([k]) => `${k}: write`);
}

/** Alle `uses:`-Zeilen ohne 40-stelligen Commit-SHA samt Versionskommentar (lokale `./`-Actions ausgenommen). */
function ungepinnteUses(yml: string): string[] {
  const out: string[] = [];
  for (const l of String(yml ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(l);
    if (!m || m[1].startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(m[1]) || !/^\s+#\s*v\d+(\.\d+)*\s*$/.test(m[2])) out.push(l.trim());
  }
  return out;
}

/** Alle Schlüssel eines Syntaxbaums (beliebige Tiefe). */
function schluessel(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((e) => schluessel(e, out));
  else if (istObj(x)) {
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      schluessel(v, out);
    }
  }
  return out;
}

/** Jeder `actions/checkout@` eines Jobs braucht `persist-credentials: false` (gemeinsam für `pruefe` und `pruefeInbox`). */
function checkoutFehler(name: string, job: Obj): string[] {
  const schritte = Array.isArray(job.steps) ? job.steps.filter(istObj) : [];
  return schritte
    .filter((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@") && !(istObj(s.with) && s.with["persist-credentials"] === false))
    .map(() => `Job ${name}: Checkout ohne persist-credentials: false`);
}

/** Alle Regelverstöße einer Datei als Liste (leer = ok). `art` wählt die dateispezifischen Regeln. */
function pruefe(yml: string, art: "codeql" | "scorecard"): string[] {
  const fehler: string[] = [];
  let wf: unknown;
  try {
    wf = parse(String(yml ?? ""));
  } catch {
    return ["YAML nicht lesbar"];
  }
  if (!istObj(wf)) return ["kein Workflow-Objekt"];
  const on = istObj(wf.on) ? wf.on : {};
  const brauch = art === "codeql" ? ["push", "pull_request", "schedule", "workflow_dispatch"] : ["push", "schedule", "workflow_dispatch"];
  for (const k of brauch) if (!(k in on)) fehler.push(`Trigger ${k} fehlt`);
  const push = on.push;
  if (!(istObj(push) && Array.isArray(push.branches) && push.branches.length === 1 && push.branches[0] === "main")) fehler.push("push-Trigger nicht auf main beschränkt");
  if (wf.permissions === undefined) fehler.push("permissions: auf oberster Ebene fehlt");
  else if (schreibRechte(wf.permissions).length) fehler.push("oberste permissions enthalten write");
  const jobs = istObj(wf.jobs) ? Object.entries(wf.jobs).filter((e): e is [string, Obj] => istObj(e[1])) : [];
  const schritte = (j: Obj): Obj[] => (Array.isArray(j.steps) ? j.steps.filter(istObj) : []);
  const mitAnalyze = (j: Obj) => schritte(j).some((s) => typeof s.uses === "string" && s.uses.startsWith("github/codeql-action/analyze@"));
  const schreibend = jobs.filter(([, j]) => schreibRechte(j.permissions).includes("security-events: write"));
  if (schreibend.length !== 1) fehler.push(`security-events: write in ${schreibend.length} Jobs statt genau einem`);
  for (const [name, j] of jobs) {
    const rechte = schreibRechte(j.permissions).filter((r) => r !== "security-events: write");
    if (rechte.length) fehler.push(`Job ${name}: unerlaubte Schreibrechte (${rechte.join(", ")})`);
    fehler.push(...checkoutFehler(name, j));
  }
  const alleSchluessel = schluessel(wf);
  if (art === "codeql") {
    const sprachen = jobs.flatMap(([, j]) => {
      const m = istObj(j.strategy) && istObj(j.strategy.matrix) ? j.strategy.matrix.language : undefined;
      return Array.isArray(m) ? (m as unknown[]) : [];
    });
    for (const sprache of ["javascript-typescript", "actions"]) if (!sprachen.includes(sprache)) fehler.push(`Matrix ohne ${sprache}`);
    const analyzeJobs = jobs.filter(([, j]) => mitAnalyze(j)).map(([n]) => n);
    if (schreibend.length === 1 && !(analyzeJobs.length === 1 && analyzeJobs[0] === schreibend[0][0])) fehler.push("security-events: write nicht im Job mit analyze");
  } else {
    if ("pull_request" in on || "pull_request_target" in on) fehler.push("Scorecard darf nicht auf PRs laufen");
    const publish = jobs.flatMap(([, j]) => schritte(j)).flatMap((s) => (istObj(s.with) && "publish_results" in s.with ? [s.with.publish_results] : []));
    if (publish.length === 0) fehler.push("publish_results: false fehlt");
    if (publish.some((p) => p !== false && p !== "false")) fehler.push("publish_results ist nicht false");
    if (alleSchluessel.includes("id-token")) fehler.push("id-token verwendet");
    if (alleSchluessel.includes("repo_token")) fehler.push("repo_token verwendet");
    if (/secrets\./.test(ohneKommentare(yml))) fehler.push("secrets.* verwendet");
  }
  for (const u of ungepinnteUses(String(yml ?? ""))) fehler.push(`Action nicht per SHA mit Versionskommentar gepinnt: ${u}`);
  return fehler;
}

/**
 * Regeln für `codescanning-inbox.yml` (hält PROJECT_TOKEN): oberste `permissions` vorhanden und ohne `write` (Schreibrechte nur im Job, hier
 * `issues`), jeder Checkout mit `persist-credentials: false`. Leer = ok.
 */
function pruefeInbox(yml: string): string[] {
  let wf: unknown;
  try {
    wf = parse(String(yml ?? ""));
  } catch {
    return ["YAML nicht lesbar"];
  }
  if (!istObj(wf)) return ["kein Workflow-Objekt"];
  const fehler: string[] = [];
  if (wf.permissions === undefined) fehler.push("permissions: auf oberster Ebene fehlt");
  else if (schreibRechte(wf.permissions).length) fehler.push("oberste permissions enthalten write");
  const jobs = istObj(wf.jobs) ? Object.entries(wf.jobs).filter((e): e is [string, Obj] => istObj(e[1])) : [];
  if (jobs.length === 0) fehler.push("keine Jobs gefunden");
  for (const [name, j] of jobs) fehler.push(...checkoutFehler(name, j));
  return fehler;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const CHECKOUT = `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: false`;
const ANALYZE = `      - uses: github/codeql-action/analyze@${SHA} # v4.39.0`;
const codeql = (o: { top?: string; job?: string; name?: string; extra?: string; uses?: string; trig?: string; analyze?: string } = {}) =>
  [
    "name: CodeQL",
    "on:",
    o.trig ?? "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:",
    o.top ?? "permissions: {}",
    "jobs:",
    "  analyse:",
    `    name: ${o.name ?? "CodeQL-Analyse (${{ matrix.language }})"}`,
    "    strategy:",
    "      matrix:",
    "        language: [javascript-typescript, actions]",
    "    permissions:",
    o.job ?? "      contents: read\n      security-events: write",
    "    steps:",
    o.uses ?? CHECKOUT,
    o.analyze ?? ANALYZE,
    o.extra ?? "",
  ].join("\n");
const scorecard = (o: { extra?: string; trig?: string; publish?: string; uses?: string; top?: string; job?: string } = {}) =>
  [
    "name: Scorecard",
    "on:",
    o.trig ?? "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:",
    o.top ?? "permissions: {}",
    "jobs:",
    "  analyse:",
    "    name: Scorecard-Analyse",
    "    permissions:",
    o.job ?? "      security-events: write\n      contents: read",
    "    steps:",
    o.uses ?? CHECKOUT,
    `      - uses: ossf/scorecard-action@${SHA} # v2.5.0`,
    "        with:",
    `          publish_results: ${o.publish ?? "false"}`,
    o.extra ?? "",
  ].join("\n");

describe("echte Dateien", () => {
  for (const [datei, art] of [["codeql.yml", "codeql"], ["scorecard.yml", "scorecard"]] as const) {
    test(`${datei} hält alle Regeln`, () => {
      expect(pruefe(lies(".github", "workflows", datei), art)).toEqual([]);
    });
  }
  test("codescanning-inbox.yml: oben kein write, Checkout ohne gespeicherte Zugangsdaten", () => {
    expect(pruefeInbox(lies(".github", "workflows", "codescanning-inbox.yml"))).toEqual([]);
  });
  test("PIN_PFLICHT: jede Datei der Liste ist komplett gepinnt", () => {
    for (const d of PIN_PFLICHT) expect(ungepinnteUses(lies(".github", "workflows", d)), d).toEqual([]);
  });
});

describe("Fixtures: gültige Grundform", () => {
  test("codeql und scorecard ohne Verstöße", () => {
    expect(pruefe(codeql(), "codeql")).toEqual([]);
    expect(pruefe(scorecard(), "scorecard")).toEqual([]);
  });
});

describe("Inbox-Workflow: Fixtures", () => {
  const inbox = (o: { top?: string; checkout?: string } = {}) =>
    [
      "name: Code-Scanning-Inbox",
      "on:",
      "  workflow_dispatch: {}",
      o.top ?? "permissions: {}",
      "jobs:",
      "  inbox:",
      "    permissions:",
      "      contents: read",
      "      issues: write",
      "    steps:",
      o.checkout ?? CHECKOUT,
    ].join("\n");
  test("gültige Grundform (Job darf issues: write)", () => expect(pruefeInbox(inbox())).toEqual([]));
  test("oben write", () => expect(pruefeInbox(inbox({ top: "permissions:\n  issues: write" }))).toEqual(["oberste permissions enthalten write"]));
  test("oben write-all", () => expect(pruefeInbox(inbox({ top: "permissions: write-all" }))).toEqual(["oberste permissions enthalten write"]));
  test("oben permissions fehlen", () => expect(pruefeInbox(inbox({ top: "" }))).toEqual(["permissions: auf oberster Ebene fehlt"]));
  test("Checkout ohne with", () => expect(pruefeInbox(inbox({ checkout: `      - uses: actions/checkout@${SHA} # v7.0.1` }))).toEqual([expect.stringContaining("persist-credentials")]));
  test("Checkout mit persist-credentials: true", () =>
    expect(pruefeInbox(inbox({ checkout: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: true` }))).toEqual([expect.stringContaining("persist-credentials")]));
  test("Workflow ohne Jobs: keine Jobs gefunden", () => {
    expect(pruefeInbox("name: x\non:\n  workflow_dispatch: {}\npermissions: {}\n")).toEqual(["keine Jobs gefunden"]);
    expect(pruefeInbox("name: x\non:\n  workflow_dispatch: {}\npermissions: {}\njobs:\n  a: 5\n")).toEqual(["keine Jobs gefunden"]);
  });
  test("kaputtes YAML, leere Eingabe: fail-closed", () => {
    expect(pruefeInbox(":::\n\t- [").length).toBeGreaterThan(0);
    expect(pruefeInbox("").length).toBeGreaterThan(0);
  });
});

describe("Negativfälle: jede Regel verfälscht für sich", () => {
  const nur = (f: string[], teil: string) => expect(f, f.join(" | ")).toEqual([expect.stringContaining(teil)]);
  test("security-events: write oben", () => expect(pruefe(codeql({ top: "permissions:\n  security-events: write" }), "codeql")).toContain("oberste permissions enthalten write"));
  test("write-all oben", () => nur(pruefe(codeql({ top: "permissions: write-all" }), "codeql"), "oberste permissions"));
  test("Flow-Style oben: permissions: { contents: write }", () => nur(pruefe(codeql({ top: "permissions: { contents: write }" }), "codeql"), "oberste permissions"));
  test("permissions oben fehlen", () => nur(pruefe(codeql({ top: "" }), "codeql"), "permissions: auf oberster Ebene fehlt"));
  test("zweiter Job mit security-events: write", () => {
    const z = codeql({ extra: "  zweiter:\n    name: CodeQL-Zwei\n    permissions:\n      security-events: write\n    steps: []" });
    expect(pruefe(z, "codeql").some((x) => x.includes("in 2 Jobs"))).toBe(true);
  });
  test("analyze in einem anderen Job als security-events: write", () => {
    const z = codeql({ analyze: "", extra: `  anderer:\n    name: CodeQL-Zwei\n    permissions:\n      contents: read\n    steps:\n${ANALYZE}` });
    nur(pruefe(z, "codeql"), "nicht im Job mit analyze");
  });
  test("anderes Schreibrecht im Analyse-Job", () => nur(pruefe(codeql({ job: "      contents: write\n      security-events: write" }), "codeql"), "unerlaubte Schreibrechte (contents: write)"));
  test("write-all im Job", () => {
    const z = codeql().replace("    permissions:\n      contents: read\n      security-events: write", "    permissions: write-all");
    expect(pruefe(z, "codeql").some((x) => x.includes("unerlaubte Schreibrechte (write-all)"))).toBe(true);
  });
  test("security-events: write fehlt ganz", () => expect(pruefe(codeql({ job: "      contents: read" }), "codeql").some((x) => x.includes("in 0 Jobs"))).toBe(true));
  test("Tag-Pin statt SHA", () => nur(pruefe(codeql({ uses: "      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false" }), "codeql"), "nicht per SHA"));
  test("SHA ohne Versionskommentar", () => nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA}\n        with:\n          persist-credentials: false` }), "codeql"), "nicht per SHA"));
  test("Checkout ohne persist-credentials: false", () => nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1` }), "codeql"), "persist-credentials"));
  test.each(["true", "false-ähnlich"])("Checkout mit persist-credentials: %s", (wert) =>
    nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: ${wert}` }), "codeql"), "persist-credentials"));
  test("Checkout mit with, aber ohne persist-credentials", () =>
    nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          fetch-depth: 0` }), "codeql"), "persist-credentials"));
  test.each(["branches: [dev]", "branches: [main, dev]", "tags: [v1]"])("push-Trigger mit %s", (b) =>
    nur(pruefe(codeql({ trig: `  push:\n    ${b}\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:` }), "codeql"), "push-Trigger"));
  test("push-Trigger als leeres Objekt", () =>
    nur(pruefe(codeql({ trig: "  push: {}\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "push-Trigger"));
  test.each(["schedule", "workflow_dispatch"])("Scorecard ohne %s", (k) => {
    const alle: Record<string, string> = { schedule: "  schedule:\n    - cron: '1 1 * * 1'", workflow_dispatch: "  workflow_dispatch:" };
    const trig = ["  push:\n    branches: [main]", ...Object.entries(alle).filter(([n]) => n !== k).map(([, v]) => v)].join("\n");
    nur(pruefe(scorecard({ trig }), "scorecard"), `Trigger ${k} fehlt`);
  });
  test("Matrix ohne actions", () => nur(pruefe(codeql().replace("javascript-typescript, actions", "javascript-typescript"), "codeql"), "Matrix ohne actions"));
  test("Matrix ohne javascript-typescript", () => nur(pruefe(codeql().replace("javascript-typescript, actions", "actions"), "codeql"), "Matrix ohne javascript-typescript"));
  test("pull_request-Trigger fehlt bei CodeQL", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "Trigger pull_request fehlt"));
  test("schedule-Trigger fehlt", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:" }), "codeql"), "Trigger schedule fehlt"));
  test("workflow_dispatch-Trigger fehlt", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'" }), "codeql"), "Trigger workflow_dispatch fehlt"));
  test("push nicht auf main beschränkt", () => nur(pruefe(codeql({ trig: "  push:\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "push-Trigger"));
  test("Scorecard: publish_results: true", () => nur(pruefe(scorecard({ publish: "true" }), "scorecard"), "publish_results ist nicht false"));
  test("Scorecard: ein Schritt false, ein zweiter true", () => {
    const z = scorecard({ extra: `      - uses: ossf/scorecard-action@${SHA} # v2.5.0\n        with:\n          publish_results: true` });
    nur(pruefe(z, "scorecard"), "publish_results ist nicht false");
  });
  test("Scorecard: publish_results fehlt", () => nur(pruefe(scorecard().replace(/ {10}publish_results: false\n?/, "          x: y\n"), "scorecard"), "publish_results: false fehlt"));
  test("Scorecard: id-token (ohne write, für sich)", () => nur(pruefe(scorecard({ extra: "          id-token: read" }), "scorecard"), "id-token"));
  test("Scorecard: id-token: write in den Job-Permissions", () => expect(pruefe(scorecard({ job: "      security-events: write\n      id-token: write" }), "scorecard")).toContain("id-token verwendet"));
  test("Scorecard: repo_token", () => nur(pruefe(scorecard({ extra: "          repo_token: x" }), "scorecard"), "repo_token"));
  test("Scorecard: secrets.X", () => nur(pruefe(scorecard({ extra: "          t: ${{ secrets.X }}" }), "scorecard"), "secrets"));
  test("Scorecard: pull_request-Trigger", () => nur(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
  test("Scorecard: pull_request_target-Trigger", () => nur(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request_target:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
});

describe("Grenzfälle", () => {
  test("leere und kaputte Eingabe wirft nicht und ist fail-closed", () => {
    for (const art of ["codeql", "scorecard"] as const) {
      expect(pruefe("", art).length).toBeGreaterThan(0);
      expect(pruefe(":::\n\t- [", art).length).toBeGreaterThan(0);
      expect(pruefe(undefined as unknown as string, art).length).toBeGreaterThan(0);
    }
  });
  test("CRLF ändert nichts", () => {
    expect(pruefe(codeql().replace(/\n/g, "\r\n"), "codeql")).toEqual([]);
    expect(pruefe(scorecard().replace(/\n/g, "\r\n"), "scorecard")).toEqual([]);
  });
  test("Kommentare mit secrets zählen nicht (die übrigen Schlüssel liest die yaml-Bibliothek ohnehin ohne Kommentare)", () => {
    expect(pruefe(scorecard({ extra: "          # id-token / repo_token / secrets.X" }), "scorecard")).toEqual([]);
    expect(ohneKommentare("a: 1 # secrets.X\n# secrets.Y")).not.toMatch(/secrets/);
  });
  test("lokale Action braucht keinen SHA", () => {
    expect(ungepinnteUses("      - uses: ./.github/actions/x")).toEqual([]);
  });
  test("SHA mit falscher Länge ist ungepinnt", () => {
    expect(ungepinnteUses("      - uses: a/b@0123456789abcdef # v1")).toHaveLength(1);
  });
});

/** Hat der Workflow ein `permissions:` auf oberster Ebene (Objekt oder `{}`)? Ohne gälte der Repo-Standard des Tokens. */
function hatOberstePermissions(yml: string): boolean {
  try {
    const doc: unknown = parse(yml);
    return istObj(doc) && istObj(doc.permissions);
  } catch {
    return false;
  }
}

describe("jeder Workflow hat oberste permissions (#1663)", () => {
  const dateien = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));
  test("es gibt Workflows", () => expect(dateien.length).toBeGreaterThan(0));
  test.each(dateien)("%s", (datei) => {
    expect(hatOberstePermissions(lies(".github", "workflows", datei)), `${datei}: permissions: auf oberster Ebene fehlt`).toBe(true);
  });
  test("Negativfälle: fehlend, nur im Job, Flow-Skalar, kaputtes YAML", () => {
    expect(hatOberstePermissions("on: push\njobs:\n  a:\n    runs-on: x\n")).toBe(false);
    expect(hatOberstePermissions("on: push\njobs:\n  a:\n    permissions:\n      contents: read\n")).toBe(false);
    expect(hatOberstePermissions("permissions: write-all\njobs: {}\n")).toBe(false);
    expect(hatOberstePermissions("permissions: [\n")).toBe(false);
    expect(hatOberstePermissions("permissions: {}\njobs: {}\n")).toBe(true);
    expect(hatOberstePermissions("permissions:\n  contents: read\n")).toBe(true);
  });
});
