/**
 * `--config <pfad>` an den Skripten der Ticket-Auswahl und des Spezifikations-Gates (#1860): ein kaputter oder fehlender Pfad endet mit
 * Exit 2 (✖, Schlüssel/Pfad, Fix-Zeile, kein Stacktrace) vor jedem I/O; eine gültige Config wird wirklich gelesen.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const WURZEL = join(__dirname, "..");
const ordner: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "kq-config-flag-"));
  ordner.push(d);
  return d;
};
afterAll(() => {
  for (const d of ordner) rmSync(d, { recursive: true, force: true });
});

const STUB = pathToFileURL(join(WURZEL, "test", "support", "gh-stub.mjs")).href;

/** Läuft offline: `gh` ist gestubbt (`rate_limit` voll, sonst `[]`), das Kosten-Log liegt im Temp-Ordner, nicht im Repo; `cwd` bestimmt, woran `git` arbeitet. */
const lauf = (args: string[], { cwd = WURZEL, env = {} }: { cwd?: string; env?: Record<string, string> } = {}) => {
  const log = join(tmp(), "kosten.jsonl");
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd,
    timeout: 30_000,
    env: { ...process.env, NODE_OPTIONS: `--import ${STUB}`, STUB_LEER: "1", FACTORY_GH_KOSTEN_LOG: log, GITHUB_ACTIONS: "", ...env }, // GITHUB_ACTIONS leer: unter Actions schreibt die Kostenmessung kein Log
  });
  return { status: r.status, text: `${r.stderr}${r.stdout}`, log };
};

const SKRIPTE: [string, string[]][] = [
  ["naechstes-ticket.mjs", []],
  ["spezifikation.mjs", ["pruefen", "--body-datei", "gibt-es-nicht.md"]],
  ["abnahme.mjs", ["kriterien", "1"]],
];

describe.each(SKRIPTE)("%s --config", { timeout: 60_000 }, (skript, rest) => {
  const aufruf = (...config: string[]) => [join(WURZEL, "scripts", skript), ...config, ...rest];

  test("kaputtes JSON: Exit 2, ✖, Pfad, Fix, kein Stacktrace", () => {
    const pfad = join(tmp(), "kaputt.json");
    writeFileSync(pfad, "{ nicht json");
    const r = lauf(aufruf("--config", pfad));
    expect(r.status, r.text).toBe(2);
    expect(r.text).toMatch(/✖/);
    expect(r.text).toContain("kaputt.json");
    expect(r.text).toMatch(/Fix:/);
    expect(r.text).not.toMatch(/^\s+at /m);
  });

  test("Config ohne Pflichtschlüssel: Exit 2 mit Fix", () => {
    const pfad = join(tmp(), "leer.json");
    writeFileSync(pfad, "{}");
    const r = lauf(aufruf("--config", pfad));
    expect(r.status, r.text).toBe(2);
    expect(r.text).toMatch(/Fix:/);
  });

  test("ungültige sprache in der übergebenen Config: Exit 2, ✖, sprache, Fix, kein Stacktrace", () => {
    const config = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as { sprache: Record<string, Record<string, unknown>> };
    config.sprache = {};
    const pfad = join(tmp(), "sprache.json");
    writeFileSync(pfad, JSON.stringify(config));
    const r = lauf(aufruf("--config", pfad));
    expect(r.status, r.text).toBe(2);
    expect(r.text).toMatch(/✖/);
    expect(r.text).toMatch(/sprache/);
    expect(r.text).toMatch(/Fix:/);
    expect(r.text).not.toMatch(/^\s+at /m);
  });

  test("nicht vorhandener Pfad: Exit 2 mit Pfad", () => {
    const r = lauf(aufruf("--config", join(tmp(), "fehlt.json")));
    expect(r.status, r.text).toBe(2);
    expect(r.text).toContain("fehlt.json");
  });

  test("--config ohne Pfad: Exit 2 mit Fix", () => {
    const r = lauf([join(WURZEL, "scripts", skript), ...rest, "--config"]);
    expect(r.status, r.text).toBe(2);
    expect(r.text).toMatch(/--config braucht einen Pfad/);
    expect(r.text).toMatch(/Fix:/);
  });
});

