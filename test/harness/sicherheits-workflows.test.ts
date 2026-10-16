/* Wächter für die berichtenden Sicherheits-Workflows (#875): `codeql.yml` und `scorecard.yml`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regeln, darum im geschützten test/harness/ (#1165).
 *
 * Erzwungen wird: minimale Permissions (oben kein `write`, `security-events: write` nur im Analyse-Job), Actions per
 * Commit-SHA mit Versionskommentar gepinnt, Scorecard ohne Veröffentlichung (`publish_results: false`, kein PAT, kein
 * `id-token`), keine PR-Trigger bei Scorecard, `persist-credentials: false` am Checkout und Jobnamen mit einem Präfix aus
 * `BERICHTEND` von `scripts/pr-warten.mjs` (die CI-Warteschleife meldet deren Rot nur als HINWEIS). Kein Jobname beginnt
 * mit dem Kontext eines Required-Checks (Ruleset-Spiegel), sonst könnte der berichtende Lauf einen echten Check überschreiben.
 *
 * Ehrliche Grenzen (keine YAML-Lib im Projekt, Präzedenz required-check-shadowing.test.ts): der Regex-Parser liest nur
 * Block-Style mit Zwei-Leerzeichen-Einrückung; Flow-Style (`{ a: b }`), Block-Scalars und über Folgezeilen gefaltete Werte
 * erkennt er nicht. Die Pin-Pflicht gilt nur für `PIN_PFLICHT`; die übrigen Workflows pinnt #983.
 *
 * Ausführen mit:  npm test
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rulesetSpiegel from "../../scripts/docs-gen/ruleset-spiegel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as prWarten from "../../scripts/pr-warten.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const lies = (...teile: string[]) => readFileSync(join(ROOT, ...teile), "utf8");

/** Workflows mit Pin-Pflicht; #983 erweitert die Liste auf alle. */
export const PIN_PFLICHT = ["codeql.yml", "scorecard.yml"] as const;
const BERICHTEND = (prWarten as unknown as { BERICHTEND: readonly string[] }).BERICHTEND;
const REQUIRED = (rulesetSpiegel as unknown as { pruefeRulesetSpiegel: (r: unknown, p: string) => { requiredChecks: string[] } }).pruefeRulesetSpiegel(
  JSON.parse(lies(".github", "ruleset-main-schutz.json")),
  "Spiegel",
).requiredChecks;

