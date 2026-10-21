/* Wächter: jedes `gh issue list` / `gh pr list` trägt `--limit` (#1787 L7).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Warum: ohne `--limit` liefert `gh … list` nur 30 Treffer; bei mehr offenen Issues (Duplikat-Suche der Inbox-Workflows,
 * Festgefahren-Prüfung) fehlt der gesuchte Treffer still, und es entstehen Duplikate. Geprüft werden alle Workflows unter
 * .github/workflows (Fortsetzungszeilen mit `\` zusammengefügt) und die Skripte unter scripts/ (Argument-Arrays mit `"issue", "list"`
 * bzw. `"pr", "list"`).
 *
 * Bewusste Grenzen: nur diese beiden Aufrufformen; ein `--limit` in einem anderen Befehl derselben zusammengefügten Zeile
 * (Pipe, `&&`) zählt mit, und das Limit selbst wird nicht auf Sinnhaftigkeit geprüft. `gh api` hat eine eigene Grenze
 * (`--paginate`) und ist nicht Teil dieser Regel. Gelesen wird `scripts/` rekursiv; erkannt werden Argument-Arrays mit einfachen oder doppelten Anführungszeichen und Befehls-Strings `gh issue|pr list` auf Nicht-Kommentarzeilen (je Zeile bewertet: steht das Limit erst auf einer Folgezeile, ist das ein Fund); dynamisch zusammengesetzte Argumente (`["issue", sub]`) sieht er nicht. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const WURZEL = process.cwd();

/** Alle Skriptdateien unter scripts/ samt Unterordnern (relativ zu scripts/); der Test unten prüft genau diese Liste. */
function skriptDateien(): string[] {
  return readdirSync(join(WURZEL, "scripts"), { recursive: true, encoding: "utf8" }).filter((n) => /\.(mjs|cjs|js)$/.test(n));
}

/** Pur: Zeilen eines Workflow-Texts mit `gh issue|pr list` ohne `--limit` (Fortsetzungszeilen mit `\` zusammengefügt). */
function ohneLimitImWorkflow(text: string): string[] {
  const zusammen = text.replace(/\\\r?\n\s*/g, " ");
  return zusammen.split(/\r?\n/).filter((z) => /\bgh\s+(issue|pr)\s+list\b/.test(z) && !/--limit\b/.test(z)).map((z) => z.trim());
}

/** Pur: Argument-Arrays in Skripten mit `"issue", "list"` bzw. `"pr", "list"` ohne `"--limit"` (bis zum schließenden `])`). */
function ohneLimitImSkript(text: string): string[] {
  const aus: string[] = [];
  const re = /["'](?:issue|pr)["'],\s*["']list["']/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const ende = text.indexOf("])", m.index);
    const aufruf = text.slice(m.index, ende === -1 ? undefined : ende);
    if (!/["']--limit["']/.test(aufruf)) aus.push(aufruf.replace(/\s+/g, " ").trim());
  }
  for (const zeile of text.split(/\r?\n/)) {
    if (/^\s*(\*|\/\/|\/\*)/.test(zeile)) continue;
    if (/\bgh\s+(issue|pr)\s+list\b/.test(zeile) && !/--limit\b/.test(zeile)) aus.push(zeile.trim());
  }
  return aus;
}

describe("gh list: Fixtures (Red-Green der Prüfer)", () => {
  test("Workflow: ohne --limit ist ein Fund, auch bei Fortsetzungszeile; mit --limit (auch weiter unten) nicht", () => {
    expect(ohneLimitImWorkflow('x=$(gh issue list --repo "$R" --state open)')).toHaveLength(1);
    expect(ohneLimitImWorkflow('x=$(gh pr list --repo "$R" \\\n  --json number)')).toHaveLength(1);
    expect(ohneLimitImWorkflow('x=$(gh issue list --repo "$R" \\\n  --limit 1000 --json number)')).toEqual([]);
    expect(ohneLimitImWorkflow('gh issue close 5 --repo "$R"')).toEqual([]);
  });
  test("Skript: Array ohne \"--limit\" ist ein Fund, mit Limit nicht", () => {
    expect(ohneLimitImSkript('ghJson(["issue", "list", "--state", "open"])')).toHaveLength(1);
    expect(ohneLimitImSkript('ghJson([\n  "pr", "list",\n  "--state", "open",\n  "--json", "number",\n])')).toHaveLength(1);
    expect(ohneLimitImSkript('ghJson(["issue", "list", "--limit", "200"])')).toEqual([]);
    expect(ohneLimitImSkript('ghJson([\n  "pr", "list",\n  "--limit", "1000",\n])')).toEqual([]);
    expect(ohneLimitImSkript('ghJson(["issue", "view", "3"])')).toEqual([]);
  });
  test("Skript: einfache Anführungszeichen und Befehls-Strings sind Funde, Limit und Kommentarzeilen nicht", () => {
    expect(ohneLimitImSkript("ghJson(['issue', 'list', '--state', 'open'])")).toHaveLength(1);
    expect(ohneLimitImSkript("ghJson(['pr', 'list', '--limit', '50'])")).toEqual([]);
    expect(ohneLimitImSkript("ghJson(['pr', 'list', \"--limit\", '50'])")).toEqual([]);
    expect(ohneLimitImSkript("execSync(`gh pr list --state open`)")).toHaveLength(1);
    expect(ohneLimitImSkript('execSync("gh issue list --state open")')).toHaveLength(1);
    expect(ohneLimitImSkript("execSync(`gh pr list --limit 100 --state open`)")).toEqual([]);
    expect(ohneLimitImSkript(" * Doku: gh pr list zeigt offene PRs")).toEqual([]);
    expect(ohneLimitImSkript("// gh issue list --state open")).toEqual([]);
    expect(ohneLimitImSkript("/* gh issue list */")).toEqual([]);
  });
});

describe("gh list: jeder Aufruf im Repo trägt --limit (#1787 L7)", () => {
  const wfDir = join(WURZEL, ".github", "workflows");
  const workflows = readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n));

  test("es gibt Workflows mit gh list zu prüfen (kein leerer Lauf)", () => {
    expect(workflows.some((n) => /\bgh\s+(issue|pr)\s+list\b/.test(readFileSync(join(wfDir, n), "utf8")))).toBe(true);
  });

  test("Workflows: kein gh issue/pr list ohne --limit", () => {
    const fehler = workflows.flatMap((n) => ohneLimitImWorkflow(readFileSync(join(wfDir, n), "utf8")).map((z) => `${n}: ${z}`));
    expect(fehler).toEqual([]);
  });

  test("scripts/: die Dateiliste des Tests enthält auch Unterordner (docs-gen)", () => {
    expect(skriptDateien().some((n) => /[\\/]/.test(n))).toBe(true);
  });

  test("scripts/: kein \"issue\"/\"pr\", \"list\" ohne \"--limit\"", () => {
    const dir = join(WURZEL, "scripts");
    const dateien = skriptDateien();
    const fehler = dateien.flatMap((n) => ohneLimitImSkript(readFileSync(join(dir, n), "utf8")).map((z) => `${n}: ${z}`));
    expect(fehler).toEqual([]);
  });
});
