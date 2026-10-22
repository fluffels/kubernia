/* Harness-Doctor `--einrichten` (#1800): legt nur Umkehrbares an, alles andere nur als Anleitung mit Link; ein zweiter Lauf ändert nichts.
 * `gh` und der Sammelticket-Aufruf sind Fakes, das Fake-gh führt die geposteten Labels nach (Idempotenz-Test), ohne Netz. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../scripts/harness-doctor.mjs";

interface Doctor {
  main(argv: string[], opt: Record<string, unknown>): number;
  WOCHENLAUF_PFAD: string;
  WOCHENLAUF_WORKFLOW: string;
}
const doctor = rawDoctor as unknown as Doctor;

const board = (rolle: string, nummer: number, id: string) => ({ rolle, besitzer: "acme", besitzerTyp: "org", nummer, projectId: id, statusFeldId: 5, statusFeldNodeId: "x_status", todoOptionId: "abc" });
const CONFIG = {
  version: 2,
  repo: "acme/demo",
  boards: [board("produkt", 7, "p_eins"), board("factory", 8, "p_zwei")],
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
  labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
  agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" },
  rulesetSpiegel: "ruleset.json",
  sprache: {
    umschrift: ["ae"],
    spezifikation: {
      ziel: "Ziel",
      nachMerge: "Danach:",
      akzeptanzkriterien: ["Kriterien"],
      blocker: "blockiert durch",
      abhaengigkeit: ["folgt nach #"],
      negativfall: { wort: "Negativfall", muster: "negativ" },
      begrenzung: { wort: "Grenze", muster: "grenze" },
      allquantor: { wort: "alle", muster: "alle" },
    },
  },
};
const WORKFLOW = "env:\n  T: ${{ secrets.PROJECT_TOKEN }}\nrun: gh issue list --label forum\n";
const feld = { name: "Status", node_id: "x_status", options: [{ id: "abc", name: { raw: "Todo" } }] };
const LABEL_KEY = "api --paginate --slurp repos/acme/demo/labels?per_page=100";
const SECRETS_KEY = "api --paginate --slurp repos/acme/demo/actions/secrets";
const GESUND: Record<string, unknown> = {
  "api -i user": "HTTP/2.0 200 OK\nX-Oauth-Scopes: gist, project, repo\n\n{}",
  "api repos/acme/demo": { private: false, default_branch: "main", permissions: { admin: true } },
  "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "all" },
  [SECRETS_KEY]: [{ secrets: [{ name: "PROJECT_TOKEN" }] }],
  "api --paginate --slurp repos/acme/demo/actions/organization-secrets": [{ secrets: [] }],
  "api orgs/acme/projectsV2/7": { node_id: "p_eins", number: 7 },
  "api orgs/acme/projectsV2/8": { node_id: "p_zwei", number: 8 },
  "api orgs/acme/projectsV2/7/fields/5": feld,
  "api orgs/acme/projectsV2/8/fields/5": feld,
  "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [[{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }]],
};

const cfgPfad = (root: string): string => join(root, ".factory", "projekt.json"); // die Standard-Config (PROJEKT_CONFIG)
const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});
const neuerRoot = (workflow: string | null = WORKFLOW): string => {
  const root = mkdtempSync(join(tmpdir(), "kq-einrichten-"));
  ordner.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  if (workflow !== null) writeFileSync(join(root, ".github", "workflows", "a.yml"), workflow);
  writeFileSync(join(root, "ruleset.json"), JSON.stringify({ name: "main-schutz", requiredChecks: ["CI"], bypassActors: [] }));
  mkdirSync(join(root, ".factory"), { recursive: true });
  writeFileSync(cfgPfad(root), JSON.stringify(CONFIG));
  return root;
};

interface Welt { labels: string[]; over: Record<string, unknown>; postFehler: Set<string> }
interface Ergebnis { code: number; out: string[]; err: string[]; posts: string[]; schreibend: string[]; sammel: string[][]; ghAufrufe: number }
const welt = (labels = ["area:werk", "status:steckt", "forum"], over: Record<string, unknown> = {}): Welt => ({ labels, over, postFehler: new Set() });
const SCHON = "Ungeclaimtes „Harness-Härtung (gesammelt)“ gibt es schon: #1, nichts wird angelegt.\n";
function fahre(root: string, w: Welt, argv: string[], sammelStatus = 0, sammelAusgabe: string | null = SCHON): Ergebnis {
  const r: Ergebnis = { code: -1, out: [], err: [], posts: [], schreibend: [], sammel: [], ghAufrufe: 0 };
  const gh = (args: string[]): string => {
    r.ghAufrufe++;
    const k = args.join(" ");
    if (args.includes("-X")) {
      r.schreibend.push(k);
      const name = /name=(.*)$/.exec(k)?.[1] ?? "";
      if (w.postFehler.has(name)) throw new Error(`HTTP 422: ${name}`);
      r.posts.push(name);
      w.labels.push(name);
      return "{}";
    }
    const antwort = w.over[k] ?? (k === LABEL_KEY ? [w.labels.map((name) => ({ name }))] : GESUND[k]);
    if (antwort instanceof Error) throw antwort;
    if (antwort === undefined) throw new Error(`HTTP 404: ${k}`);
    return typeof antwort === "string" ? antwort : JSON.stringify(antwort);
  };
  const spawn = (args: string[]) => {
    r.sammel.push(args);
    return { status: sammelStatus, stdout: sammelAusgabe ?? undefined, stderr: sammelAusgabe === null ? null : "" };
  };
  r.code = doctor.main(argv, { rootDir: root, gh, spawn, langfuse: () => assert.fail("Langfuse wird bei --einrichten nicht geprüft"), out: (s: string) => r.out.push(s), err: (s: string) => r.err.push(s) });
  return r;
}
const EINR = (root: string, ...extra: string[]): string[] => ["--einrichten", "--config", cfgPfad(root), ...extra];
const datei = (root: string): string => join(root, doctor.WOCHENLAUF_PFAD);

describe("harness-doctor --einrichten", () => {
  test("Dry-Run: nur Plan, nichts wird geschrieben, das Sammelticket bekommt --dry-run", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(["status:steckt"]), EINR(root, "--dry-run"));
    assert.equal(r.code, 1);
    assert.deepEqual(r.out.filter((z) => z.startsWith("PLAN")), ['PLAN Label "area:werk" anlegen', 'PLAN Label "forum" anlegen', `PLAN Workflow ${doctor.WOCHENLAUF_PFAD} anlegen`]);
    assert.deepEqual(r.schreibend, []);
    assert.equal(existsSync(datei(root)), false);
    assert.deepEqual(r.sammel, [["harness", "--dry-run"]]);
  });

  test("echter Lauf: je fehlendem Label ein POST, die Wochenlauf-Datei gleicht der Vorlage, das Sammelticket läuft ohne --dry-run", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(["status:steckt", "FORUM"]), EINR(root));
    assert.equal(r.code, 0, r.out.join("\n"));
    assert.deepEqual(r.posts, ["area:werk"]); // „FORUM“ gilt als vorhanden (Groß-/Kleinschreibung egal)
    assert.equal(readFileSync(datei(root), "utf8"), doctor.WOCHENLAUF_WORKFLOW);
    assert.deepEqual(r.sammel, [["harness"]]);
    assert.ok(r.out.some((z) => z === 'ANGELEGT Label "area:werk"'));
    assert.match(r.out.at(-1) ?? "", /^Harness-Doctor --einrichten: 2 angelegt, 0 geplant, 0 Anleitung\(en\), 0 Fehler$/);
  });

  test("zweiter Lauf im selben Ordner ändert nichts (idempotent)", () => {
    const root = neuerRoot();
    const w = welt(["status:steckt"]);
    fahre(root, w, EINR(root));
    const vorher = readFileSync(datei(root), "utf8");
    const r = fahre(root, w, EINR(root));
    assert.equal(r.code, 0);
    assert.deepEqual(r.schreibend, []);
    assert.equal(readFileSync(datei(root), "utf8"), vorher);
    assert.deepEqual(r.out.filter((z) => /^(ANGELEGT|PLAN|FEHLER)/.test(z)), []);
  });

  test("nie automatisch: Secret, Ruleset, Board-Feld, Actions und Admin-Recht sind nur Anleitungen mit Link", () => {
    const root = neuerRoot();
    const r = fahre(
      root,
      welt(undefined, {
        [SECRETS_KEY]: [{ secrets: [] }],
        "api repos/acme/demo": { private: false, default_branch: "main", permissions: { admin: false } },
        "api repos/acme/demo/actions/permissions": { enabled: false },
        "api orgs/acme/projectsV2/7": { node_id: "falsch", number: 7 },
        "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [[]],
      }),
      EINR(root),
    );
    assert.deepEqual(r.schreibend, []);
    const anleitungen = r.out.filter((z) => z.startsWith("ANLEITUNG"));
    for (const punkt of ["Secret PROJECT_TOKEN", "Admin-Recht", "Actions", "Board produkt", "Ruleset"]) {
      assert.ok(anleitungen.some((z) => z.startsWith(`ANLEITUNG ${punkt}:`) && /Fix: .+ Link: https:\/\/\S+$/.test(z)), `${punkt}: ${anleitungen.join("\n")}`);
    }
    assert.equal(r.code, 1);
  });

  test("eine abweichende Wochenlauf-Datei bleibt unangetastet (HINWEIS)", () => {
    const root = neuerRoot();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(datei(root), "name: eigener Stand\n");
    const r = fahre(root, welt(), EINR(root));
    assert.equal(readFileSync(datei(root), "utf8"), "name: eigener Stand\n");
    assert.ok(r.out.some((z) => z.startsWith("HINWEIS Workflow") && z.includes("factory-sync")));
  });

  test("die Vorlage zählt als Workflow: ohne Datei steht Secret PROJECT_TOKEN schon im Plan", () => {
    const root = neuerRoot("run: echo\n");
    const r = fahre(root, welt(undefined, { [SECRETS_KEY]: [{ secrets: [] }] }), EINR(root, "--dry-run"));
    assert.ok(r.out.some((z) => z.startsWith("ANLEITUNG Secret PROJECT_TOKEN:")));
  });

  test("ein fehlschlagender Label-POST ist FEHLER, die übrigen Labels werden trotzdem versucht", () => {
    const root = neuerRoot();
    const w = welt(["status:steckt"]);
    w.postFehler.add("area:werk");
    const r = fahre(root, w, EINR(root));
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith('FEHLER Label "area:werk"')));
    assert.deepEqual(r.posts, ["forum"]);
  });

  test("das Sammelticket zählt: im Dry-Run „Würde … anlegen“ als geplant (Exit 1), im echten Lauf „Angelegt:“ als angelegt (Exit 0)", () => {
    const root0 = neuerRoot();
    const geplant = fahre(root0, welt(), EINR(root0, "--dry-run"), 0, "Würde „Harness-Härtung (gesammelt)“ anlegen.\n");
    assert.match(geplant.out.at(-1) ?? "", /: 0 angelegt, 2 geplant, /); // Workflow-Datei und Sammelticket
    assert.ok(geplant.out.includes("Sammelticket: Würde „Harness-Härtung (gesammelt)“ anlegen."));
    const root = neuerRoot();
    const echt = fahre(root, welt(), EINR(root), 0, "Angelegt: #5\n");
    assert.equal(echt.code, 0);
    assert.match(echt.out.at(-1) ?? "", /: 2 angelegt, 0 geplant, /); // Workflow-Datei und Sammelticket
  });

  test("Dry-Run: ein vorhandenes, aber falsch positioniertes Sammelticket („Trockenlauf … würde es neu setzen“) zählt als geplant (Exit 1)", () => {
    const root = neuerRoot();
    writeFileSync(datei(root), doctor.WOCHENLAUF_WORKFLOW, { flag: "w" });
    const ausgabe = SCHON + "Trockenlauf: #1 steht nicht auf Position 4, ein echter Lauf würde es neu setzen.\n";
    const r = fahre(root, welt(), EINR(root, "--dry-run"), 0, ausgabe);
    assert.match(r.out.at(-1) ?? "", /: 0 angelegt, 1 geplant, /);
    assert.equal(r.code, 1);
    const ruhig = fahre(root, welt(), EINR(root, "--dry-run"), 0, SCHON);
    assert.match(ruhig.out.at(-1) ?? "", /: 0 angelegt, 0 geplant, /);
  });

  test("abweichendes --config: kein Sammelticket-Aufruf (das Skript liest die Standard-Config), stattdessen ANLEITUNG, Exit 1", () => {
    const root = neuerRoot();
    const andere = join(root, "andere.json");
    writeFileSync(andere, JSON.stringify(CONFIG));
    const r = fahre(root, welt(), ["--einrichten", "--config", andere]);
    assert.deepEqual(r.sammel, []);
    assert.ok(r.out.some((z) => z.startsWith("ANLEITUNG Sammelticket:") && /Standard-Config/.test(z)), r.out.join("\n"));
    assert.equal(r.code, 1);
    assert.match(r.out.at(-1) ?? "", /, 1 Anleitung\(en\), /);
    const gleich = fahre(root, welt(), ["--einrichten", "--config", cfgPfad(root)]);
    assert.equal(gleich.sammel.length, 1, "die Standard-Config ausdrücklich genannt ist nicht abweichend");
    const ohne = fahre(root, welt(), ["--einrichten"]);
    assert.equal(ohne.sammel.length, 1, "ohne --config ebenso");
  });

  test("eine Anleitung ohne Link bleibt ohne „Link:“ (Labels nicht lesbar)", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(undefined, { [LABEL_KEY]: new Error("HTTP 500") }), EINR(root));
    const z = r.out.find((x) => x.startsWith("ANLEITUNG Labels:")) ?? "";
    assert.match(z, /Fix: /);
    assert.doesNotMatch(z, /Link:/);
  });

  test("eine Wochenlauf-Datei mit Windows-Zeilenenden gleicht der Vorlage (OK, kein HINWEIS)", () => {
    const root = neuerRoot();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(datei(root), doctor.WOCHENLAUF_WORKFLOW.replace(/\n/g, "\r\n"));
    const r = fahre(root, welt(), EINR(root));
    assert.ok(r.out.includes(`OK Workflow ${doctor.WOCHENLAUF_PFAD}`));
    assert.equal(r.out.some((z) => z.startsWith("HINWEIS")), false);
  });

  test("ein frisches Projekt ohne .github/workflows: die Wochenlauf-Datei wird samt Ordner angelegt", () => {
    const root = neuerRoot();
    rmSync(join(root, ".github"), { recursive: true });
    const r = fahre(root, welt(), EINR(root));
    assert.equal(r.code, 0, r.out.join("\n"));
    assert.equal(readFileSync(datei(root), "utf8"), doctor.WOCHENLAUF_WORKFLOW);
  });

  test("Dry-Run auf vollständig eingerichtetem Stand: nichts geplant, Exit 0, keine PLAN-Zeile", () => {
    const root = neuerRoot();
    const w = welt(["status:steckt"]);
    fahre(root, w, EINR(root));
    const r = fahre(root, w, EINR(root, "--dry-run"));
    assert.equal(r.code, 0);
    assert.deepEqual(r.out.filter((z) => z.startsWith("PLAN")), []);
    assert.match(r.out.at(-1) ?? "", /: 0 angelegt, 0 geplant, 0 Anleitung\(en\), 0 Fehler$/);
  });

  test("das Label wird per POST an repos/<repo>/labels angelegt", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(["status:steckt", "forum"]), EINR(root));
    assert.deepEqual(r.schreibend, ["api -X POST repos/acme/demo/labels -f name=area:werk"]);
  });

  test("ein Sammelticket-Aufruf ohne Status und Ausgabe (Timeout) ist FEHLER „Exit ?“, ohne „undefined“", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(), EINR(root), null as unknown as number, null);
    assert.equal(r.code, 1);
    const z = r.out.find((x) => x.startsWith("FEHLER Sammelticket:")) ?? "";
    assert.match(z, /Exit \?/);
    assert.equal(r.out.some((x) => x.includes("undefined") || x.includes("null")), false);
  });

  test("ein fehlschlagendes Sammelticket ist FEHLER mit Exit 1", () => {
    const root = neuerRoot();
    const r = fahre(root, welt(), EINR(root), 1);
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("FEHLER Sammelticket:")));
  });

  test("fatales Token: weder Label noch Sammelticket, nur Anleitung", () => {
    const root = neuerRoot();
    const w = welt(["status:steckt"], { "api -i user": new Error("nicht angemeldet") });
    const r = fahre(root, w, EINR(root));
    assert.deepEqual(r.schreibend, []);
    assert.deepEqual(r.sammel, []);
    assert.ok(r.out.some((z) => z.startsWith("ANLEITUNG Token:") && z.includes("Link: https://")));
    assert.ok(r.out.some((z) => z.startsWith("ANLEITUNG Sammelticket:") && z.includes("Token-Punkt")));
    assert.equal(r.code, 1);
  });

  test("Aufruf-Fehler: kein Modus, beide Modi, --dry-run ohne --einrichten, unbekanntes Flag: Exit 2 ohne gh-Aufruf", () => {
    const root = neuerRoot();
    const cfg = ["--config", cfgPfad(root)];
    for (const argv of [cfg, ["--pruefen", "--einrichten", ...cfg], ["--pruefen", "--dry-run", ...cfg], ["--einrichten", "--bunt"]]) {
      const r = fahre(root, welt(), argv);
      assert.equal(r.code, 2, argv.join(" "));
      assert.match(r.err.join("\n"), /Aufruf: node scripts\/harness-doctor\.mjs/);
      assert.equal(r.ghAufrufe, 0);
    }
  });

  test("kaputte Config: Exit 2 mit Fix-Zeile, ohne gh- und Sammelticket-Aufruf", () => {
    const root = neuerRoot();
    writeFileSync(cfgPfad(root), "{kaputt");
    const r = fahre(root, welt(), EINR(root));
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /Fix:/);
    assert.equal(r.ghAufrufe, 0);
    assert.deepEqual(r.sammel, []);
  });
});