/** Ohne Kommentarzeilen, ohne CR, ohne Kommentar-Endungen; leere Zeilen bleiben (Zeilenindex stabil). */
function zeilen(yml: string): string[] {
  return String(yml ?? "")
    .split(/\r?\n/)
    .map((z) => (/^\s*#/.test(z) ? "" : z.replace(/\s+#.*$/, "")));
}

/** Zeilen unter einem Schlüssel in Spalte 0 (bis zum nächsten Schlüssel in Spalte 0); null, wenn der Schlüssel fehlt. */
export function oberBlock(yml: string, key: string): string[] | null {
  const z = zeilen(yml);
  const start = z.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start < 0) return null;
  const rest: string[] = [z[start]];
  for (let i = start + 1; i < z.length && !/^\S/.test(z[i]); i++) rest.push(z[i]);
  return rest;
}

/** Jobs unter `jobs:` als Name → Zeilen (Schnitt an `  <key>:` in Spalte 2). */
export function jobBloecke(yml: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  let aktuell: string[] | null = null;
  for (const l of (oberBlock(yml, "jobs") ?? []).slice(1)) {
    const m = /^ {2}([\w-]+):\s*$/.exec(l);
    if (m) {
      aktuell = [];
      jobs.set(m[1], aktuell);
    } else aktuell?.push(l);
  }
  return jobs;
}

/** Schreibrechte in einem Textblock: `<recht>: write` und `write-all`. */
export function schreibRechte(text: string[]): string[] {
  return text.map((l) => l.trim()).filter((l) => /^[a-z-]+:\s*write\b/.test(l) || /\bwrite-all\b/.test(l));
}

/** Alle `uses:`-Zeilen ohne 40-stelligen Commit-SHA samt Versionskommentar (lokale `./`-Actions ausgenommen). */
export function ungepinnteUses(yml: string): string[] {
  const out: string[] = [];
  for (const l of String(yml ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(l);
    if (!m || m[1].startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(m[1]) || !/^\s+#\s*v\d+(\.\d+)*\s*$/.test(m[2])) out.push(l.trim());
  }
  return out;
}

/** Wörtliche Trigger-Schlüssel unter `on:`. */
function trigger(yml: string): string[] {
  return (oberBlock(yml, "on") ?? []).map((l) => /^ {2}([\w-]+):/.exec(l)?.[1]).filter((x): x is string => !!x);
}

/** Alle Regelverstöße einer Datei als Liste (leer = ok). `art` wählt die dateispezifischen Regeln. */
export function pruefe(yml: string, art: "codeql" | "scorecard"): string[] {
  const fehler: string[] = [];
  const text = String(yml ?? "");
  const code = zeilen(text).join("\n");
  const t = trigger(text);
  const brauch = art === "codeql" ? ["push", "pull_request", "schedule", "workflow_dispatch"] : ["push", "schedule", "workflow_dispatch"];
  for (const k of brauch) if (!t.includes(k)) fehler.push(`Trigger ${k} fehlt`);
  if (!/^ {2}push:\s*\n {4}branches:\s*\[\s*main\s*\]/m.test(text.replace(/\r/g, ""))) fehler.push("push-Trigger nicht auf main beschränkt");
  const oben = oberBlock(text, "permissions");
  if (!oben) fehler.push("permissions: auf oberster Ebene fehlt");
  else if (schreibRechte(oben).length) fehler.push("oberste permissions enthalten write");
  const jobs = jobBloecke(text);
  const schreibend = [...jobs].filter(([, z]) => schreibRechte(z).some((l) => /^security-events:\s*write/.test(l)));
  if (schreibend.length !== 1) fehler.push(`security-events: write in ${schreibend.length} Jobs statt genau einem`);
  for (const [name, z] of jobs) {
    const rechte = schreibRechte(z).filter((l) => !/^security-events:\s*write$/.test(l));
    if (rechte.length) fehler.push(`Job ${name}: unerlaubte Schreibrechte (${rechte.join(", ")})`);
    const jobName = z.map((l) => /^ {4}name:\s*["']?(.*?)["']?\s*$/.exec(l)?.[1]).find((x) => x !== undefined) ?? "";
    for (const k of REQUIRED) if (jobName.startsWith(k)) fehler.push(`Job ${name}: Name beschattet Required-Check ${k}`);
    if (art === "codeql" && !BERICHTEND.some((p) => jobName.startsWith(p))) fehler.push(`Job ${name}: Name beginnt mit keinem BERICHTEND-Präfix`);
    const checkouts = z.map((l, i) => (/uses:\s*actions\/checkout@/.test(l) ? i : -1)).filter((i) => i >= 0);
    for (const i of checkouts) {
      const rest = z.slice(i, i + 6).join("\n");
      if (!/persist-credentials:\s*false/.test(rest)) fehler.push(`Job ${name}: Checkout ohne persist-credentials: false`);
    }
  }
  if (art === "codeql") {
    const matrix = /^\s+language:\s*\[([^\]\n]*)\]/m.exec(code)?.[1].split(",").map((x) => x.trim()) ?? [];
    for (const sprache of ["javascript-typescript", "actions"]) if (!matrix.includes(sprache)) fehler.push(`Matrix ohne ${sprache}`);
    const mitAnalyze = [...jobs].filter(([, z]) => z.some((l) => /codeql-action\/analyze@/.test(l))).map(([n]) => n);
    if (schreibend.length === 1 && !(mitAnalyze.length === 1 && mitAnalyze[0] === schreibend[0][0])) fehler.push("security-events: write nicht im Job mit analyze");
  } else {
    if (t.some((k) => k === "pull_request" || k === "pull_request_target")) fehler.push("Scorecard darf nicht auf PRs laufen");
    if (!/publish_results:[ \t]*false[ \t]*$/m.test(code)) fehler.push("publish_results: false fehlt");
    if (/publish_results:[ \t]*(?!false[ \t]*$)\S+/m.test(code)) fehler.push("publish_results ist nicht false");
    if (/id-token/.test(code)) fehler.push("id-token verwendet");
    if (/repo_token/.test(code)) fehler.push("repo_token verwendet");
    if (/secrets\./.test(code)) fehler.push("secrets.* verwendet");
  }
  for (const u of ungepinnteUses(text)) fehler.push(`Action nicht per SHA mit Versionskommentar gepinnt: ${u}`);
  return fehler;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const CHECKOUT = `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: false\n`;
const codeql = (o: { top?: string; job?: string; name?: string; extra?: string; uses?: string; trig?: string } = {}) =>
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
    o.uses ?? CHECKOUT.trimEnd(),
    `      - uses: github/codeql-action/analyze@${SHA} # v4.39.0`,
    o.extra ?? "",
  ].join("\n");
const scorecard = (o: { extra?: string; trig?: string; publish?: string; uses?: string } = {}) =>
  [
    "name: Scorecard",
    "on:",
    o.trig ?? "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:",
    "permissions: {}",
    "jobs:",
    "  analyse:",
    "    name: Scorecard-Analyse",
    "    permissions:",
    "      security-events: write",
    "      contents: read",
    "    steps:",
    o.uses ?? CHECKOUT.trimEnd(),
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
  test("PIN_PFLICHT: jede Datei der Liste ist komplett gepinnt", () => {
    for (const d of PIN_PFLICHT) expect(ungepinnteUses(lies(".github", "workflows", d)), d).toEqual([]);
  });
  test("kein Required-Check-Kontext beginnt mit einem BERICHTEND-Präfix", () => {
    for (const k of REQUIRED) for (const p of BERICHTEND) expect(k.startsWith(p), `${k} / ${p}`).toBe(false);
  });
  test("BERICHTEND ist nicht leer (sonst gäbe es keine berichtende Klasse)", () => {
    expect(BERICHTEND.length).toBeGreaterThan(0);
  });
});

describe("Fixtures: gültige Grundform", () => {
  test("codeql und scorecard ohne Verstöße", () => {
    expect(pruefe(codeql(), "codeql")).toEqual([]);
    expect(pruefe(scorecard(), "scorecard")).toEqual([]);
  });
});

describe("Negativfälle: jede Regel verfälscht für sich", () => {
  const hat = (f: string[], teil: string) => expect(f.some((x) => x.includes(teil)), f.join(" | ")).toBe(true);
  test("security-events: write oben", () => hat(pruefe(codeql({ top: "permissions:\n  security-events: write" }), "codeql"), "oberste permissions"));
  test("write-all oben", () => hat(pruefe(codeql({ top: "permissions: write-all" }), "codeql"), "oberste permissions"));
  test("permissions oben fehlen", () => hat(pruefe(codeql({ top: "" }), "codeql"), "permissions: auf oberster Ebene fehlt"));
  test("zweiter Job mit security-events: write", () => {
    const z = codeql({ extra: "  zweiter:\n    name: CodeQL-Zwei\n    permissions:\n      security-events: write\n    steps: []" });
    hat(pruefe(z, "codeql"), "in 2 Jobs");
  });
  test("anderes Schreibrecht im Analyse-Job", () => hat(pruefe(codeql({ job: "      contents: write\n      security-events: write" }), "codeql"), "unerlaubte Schreibrechte"));
  test("write-all im Job", () => hat(pruefe(codeql({ job: "      security-events: write\n      write-all" }), "codeql"), "unerlaubte Schreibrechte"));
  test("security-events: write fehlt ganz", () => hat(pruefe(codeql({ job: "      contents: read" }), "codeql"), "in 0 Jobs"));
  test("Tag-Pin statt SHA", () => hat(pruefe(codeql({ uses: "      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false" }), "codeql"), "nicht per SHA"));
  test("SHA ohne Versionskommentar", () => hat(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA}\n        with:\n          persist-credentials: false` }), "codeql"), "nicht per SHA"));
  test("Checkout ohne persist-credentials: false", () => hat(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1` }), "codeql"), "persist-credentials"));
  test("Jobname ohne BERICHTEND-Präfix", () => hat(pruefe(codeql({ name: "Analyse" }), "codeql"), "BERICHTEND"));
  test("Jobname beschattet Required-Check", () => hat(pruefe(codeql({ name: "Tests, Typecheck & Builds" }), "codeql"), "Required-Check"));
  test("Matrix ohne actions", () => hat(pruefe(codeql().replace("javascript-typescript, actions", "javascript-typescript"), "codeql"), "Matrix ohne actions"));
  test("PR-Trigger fehlt bei CodeQL", () => hat(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "Trigger pull_request fehlt"));
  test("push nicht auf main beschränkt", () => hat(pruefe(codeql({ trig: "  push:\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "push-Trigger"));
  test("Scorecard: publish_results: true", () => hat(pruefe(scorecard({ publish: "true" }), "scorecard"), "publish_results"));
  test("Scorecard: publish_results fehlt", () => hat(pruefe(scorecard().replace(/ {10}publish_results: false\n?/, ""), "scorecard"), "publish_results: false fehlt"));
  test("Scorecard: id-token", () => hat(pruefe(scorecard({ extra: "          id-token: write" }), "scorecard"), "id-token"));
  test("Scorecard: repo_token", () => hat(pruefe(scorecard({ extra: "          repo_token: x" }), "scorecard"), "repo_token"));
  test("Scorecard: secrets.X", () => hat(pruefe(scorecard({ extra: "          t: ${{ secrets.X }}" }), "scorecard"), "secrets"));
  test("Scorecard: pull_request-Trigger", () => hat(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
  test("Scorecard: pull_request_target-Trigger", () => hat(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request_target:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
});

describe("Grenzfälle der Parser", () => {
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
  test("Kommentarzeile mit write zählt nicht", () => {
    expect(pruefe(codeql({ top: "permissions: {}\n# security-events: write" }), "codeql")).toEqual([]);
  });
  test("Kommentar-Endung mit write zählt nicht", () => {
    expect(schreibRechte(zeilen("      contents: read # nie write"))).toEqual([]);
  });
  test("lokale Action braucht keinen SHA", () => {
    expect(ungepinnteUses("      - uses: ./.github/actions/x")).toEqual([]);
  });
  test("SHA mit falscher Länge ist ungepinnt", () => {
    expect(ungepinnteUses("      - uses: a/b@0123456789abcdef # v1")).toHaveLength(1);
  });
});
