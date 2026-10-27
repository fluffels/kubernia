/* Factory-Link-Wächter (#1966, ADR 0022 F10): Links ins Factory-Repo stehen auf dem Sync-Tag und zeigen auf Pfade und Anker, die es dort gibt.
 *
 * @harness-waechter – Projekt-Test: das Skript ist (noch) Projekt-Gate in kubernia; die Lebendigkeitsprobe unten prüft die echte Doku dieses Repos. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "vitest";
import { SCHNAPPSCHUSS_ENDE as ENTFERNT_ENDE, SCHNAPPSCHUSS_START as ENTFERNT_START } from "../support/entfernte-pfade";
import { fixture } from "../support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-factory-links.mjs";

interface Stelle { start: number; ende: number; zeile: number; url: string; form: string; ref: string; pfad: string; anker: string; refStart: number }
interface Befund { art: string; datei?: string; zeile?: number; text: string }
const lib = raw as unknown as {
  SCHNAPPSCHUSS_START: string;
  SCHNAPPSCHUSS_ENDE: string;
  factoryLinkStellen(md: string, repo: string): Stelle[];
  sammleLinks(root: string, o: { repo: string; einheiten?: string[] }): (Stelle & { datei: string })[];
  pruefeIndex(o: { links: unknown[]; index: unknown; sync: unknown; repo: string }): Befund[];
  auditFactoryLinks(root: string): { befunde: Befund[]; links: unknown[] };
  schreibeFactoryLinks(root: string, quelle: string): { befunde: Befund[]; geschrieben: number };
  cli(argv: string[], o: { wurzel: string; out: (s: string) => void; err: (s: string) => void }): number;
};

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const REPO = "o/f";
const u = (ref: string, pfad: string, anker = "", form = "blob") => `https://github.com/${REPO}/${form}/${ref}/${pfad}${anker ? `#${anker}` : ""}`;
const run = (argv: string[], wurzel: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = lib.cli(argv, { wurzel, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("factoryLinkStellen: Scan-Umfang (AK4)", () => {
  const stellen = (md: string) => lib.factoryLinkStellen(md, REPO);

  test("erfasst Inline-Link, Bild, spitze Klammern und Autolink mit Ref, Pfad und Anker", () => {
    const md = [`[t](${u("v1", "a.md", "kopf")})`, `![b](${u("v1", "bild.png")})`, `[t](<${u("v1", "b.md")}>)`, `<${u("v1", "c.md")}>`].join("\n");
    const s = stellen(md);
    assert.deepEqual(s.map((x) => [x.form, x.ref, x.pfad, x.anker, x.zeile]), [["blob", "v1", "a.md", "kopf", 1], ["blob", "v1", "bild.png", "", 2], ["blob", "v1", "b.md", "", 3], ["blob", "v1", "c.md", "", 4]]);
    assert.equal(md.slice(s[0].refStart, s[0].refStart + 2), "v1");
    assert.equal(md.slice(s[0].start, s[0].ende), s[0].url);
  });
  test("tree-Link ist ein tree; Repo-Name ohne Beachtung der Groß-/Kleinschreibung; Pfad und Anker werden dekodiert", () => {
    const s = stellen(`[a](https://github.com/O/F/tree/v1/test/h)\n[b](${u("v1", "d%20e.md", "k%C3%A4se")})`);
    assert.deepEqual(s.map((x) => [x.form, x.pfad, x.anker]), [["tree", "test/h", ""], ["blob", "d e.md", "käse"]]);
  });
  test("nicht erfasst: Code-Fence, Inline-Code, nackte URL, Referenz-Link, Issues, Pull, Wurzel", () => {
    const md = [
      "```", `[t](${u("v1", "a.md")})`, "```",
      `\`[t](${u("v1", "a.md")})\``,
      u("v1", "a.md"),
      `[t][r]\n\n[r]: ${u("v1", "a.md")}`,
      `[i](https://github.com/${REPO}/issues/5)`, `[p](https://github.com/${REPO}/pull/6)`,
      `[w](https://github.com/${REPO})`, `[w2](https://github.com/${REPO}/)`,
      `[fremd](https://github.com/${REPO}x/blob/v1/a.md)`, `[andere](https://github.com/anderer/repo/blob/v1/a.md)`,
    ].join("\n");
    assert.deepEqual(stellen(md), []);
  });
  test("jede andere URL auf das Repo ist `fremd` (rot statt ungeprüft)", () => {
    const s = stellen(`[c](https://github.com/${REPO}/commit/abc123)\n[b](https://github.com/${REPO}/blob/v1)`);
    assert.deepEqual(s.map((x) => x.form), ["fremd", "fremd"]);
  });
  test("ein Autolink in `[t](<url>)` zählt nur einmal", () => {
    assert.equal(stellen(`[t](<${u("v1", "a.md")}>)`).length, 1);
  });
});

describe("sammleLinks: Ausnahmen (AK4)", () => {
  const eintrag = `[x](${u("v0", "a.md")})`;
  const root = () =>
    fixture({
      "docs/x.md": eintrag,
      "docs/adr/x.md": eintrag,
      "docs/lessons-learned.md": eintrag,
      "docs/a-gegenprobe-b.md": eintrag,
      "docs/s.md": `${lib.SCHNAPPSCHUSS_START}\n${eintrag}\n${lib.SCHNAPPSCHUSS_ENDE}\n${eintrag}`,
      "AGENTS.md": "<!-- factory-besitz:start kern -->\n" + eintrag + "\n<!-- factory-besitz:ende kern -->\n" + eintrag,
      "docs/ganz.md": eintrag,
    });

  test("ADRs, Lessons Learned, Gegenproben, Schnappschuss-Block, Besitz-Block und Besitz-Datei bleiben unerfasst; der Rest zählt", () => {
    const links = lib.sammleLinks(root(), { repo: REPO, einheiten: ["AGENTS.md#kern", "docs/ganz.md", ".claude/settings.json#/hooks"] });
    assert.deepEqual(links.map((l) => `${l.datei}:${l.zeile}`).sort(), ["AGENTS.md:4", "docs/s.md:4", "docs/x.md:1"]);
  });
  test("derselbe Link direkt nach dem Block-Ende wird erfasst (Gegenprobe)", () => {
    const links = lib.sammleLinks(root(), { repo: REPO, einheiten: ["AGENTS.md#kern"] });
    assert.ok(links.some((l) => l.datei === "AGENTS.md" && l.zeile === 4));
  });
  test("die Schnappschuss-Marker sind dieselben wie die des Reste-Wächters", () => {
    assert.equal(lib.SCHNAPPSCHUSS_START, ENTFERNT_START);
    assert.equal(lib.SCHNAPPSCHUSS_ENDE, ENTFERNT_ENDE);
  });
});

describe("Prüfmodus (AK1, AK3)", () => {
  const tagLinks = (ref: string, extra = "") => `[a](${u(ref, "a.md", "kopf")})\n[b](${u(ref, "test/h", "", "tree")})\n${extra}`;
  const indexJson = (tag: string, commit: string, ziele: Record<string, string[]>) => JSON.stringify({ repo: REPO, tag, commit, ziele });
  const projekt = (doku: string, index: string | null, sync = { tag: "v1", commit: "c1" }) =>
    fixture({
      ".factory/projekt.json": JSON.stringify({ boards: [{ rolle: "factory", repo: REPO }] }),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { ...sync, sauber: true }, einheiten: {} }),
      ...(index === null ? {} : { ".factory/factory-links.json": index }),
      "docs/x.md": doku,
    });
  const gut = () => indexJson("v1", "c1", { "a.md": ["kopf"], "test/h": [""] });
  const arten = (root: string) => lib.auditFactoryLinks(root).befunde.map((b) => b.art).sort();

  test("grün: Ref = Sync-Tag, alle Paare im Index, nichts verwaist, Beispiel-Link im Code-Fence ignoriert", () => {
    const root = projekt(tagLinks("v1", "```\n" + `[x](${u("v0", "tot.md")})\n` + "```"), gut());
    assert.deepEqual(lib.auditFactoryLinks(root).befunde, []);
    assert.equal(run([], root).code, 0);
  });
  test("rot: Ref ungleich Sync-Tag, mit Datei:Zeile und Fix-Befehl", () => {
    const root = projekt(tagLinks("v0"), gut());
    const r = run([], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/x\.md:1: \[ref\]/);
    assert.match(r.err, /check:factorylinks -- --schreiben --quelle/);
  });
  test("rot: Link außerhalb des Index (anderer Anker)", () => {
    assert.deepEqual(arten(projekt(`[a](${u("v1", "a.md", "andere")})\n[b](${u("v1", "test/h", "", "tree")})`, gut())), ["nicht-im-index", "verwaist"]);
  });
  test("rot: verwaister Index-Eintrag, Exit 1 mit Liste", () => {
    const root = projekt(tagLinks("v1"), indexJson("v1", "c1", { "a.md": ["kopf"], "test/h": [""], "tot.md": [""] }));
    assert.deepEqual(arten(root), ["verwaist"]);
    const r = run([], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /tot\.md wird von keinem Link genutzt/);
  });
  test("rot: Index-Tag ungleich Sync-Tag und Index-Commit ungleich Sync-Commit", () => {
    assert.deepEqual(arten(projekt(tagLinks("v1"), indexJson("v0", "c1", { "a.md": ["kopf"], "test/h": [""] }))), ["index-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), indexJson("v1", "c0", { "a.md": ["kopf"], "test/h": [""] }))), ["index-stand"]);
  });
  test("rot: Index fehlt, Sync-Stand ohne Tag, fremde URL-Form", () => {
    assert.deepEqual(arten(projekt(tagLinks("v1"), null)), ["index-fehlt"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), gut(), { tag: "", commit: "" })), ["sync-stand"]);
    assert.deepEqual(arten(projekt(`[c](https://github.com/${REPO}/commit/abc)`, indexJson("v1", "c1", {}))), ["form"]);
  });
  test("pruefeIndex ohne Link und ohne Eintrag ist grün", () => {
    assert.deepEqual(lib.pruefeIndex({ links: [], index: { repo: REPO, tag: "v1", commit: "c1", ziele: {} }, sync: { quelle: { tag: "v1", commit: "c1" } }, repo: REPO }), []);
  });
  test("Aufruf: --quelle ohne --schreiben und umgekehrt sind Exit 2", () => {
    const root = projekt(tagLinks("v1"), gut());
    assert.equal(run(["--quelle", "x"], root).code, 2);
    assert.equal(run(["--schreiben"], root).code, 2);
    assert.equal(run(["--gibtsnicht"], root).code, 2);
  });
});

describe("Schreibmodus e2e mit temporärem Git-Repo als Quelle (AK2, AK3)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
  /** Klon-Attrappe: a.md mit Überschrift, test/x.test.ts, Ordner test/h/, Tag v9 auf dem einzigen Commit. */
  const klon = (tag = "v9") => {
    const d = mkdtempSync(join(tmpdir(), "flinks-"));
    dirs.push(d);
    git(d, "init", "-q");
    mkdirSync(join(d, "test", "h"), { recursive: true });
    writeFileSync(join(d, "a.md"), "# Kopf\n\ntext\n");
    writeFileSync(join(d, "test", "x.test.ts"), "x");
    writeFileSync(join(d, "test", "h", "y.txt"), "y");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "c");
    if (tag) git(d, "tag", tag);
    return { dir: d, commit: git(d, "rev-parse", "HEAD") };
  };
  const projekt = (doku: string, commit: string) =>
    fixture({
      ".factory/projekt.json": JSON.stringify({ boards: [{ rolle: "factory", repo: REPO }] }),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v9", commit, sauber: true }, einheiten: {} }),
      "docs/x.md": doku,
    });
  const lies = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
  const existiert = (root: string, rel: string) => {
    try {
      readFileSync(join(root, rel));
      return true;
    } catch {
      return false;
    }
  };

  test("Glücksfall: Refs auf den Tag, Index geschrieben, danach Prüfmodus grün; tree als Ordner-Präfix, Zeilenenden bleiben", () => {
    const k = klon();
    const doku = `[a](${u("v1", "a.md", "kopf")}) und [t](${u("v1", "test/x.test.ts")})\r\n[o](${u("v1", "test/h", "", "tree")})\r\n`;
    const root = projekt(doku, k.commit);
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(root, "docs/x.md"), doku.replaceAll("/v1/", "/v9/"));
    assert.equal(
      lies(root, ".factory/factory-links.json"),
      `{\n  "repo": "o/f",\n  "tag": "v9",\n  "commit": "${k.commit}",\n  "ziele": {\n    "a.md": ["kopf"],\n    "test/h": [""],\n    "test/x.test.ts": [""]\n  }\n}\n`,
    );
    assert.equal(run([], root).code, 0);
  });
  test("toter Anker: rot, Doku byte-gleich, kein Index", () => {
    const k = klon();
    const doku = `[a](${u("v1", "a.md", "gibts-nicht")})\n`;
    const root = projekt(doku, k.commit);
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /\[anker-tot\]/);
    assert.equal(lies(root, "docs/x.md"), doku);
    assert.equal(existiert(root, ".factory/factory-links.json"), false);
  });
  test("toter Pfad und tree auf nicht vorhandenen Ordner: rot, nichts geschrieben", () => {
    const k = klon();
    const doku = `[a](${u("v1", "weg.md")})\n[b](${u("v1", "test/nix", "", "tree")})\n`;
    const root = projekt(doku, k.commit);
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 1);
    assert.equal(r.err.match(/\[pfad-tot\]/g)?.length, 2);
    assert.equal(lies(root, "docs/x.md"), doku);
    assert.equal(existiert(root, ".factory/factory-links.json"), false);
  });
  test("Tag zeigt auf einen anderen Commit als der Sync-Stand: rot", () => {
    const k = klon();
    const root = projekt(`[a](${u("v1", "a.md")})\n`, "0".repeat(40));
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /\[tag-commit\]/);
    assert.equal(existiert(root, ".factory/factory-links.json"), false);
  });
  test("Tag fehlt in der Quelle: rot", () => {
    const k = klon("");
    const root = projekt(`[a](${u("v1", "a.md")})\n`, k.commit);
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /\[quelle\]/);
  });
  test("Anker bei Nicht-Markdown-Ziel und bei tree wird nicht geprüft", () => {
    const k = klon();
    const root = projekt(`[a](${u("v1", "test/x.test.ts", "L10")})\n`, k.commit);
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
  });
});

describe("Lebendigkeit: die echte Doku dieses Repos", () => {
  test("keine Befunde und mindestens ein erfasster Link", () => {
    const { befunde, links } = lib.auditFactoryLinks(WURZEL);
    assert.deepEqual(befunde, []);
    assert.ok(links.length >= 1);
  });
});
