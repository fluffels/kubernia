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
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/haupt-sync.mjs";

type Eingabe = { istLinkedWorktree: boolean; branch: string; sauber: boolean; hinter: number; vor: number };
type Ergebnis = { aktion: string; grund: string; hinter: number; basis: string; gepullt: boolean; agentenGeaendert: boolean; notiz: string };
const S = raw as unknown as {
  entscheideSync: (e: Eingabe) => { aktion: "pull" | "melden" | "nichts"; grund: string };
  agentenGeaendert: (d: string[]) => boolean;
  baueText: (e: Partial<Ergebnis>) => string;
  fuehreSyncAus: (dir: string) => Ergebnis;
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
