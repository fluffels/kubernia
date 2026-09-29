/* Harness-Freigabe-Wächter (#1012, Regel seit #1069) – Sign-off + Audit-Spur für Leitplanken-Diffs.
 *
 * Kubernia mergt autonom. Leitplanken-Änderungen (Selbstmodifikation) waren bis #1069 ein
 * Pflicht-Stopp; seitdem setzt der Agent das Label `maintainer-approved` bei der intendierten
 * Änderung seines Tickets selbst, mergt und hinterlässt einen Audit-Kommentar. Dieser Wächter
 * deckt die zwei Fehlklassen ab, die diese Regel leise aushöhlen:
 *
 *   1. **Die portable Regel verschwindet.** Die Verhaltensregel (Pre-Flight-Klärung + Audit-
 *      Kommentar nach dem Selbst-Merge) lebt tool-neutral in AGENTS.md. Wird sie umformuliert bis
 *      der Marker fehlt, liest ein fremder Agent (der nur AGENTS.md kennt) sie nicht mehr.
 *   2. **Die Durchsetzungs-Listen driften auseinander.** Der CI-Riegel `gate-change-guard`
 *      (.github/workflows/gate-change-guard.yml, Array PROTECTED) ist laut eigenem Kommentar
 *      „Spiegel der CODEOWNERS-Liste"; `HARNESS_PFADE` im Ticket-Workflow spiegelt ihn (#1116).
 *      Ergänzt jemand einen Leitplanken-Pfad nur in einer der Dateien, greift der Riegel
 *      halb – von außen (grüne Checks) nicht von einem echten Schutz zu unterscheiden. Hier ROT.
 *
 * Zusätzlich wird geprüft, dass alle Listen die Leitplanken-Dateien (über die reine Gate-Config
 * hinaus: AGENTS.md, CLAUDE.md, CLAUDE.local.md, .claude/, .agents/, docs/agent-harness) wirklich
 * enthalten – sonst wäre die Regel dokumentiert, aber der Riegel liefe ins Leere. Seit #1156
 * schützen die Listen auch die Wächter-Tests selbst (diese Datei eingeschlossen), und kein Eintrag
 * darf pauschal den ganzen test/-Ordner sperren.
 *
 * Fitness-Function-Kategorie neben agents-md-native/docmap/readme (#1087/#482), nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`: `scripts/check-`
 * ist selbst gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht) – für rein
 * doku-/config-strukturelle Wächter gibt es die etablierte test-only-Familie (Präzedenz:
 * `test/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/**
 * Normalisiert einen geschützten Pfad auf seine Substring-Form: führenden `/` weg
 * (CODEOWNERS-Anker) und ab dem ersten Glob-`*` abschneiden. So werden die zwei
 * Schreibweisen vergleichbar – CODEOWNERS `/scripts/check-*.mjs` und der
 * gate-change-guard.yml-Substring `scripts/check-` landen beide auf `scripts/check-`.
 */
function normalizeProtected(p: string): string {
  return p.replace(/^\//, "").replace(/\*.*$/, "");
}

/** Die geschützten Pfade aus `.github/CODEOWNERS` (jeweils vor dem `@owner`). */
function codeownersPaths(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+@\S+/);
    if (m) set.add(normalizeProtected(m[1]));
  }
  return set;
}

/** Die geschützten Pfade aus dem `PROTECTED=( '...' … )`-Bash-Array in gate-change-guard.yml. */
function guardProtectedPaths(text: string): Set<string> {
  // Bis zur schliessenden Klammer auf EIGENER Zeile (^\s*\)) – nicht bis zum ersten `)`,
  // sonst schneidet ein Kommentar mit Klammer wie "(#903)" das Array zu frueh ab.
  const block = text.match(/PROTECTED=\(\s*([\s\S]*?)^\s*\)/m);
  assert.ok(block, "PROTECTED=(...)-Array im gate-change-guard (gate-change-guard.yml) nicht gefunden");
  const set = new Set<string>();
  for (const m of block[1].matchAll(/'([^']+)'/g)) set.add(normalizeProtected(m[1]));
  return set;
}

