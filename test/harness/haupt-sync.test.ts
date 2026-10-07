/* Haupt-Checkout-Sync (#1349, SessionStart-Hook) – hebt `main` per Fast-Forward, sonst meldet er nur.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der Hook darf einen Haupt-Checkout NIE verändern, der nicht sauber, nicht auf `main` oder nicht rein zurück ist,
 * und einen Linked Worktree nie anfassen. Darum zwei Ebenen: die pure Entscheidung (jede Verzweigung) und ein
 * Durchlauf gegen echte temporäre Git-Repos (bare Remote + zwei Klone), der das Verhalten über die öffentliche
 * Funktion `fuehreSyncAus` prüft. Dazu die Bindung settings.json → Skript.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/haupt-sync.mjs";

type Eingabe = { istLinkedWorktree: boolean; branch: string; sauber: boolean; hinter: number; vor: number };
type Ergebnis = { aktion: string; grund: string; hinter: number; basis: string; gepullt: boolean; agentenGeaendert: boolean; notiz: string };
const S = raw as unknown as {
  entscheideSync: (e: Eingabe) => { aktion: "pull" | "melden" | "nichts"; grund: string };
  agentenGeaendert: (d: string[]) => boolean;
  baueText: (e: Partial<Ergebnis>) => string;
  fuehreSyncAus: (dir: string) => Ergebnis;
  ausgabe: (e: Partial<Ergebnis>, text: boolean) => string;
};

const basis: Eingabe = { istLinkedWorktree: false, branch: "main", sauber: true, hinter: 3, vor: 0 };

describe("entscheideSync: jede Verzweigung", () => {
  test("sauber, main, nur zurück: pull", () => {
    expect(S.entscheideSync(basis).aktion).toBe("pull");
  });
  test("aktuell: nichts", () => {
    expect(S.entscheideSync({ ...basis, hinter: 0 }).aktion).toBe("nichts");
  });
  test("Linked Worktree: nichts, auch wenn zurück", () => {
    expect(S.entscheideSync({ ...basis, istLinkedWorktree: true }).aktion).toBe("nichts");
  });
  test("anderer Branch: nur melden", () => {
    const e = S.entscheideSync({ ...basis, branch: "feature/x" });
    expect(e.aktion).toBe("melden");
    expect(e.grund).toContain("feature/x");
  });
  test("Arbeitsbaum nicht sauber: nur melden", () => {
    expect(S.entscheideSync({ ...basis, sauber: false }).aktion).toBe("melden");
  });
  test("lokale Commits (kein Fast-Forward): nur melden", () => {
    expect(S.entscheideSync({ ...basis, vor: 1 }).aktion).toBe("melden");
  });
  test("kaputte Zahlen: nichts statt Pull", () => {
    expect(S.entscheideSync({ ...basis, hinter: Number.NaN }).aktion).toBe("nichts");
    expect(S.entscheideSync({ ...basis, vor: -1 }).aktion).toBe("nichts");
  });
});

describe("Hilfsfunktionen", () => {
  test("agentenGeaendert erkennt .claude/ und jede AGENTS.md, sonst nicht", () => {
    expect(S.agentenGeaendert([".claude/agents/kubernia-planner.md"])).toBe(true);
    expect(S.agentenGeaendert(["AGENTS.md"])).toBe(true);
    expect(S.agentenGeaendert(["src/content/AGENTS.md"])).toBe(true);
    expect(S.agentenGeaendert(["docs/x.md", "src/a.ts"])).toBe(false);
    expect(S.agentenGeaendert([])).toBe(false);
  });
  test("baueText: Sitzungsbasis immer, Neustart-Hinweis nur bei geänderten Agenten, Meldung mit Zahl", () => {
    expect(S.baueText({ aktion: "nichts", basis: "abc" })).toBe("Sitzungsbasis: abc");
    const gepullt = S.baueText({ aktion: "pull", gepullt: true, hinter: 4, basis: "abc", agentenGeaendert: true });
    expect(gepullt).toContain("neu starten");
    expect(gepullt).toContain("Sitzungsbasis: abc");
    expect(S.baueText({ aktion: "pull", gepullt: true, hinter: 4, basis: "abc", agentenGeaendert: false })).not.toContain("neu starten");
    expect(S.baueText({ aktion: "melden", hinter: 2, grund: "Arbeitsbaum nicht sauber", basis: "abc" })).toContain("2 Commits hinter origin/main");
  });
});

describe("Ausgabe des Hooks", () => {
  test("SessionStart-Modus: JSON mit additionalContext und Sitzungsbasis", () => {
    const o = JSON.parse(S.ausgabe({ aktion: "nichts", basis: "abc" }, false)) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(o.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(o.hookSpecificOutput.additionalContext).toBe("Sitzungsbasis: abc");
  });
  test("--text: Klartext OHNE Sitzungsbasis (ein späterer Aufruf sieht einen schon gehobenen main)", () => {
    const t = S.ausgabe({ aktion: "nichts", basis: "abc" }, true);
    expect(t).not.toContain("Sitzungsbasis");
    expect(t).toContain("Stand vor diesem Sync: abc");
  });
  test("ohne Text nichts; Notiz erscheint im Text", () => {
    expect(S.ausgabe({ aktion: "nichts" }, false)).toBe("");
    expect(S.baueText({ aktion: "nichts", notiz: "git fetch fehlgeschlagen (x)", basis: "abc" })).toContain("Haupt-Sync: git fetch fehlgeschlagen");
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Bare-Remote + Haupt-Klon (main) + zweiter Klon, der Commits auf origin schiebt. */
function aufbau() {
  const wurzel = mkdtempSync(join(tmpdir(), "kq-haupt-sync-"));
  const remote = join(wurzel, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare", "--initial-branch=main");
  const haupt = join(wurzel, "haupt");
  const zweit = join(wurzel, "zweit");
  git(wurzel, "clone", remote, haupt);
  git(haupt, "checkout", "-B", "main");
  writeFileSync(join(haupt, "a.txt"), "1\n");
  git(haupt, "add", "-A");
  git(haupt, "commit", "-m", "start");
  git(haupt, "push", "-u", "origin", "main");
  git(wurzel, "clone", remote, zweit);
  const schiebe = (datei: string, inhalt: string) => {
    mkdirSync(join(zweit, datei, ".."), { recursive: true });
    writeFileSync(join(zweit, datei), inhalt);
    git(zweit, "add", "-A");
    git(zweit, "commit", "-m", `aendere ${datei}`);
    git(zweit, "push", "origin", "main");
  };
  return { wurzel, haupt, schiebe, aufraeumen: () => rmSync(wurzel, { recursive: true, force: true }) };
}

describe("fuehreSyncAus gegen echte Repos", { timeout: 30_000 }, () => {
  test("sauberer main hinter origin: Fast-Forward, Sitzungsbasis = alter HEAD", () => {
    const t = aufbau();
    try {
      const alt = git(t.haupt, "rev-parse", "HEAD");
      t.schiebe("docs/neu.md", "x\n");
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.gepullt).toBe(true);
      expect(e.basis).toBe(alt);
      expect(e.agentenGeaendert).toBe(false);
      expect(git(t.haupt, "rev-parse", "HEAD")).not.toBe(alt);
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(git(t.haupt, "rev-parse", "origin/main"));
    } finally {
      t.aufraeumen();
    }
  });

  test("Pull, der .claude/ ändert, setzt den Neustart-Hinweis", () => {
    const t = aufbau();
    try {
      t.schiebe(".claude/agents/x.md", "neu\n");
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.gepullt).toBe(true);
      expect(e.agentenGeaendert).toBe(true);
      expect(S.baueText(e)).toContain("neu starten");
    } finally {
      t.aufraeumen();
    }
  });

  test("dirty (getrackte Änderung): nichts angefasst, Meldung mit Rückstand", () => {
    const t = aufbau();
    try {
      t.schiebe("b.txt", "x\n");
      const alt = git(t.haupt, "rev-parse", "HEAD");
      writeFileSync(join(t.haupt, "a.txt"), "lokal geändert\n");
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.gepullt).toBe(false);
      expect(e.aktion).toBe("melden");
      expect(e.hinter).toBe(1);
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(alt);
      expect(readFileSync(join(t.haupt, "a.txt"), "utf8")).toBe("lokal geändert\n");
    } finally {
      t.aufraeumen();
    }
  });

  test("untracked Datei stört den Fast-Forward nicht", () => {
    const t = aufbau();
    try {
      t.schiebe("b.txt", "x\n");
      writeFileSync(join(t.haupt, "scratch.txt"), "egal\n");
      expect(S.fuehreSyncAus(t.haupt).gepullt).toBe(true);
    } finally {
      t.aufraeumen();
    }
  });

  test("anderer Branch: nichts angefasst", () => {
    const t = aufbau();
    try {
      t.schiebe("b.txt", "x\n");
      git(t.haupt, "checkout", "-b", "feature/y");
      const alt = git(t.haupt, "rev-parse", "HEAD");
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.gepullt).toBe(false);
      expect(e.aktion).toBe("melden");
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(alt);
    } finally {
      t.aufraeumen();
    }
  });

  test("main mit lokalem Commit (kein Fast-Forward): nichts angefasst", () => {
    const t = aufbau();
    try {
      t.schiebe("b.txt", "x\n");
      writeFileSync(join(t.haupt, "lokal.txt"), "l\n");
      git(t.haupt, "add", "-A");
      git(t.haupt, "commit", "-m", "lokal");
      const alt = git(t.haupt, "rev-parse", "HEAD");
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.gepullt).toBe(false);
      expect(e.aktion).toBe("melden");
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(alt);
    } finally {
      t.aufraeumen();
    }
  });

  test("Linked Worktree: nichts angefasst, Sitzungsbasis trotzdem gemeldet", () => {
    const t = aufbau();
    try {
      const wt = join(t.wurzel, "wt");
      git(t.haupt, "worktree", "add", "--detach", wt, "HEAD");
      t.schiebe("b.txt", "x\n");
      const alt = git(wt, "rev-parse", "HEAD");
      const e = S.fuehreSyncAus(wt);
      expect(e.gepullt).toBe(false);
      expect(e.aktion).toBe("nichts");
      expect(e.basis).toBe(alt);
      expect(git(wt, "rev-parse", "HEAD")).toBe(alt);
    } finally {
      t.aufraeumen();
    }
  });

  test("fetch scheitert (Remote weg): fail-open mit Notiz, nichts verändert, kein Wurf", () => {
    const t = aufbau();
    try {
      const alt = git(t.haupt, "rev-parse", "HEAD");
      git(t.haupt, "remote", "set-url", "origin", join(t.wurzel, "gibt-es-nicht.git"));
      const e = S.fuehreSyncAus(t.haupt);
      expect(e.notiz).toMatch(/fetch fehlgeschlagen/);
      expect(e.gepullt).toBe(false);
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(alt);
    } finally {
      t.aufraeumen();
    }
  });

  test("kein Git-Repo: kein Wurf, Notiz", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "kq-haupt-sync-leer-"));
    try {
      const e = S.fuehreSyncAus(wurzel);
      expect(e.gepullt).toBe(false);
      expect(e.notiz).toMatch(/Fehler/);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
});

