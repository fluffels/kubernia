/* Diff-Basis-Wächter (#1108) – Harness-Texte lehren NUR den Drei-Punkt-Diff gegen `origin/main`.
 *
 * In #1095 und #1105 stand in Harness-Texten jeweils ein Zwei-Punkt-Diff `git diff … main` gegen ein
 * womöglich veraltetes LOKALES `main`. Dabei zählen fremde main-Commits mit: der Review sieht Zeilen,
 * die gar nicht zum Slice gehören, und `beruehrtHarness`-artige Entscheidungen kippen. Beide Stellen
 * wurden von Hand gefunden – dieser Wächter macht das maschinell. Kanonisch ist die Form, die auch
 * `check:diffsize`/`check:diffcoverage` messen: `git diff origin/main...HEAD` (Begründung:
 * docs/agent-harness.md § 2.5 und `.claude/skills/review-lenses/SKILL.md`).
 *
 * Regel: jeder `git diff`-Aufruf, der ein bares `main` als Revision nennt und NICHT `origin/main...`
 * enthält, ist rot. Bewusste Auslegungen:
 *   - Auch `git diff main...HEAD` ist rot: ohne `origin/` hängt die Merge-Base am veralteten lokalen
 *     Stand. Eine einzige Form, die alle Texte lehren.
 *   - `git diff origin/main HEAD` / `origin/main..HEAD` (Zwei-Punkt gegen die FRISCHE Remote-Ref) wird
 *     bewusst noch nicht erfasst – milderer Fehler, nachrüstbar über `BARES_MAIN`, ohne das Prädikat
 *     umzubauen.
 *   - Ein Aufruf endet am nächsten Backtick, Zeilenende oder Shell-Trenner (`;`, `&`, `|`). Der
 *     Backtick ist der entscheidende Terminator: sonst zöge Markdown-Inline-Code die nachfolgende
 *     Prosa (mit dem Wort „main") mit. Die Shell-Trenner verhindern, dass ein kanonischer Aufruf
 *     einen falschen in derselben Zeile maskiert (`git diff origin/main...HEAD && git diff main`).
 *   - Globale git-Optionen vor `diff` zählen mit (`git -C <pfad> diff main`, `git --no-pager diff`).
 *   - `main` zählt nur als Revision: `main.ts` oder `main/x` sind Pfade, keine Treffer.
 *   - Konservativ rot (harmlos in dieser Richtung): Prosa hinter einem Aufruf in derselben Zeile, die
 *     „main" nennt, und `git diff $(git merge-base HEAD main)` – in Harness-Texten gilt nur eine Form.
 *   - Bekannte Lücke: ein Aufruf, der MITTEN im Argument umbricht (`git diff --name-only⏎main`, auch
 *     per `\`-Fortsetzung), wird nicht erkannt – die Erkennung ist zeilenweise, damit Zeilennummern
 *     und Terminatoren eindeutig bleiben. Heute steht keine solche Stelle in den Texten.
 *
 * ⚠️ Code-Fences werden bewusst NICHT gestrippt (anders als `claude-bridge.test.ts`): die
 * kanonischen Kommandos stehen gerade IN ```bash-Fences – genau die soll der Wächter bewachen.
 *
 * Historische Gegenbeispiele (Prosa, die erklärt, WARUM Zwei-Punkt falsch ist) sind erlaubt – aber
 * nur namentlich, begründet und mit EXAKTER Anzahl. Keine Zeilennummern als Schlüssel (driften bei
 * jeder Bearbeitung). Eine zusätzliche Stelle in derselben Datei ist rot, ein verschwundenes
 * Gegenbeispiel ebenso (stale – Eintrag entfernen/anpassen, Ratchet nur in die strenge Richtung).
 *
 * Scan-Umfang: ALLE Dateien der versionierten `.claude`-Ordner (SSOT `VERSIONED_CLAUDE_DIRS` aus
 * scripts/check-docdrift.mjs – ein neuer versionierter Ordner ist damit automatisch drin, egal mit
 * welcher Endung), `.claude/settings.json` (Hook-Kommandos), `docs/agent-harness*.md` und die
 * Root-Kontextdateien. Nicht gescannt: `scripts/**` (dort ist `merge-base … main` ein dokumentierter,
 * korrekter Fallback für flache Checkouts in `check-diffsize.mjs`), `test/**` (Fixtures tragen per
 * Definition beide Formen) und `.github/workflows/*.yml` (diffen gegen SHA-Variablen, kein literales
 * `main`; die Diff-Basis des Goodhart-Guards bewacht `test/harness-approval.test.ts`).
 *
 * Wie in `review-context.test.ts` (#1034) läuft das Prädikat als EINE benannte Funktion über das
 * echte Artefakt UND über Gegenbeispiele, die rot sein MÜSSEN – kein abgeschriebener Zweit-Regex.
 *
 * Fitness-Function-Kategorie neben claude-bridge/harness-approval/review-context. Bewusst **ohne**
 * eigenes `scripts/check-*.mjs`: `scripts/check-` ist selbst gate-config-geschützt (Goodhart-Guard).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File – wie in claude-bridge.test.ts.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../scripts/check-docdrift.mjs";

// Begründete Ausnahme wie in claude-bridge.test.ts: der Namespace des .mjs ist für tsc
// „error typed"; eng begrenzter Inline-Disable statt Gate-Config anzufassen.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const VERSIONED_CLAUDE_DIRS: Set<string> = checkDocDrift.VERSIONED_CLAUDE_DIRS;

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, "utf8");

/** Ein git-diff-Aufruf samt globaler Optionen und Argumenten; Backtick, Zeilenende und
 *  Shell-Trenner beenden ihn. */