/**
 * Die Harness-Pfade aus `const HARNESS_PFADE = [ '...' … ]` im Ticket-Workflow – die dritte
 * Spiegel-Liste, nach der der Workflow `maintainer-approved` selbst setzt (#1069, Sync seit #1116).
 */
function workflowHarnessPaths(text: string): Set<string> {
  const block = text.match(/const HARNESS_PFADE = \[([\s\S]*?)^\]/m);
  assert.ok(block, "const HARNESS_PFADE = [...] in .claude/workflows/kubernia-ticket.js nicht gefunden");
  const set = new Set<string>();
  for (const m of block[1].matchAll(/'([^']+)'/g)) set.add(normalizeProtected(m[1]));
  return set;
}

/**
 * Leitplanken-Dateien, die über die reine Gate-Config hinaus den sichtbaren Sign-off tragen
 * (Ticket #1012 / Maintainerin-Entscheidung „breit"). In Substring-Form – so wie
 * beide Listen sie nach der Normalisierung führen müssen.
 */
// CLAUDE.md bleibt geschützt, obwohl sie seit #1087 gelöscht ist: ihre Wiederanlage würde
// AGENTS.md als geladene SSOT verdrängen und muss darum die Label-Pflicht auslösen.
// Dasselbe gilt für CLAUDE.local.md (#1116) – der Guard matcht per Substring, `CLAUDE.md` trifft sie nicht.
const LEITPLANKEN = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/", ".agents/", "docs/agent-harness"];

/**
 * Wächter-Tests, die selbst der EINZIGE Durchsetzer ihrer Regel sind (#1156) – ohne eigenes,
 * schon geschütztes `scripts/check-*.mjs` dahinter. Liefen sie ungeschützt, könnte ein PR den
 * Riegel ohne `maintainer-approved` still abschwächen: agents-md-native bewacht die eine
 * Root-Kontextdatei (auch den ungetrackten CLAUDE.local.md-Fall, den kein PR-Diff zeigt),
 * dieser Test hier den Sync der drei Listen. Bewusst einzeln statt als Muster: ein Glob
 * würde von `normalizeProtected` auf `test/` gekürzt und jeden Test-PR label-pflichtig machen.
 * Tests mit geschütztem check-Skript dahinter (filesize, docmap, diffsize, …) gehören nicht hierher.
 * Bewusst vorerst nur diese zwei (Maintainerin-Entscheidung #1156): weitere Wächter ohne
 * check-Skript (z.B. settings-permissions, diffbasis) kommen mit der Namensregel test/harness/ bzw. #1157.
 */
const WAECHTER_TESTS = ["test/agents-md-native.test.ts", "test/harness-approval.test.ts"];

/**
 * Deckt ein normalisierter Schutz-Eintrag den ganzen test/-Ordner ab? Das gilt für `test/` selbst,
 * jedes kürzere Präfix davon (`t`, aus `/t*`) und den Leer-String (aus `/*.test.ts` oder `/**`).
 */
function decktTestOrdnerAb(p: string): boolean {
  return "test/".startsWith(p);
}

/**
 * Marker der portablen Regeln in AGENTS.md. Bewusst wording-gekoppelt (wie readme.test.ts die
 * Quest-Zahl): die Regel darf umformuliert werden, aber der tragende Begriff muss stehen bleiben,
 * sonst findet ihn ein fremder Agent nicht mehr.
 */
const AGENTS_MARKER = [
  "Human-in-the-Loop", // der Checkpoint-Regel-Bullet (Pre-Flight-Klärung)
  "Leitplanken-Änderung selbst gemergt", // Audit-Kommentar-Pflicht nach dem Selbst-Merge (#1069)
  "Mehr-Perspektiven-Review", // die erzwungene Review-Konvergenzschleife vor dem Merge
];

const codeowners = read(".github/CODEOWNERS");
const guardWf = read(".github/workflows/gate-change-guard.yml");
const agentsMd = read("AGENTS.md");
const ticketWf = read(".claude/workflows/kubernia-ticket.js");