describe("Verdrahtung", () => {
  test("settings.json startet scripts/haupt-sync.mjs bei SessionStart (startup, resume, clear), mit Timeout", () => {
    const settings = JSON.parse(readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8")) as {
      hooks: { SessionStart?: { matcher?: string; hooks: { type: string; command: string; args?: string[]; timeout?: number }[] }[] };
    };
    const eintraege = settings.hooks.SessionStart ?? [];
    const treffer = eintraege.filter((e) => e.hooks.some((h) => (h.args ?? []).some((a) => a.endsWith("/scripts/haupt-sync.mjs"))));
    expect(treffer).toHaveLength(1);
    expect(treffer[0].matcher).toBe("startup|resume|clear");
    expect(treffer[0].hooks[0].timeout).toBeGreaterThanOrEqual(30);
    expect(readFileSync(new URL("../../scripts/haupt-sync.mjs", import.meta.url), "utf8")).toContain("--ff-only");
  });
});

describe("--streng: Exit-Code des Skill-Schritts 0 (#1392 Z32)", () => {
  const X = raw as unknown as { exitCodeFuer: (e: Record<string, unknown>) => number };
  const cli = (dir: string, ...args: string[]) => {
    try {
      const out = execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/haupt-sync.mjs", import.meta.url)), ...args], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: err.stdout };
    }
  };

  test("exitCodeFuer: jede Aktion", () => {
    expect(X.exitCodeFuer({ aktion: "nichts", branch: "main", sauber: true })).toBe(0);
    expect(X.exitCodeFuer({ aktion: "pull", gepullt: true, branch: "main", sauber: true })).toBe(0);
    expect(X.exitCodeFuer({ aktion: "melden", branch: "main", sauber: false })).toBe(1);
    expect(X.exitCodeFuer({ aktion: "nichts", notiz: "Fehler (kein Netz), nichts verändert" })).toBe(1);
  });

  test("exitCodeFuer: auch ohne Rückstand zählen getrackte Reste und ein anderer Branch; ein Linked Worktree nie", () => {
    expect(X.exitCodeFuer({ aktion: "nichts", branch: "main", sauber: false })).toBe(1);
    expect(X.exitCodeFuer({ aktion: "nichts", branch: "feature/x", sauber: true })).toBe(1);
    expect(X.exitCodeFuer({ aktion: "nichts", grund: "Linked Worktree", branch: "", sauber: undefined })).toBe(0);
  });

  test("--text: nach einem Pull mit geänderten Skills steht „Skill neu lesen“ statt „Session neu starten“; der Hook-Modus bleibt beim Neustart-Hinweis", () => {
    const e = { aktion: "pull", gepullt: true, hinter: 3, basis: "abc", agentenGeaendert: true };
    const text = S.ausgabe(e, true);
    expect(text).toContain("Skill neu lesen");
    expect(text).toContain("git diff <Stand vor diesem Sync> HEAD -- AGENTS.md");
    expect(text).not.toContain("Sitzungsbasis");
    const hook = (JSON.parse(S.ausgabe(e, false)) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(hook).toContain("neu starten");
    expect(hook).not.toContain("Skill neu lesen");
  });

  test("CLI: sauberer, aktueller main → Exit 0; dirty → Exit 1 mit Stopp-Text; ohne --streng bleibt es Exit 0", () => {
    const t = aufbau();
    try {
      expect(cli(t.haupt, "--text", "--streng").code).toBe(0);
      writeFileSync(join(t.haupt, "a.txt"), "lokal geändert\n");
      const r = cli(t.haupt, "--text", "--streng");
      expect(r.code).toBe(1);
      expect(r.out).toContain("STOPP");
      expect(cli(t.haupt, "--text").code).toBe(0);
    } finally {
      t.aufraeumen();
    }
  });

  test("CLI: main hinter origin und sauber → Fast-Forward, Exit 0; geänderter Skill-Pfad meldet „Skill neu lesen“", () => {
    const t = aufbau();
    try {
      t.schiebe(".claude/skills/kubernia/SKILL.md", "neu\n");
      const r = cli(t.haupt, "--text", "--streng");
      expect(r.code).toBe(0);
      expect(r.out).toContain("Skill neu lesen");
      expect(r.out).toContain("Stand vor diesem Sync");
    } finally {
      t.aufraeumen();
    }
  });

  test("der Skill kubernia beginnt mit Schritt 0 (haupt-sync --streng), nennt Stopp bei Exit 1 und die Neu-Lesen-Regel; kein „nie ein eigenes git pull“ mehr", () => {
    const skill = readFileSync(new URL("../../.claude/skills/kubernia/SKILL.md", import.meta.url), "utf8");
    const schritt0 = /^0\. \*\*Hauptcheckout heben[^\n]*\n/m.exec(skill)?.[0] ?? "";
    expect(schritt0).toContain("node scripts/haupt-sync.mjs --text --streng");
    expect(schritt0).toMatch(/Exit 1/);
    expect(schritt0).toMatch(/kein Ticket starten/);
    expect(schritt0).toMatch(/SKILL\.md[^\n]*neu/);
    expect(skill.indexOf("0. **Hauptcheckout heben")).toBeLessThan(skill.indexOf("1. **Auswählen und claimen.**"));
    expect(skill).not.toMatch(/nie ein eigenes `git pull`/);
  });
});