const AUFRUF = /\bgit(?:\s+(?:-C\s+\S+|--?[\w-]+))*\s+diff\b[^\n`;&|]*/g;
/** Kanonische Form: Drei-Punkt gegen die frisch geholte Remote-Ref. */
const KANONISCH = /\borigin\/main\.\.\./;
/** `main` als bare Revision – `origin/main`, `feature/main-x`, `main.ts`, `main/x` zählen NICHT;
 *  `main..HEAD`/`main...HEAD` schon. */
const BARES_MAIN = /(?<![\w/-])main(?![\w/-]|\.\w)/;

type Treffer = { zeile: number; aufruf: string };

/** Alle `git diff`-Aufrufe in `text`, die gegen ein bares lokales `main` diffen. */
function findeZweiPunktTreffer(text: string): Treffer[] {
  const treffer: Treffer[] = [];
  text.split(/\r?\n/).forEach((zeile, i) => {
    for (const [aufruf] of zeile.matchAll(AUFRUF)) {
      if (BARES_MAIN.test(aufruf) && !KANONISCH.test(aufruf)) treffer.push({ zeile: i + 1, aufruf: aufruf.trim() });
    }
  });
  return treffer;
}

/** Erlaubte historische Gegenbeispiele: Datei → exakte Trefferzahl + Begründung. */
const ERLAUBTE_GEGENBEISPIELE: { datei: string; anzahl: number; grund: string }[] = [
  {
    datei: ".claude/skills/review-lenses/SKILL.md",
    anzahl: 2,
    grund:
      "Historische Gegenbeispiele: die Absätze „Warum Drei-Punkt“ und „Erst committen“ erklären, " +
      "WARUM der Zwei-Punkt-Diff gegen lokales main falsch ist (#1034). Wegkürzen wäre ein Verlust.",
  },
];

// ── Scan-Umfang ─────────────────────────────────────────────────────────────────
// Verzeichnis-Scan statt fester Dateiliste: jeder neue Skill/Workflow/Agent ist automatisch drin –
// mit jeder Endung, weil ein Hilfsskript (.sh/.mjs) den Aufruf genauso ausführbar trägt.
function dateienUnter(rel: string): string[] {
  if (!existsSync(ROOT + rel)) return [];
  return readdirSync(ROOT + rel).flatMap((name) => {
    const pfad = `${rel}/${name}`;
    return statSync(ROOT + pfad).isDirectory() ? dateienUnter(pfad) : [pfad];
  });
}

const SCAN = [
  ...[...VERSIONED_CLAUDE_DIRS].flatMap((dir) => dateienUnter(`.claude/${dir}`)),
  ".claude/settings.json",
  ...readdirSync(ROOT + "docs")
    .filter((n) => n.startsWith("agent-harness") && n.endsWith(".md"))
    .map((n) => `docs/${n}`),
  "AGENTS.md",
  "CLAUDE.md",
].filter((rel) => existsSync(ROOT + rel));

describe("Prädikat findeZweiPunktTreffer (#1108)", () => {
  test.each([
    "git diff main",
    "git diff --name-only main",
    "git diff --stat main",
    "git diff main --stat",
    "git diff main..HEAD",
    "git diff HEAD..main",
    "git diff abc123..main",
    "git diff main...HEAD",
    "Führe `git diff main` aus",
    "```bash\ngit diff --name-only main\n```",
    "git -C .claude/worktrees/kq-1 diff main",
    "git --no-pager diff --stat main",
    // Ein kanonischer Aufruf davor darf den falschen hinter dem Shell-Trenner nicht maskieren.
    "git diff origin/main...HEAD --stat && git diff --name-only main",
    "git diff origin/main...HEAD; git diff main",
    "git diff origin/main...HEAD | cat; git diff HEAD..main",
  ])("meldet %j", (text) => {
    assert.equal(findeZweiPunktTreffer(text).length, 1);
  });

  test.each([
    "git diff origin/main...HEAD",
    "git diff --name-only origin/main...HEAD",
    "git diff --stat origin/main...HEAD -- src/",
    "git diff HEAD~1",
    "git diff feature/main-x",
    "git diff -- main.ts",
    "git diff HEAD~1 -- src/main.ts main/x",
    "git -C .claude/worktrees/kq-1 diff origin/main...HEAD",
    // Kanonischer Aufruf im Fence mit Shell-Kommentar, der „main" nennt – die KANONISCH-Ausnahme.
    "```bash\ngit diff origin/main...HEAD   # nicht gegen lokales main\n```",
    // Nachbau von review-lenses/SKILL.md: kanonischer Inline-Code, danach Prosa mit „main".
    "Diff per `git diff origin/main...HEAD` – nicht gegen das lokale main, das veraltet sein kann.",
    "Wir mergen nach main, danach `git diff HEAD~1`.",
  ])("meldet NICHT %j", (text) => {
    assert.deepEqual(findeZweiPunktTreffer(text), []);
  });

  test("zählt mehrere Aufrufe einer Zeile getrennt und liefert die Zeilennummer", () => {
    assert.deepEqual(findeZweiPunktTreffer("ok\n`git diff main` und `git diff HEAD..main`"), [
      { zeile: 2, aufruf: "git diff main" },
      { zeile: 2, aufruf: "git diff HEAD..main" },
    ]);
  });
});