describe("gültige --config wird gelesen", { timeout: 60_000 }, () => {
  test("spezifikation pruefen nimmt den Zielabschnitt aus der übergebenen Config", () => {
    const d = tmp();
    const config = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as { sprache: Record<string, Record<string, unknown>> };
    config.sprache.spezifikation.ziel = "Zweckbestimmung";
    const pfad = join(d, "anders.json");
    writeFileSync(pfad, JSON.stringify(config));
    const body = join(d, "body.md");
    writeFileSync(body, "## Ziel\nx\n\n## Akzeptanzkriterien\n- [ ] a\n- [ ] Negativfall: b\n");
    const r = lauf([join(WURZEL, "scripts", "spezifikation.mjs"), "pruefen", "--body-datei", body, "--config", pfad]);
    expect(r.status, r.text).toBe(1);
    expect(r.text).toContain("Zweckbestimmung");
    const mitRepoConfig = lauf([join(WURZEL, "scripts", "spezifikation.mjs"), "pruefen", "--body-datei", body]);
    expect(mitRepoConfig.text).not.toContain("Zweckbestimmung");
  });

  test("abnahme kriterien nimmt den Abschnittsnamen der Kriterien aus der übergebenen Config", () => {
    const d = tmp();
    const config = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as { repo: string; sprache: Record<string, Record<string, unknown>> };
    config.sprache.spezifikation.akzeptanzkriterien = ["Abnahmepunkte"];
    const pfad = join(d, "anders.json");
    writeFileSync(pfad, JSON.stringify(config));
    const issue = JSON.stringify({ number: 1, title: "T", state: "open", user: { login: config.repo.split("/")[0], type: "User" }, labels: [], body: "## Abnahmepunkte\n- [ ] erstes\n- [ ] Negativfall: zweites\n" });
    const mitStub = (...extra: string[]) => lauf([join(WURZEL, "scripts", "abnahme.mjs"), "kriterien", "1", ...extra], { env: { STUB_ISSUE: issue } }).text;
    expect(mitStub("--config", pfad)).toMatch(/^K1: erstes$/m);
    expect(mitStub()).toContain("Keine Akzeptanzkriterien");
  });

  test("naechstes-ticket --ticket nimmt den Zielabschnitt aus der übergebenen Config", () => {
    const d = tmp();
    const config = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as { repo: string; sprache: Record<string, Record<string, unknown>> };
    config.sprache.spezifikation.ziel = "Zweckbestimmung";
    const pfad = join(d, "anders.json");
    writeFileSync(pfad, JSON.stringify(config));
    const issue = JSON.stringify({
      number: 1,
      title: "T",
      state: "open",
      user: { login: config.repo.split("/")[0], type: "User" },
      labels: [],
      assignees: [],
      body: "## Ziel\nx\n## Akzeptanzkriterien\n- [ ] a\n- [ ] Negativfall: b\n",
    });
    // `git` arbeitet in einem leeren Temp-Repo: kein `fetch` gegen das echte `origin`, keine echten Refs und Worktrees.
    const git = tmp();
    expect(spawnSync("git", ["init", "-q"], { cwd: git }).status).toBe(0);
    const mitStub = (...extra: string[]) => lauf([join(WURZEL, "scripts", "naechstes-ticket.mjs"), "--ticket", "1", ...extra], { cwd: git, env: { STUB_ISSUE: issue } });
    const mit = mitStub("--config", pfad);
    expect(mit.status, mit.text).toBe(1);
    expect(mit.text).toContain("`## Zweckbestimmung` fehlt");
    const ohne = mitStub();
    expect(ohne.status, ohne.text).toBe(0);
    expect(ohne.text).not.toContain("Zweckbestimmung");
  });
});

describe("Läufe sind offline und fassen das echte Kosten-Log nicht an", { timeout: 60_000 }, () => {
  test("ein gültiger Lauf schreibt nur in das Temp-Log; das Standard-Log bleibt unverändert", () => {
    const config = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as { repo: string };
    const standard = join(tmpdir(), `${config.repo.split("/")[1]}-gh-kosten.jsonl`);
    const vorher = existsSync(standard) ? statSync(standard).size : -1;
    const r = lauf([join(WURZEL, "scripts", "naechstes-ticket.mjs"), "--ticket", "1"], { cwd: tmp(), env: { STUB_ISSUE: JSON.stringify({ number: 1, title: "T", state: "closed", user: { login: "x", type: "User" }, labels: [], assignees: [], body: "" }) } });
    expect(r.text).not.toMatch(/gh gestubbt, kein Netz/);
    expect(existsSync(r.log), "Kostenmessung schreibt in das Temp-Log").toBe(true);
    expect(existsSync(standard) ? statSync(standard).size : -1).toBe(vorher);
  });
});
