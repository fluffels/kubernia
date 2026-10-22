/* Harness-Doctor (#1799): Verhalten von `--pruefen` über die öffentliche API mit injiziertem `gh` und Langfuse, ohne Netz.
 * Die gesunde Welt ist ein Fake; jeder Test verfälscht genau eine Antwort und erwartet genau diese Lücke samt `Fix:`-Zeile. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../scripts/harness-doctor.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeAltnamen as rawAlt, pruefLauf as rawPruefLauf } from "../scripts/harness-doctor-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { altEnvName as rawAltName } from "../scripts/projekt-config-lib.mjs";

interface Doctor {
  main(argv: string[], opt: Record<string, unknown>): number;
  pruefe(a: { config: { repo: string }; voraussetzungen: Record<string, unknown[]>; spiegel: undefined; gh: (a: string[]) => string; langfuse: null }): { punkt: string; ok: boolean; fatal?: boolean }[];
  voraussetzungenAus(a: { config: Record<string, unknown>; workflows: { pfad: string; text: string }[] }): { secrets: string[]; variablen: string[]; labels: string[] };
}
const doctor = rawDoctor as unknown as Doctor;
type Befund = { punkt: string; ok: boolean; befund?: string; fix?: string };
const pruefeAltnamen = rawAlt as (a: { env: Record<string, string | undefined>; config: unknown; namen: string[] }) => Befund[];
const altEnvName = rawAltName as (name: string, config: unknown) => string | null;
const SKRIPT = fileURLToPath(new URL("../scripts/harness-doctor.mjs", import.meta.url));

const board = (rolle: string, nummer: number, id: string) => ({ rolle, besitzer: "acme", besitzerTyp: "org", nummer, projectId: id, statusFeldId: 5, statusFeldNodeId: "x_status", todoOptionId: "abc" });
const CONFIG = {
  version: 2,
  repo: "acme/demo",
  boards: [board("produkt", 7, "p_eins"), board("factory", 8, "p_zwei")],
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
  labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
  agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" },
  rulesetSpiegel: "ruleset.json",
};
const WORKFLOW = "env:\n  T: ${{ secrets.PROJECT_TOKEN }}\n  G: ${{ secrets.GITHUB_TOKEN }}\nrun: gh issue list --label forum\n";
const feld = { name: "Status", node_id: "x_status", options: [{ id: "abc", name: { raw: "Todo" } }] };
const GESUND: Record<string, unknown> = {
  "api -i user": "HTTP/2.0 200 OK\nX-Oauth-Scopes: gist, project, repo\n\n{}",
  "api repos/acme/demo": { private: false, default_branch: "main", permissions: { admin: true } },
  "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "all" },
  "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [{ name: "PROJECT_TOKEN" }] }],
  "api --paginate --slurp repos/acme/demo/actions/organization-secrets": [{ secrets: [] }],
  "api --paginate --slurp repos/acme/demo/labels?per_page=100": [[{ name: "area:werk" }, { name: "status:steckt" }, { name: "forum" }]],
  "api orgs/acme/projectsV2/7": { node_id: "p_eins", number: 7 },
  "api orgs/acme/projectsV2/8": { node_id: "p_zwei", number: 8 },
  "api orgs/acme/projectsV2/7/fields/5": feld,
  "api orgs/acme/projectsV2/8/fields/5": feld,
  "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } }],
};
const SPIEGEL = { name: "main-schutz", requiredChecks: ["CI", "Audit"], bypassActors: [] };

const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});

interface Lauf { code: number; out: string[]; err: string[]; aufrufe: string[] }
function lauf(over: Record<string, unknown> = {}, opt: { config?: Record<string, unknown>; workflow?: string | null; spiegel?: unknown; langfuse?: number; argv?: string[]; env?: Record<string, string> } = {}): Lauf {
  const root = mkdtempSync(join(tmpdir(), "kq-doctor-"));
  ordner.push(root);
  if (opt.workflow !== null) {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "a.yml"), opt.workflow ?? WORKFLOW);
  }
  writeFileSync(join(root, "ruleset.json"), JSON.stringify(opt.spiegel ?? SPIEGEL));
  writeFileSync(join(root, "projekt.json"), JSON.stringify(opt.config ?? CONFIG));
  const welt: Record<string, unknown> = { ...GESUND, ...over };
  // Regeln liefert `gh api --paginate --slurp` als Seiten; eine flache Regelliste in den Fixtures ist eine Seite (Seitenform steht in "Regeln über zwei Seiten").
  for (const [k, w] of Object.entries(welt)) if (k.includes("/rules/branches/") && Array.isArray(w) && !w.some(Array.isArray)) welt[k] = [w];
  const aufrufe: string[] = [];
  const gh = (args: string[]): string => {
    const k = args.join(" ");
    aufrufe.push(k);
    const w = welt[k];
    if (w instanceof Error) throw w;
    if (w === undefined) throw new Error(`HTTP 404: ${k}`);
    return typeof w === "string" ? w : JSON.stringify(w);
  };
  const r: Lauf = { code: -1, out: [], err: [], aufrufe };
  r.code = doctor.main((opt.argv ?? ["--pruefen", "--config", "<config>"]).map((a) => (a === "<config>" ? join(root, "projekt.json") : a)), {
    rootDir: root,
    gh,
    env: opt.env ?? {},
    langfuse: () => ({ status: opt.langfuse ?? 0, stderr: opt.langfuse ? "Langfuse aus." : "" }),
    out: (s: string) => r.out.push(s),
    err: (s: string) => r.err.push(s),
  });
  return r;
}
const luecken = (r: Lauf): string[] => r.out.filter((z) => z.startsWith("LÜCKE"));

describe("Altnamen der Kern-Umgebungsvariablen (--pruefen)", () => {
  const NEU = "FACTORY_DIFF_BASE";
  const ALT = altEnvName(NEU, CONFIG) as string;
  const NEU2 = "FACTORY_PR_NUMBER";
  const ALT2 = altEnvName(NEU2, CONFIG) as string;

  test("pur: keiner gesetzt ergibt einen guten Punkt", () => {
    assert.deepEqual(pruefeAltnamen({ env: {}, config: CONFIG, namen: [NEU, NEU2] }), [{ punkt: "Umgebungsvariablen", ok: true }]);
  });
  test("pur: ein gesetzter Altname ergibt eine Lücke mit Fix, der Wert fehlt", () => {
    const e = pruefeAltnamen({ env: { [ALT]: "geheimwert" }, config: CONFIG, namen: [NEU, NEU2] });
    assert.equal(e.length, 1);
    assert.equal(e[0].ok, false);
    assert.equal(e[0].punkt, `Umgebungsvariable ${ALT}`);
    assert.match(e[0].fix ?? "", new RegExp(`${NEU}`));
    assert.doesNotMatch(JSON.stringify(e), /geheimwert/);
  });
  test("pur: ein leerer Altwert zählt als gesetzt, zwei Altnamen geben zwei Lücken, der neue Name allein keine", () => {
    assert.equal(pruefeAltnamen({ env: { [ALT]: "" }, config: CONFIG, namen: [NEU] })[0].ok, false);
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a", [ALT2]: "b" }, config: CONFIG, namen: [NEU, NEU2] }).length, 2);
    assert.equal(pruefeAltnamen({ env: { [NEU]: "x" }, config: CONFIG, namen: [NEU] })[0].ok, true);
  });
  test("pur: Config ohne gültiges Commit-Präfix und leere Namensliste: kein Befund", () => {
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a" }, config: { praefixe: { commitZeile: "x" } }, namen: [NEU] })[0].ok, true);
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a" }, config: CONFIG, namen: [] })[0].ok, true);
  });
  test("CLI: ein gesetzter Altname ergibt Exit 1 und eine LÜCKE-Zeile mit Fix, der Wert steht nie in der Ausgabe", () => {
    const r = lauf({}, { env: { [ALT]: "geheimwert" } });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1, r.out.join("\n"));
    assert.match(luecken(r)[0], new RegExp(`Umgebungsvariable ${ALT}: .*Fix: .*${NEU}`));
    assert.doesNotMatch(r.out.concat(r.err).join("\n"), /geheimwert/);
  });
  test("CLI: --einrichten prüft den Punkt nicht, auch nicht über die Prozess-Umgebung", () => {
    const vorher = process.env[ALT];
    process.env[ALT] = "a";
    try {
      const r = lauf({}, { argv: ["--einrichten", "--dry-run", "--config", "<config>"], env: { [ALT]: "a" } });
      assert.match(r.out.join("\n"), /Harness-Doctor --einrichten/);
      assert.doesNotMatch(r.out.join("\n"), new RegExp(ALT));
    } finally {
      if (vorher === undefined) delete process.env[ALT];
      else process.env[ALT] = vorher;
    }
  });
  test("pruefLauf ohne umgebung (Wochenlauf) prüft den Altnamen nicht, auch bei gesetzter Prozess-Umgebung", () => {
    const root = mkdtempSync(join(tmpdir(), "kq-doctor-"));
    ordner.push(root);
    writeFileSync(join(root, "projekt.json"), JSON.stringify(CONFIG));
    writeFileSync(join(root, "ruleset.json"), JSON.stringify(SPIEGEL));
    const vorher = process.env[ALT];
    process.env[ALT] = "a";
    try {
      const { ergebnis } = (rawPruefLauf as (a: Record<string, unknown>) => { ergebnis: { punkt: string }[] })({ rootDir: root, configPfad: join(root, "projekt.json"), gh: () => "{}", langfuse: null });
      assert.ok(ergebnis.length > 0);
      assert.equal(ergebnis.filter((e) => e.punkt.startsWith("Umgebungsvariable")).length, 0);
    } finally {
      if (vorher === undefined) delete process.env[ALT];
      else process.env[ALT] = vorher;
    }
  });
});

describe("pruefLauf mit umgebung: die Namen kommen vom Aufrufer, die Lib liest keine Dateien", () => {
  const fixture = (): string => {
    const root = mkdtempSync(join(tmpdir(), "kq-doctor-"));
    ordner.push(root);
    writeFileSync(join(root, "projekt.json"), JSON.stringify(CONFIG));
    writeFileSync(join(root, "ruleset.json"), JSON.stringify(SPIEGEL));
    return root;
  };
  const lauf2 = (root: string, umgebung: unknown) =>
    (rawPruefLauf as (a: Record<string, unknown>) => { ergebnis: { punkt: string; ok: boolean }[] })({ rootDir: root, configPfad: join(root, "projekt.json"), gh: () => "{}", langfuse: null, umgebung });

  test("ein übergebener Name, den kein Skript liest, wird gegen den Altnamen geprüft", () => {
    const root = fixture();
    const e = lauf2(root, { env: { [altEnvName("FACTORY_NUR_IM_TEST", CONFIG) as string]: "x" }, namen: ["FACTORY_NUR_IM_TEST"] }).ergebnis;
    assert.equal(e.filter((x) => x.punkt.startsWith("Umgebungsvariable ") && !x.ok).length, 1);
  });
  test("leere Namensliste: der Punkt ist gut, nichts wird nachgelesen", () => {
    const e = lauf2(fixture(), { env: { [altEnvName("FACTORY_NUR_IM_TEST", CONFIG) as string]: "x" }, namen: [] }).ergebnis;
    assert.deepEqual(e.filter((x) => x.punkt.startsWith("Umgebungsvariable")), [{ punkt: "Umgebungsvariablen", ok: true }]);
  });
  test("umgebung ohne namen: wirft mit Hinweis, bevor ein gh-Aufruf läuft", () => {
    assert.throws(() => lauf2(fixture(), { env: {} }), /braucht { env, namen }/);
  });
});

describe("harness-doctor --pruefen", () => {
  test("gesunde Welt: Exit 0, keine Lücke, eine Schlusszeile", () => {
    const r = lauf();
    assert.equal(r.code, 0);
    assert.equal(r.out.filter((z) => z.includes("Fix:")).length, 0);
    assert.deepEqual(r.out.filter((z) => z.startsWith("Harness-Doctor:")), ["Harness-Doctor: keine Lücke"]);
  });

  const faelle: [string, Record<string, unknown>, RegExp][] = [
    ["Actions aus", { "api repos/acme/demo/actions/permissions": { enabled: false } }, /Actions.*Fix: gh api -X PUT/],
    ["Actions local_only", { "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "local_only" } }, /Actions.*Fix:/],
    ["kein Admin", { "api repos/acme/demo": { private: false, default_branch: "main", permissions: { admin: false } } }, /Admin-Recht.*Fix:/],
    ["Scope ohne project", { "api -i user": "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo\n\n{}" }, /Token-Scope.*Fix: gh auth refresh -s project/],
    ["Secret fehlt", { "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [] }] }, /Secret PROJECT_TOKEN.*Fix: gh secret set PROJECT_TOKEN --repo acme\/demo/],
    ["Board node_id", { "api orgs/acme/projectsV2/7": { node_id: "falsch", number: 7 } }, /Board produkt: projectId.*Fix:/],
    ["Board number", { "api orgs/acme/projectsV2/8": { node_id: "p_zwei", number: 9 } }, /Board factory: nummer.*Fix:/],
    ["Feld node_id", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, node_id: "anders" } }, /statusFeldNodeId.*Fix:/],
    ["Option Todo fehlt", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, options: [{ id: "abc", name: { raw: "Done" } }] } }, /todoOptionId.*Fix:/],
    ["Status-Feld falscher Name", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, name: "Priorität" } }, /statusFeldId zeigt auf das Feld "Priorität".*Fix:/],
    ["Repo nicht lesbar", { "api repos/acme/demo": new Error("HTTP 404") }, /Admin-Recht: Repo acme\/demo nicht lesbar.*Fix:/],
    ["Actions nicht lesbar", { "api repos/acme/demo/actions/permissions": new Error("HTTP 403") }, /Actions: .*nicht lesbar.*Fix:/],
    ["Secrets nicht lesbar", { "api --paginate --slurp repos/acme/demo/actions/secrets": new Error("HTTP 403") }, /Secret: secrets nicht lesbar.*Fix:/],
    ["Labels nicht lesbar", { "api --paginate --slurp repos/acme/demo/labels?per_page=100": new Error("HTTP 403") }, /Labels: Labels nicht lesbar.*Fix:/],
    ["Status-Feld 404", { "api orgs/acme/projectsV2/7/fields/5": new Error("HTTP 404") }, /Board produkt: Status-Feld 5 \("Status"\) nicht lesbar.*Fix: boards\[0\]/],
    ["Board wirft", { "api orgs/acme/projectsV2/7": new Error("HTTP 404") }, /Board produkt: Board nicht lesbar.*Fix: boards\[0\]/],
    ["keine Regel", { "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [] }, /Ruleset: kein Required status check.*Fix:/],
    ["Ruleset 403", { "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": new Error("HTTP 403") }, /Ruleset: Regeln.*nicht lesbar.*Fix:/],
    ["privat ohne Ruleset", { "api repos/acme/demo": { private: true, default_branch: "main", permissions: { admin: true } }, "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [] }, /ADR 0022.*Fix: Repo öffentlich/],
  ];
  for (const [name, over, muster] of faelle) {
    test(`Lücke: ${name}`, () => {
      const r = lauf(over);
      assert.equal(r.code, 1);
      assert.equal(luecken(r).length, 1, r.out.join("\n"));
      assert.match(luecken(r)[0], muster);
    });
  }

  test("K4: fehlendes Label ergibt Exit 1 mit Fix-Zeile, Groß-/Kleinschreibung zählt nicht", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/labels?per_page=100": [[{ name: "AREA:WERK" }, { name: "forum" }]] });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1);
    assert.match(luecken(r)[0], /Label status:steckt.*Fix: gh label create "status:steckt" --repo acme\/demo/);
  });

  test("K4: fehlender Required-Check ergibt Exit 1 mit Fix-Zeile; zwei fehlende ergeben zwei Zeilen", () => {
    const eins = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }] });
    assert.equal(eins.code, 1);
    assert.equal(luecken(eins).length, 1);
    assert.match(luecken(eins)[0], /Required-Check "Audit" fehlt.*Fix: "Audit" in Ruleset "main-schutz"/);
    const zwei = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "X" }] } }] });
    assert.equal(luecken(zwei).length, 2);
  });

  test("Required-Check einer anderen Regelart zählt nicht", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "pull_request", parameters: { required_status_checks: [{ context: "Audit" }] } }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Required-Check "Audit" fehlt/);
  });

  test("Standardzweig mit anderem Namen: Regeln kommen von diesem Zweig", () => {
    const repo = { private: false, default_branch: "trunk", permissions: { admin: true } };
    assert.equal(lauf({ "api repos/acme/demo": repo, "api --paginate --slurp repos/acme/demo/rules/branches/trunk?per_page=100": GESUND["api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100"] }).code, 0);
    const r = lauf({ "api repos/acme/demo": repo });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Ruleset:.*trunk/);
  });

  test("Regeln über zwei Seiten (--slurp): Checks beider Seiten zählen, ein Check nur auf Seite 2 fehlend ist eine Lücke", () => {
    const seite = (c: string) => [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: c }] } }];
    const k = "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100";
    assert.equal(lauf({ [k]: [seite("CI"), seite("Audit")] }).code, 0);
    const r = lauf({ [k]: [seite("CI"), seite("Anderes")] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Required-Check "Audit" fehlt/);
  });

  test("Regel ohne parameters zählt als ohne Checks", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks" }] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Ruleset: kein Required status check/);
  });

  test("Antwort null für Board bzw. Status-Feld: Lücken statt Absturz", () => {
    const board = lauf({ "api orgs/acme/projectsV2/7": null });
    assert.equal(board.code, 1);
    assert.equal(luecken(board).length, 2);
    assert.match(luecken(board).join("\n"), /Board produkt: projectId p_eins passt nicht zum Board/);
    const feldNull = lauf({ "api orgs/acme/projectsV2/7/fields/5": null });
    assert.equal(feldNull.code, 1);
    assert.equal(luecken(feldNull).length, 3);
    assert.match(luecken(feldNull).join("\n"), /statusFeldId zeigt auf das Feld/);
  });

  test("Option mit Text-Namen statt { raw } gilt auch", () => {
    assert.equal(lauf({ "api orgs/acme/projectsV2/7/fields/5": { ...feld, options: [{ id: "abc", name: "Todo" }] } }).code, 0);
    const r = lauf({ "api orgs/acme/projectsV2/7/fields/5": { name: "Status", node_id: "x_status" } });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /todoOptionId/);
  });

  test("ohne Ordner .github/workflows wird trotzdem geprüft (Einrichtungsfall)", () => {
    const r = lauf({}, { workflow: null });
    assert.equal(r.code, 0);
    assert.equal(r.aufrufe.filter((a) => a.includes("secrets")).length, 0);
  });

  test("Org-Secret deckt den Bedarf; ohne secrets.* kein Secrets-Aufruf", () => {
    const org = lauf({ "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [] }], "api --paginate --slurp repos/acme/demo/actions/organization-secrets": [{ secrets: [{ name: "PROJECT_TOKEN" }] }] });
    assert.equal(org.code, 0);
    const keins = lauf({}, { workflow: "run: echo\n" });
    assert.equal(keins.code, 0);
    assert.equal(keins.aufrufe.filter((a) => a.includes("secrets")).length, 0);
  });

  test("fehlende Variable (vars.*) ergibt eine Lücke mit gh variable set", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/actions/variables": [{ variables: [] }] }, { workflow: `${WORKFLOW}x: \${{ vars.MODUS }}\n` });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Variable MODUS.*Fix: gh variable set MODUS --repo acme\/demo/);
  });

  test("Scope-Header fehlt (fein granulares Token): nur HINWEIS, Exit 0", () => {
    const r = lauf({ "api -i user": "HTTP/2.0 200 OK\n\n{}" });
    assert.equal(r.code, 0);
    assert.ok(r.out.some((z) => z.startsWith("HINWEIS Token-Scope")));
  });

  test("gh nicht angemeldet: genau eine GitHub-Lücke, danach kein weiterer gh-Aufruf, Langfuse läuft weiter", () => {
    const r = lauf({ "api -i user": new Error("gh auth login") }, { langfuse: 1 });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 2);
    assert.match(luecken(r)[1], /Langfuse:/);
    assert.match(luecken(r)[0], /Token:.*Fix: gh auth login --scopes project/);
    assert.deepEqual(r.aufrufe, ["api -i user"]);
  });

  test("das nicht angemeldete Token trägt das Feld fatal (einrichten prüft es statt des Punktnamens), ein fehlender Scope nicht", () => {
    const leer = { secrets: [], variablen: [], labels: [], boards: [] };
    const nichtAngemeldet = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: undefined, gh: () => { throw new Error("gh auth login"); }, langfuse: null });
    assert.deepEqual(nichtAngemeldet.map((p) => [p.punkt, p.fatal]), [["Token", true]]);
    const ohneScope = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: undefined, gh: (a) => (a.join(" ") === "api -i user" ? "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo\n\n{}" : (() => { throw new Error("404"); })()), langfuse: null });
    assert.equal(ohneScope.find((p) => p.punkt === "Token-Scope")?.fatal, undefined);
  });

  test("Langfuse nicht erreichbar: Lücke mit Befund aus stderr und Fix", () => {
    const r = lauf({}, { langfuse: 1 });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Langfuse: Langfuse aus\. Fix:/);
  });

  test("Ohne Spiegel reicht ein Required-Check", () => {
    const { rulesetSpiegel: _weg, ...ohne } = CONFIG;
    void _weg;
    assert.equal(lauf({}, { config: ohne }).code, 0);
    assert.equal(lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [] }, { config: ohne }).code, 1);
  });

  test("Aufruf- und Config-Fehler: Exit 2 ohne einen gh-Aufruf", () => {
    const kaputt = lauf({}, { argv: ["--pruefen", "--config", "/gibt/es/nicht.json"] });
    assert.equal(kaputt.code, 2);
    assert.match(kaputt.err.join("\n"), /Fix:/);
    assert.doesNotMatch(kaputt.err.join("\n"), /Ruleset-Spiegel/);
    assert.equal(kaputt.aufrufe.length, 0);
    const ungueltig = lauf({}, { config: { version: 2 } });
    assert.equal(ungueltig.code, 2);
    assert.equal(ungueltig.aufrufe.length, 0);
    const keinSpiegel = lauf({}, { config: { ...CONFIG, rulesetSpiegel: "fehlt.json" } });
    assert.equal(keinSpiegel.code, 2);
    assert.equal(keinSpiegel.aufrufe.length, 0);
    assert.match(keinSpiegel.err.join("\n"), /Fix: Ruleset-Spiegel/);
    const leer = lauf({}, { spiegel: { name: "x", requiredChecks: [], bypassActors: [] } });
    assert.equal(leer.code, 2);
    assert.equal(leer.aufrufe.length, 0);
    for (const argv of [[], ["--config", "x"], ["--pruefen", "--unbekannt"], ["--pruefen", "--config"]]) {
      const r = lauf({}, { argv });
      assert.equal(r.code, 2, argv.join(" "));
      assert.equal(r.aufrufe.length, 0);
    }
  });

  test("CLI-Verdrahtung: unlesbare Config per Prozess ergibt Exit 2 und Fix auf stderr (ohne gh und Langfuse)", () => {
    const root = mkdtempSync(join(tmpdir(), "kq-doctor-cli-"));
    ordner.push(root);
    writeFileSync(join(root, "kaputt.json"), "{ nicht json");
    const r = spawnSync(process.execPath, [SKRIPT, "--pruefen", "--config", join(root, "kaputt.json")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Fix:/);
  });
});

describe("voraussetzungenAus", () => {
  const wf = (text: string) => [{ pfad: "a.yml", text }];
  const ab = (text: string) => doctor.voraussetzungenAus({ config: { labels: { harness: "area:werk" } }, workflows: wf(text) });

  test("secrets und vars außer GITHUB_TOKEN", () => {
    const v = ab("a: ${{ secrets.B }} ${{ secrets.GITHUB_TOKEN }} ${{ vars.C }}");
    assert.deepEqual(v.secrets, ["B"]);
    assert.deepEqual(v.variablen, ["C"]);
  });

  test("Label-Literale: Flag mit und ohne Anführungszeichen, Env-Schlüssel; Variablen und Ausdrücke nicht; Dedup ohne Groß-/Kleinschreibung", () => {
    const v = ab('run: gh x --label forum --add-label "Area:Werk" --label "$VAR" --label \'a:b,c:d,\' --label=eq:wert\nenv:\n  ALARM_LABEL: "area:neu"\n  INBOX_LABEL: ${{ x.y }}\n  OTHER: nein\n');
    assert.deepEqual([...v.labels].sort(), ["area:werk", "a:b", "area:neu", "c:d", "eq:wert", "forum"].sort());
  });
});