describe("Harness-Texte diffen nur gegen origin/main... (#1108)", () => {
  test("Scan-Umfang ist nicht leer und enthält die bekannten Artefakte", () => {
    for (const pflicht of [
      ".claude/workflows/kubernia-ticket.js",
      ".claude/skills/review-lenses/SKILL.md",
      ".claude/agents/kubernia-planner.md",
      "docs/agent-harness.md",
      "AGENTS.md",
    ]) {
      assert.ok(SCAN.includes(pflicht), `${pflicht} fehlt im Scan-Umfang`);
    }
  });

  test.each(SCAN)("%s hat keinen unerlaubten Zwei-Punkt-Diff gegen main", (datei) => {
    const treffer = findeZweiPunktTreffer(read(datei));
    const erlaubt = ERLAUBTE_GEGENBEISPIELE.find((e) => e.datei === datei)?.anzahl ?? 0;
    const liste = treffer.map((t) => `  ${datei}:${t.zeile}  ${t.aufruf}`).join("\n");
    assert.ok(
      treffer.length <= erlaubt,
      `Zwei-Punkt-Diff gegen lokales main – auf \`git diff origin/main...HEAD\` umstellen:\n${liste}`,
    );
    assert.equal(
      treffer.length,
      erlaubt,
      `ERLAUBTE_GEGENBEISPIELE für ${datei} ist stale (erwartet ${erlaubt}, gefunden ${treffer.length}) – Eintrag anpassen/entfernen`,
    );
  });

  test("jedes erlaubte Gegenbeispiel zeigt auf eine gescannte Datei und ist begründet", () => {
    for (const e of ERLAUBTE_GEGENBEISPIELE) {
      assert.ok(SCAN.includes(e.datei), `${e.datei} liegt nicht im Scan-Umfang – Eintrag ist stale`);
      assert.ok(e.anzahl > 0, `${e.datei}: anzahl muss > 0 sein`);
      assert.ok(e.grund.length >= 20, `${e.datei}: Begründung fehlt`);
    }
  });
});
