/* Worktree-Setup-Wächter (#1119) – ein frischer Worktree wird mit `npm ci` bestückt,
 * nicht mit `npm install`.
 *
 * Hintergrund: `npm install` darf `package-lock.json` neu schreiben. In jedem Ticket-Lauf
 * wurde der Lockfile im frischen Worktree dirty und musste von Hand zurückgesetzt werden
 * (#998, #1107: einmal versehentlich mitcommittet). `npm ci` installiert exakt nach
 * Lockfile und schreibt ihn nie – identisch zur CI.
 *
 * Geprüft wird absatzweise: jeder Absatz der Harness-Texte, der einen Worktree erwähnt
 * und eine npm-Installation nennt, muss `npm ci` nennen und darf `npm install` nicht
 * nennen. Absätze ohne Worktree-Bezug bleiben frei – die Regel „nach Hand-Änderung an
 * `package.json` → `npm install` + Lockfile mitcommitten" (AGENTS.md) ist gewollt.
 *
 * Grenze (bewusst): kein Semantik-Prüfer, nur die abgelegte Formulierung neben einem
 * Worktree-Bezug. Fitness-Function, test-only wie `test/claude-bridge.test.ts` (ohne
 * eigenes `scripts/check-*.mjs`, das wäre gate-config-geschützt).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Die Texte, die die Worktree-Anlage beschreiben. */
const QUELLEN = [
  "AGENTS.md",
  ".claude/workflows/kubernia-ticket.js",
  ".claude/skills/review-lenses/SKILL.md",
  "docs/agent-harness-faq.md",
];

/** Mindestzahl gefundener Worktree-Installations-Absätze (Leerlauf-Schutz). */
const MIN_TREFFER = QUELLEN.length;

interface Treffer {
  datei: string;
  absatz: string;
}

/** Absätze mit Worktree-Bezug UND npm-Installationsbefehl. */
function worktreeInstallAbsaetze(datei: string, text: string): Treffer[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .filter((a) => /worktree/i.test(a) && /\bnpm (ci|install)\b/.test(a))
    .map((absatz) => ({ datei, absatz }));
}

/** Verstöße: Worktree-Absatz ohne `npm ci` oder mit `npm install`. */
function verstoesse(treffer: Treffer[]): Treffer[] {
  return treffer.filter((t) => !/\bnpm ci\b/.test(t.absatz) || /\bnpm install\b/.test(t.absatz));
}

function alleTreffer(): Treffer[] {
  return QUELLEN.flatMap((d) => worktreeInstallAbsaetze(d, readFileSync(ROOT + d, "utf8")));
}

describe("Worktree-Setup nutzt npm ci (#1119)", () => {
  test("jede Quelle beschreibt die Worktree-Installation (Leerlauf-Schutz)", () => {
    const treffer = alleTreffer();
    assert.ok(treffer.length >= MIN_TREFFER, `nur ${treffer.length} Treffer, erwartet ≥ ${MIN_TREFFER}`);
    for (const d of QUELLEN) {
      assert.ok(
        treffer.some((t) => t.datei === d),
        `${d}: keine Worktree-Installationsanweisung gefunden – Formulierung geändert?`,
      );
    }
  });

  test("kein Worktree-Absatz schreibt npm install vor", () => {
    const fehler = verstoesse(alleTreffer());
    assert.deepEqual(
      fehler.map((f) => `${f.datei}: ${f.absatz.slice(0, 120)}`),
      [],
    );
  });

  test("Negativfall: npm install im Worktree-Absatz wird gemeldet", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im frischen Worktree einmal `npm install`.");
    assert.equal(verstoesse(t).length, 1);
  });

  test("Negativfall: npm install neben npm ci im Worktree-Absatz wird gemeldet", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im Worktree `npm ci`, sonst `npm install`.");
    assert.equal(verstoesse(t).length, 1);
  });

  test("Grenzfall: npm install ohne Worktree-Bezug bleibt erlaubt", () => {
    const text = "Nach Hand-Änderung an `package.json` `npm install` und den Lockfile mitcommitten.";
    assert.deepEqual(worktreeInstallAbsaetze("x.md", text), []);
  });

  test("Happy Path: npm ci im Worktree-Absatz ist ok", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im frischen Worktree einmal `npm ci`.");
    assert.equal(t.length, 1);
    assert.deepEqual(verstoesse(t), []);
  });
});