describe("Harness-Freigabe – die Durchsetzungs-Listen bleiben synchron (#1012, #1116)", () => {
  test("CODEOWNERS und gate-change-guard/PROTECTED schützen dieselben Pfade", () => {
    assert.deepEqual(
      [...codeownersPaths(codeowners)].sort(),
      [...guardProtectedPaths(guardWf)].sort(),
      "Die geschützten Pfade in .github/CODEOWNERS und im PROTECTED-Array (.github/workflows/gate-change-guard.yml) sind auseinandergelaufen. " +
        "Der CI-Kommentar nennt PROTECTED ausdrücklich 'Spiegel der CODEOWNERS-Liste' - beide Listen zusammen pflegen.",
    );
  });

  test("HARNESS_PFADE im Ticket-Workflow spiegelt PROTECTED (#1116)", () => {
    assert.deepEqual(
      [...workflowHarnessPaths(ticketWf)].sort(),
      [...guardProtectedPaths(guardWf)].sort(),
      "HARNESS_PFADE in .claude/workflows/kubernia-ticket.js und das PROTECTED-Array in gate-change-guard.yml sind auseinandergelaufen - " +
        "sonst setzt der Workflow maintainer-approved für einen Pfad nicht, den der Guard sperrt (oder umgekehrt).",
    );
  });

  test("alle Listen decken die Leitplanken-Dateien ab (nicht nur Gate-Config)", () => {
    const co = codeownersPaths(codeowners);
    const cp = guardProtectedPaths(guardWf);
    const hp = workflowHarnessPaths(ticketWf);
    const fehlend: string[] = [];
    for (const p of LEITPLANKEN) {
      if (!co.has(p)) fehlend.push(`.github/CODEOWNERS: ${p}`);
      if (!cp.has(p)) fehlend.push(`gate-change-guard.yml PROTECTED: ${p}`);
      if (!hp.has(p)) fehlend.push(`kubernia-ticket.js HARNESS_PFADE: ${p}`);
    }
    assert.deepEqual(
      fehlend,
      [],
      "Leitplanken-Dateien fehlen im Sign-off-Riegel (#1012/#1069: Harness-Änderungen tragen das Label als sichtbaren Marker):\n" +
        fehlend.join("\n"),
    );
  });

  test("alle Listen schützen die Wächter-Tests selbst (#1156)", () => {
    const co = codeownersPaths(codeowners);
    const cp = guardProtectedPaths(guardWf);
    const hp = workflowHarnessPaths(ticketWf);
    const fehlend: string[] = [];
    for (const p of WAECHTER_TESTS) {
      if (!co.has(p)) fehlend.push(`.github/CODEOWNERS: ${p}`);
      if (!cp.has(p)) fehlend.push(`gate-change-guard.yml PROTECTED: ${p}`);
      if (!hp.has(p)) fehlend.push(`kubernia-ticket.js HARNESS_PFADE: ${p}`);
    }
    assert.deepEqual(
      fehlend,
      [],
      "Wächter-Tests fehlen im Sign-off-Riegel (#1156) – sonst lässt sich der Wächter des Riegels ohne Label abschwächen:\n" +
        fehlend.join("\n"),
    );
  });

  test("kein Listen-Eintrag schützt pauschal den ganzen test/-Ordner (#1156)", () => {
    // Ein Muster wie /test/*harness*.test.ts normalisiert auf `test/` – dann bräuchte jeder PR mit
    // Teständerung das Label, und ein immer nötiges Label markiert nichts mehr (Label-Fatigue).
    const alle = [...codeownersPaths(codeowners), ...guardProtectedPaths(guardWf), ...workflowHarnessPaths(ticketWf)];
    assert.deepEqual(
      alle.filter(decktTestOrdnerAb),
      [],
      "Ein Schutzlisten-Eintrag deckt den ganzen test/-Ordner ab – Wächter-Tests einzeln eintragen (#1156)",
    );
  });

  test("die geschützten Wächter-Tests existieren wirklich (#1156)", () => {
    // Nach einem Umbenennen stünde sonst ein verwaister Pfad in allen Listen – grün, aber ohne Schutz.
    const fehlend = WAECHTER_TESTS.filter((p) => !existsSync(fileURLToPath(new URL(`../${p}`, import.meta.url))));
    assert.deepEqual(fehlend, [], `Geschützte Wächter-Tests gibt es nicht (umbenannt?):\n${fehlend.join("\n")}`);
  });
});

describe("Der Guard-Workflow triggert auf Label-Änderung (#1015)", () => {
  test("gate-change-guard.yml reagiert auf labeled/unlabeled (sonst bleibt der Required-Check nach dem Label rot)", () => {
    // Kern-Deliverable von #1015: der ausgelagerte Guard MUSS zusätzlich auf
    // labeled/unlabeled triggern, damit das Setzen von 'maintainer-approved' den
    // Required-Check automatisch neu grün laufen lässt. Ohne diesen Wächter könnte
    // jemand `labeled` aus types entfernen und der Ticket-Zweck regressierte still
    // (alle anderen Tests blieben grün) – genau das „von außen grün, kein echter
    // Schutz"-Muster, das diese Fitness-Function-Familie adressiert.
    const m = guardWf.match(/pull_request:\s*\n\s*types:\s*\[([^\]]*)\]/);
    assert.ok(m, "kein pull_request.types-Trigger in gate-change-guard.yml gefunden");
    assert.match(m[1], /\blabeled\b/, "Trigger enthält 'labeled' nicht");
    assert.match(m[1], /\bunlabeled\b/, "Trigger enthält 'unlabeled' nicht");
  });
});

describe("Harness-Freigabe – die portable Regel steht in AGENTS.md (#1012)", () => {
  test("AGENTS.md nennt die Human-in-the-Loop-Checkpoints und den erzwungenen Review", () => {
    const fehlend = AGENTS_MARKER.filter((m) => !agentsMd.includes(m));
    assert.deepEqual(
      fehlend,
      [],
      "In AGENTS.md fehlen die tragenden Regel-Marker (#1012). Ein fremder Agent kennt nur AGENTS.md – " +
        `ohne diese Begriffe findet er die Regel nicht:\n${fehlend.join("\n")}`,
    );
  });
});

describe("Erkennung greift wirklich (Red-Green, #1012)", () => {
  test("Normalisierung führt beide Schreibweisen zusammen", () => {
    assert.equal(normalizeProtected("/scripts/check-*.mjs"), "scripts/check-");
    assert.equal(normalizeProtected("scripts/check-"), "scripts/check-");
    assert.equal(normalizeProtected("/.github/workflows/*.yml"), ".github/workflows/");
    assert.equal(normalizeProtected("/AGENTS.md"), "AGENTS.md");
  });

  test("Parser lesen echte Listen und ignorieren Kommentare/Leerzeilen", () => {
    assert.deepEqual(
      [...codeownersPaths("# Kopf\n\n/foo.js   @fluffels\n/bar/*.yml  @fluffels")].sort(),
      ["bar/", "foo.js"],
    );
    assert.deepEqual([...guardProtectedPaths("x\nPROTECTED=(\n  'a.js'\n  'b/'\n)\ny")].sort(), ["a.js", "b/"]);
    assert.deepEqual(
      [...workflowHarnessPaths("// 'kommentar/'\nconst HARNESS_PFADE = [\n  'a.js',\n  'b/',\n]\nconst X = ['c']")].sort(),
      ["a.js", "b/"],
    );
  });

  test("CLAUDE.md deckt CLAUDE.local.md im Substring-Guard NICHT mit ab (#1116)", () => {
    // Der Grund für den eigenen Eintrag: PROTECTED matcht per Substring auf den geänderten Pfad.
    assert.equal("CLAUDE.local.md".includes("CLAUDE.md"), false);
  });

  test("ein einseitig ergänzter Pfad würde als Drift auffallen", () => {
    // Beweist, dass der Sync-Test nicht immer grün ist: fehlt ein Pfad in einer Liste, kippt der Vergleich.
    const co = new Set(["AGENTS.md", "CLAUDE.md"]);
    const cp = new Set(["AGENTS.md"]);
    assert.notDeepEqual([...co].sort(), [...cp].sort());
  });

  test("ein Glob-Muster für Tests würde auf den ganzen test/-Ordner kürzen (#1156)", () => {
    // Belegt, warum die Wächter-Tests einzeln statt als Muster eingetragen sind – und dass der
    // Negativ-Wächter oben ein solches Muster wirklich fängt. Feste Literale, nicht WAECHTER_TESTS.
    assert.equal(normalizeProtected("/test/*harness*.test.ts"), "test/");
    assert.equal(normalizeProtected("/test/harness-approval.test.ts"), "test/harness-approval.test.ts");
  });

  test("der test/-Pauschal-Filter fängt auch breitere Muster, aber keine Einzelpfade (#1156)", () => {
    for (const muster of ["/test/*x*", "/test", "/t*", "/*.test.ts", "/**"]) {
      assert.equal(decktTestOrdnerAb(normalizeProtected(muster)), true, `nicht erkannt: ${muster}`);
    }
    for (const einzeln of ["/test/agents-md-native.test.ts", "/.claude/", "/AGENTS.md", "/tests-x/"]) {
      assert.equal(decktTestOrdnerAb(normalizeProtected(einzeln)), false, `fälschlich erkannt: ${einzeln}`);
    }
  });
});

describe("Der Guard diffed gegen die Merge-Base, nicht gegen den main-Tip (#1095)", () => {
  /** Die `git diff …`-Argumente aus der `changed=$(git diff …)`-Zeile des Guards, mit eingesetzten SHAs. */
  function guardDiffArgs(wf: string, base: string, head: string): string[] {
    const m = wf.match(/changed=\$\(git diff ([^)]*)\)/);
    assert.ok(
      m,
      "changed=$(git diff …)-Zeile in gate-change-guard.yml nicht gefunden",
    );
    return [
      "diff",
      ...m[1]
        .replaceAll("$BASE_SHA", base)
        .replaceAll("$HEAD_SHA", head)
        .split(/\s+/)
        .filter(Boolean)
        .map((a) => a.replace(/^"|"$/g, "")),
    ];
  }

  test("ein nach dem Abzweigen auf main gemergter Harness-Commit zählt NICHT als PR-Änderung", () => {
    // Repro von PR #1093: der PR ändert nur Doku, auf main landet derweil eine .claude/-Änderung.
    // Mit Zwei-Punkt-Diff (base.sha = main-Tip) meldete der Guard die fremde Datei und blieb rot.
    const dir = mkdtempSync(join(tmpdir(), "kq-guard-"));
    // GIT_DIR & Co. aus einem umgebenden git-Hook (pre-push → verify) nicht erben –
    // sonst liefen die Fixture-Befehle gegen das echte Repo statt gegen `dir`.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX)$/.test(k)),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.invalid");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "README.md"), "x\n");
      git("add", ".");
      git("commit", "-q", "-m", "basis");
      git("checkout", "-q", "-b", "feature");
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "docs", "adr.md"), "pr\n");
      git("add", ".");
      git("commit", "-q", "-m", "pr");
      const head = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      mkdirSync(join(dir, ".claude"));
      writeFileSync(join(dir, ".claude", "fremd.js"), "main\n");
      git("add", ".");
      git("commit", "-q", "-m", "fremder main-commit");
      const base = git("rev-parse", "HEAD");

      const changed = git(...guardDiffArgs(guardWf, base, head))
        .split(/\r?\n/)
        .filter(Boolean);
      assert.deepEqual(
        changed,
        ["docs/adr.md"],
        "Der Guard zählt Dateien fremder main-Commits zum PR (Zwei- statt Drei-Punkt-Diff)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("der Checkout holt die volle Historie (ohne sie findet der Drei-Punkt-Diff keine Merge-Base)", () => {
    assert.match(guardWf, /fetch-depth:\s*0\b/, "gate-change-guard.yml: actions/checkout braucht fetch-depth: 0");
  });
});
