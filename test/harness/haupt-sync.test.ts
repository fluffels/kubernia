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
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as syncRaw from "../../scripts/skills-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pfadeRaw from "../../scripts/skill-pfade.mjs";
const pfade = pfadeRaw as unknown as { ZEIGER_WURZEL: string };

type Eingabe = { istLinkedWorktree: boolean; branch: string; sauber: boolean; hinter: number; vor: number };
type Ergebnis = { aktion: string; grund: string; hinter: number; basis: string; gepullt: boolean; harness?: { skill: string[]; agenten: string[]; sonstige: string[] }; notiz: string };
const S = raw as unknown as {
  entscheideSync: (e: Eingabe) => { aktion: "pull" | "melden" | "nichts"; grund: string };
  ordneHarnessAenderungen: (d: string[]) => { skill: string[]; agenten: string[]; sonstige: string[]; lockGeaendert: boolean };
  baueText: (e: Partial<Ergebnis>, o?: { sitzungsbasis?: boolean }) => string;
  fuehreSyncAus: (dir: string, deps?: { config?: Record<string, unknown> }) => Ergebnis;
  exitCodeFuer: (e: Partial<Ergebnis>) => number;
  ausgabe: (e: Partial<Ergebnis>, text: boolean) => string;
  ZEIGER_VERZEICHNISSE: string[];
  quellePfad: (d: string) => string;
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
  test("ordneHarnessAenderungen: Ticket-Skill und Wurzel-AGENTS.md, Agent-Definitionen und Sonstiges getrennt (#1572)", () => {
    expect(S.ordneHarnessAenderungen([".agents/skills/factory-ticket/SKILL.md", "AGENTS.md"])).toMatchObject({ skill: [".agents/skills/factory-ticket/SKILL.md", "AGENTS.md"], agenten: [], sonstige: [] });
    expect(S.ordneHarnessAenderungen([".claude/agents/factory-planer.md"])).toMatchObject({ skill: [], agenten: [".claude/agents/factory-planer.md"] });
    expect(S.ordneHarnessAenderungen([".claude/skills/andere/SKILL.md", ".claude/settings.json", "src/content/AGENTS.md"])).toMatchObject({ skill: [], agenten: [], sonstige: [".claude/skills/andere/SKILL.md", ".claude/settings.json", "src/content/AGENTS.md"] });
    expect(S.ordneHarnessAenderungen(["docs/x.md", "src/a.ts"])).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
    expect(S.ordneHarnessAenderungen([])).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
    expect(S.ordneHarnessAenderungen(["package-lock.json"]).lockGeaendert).toBe(true);
  });
  test("ordneHarnessAenderungen: der Kern-Ticket-Skill factory samt Ablauf zählt immer als Skill, auch ohne nutzbare Config (#1806)", () => {
    const f = [".agents/skills/factory/ablauf.md", ".agents/skills/factory/SKILL.md"];
    expect(S.ordneHarnessAenderungen(f)).toMatchObject({ skill: f, sonstige: [] });
    expect(S.ordneHarnessAenderungen([".claude/skills/factoryx/SKILL.md"])).toMatchObject({ skill: [], sonstige: [".claude/skills/factoryx/SKILL.md"] });
  });
  test("baueText (Hook-Modus): Sitzungsbasis immer, Neustart-Hinweis nur bei Harness-Änderungen, Meldung mit Zahl", () => {
    expect(S.baueText({ aktion: "nichts", basis: "abc" })).toBe("Sitzungsbasis: abc");
    const harness = { skill: [], agenten: [".claude/agents/x.md"], sonstige: [], lockGeaendert: false };
    const gepullt = S.baueText({ aktion: "pull", gepullt: true, hinter: 4, basis: "abc", harness });
    expect(gepullt).toContain("neu starten");
    expect(gepullt).toContain("Sitzungsbasis: abc");
    const ohne = { skill: [], agenten: [], sonstige: [], lockGeaendert: false };
    expect(S.baueText({ aktion: "pull", gepullt: true, hinter: 4, basis: "abc", harness: ohne })).not.toContain("neu starten");
    expect(S.baueText({ aktion: "melden", hinter: 2, grund: "Arbeitsbaum nicht sauber", basis: "abc" })).toContain("2 Commits hinter origin/main");
  });
});

describe("Bilddateien im Hauptcheckout-Root (#1549 Z2)", () => {
  const B = raw as unknown as { bildReste: (n: string[]) => string[]; bildResteFuer: (d: string) => string[] };
  test("bildReste: Treffer für png/jpg/jpeg/webm, groß oder klein", () => {
    expect(B.bildReste(["a.png", "B.JPG", "c.jpeg", "d.WebM", "package.json", "png", "xpng", "x.png.txt"])).toEqual(["a.png", "B.JPG", "c.jpeg", "d.WebM"]);
  });
  test("bildReste: keine Treffer ergeben []", () => {
    expect(B.bildReste(["README.md", "AGENTS.md"])).toEqual([]);
    expect(B.bildReste([])).toEqual([]);
  });
  test("bildResteFuer: nur Dateien im Root, Unterordner (auch .playwright-mcp) und Ordner mit Bildnamen zählen nicht", () => {
    const dir = mkdtempSync(join(tmpdir(), "bilder-"));
    try {
      mkdirSync(join(dir, ".playwright-mcp"));
      writeFileSync(join(dir, ".playwright-mcp", "ok.png"), "x");
      mkdirSync(join(dir, "ordner.png"));
      writeFileSync(join(dir, "rest.png"), "x");
      writeFileSync(join(dir, "notiz.md"), "x");
      expect(B.bildResteFuer(dir)).toEqual(["rest.png"]);
      expect(B.bildResteFuer(join(dir, "gibt-es-nicht"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("baueText: Hinweiszeile nennt die Dateien und .playwright-mcp/; ohne Reste keine Zeile; nicht blockierend", () => {
    const t = S.baueText({ aktion: "nichts", basis: "abc", bildReste: ["rest.png", "b.jpg"] } as Partial<Ergebnis>);
    expect(t).toContain("Bilddateien im Hauptcheckout-Root: rest.png, b.jpg");
    expect(t).toContain(".playwright-mcp/");
    expect(S.baueText({ aktion: "nichts", basis: "abc", bildReste: [] } as Partial<Ergebnis>)).not.toContain("Bilddateien");
    const ex = (raw as unknown as { exitCodeFuer: (e: unknown) => number }).exitCodeFuer;
    expect(ex({ aktion: "nichts", bildReste: ["rest.png"] })).toBe(ex({ aktion: "nichts" }));
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
  test("--text behauptet nichts über die Session-Basis (#1537)", () => {
    for (const e of [{ aktion: "nichts", basis: "abc" }, { aktion: "pull", gepullt: true, hinter: 2, basis: "abc" }]) {
      const t = S.ausgabe(e, true);
      expect(t).toContain("Stand vor diesem Sync: abc");
      expect(t).not.toMatch(/nicht die Basis/);
      expect(t).toContain("SessionStart-Kontext");
      expect(t).not.toContain("Sitzungsbasis");
    }
  });
  test("ohne Text nichts; Notiz erscheint im Text", () => {
    expect(S.ausgabe({ aktion: "nichts" }, false)).toBe("");
    expect(S.baueText({ aktion: "nichts", notiz: "git fetch fehlgeschlagen (x)", basis: "abc" })).toContain("Haupt-Sync: git fetch fehlgeschlagen");
  });
});

/** Umgebung ohne geerbte Git-Variablen (`GIT_DIR` & Co. aus einem Hook- oder Worktree-Lauf würden die Temp-Repos umlenken, #1428 Z36). */
const sauberEnv = (extra: Record<string, string> = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|PREFIX|NAMESPACE)$/.test(k)));
  return { ...env, ...extra };
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", env: sauberEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Bare-Remote + Haupt-Klon (main) + zweiter Klon, der Commits auf origin schiebt. */
function aufbau() {
  const wurzel = mkdtempSync(join(tmpdir(), "haupt-sync-"));
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
      expect(e.harness).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
      expect(git(t.haupt, "rev-parse", "HEAD")).not.toBe(alt);
      expect(git(t.haupt, "rev-parse", "HEAD")).toBe(git(t.haupt, "rev-parse", "origin/main"));
    } finally {
      t.aufraeumen();
    }
  });

  test("Pull ohne nutzbare Config (agenten.ticketSkill fehlt): Fast-Forward bleibt, der Grund steht in notiz und macht --streng rot, der Kern-Skill-Pfad gilt trotzdem als Skill (#1748)", () => {
    const t = aufbau();
    try {
      t.schiebe(".agents/skills/factory-ticket/SKILL.md", "neu\n");
      const e = S.fuehreSyncAus(t.haupt, { config: { praefixe: { branch: "feature/ab-", worktree: "ab-" }, agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g" } } });
      expect(e.gepullt).toBe(true);
      expect(e.notiz).toContain("agenten.ticketSkill");
      expect(e.notiz).toContain("Fix:");
      expect(S.exitCodeFuer(e)).toBe(1);
      expect(e.harness?.skill).toEqual([".agents/skills/factory-ticket/SKILL.md"]);
      expect(e.harness?.sonstige).toEqual([]);
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
      expect(e.harness?.agenten).toEqual([".claude/agents/x.md"]);
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
    const wurzel = mkdtempSync(join(tmpdir(), "haupt-sync-leer-"));
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

// #1428 Z10/Z36: die CLI-Tests starten echte Git-Prozesse (2,4–2,8 s); unter Last riss der Vitest-Standard (5 s) beim Fast-Forward-Test.
describe("--streng: Exit-Code des Skill-Schritts 0 (#1392 Z32)", { timeout: 30_000 }, () => {
  const X = raw as unknown as { exitCodeFuer: (e: Record<string, unknown>) => number };
  const cli = (dir: string, ...args: string[]) => {
    try {
      const out = execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/haupt-sync.mjs", import.meta.url)), ...args], {
        encoding: "utf8",
        env: sauberEnv({ CLAUDE_PROJECT_DIR: dir }),
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

  test("--text: nur der Ticket-Skill oder die Wurzel-AGENTS.md löst „Skill neu lesen“ aus; der Hook-Modus bleibt beim Neustart-Hinweis", () => {
    const e = { aktion: "pull", gepullt: true, hinter: 3, basis: "abc", harness: { skill: [".agents/skills/factory-ticket/SKILL.md", "AGENTS.md"], agenten: [], sonstige: [], lockGeaendert: false } };
    const text = S.ausgabe(e, true);
    expect(text).toContain("Skill neu lesen");
    expect(text).toContain("Geändert (Harness): .agents/skills/factory-ticket/SKILL.md, AGENTS.md");
    expect(text).toContain("git diff <Stand vor diesem Sync> HEAD -- AGENTS.md");
    expect(text).not.toContain("Sitzungsbasis");
    const hook = (JSON.parse(S.ausgabe(e, false)) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(hook).toContain("neu starten");
    expect(hook).not.toContain("Skill neu lesen");
  });

  test("--text: ohne AGENTS.md im Diff kein AGENTS.md-Hinweis; nur Agent-Definition: Pfad und Neustart-Hinweis, kein „Skill neu lesen“", () => {
    const nurSkill = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [".agents/skills/factory-ticket/SKILL.md"], agenten: [], sonstige: [], lockGeaendert: false } } as never, true);
    expect(nurSkill).toContain("Skill neu lesen");
    expect(nurSkill).not.toContain("git diff <Stand vor diesem Sync> HEAD -- AGENTS.md");
    const agent = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [".claude/agents/x.md"], sonstige: [], lockGeaendert: false } } as never, true);
    expect(agent).not.toContain("Skill neu lesen");
    expect(agent).toContain("Geändert (Harness): .claude/agents/x.md");
    expect(agent).toContain("gelten erst nach Session-Neustart");
    expect(agent).toContain("Umsetzer-Zusatz");
  });

  test("--text: ein anderer Skill unter .claude/skills nennt den Pfad und den Neustart-Hinweis, kein „Skill neu lesen“", () => {
    const text = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [], sonstige: [".claude/skills/forum/SKILL.md"], lockGeaendert: false } } as never, true);
    expect(text).toContain("Geändert (Harness): .claude/skills/forum/SKILL.md");
    expect(text).not.toContain("Skill neu lesen");
    expect(text).toContain("Übrige .claude-Dateien");
    expect(text).toContain("Session-Neustart");
  });

  test("ordneHarnessAenderungen: Dateien unter .agents/ sind eine Harness-Änderung, ähnliche Pfade nicht (#1848)", () => {
    const o = S.ordneHarnessAenderungen([".agents/skills/forum/SKILL.md", "docs/.agents/x.md", ".agentsx/y", "agents/z.md"]);
    expect(o.sonstige).toEqual([".agents/skills/forum/SKILL.md"]);
    expect(o.skill).toEqual([]);
    const text = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: o }, true);
    expect(text).toContain("Geändert (Harness): .agents/skills/forum/SKILL.md");
    expect(text).toContain("ab dem nächsten Skill-Aufruf");
    expect(text).not.toContain("Session-Neustart");
    expect(text).not.toContain("Übrige .claude-Dateien");
  });

  test("Ticket-Skills (#1866): die Verzeichnis-Konstanten stehen nur in skill-pfade.mjs, haupt-sync und skills-sync führen keine eigene", () => {
    const sync = syncRaw as unknown as { QUELL_VERZEICHNIS?: string; ZEIGER_MARKE?: string; WERKZEUGE: { claude: string } };
    const h = raw as unknown as { QUELL_VERZEICHNIS?: string; ZEIGER_WURZEL?: string };
    expect(sync.WERKZEUGE.claude).toBe(pfade.ZEIGER_WURZEL);
    expect(sync.QUELL_VERZEICHNIS).toBeUndefined();
    expect(sync.ZEIGER_MARKE).toBeUndefined();
    expect(h.QUELL_VERZEICHNIS).toBeUndefined();
    expect(h.ZEIGER_WURZEL).toBeUndefined();
    expect(S.ZEIGER_VERZEICHNISSE[0]).toBe(`${pfade.ZEIGER_WURZEL}/factory/`);
  });

  test("Ticket-Skills (#1850): Quelle und Zeiger beider Skills sind Skill-Änderungen, eine fremde Quelle und ein Nachbarname nicht", () => {
    const z = [".claude/skills/factory/SKILL.md", ".claude/skills/factory-ticket/SKILL.md"];
    expect(S.ZEIGER_VERZEICHNISSE).toEqual([".claude/skills/factory/", ".claude/skills/factory-ticket/"]);
    expect(S.ordneHarnessAenderungen(z)).toMatchObject({ skill: z, sonstige: [] });
    const q = [".agents/skills/factory/SKILL.md", ".agents/skills/factory-ticket/SKILL.md"];
    expect(S.ordneHarnessAenderungen(q)).toMatchObject({ skill: q, sonstige: [] });
    expect(S.ordneHarnessAenderungen([".agents/skills/review-lenses/SKILL.md", ".agents/skills/factory-ticketx/SKILL.md"])).toMatchObject({
      skill: [],
      sonstige: [".agents/skills/review-lenses/SKILL.md", ".agents/skills/factory-ticketx/SKILL.md"],
    });
  });

  test("Hinweissätze zu sonstigen Dateien (#1850): .claude nur Neustart, Skill-Quelle nur Aufruf, beides beide, .agents außerhalb von skills Neustart", () => {
    const text = (sonstige: string[]) => S.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [], sonstige } }, { sitzungsbasis: false });
    const NEUSTART = "gelten erst nach einem Session-Neustart";
    const AUFRUF = "ab dem nächsten Skill-Aufruf";
    const nurClaude = text([".claude/settings.json"]);
    expect(nurClaude).toContain(NEUSTART);
    expect(nurClaude).not.toContain(AUFRUF);
    const nurQuelle = text([".agents/skills/forum/SKILL.md"]);
    expect(nurQuelle).toContain(AUFRUF);
    expect(nurQuelle).not.toContain(NEUSTART);
    const beides = text([".claude/settings.json", ".agents/skills/forum/SKILL.md"]);
    expect(beides).toContain(NEUSTART);
    expect(beides).toContain(AUFRUF);
    const fremd = text([".agents/README.md"]);
    expect(fremd).toContain(NEUSTART);
    expect(fremd).not.toContain(AUFRUF);
  });

  test("Ticket-Skills (#1850): „Skill neu lesen“ nennt immer die Quelle, nie den Zeiger, und doppelt nichts", () => {
    const harness = (skill: string[]) => ({ skill, agenten: [], sonstige: [], lockGeaendert: false });
    const text = (skill: string[]) => S.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: harness(skill) }, { sitzungsbasis: false });
    const nurZeiger = text([".claude/skills/factory-ticket/SKILL.md"]);
    expect(nurZeiger).toContain("`.agents/skills/factory-ticket/SKILL.md` jetzt neu lesen");
    expect(nurZeiger).not.toContain(".claude/skills/factory-ticket/SKILL.md` jetzt");
    expect(nurZeiger).toContain("Skill neu lesen: .agents/skills/factory-ticket/SKILL.md haben");
    const beide = text([".agents/skills/factory/SKILL.md", ".claude/skills/factory/SKILL.md"]);
    expect(beide).toContain("Skill neu lesen: .agents/skills/factory/SKILL.md haben");
    expect(beide.match(/\.agents\/skills\/factory\/SKILL\.md/g)).toHaveLength(3); // Geändert-Zeile (Quelle) + Liste + Lies-Satz
    const nurAblauf = text([".agents/skills/factory/ablauf.md"]);
    expect(nurAblauf).toContain("`.agents/skills/factory/ablauf.md` jetzt neu lesen");
    expect(S.quellePfad(".claude/skills/factory/SKILL.md")).toBe(".agents/skills/factory/SKILL.md");
    expect(S.quellePfad("AGENTS.md")).toBe("AGENTS.md");
    expect(S.quellePfad(".claude/skills/forum/SKILL.md")).toBe(".claude/skills/forum/SKILL.md");
  });

  test("Ticket-Skills (#1866): ändern sich beide Ticket-Skills, nennt „Skill neu lesen“ beide SKILL.md; ablauf.md nur ohne SKILL.md", () => {
    const text = (skill: string[]) => S.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill, agenten: [], sonstige: [] } }, { sitzungsbasis: false });
    const beide = text([".claude/skills/factory/SKILL.md", ".claude/skills/factory-ticket/SKILL.md", ".agents/skills/factory/ablauf.md"]);
    expect(beide).toContain("`.agents/skills/factory/SKILL.md`, `.agents/skills/factory-ticket/SKILL.md` jetzt neu lesen");
    expect(beide).not.toContain("`.agents/skills/factory/ablauf.md` jetzt");
    const ohneSkillMd = text([".agents/skills/factory/ablauf.md", ".agents/skills/factory/weiteres.md"]);
    expect(ohneSkillMd).toContain("`.agents/skills/factory/ablauf.md` jetzt neu lesen");
    expect(ohneSkillMd).not.toContain("weiteres.md` jetzt");
    expect(text(["AGENTS.md"])).toContain("Den Ticket-Skill jetzt neu lesen");
  });

  test("Ticket-Skills: ohne SKILL.md nennt der Lies-Satz nur die erste ablauf.md, die Liste der Änderungen alle", () => {
    const text = (skill: string[]) => S.baueText({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill, agenten: [], sonstige: [] } }, { sitzungsbasis: false });
    const zwei = text([".agents/skills/factory/ablauf.md", ".agents/skills/factory-ticket/ablauf.md"]);
    expect(zwei).toContain("Skill neu lesen: .agents/skills/factory/ablauf.md, .agents/skills/factory-ticket/ablauf.md haben");
    expect(zwei).toContain("`.agents/skills/factory/ablauf.md` jetzt neu lesen");
    expect(zwei).not.toContain("factory-ticket/ablauf.md` jetzt");
  });

  test("--text: der Hinweis auf übrige .claude-Dateien kommt auch im Mischfall, fehlt aber ohne solche Dateien", () => {
    const misch = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [".claude/agents/x.md"], sonstige: [".claude/settings.json"], lockGeaendert: false } } as never, true);
    expect(misch).toContain("Übrige .claude-Dateien");
    const ohne = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [".agents/skills/factory-ticket/SKILL.md"], agenten: [], sonstige: [], lockGeaendert: false } } as never, true);
    expect(ohne).not.toContain("Übrige .claude-Dateien");
  });

  test("ordneHarnessAenderungen wirft nie: undefined, null und kein Array ergeben die leere Ordnung", () => {
    for (const x of [undefined, null, "AGENTS.md", {}]) expect(S.ordneHarnessAenderungen(x as never)).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
  });

  test("--text: genau 8 Pfade stehen ohne „weitere“-Angabe", () => {
    const sonstige = Array.from({ length: 8 }, (_, i) => `.claude/x${i}.json`);
    const text = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [], sonstige, lockGeaendert: false } } as never, true);
    expect(text).toContain(".claude/x7.json");
    expect(text).not.toContain("weitere");
  });

  test("--text: lange Pfadliste wird auf 8 gekürzt", () => {
    const sonstige = Array.from({ length: 11 }, (_, i) => `.claude/x${i}.json`);
    const text = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [], sonstige, lockGeaendert: false } } as never, true);
    expect(text).toContain(".claude/x7.json");
    expect(text).not.toContain(".claude/x8.json");
    expect(text).toContain("… und 3 weitere");
  });

  test("--text: Node-Versionszeile entfällt (der SessionStart-Hook meldet sie), node_modules nur wenn der Sync package-lock.json geändert hat", () => {
    const e = { aktion: "nichts", basis: "abc", nodeHinweis: "Node 20 erfüllt nicht", nodeModulesHinweis: "node_modules passt nicht" };
    const text = S.ausgabe(e, true);
    expect(text).not.toContain("Node-Version");
    expect(text).not.toContain("Abhängigkeiten");
    const mitLock = S.ausgabe({ ...e, harness: { skill: [], agenten: [], sonstige: [], lockGeaendert: true } } as never, true);
    expect(mitLock).toContain("Abhängigkeiten: node_modules passt nicht");
    expect(mitLock).not.toContain("Node-Version");
    const hook = (JSON.parse(S.ausgabe(e, false)) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(hook).toContain("Node-Version:");
    expect(hook).toContain("Abhängigkeiten:");
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

  test("CLI: --text behauptet nicht, der Stand sei nicht die Basis der Session (#1537)", () => {
    const t = aufbau();
    try {
      const hook = cli(t.haupt);
      const basis = /Sitzungsbasis: ([0-9a-f]+)/.exec(hook.out)?.[1];
      expect(basis).toBeTruthy();
      const r = cli(t.haupt, "--text", "--streng");
      expect(r.code).toBe(0);
      expect(r.out).toContain(`Stand vor diesem Sync: ${basis}`);
      expect(r.out).not.toMatch(/nicht die Basis/);
    } finally {
      t.aufraeumen();
    }
  });

  test("CLI: main hinter origin und sauber → Fast-Forward, Exit 0; geänderter Skill-Pfad meldet „Skill neu lesen“", () => {
    const t = aufbau();
    try {
      t.schiebe(".agents/skills/factory-ticket/SKILL.md", "neu\n");
      const r = cli(t.haupt, "--text", "--streng");
      expect(r.code).toBe(0);
      expect(r.out).toContain("Skill neu lesen");
      expect(r.out).toContain("Stand vor diesem Sync");
    } finally {
      t.aufraeumen();
    }
  });

  test("der Ticket-Skill beginnt mit Schritt 0 (haupt-sync --streng), nennt Stopp bei Exit 1 und die Neu-Lesen-Regel; kein „nie ein eigenes git pull“ mehr", () => {
    const skill = readFileSync(new URL("../../.agents/skills/factory/ablauf.md", import.meta.url), "utf8");
    const schritt0 = /^0\. \*\*Hauptcheckout heben[^\n]*\n/m.exec(skill)?.[0] ?? "";
    expect(schritt0).toContain("node scripts/haupt-sync.mjs --text --streng");
    expect(schritt0).toMatch(/Exit 1/);
    expect(schritt0).toMatch(/kein Ticket starten/);
    expect(schritt0).toMatch(/SKILL\.md[^\n]*neu/);
    expect(skill.indexOf("0. **Hauptcheckout heben")).toBeLessThan(skill.indexOf("1. **Auswählen und claimen.**"));
    expect(skill).not.toMatch(/nie ein eigenes `git pull`/);
  });
});

describe("Node-Versionsprüfung (#1411)", { timeout: 30_000 }, () => {
  const N = raw as unknown as {
    pruefeNodeVersion: (v: string, engines: unknown) => string | null;
    nodeHinweisFuer: (dir: string, v?: string) => string;
    baueText: (e: Partial<Ergebnis> & { nodeHinweis?: string }) => string;
  };
  test("erfüllt (gleich, höher in Major, Minor oder Patch): kein Hinweis", () => {
    expect(N.pruefeNodeVersion("22.22.3", ">=22.22.3")).toBeNull();
    expect(N.pruefeNodeVersion("22.22.4", ">=22.22.3")).toBeNull();
    expect(N.pruefeNodeVersion("22.23.0", ">=22.22.3")).toBeNull();
    expect(N.pruefeNodeVersion("24.0.0", ">=22.22.3")).toBeNull();
    expect(N.pruefeNodeVersion("v22.17.0", ">=22")).toBeNull();
  });
  test("nicht erfüllt: Hinweis mit Ist-Version und Soll (Patch, Minor und Major)", () => {
    expect(N.pruefeNodeVersion("22.17.0", ">=22.22.3")).toMatch(/22\.17\.0.*>=22\.22\.3/);
    expect(N.pruefeNodeVersion("22.22.2", ">=22.22.3")).not.toBeNull();
    expect(N.pruefeNodeVersion("20.11.1", ">=22")).not.toBeNull();
    expect(N.pruefeNodeVersion("22.1.0", ">= 22.2")).not.toBeNull();
  });
  test("andere Formen, fehlende Angabe oder kaputte Version werden still übersprungen", () => {
    for (const e of ["^22.0.0", "22.x", ">=22 <25", "", undefined, null, 22]) expect(N.pruefeNodeVersion("18.0.0", e)).toBeNull();
    expect(N.pruefeNodeVersion("kaputt", ">=22")).toBeNull();
  });
  test("nodeHinweisFuer liest engines.node aus der package.json und ist fail-open", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ engines: { node: ">=99" } }));
      expect(N.nodeHinweisFuer(dir, "22.17.0")).toMatch(/erfüllt engines\.node/);
      expect(N.nodeHinweisFuer(join(dir, "gibt-es-nicht"), "22.17.0")).toBe("");
      writeFileSync(join(dir, "package.json"), "{ kaputt");
      expect(N.nodeHinweisFuer(dir, "22.17.0")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("der Hinweis steht im Kontext-Text der Session", () => {
    expect(N.baueText({ nodeHinweis: "Node 22.17.0 erfüllt nicht" })).toContain("Node-Version: Node 22.17.0 erfüllt nicht");
    expect(N.baueText({})).toBe("");
  });
});

describe("node_modules gegen package-lock.json (#1428 Z2)", { timeout: 30_000 }, () => {
  const N = raw as unknown as {
    pruefeNodeModules: (lock: string, hidden: string | null) => string | null;
    nodeModulesHinweisFuer: (dir: string) => string;
    baueText: (e: Partial<Ergebnis> & { nodeModulesHinweis?: string }) => string;
  };
  const lock = (packages: Record<string, unknown>) => JSON.stringify({ packages: { "": { name: "x" }, ...packages } });
  const hidden = (packages: Record<string, unknown>) => JSON.stringify({ packages });
  const L = lock({ "node_modules/a": { version: "1.0.0" }, "node_modules/b": { version: "2.0.0" }, "node_modules/opt": { version: "3.0.0", optional: true } });

  test("gleich: kein Hinweis (fehlendes optionales Paket ist ok)", () => {
    expect(N.pruefeNodeModules(L, hidden({ "node_modules/a": { version: "1.0.0" }, "node_modules/b": { version: "2.0.0" } }))).toBeNull();
  });
  test("abweichende Version und fehlendes Pflichtpaket werden gezählt", () => {
    const h = hidden({ "node_modules/a": { version: "1.0.1" } });
    expect(N.pruefeNodeModules(L, h)).toMatch(/\(2 Pakete\).*npm ci/);
    expect(N.pruefeNodeModules(L, hidden({ "node_modules/a": { version: "1.0.0" } }))).toMatch(/\(1 Pakete\)/);
  });
  test("Workspace-Einträge außerhalb von node_modules/ und Links zählen nicht als fehlend", () => {
    const l = lock({ "packages/x": { version: "1.0.0" }, "node_modules/x": { version: "1.0.0", link: true } });
    expect(N.pruefeNodeModules(l, hidden({}))).toBeNull();
    expect(N.pruefeNodeModules(lock({ "node_modules/y": { version: "1.0.0" } }), hidden({}))).toMatch(/\(1 Pakete\)/);
  });
  test("kein Install-Stand: eigener Hinweis", () => {
    expect(N.pruefeNodeModules(L, null)).toMatch(/keinen Install-Stand/);
  });
  test("kaputtes JSON in Lock oder Install-Stand: fail-open (null)", () => {
    expect(N.pruefeNodeModules("{ kaputt", hidden({}))).toBeNull();
    expect(N.pruefeNodeModules(L, "{ kaputt")).toBeNull();
    expect(N.pruefeNodeModules(JSON.stringify({}), hidden({}))).toBeNull();
  });
  test("nodeModulesHinweisFuer liest beide Dateien; ohne Lock fail-open", () => {
    const dir = mkdtempSync(join(tmpdir(), "nm-"));
    try {
      expect(N.nodeModulesHinweisFuer(dir)).toBe("");
      writeFileSync(join(dir, "package-lock.json"), L);
      expect(N.nodeModulesHinweisFuer(dir)).toMatch(/Install-Stand/);
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", ".package-lock.json"), hidden({ "node_modules/a": { version: "9.9.9" }, "node_modules/b": { version: "2.0.0" } }));
      expect(N.nodeModulesHinweisFuer(dir)).toMatch(/\(1 Pakete\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("der Hinweis steht im Kontext-Text, ändert aber den Exit-Code von --streng nicht", () => {
    expect(N.baueText({ nodeModulesHinweis: "node_modules passt nicht" })).toContain("Abhängigkeiten: node_modules passt nicht");
    expect(X0.exitCodeFuer({ aktion: "nichts", branch: "main", sauber: true, nodeModulesHinweis: "x" })).toBe(0);
  });
});
const X0 = raw as unknown as { exitCodeFuer: (e: Record<string, unknown>) => number };

// #1568 Z8: der Abgleich-Hook lief parallel zum Sync und lud den alten Code des Hauptcheckouts; `--danach` startet ihn erst nach dem Fast-Forward.
describe("--danach: ein Folge-Hook läuft erst nach dem Sync (#1568)", { timeout: 30_000 }, () => {
  const D = raw as unknown as {
    aufrufLesen: (argv: string[]) => { text?: boolean; streng?: boolean; danach?: string | null; fehler?: string };
    starteDanach: (skript: string, text: string, o?: { spawnSync?: (...a: unknown[]) => unknown; execPath?: string }) => boolean;
  };
  const skriptPfad = fileURLToPath(new URL("../../scripts/haupt-sync.mjs", import.meta.url));

  test("aufrufLesen: danach ist der Wert hinter --danach; ohne Flag, leer oder im Modus --text null", () => {
    expect(D.aufrufLesen(["--danach", "/x/a.mjs"]).danach).toBe("/x/a.mjs");
    expect(D.aufrufLesen(["--streng", "--danach", "/x/a.mjs"])).toEqual({ text: false, streng: true, danach: "/x/a.mjs" });
    expect(D.aufrufLesen([])).toEqual({ text: false, streng: false, danach: null });
    expect(D.aufrufLesen(["--danach", ""]).danach).toBeNull();
    expect(D.aufrufLesen(["--text", "--danach", "/x/a.mjs"])).toEqual({ text: true, streng: false, danach: null });
    expect(D.aufrufLesen(["--text", "--streng"])).toEqual({ text: true, streng: true, danach: null });
  });

  test("aufrufLesen: unbekanntes Flag, Positionsargument, fehlender Wert, doppeltes Flag und Inline-Wert bei einem Schalter sind Fehler", () => {
    expect(D.aufrufLesen(["--bogus"]).fehler).toBe("Unbekanntes Argument: --bogus");
    expect(D.aufrufLesen(["x"]).fehler).toBe("Unbekanntes Argument: x");
    expect(D.aufrufLesen(["--danach"]).fehler).toBe("--danach braucht einen Wert");
    expect(D.aufrufLesen(["--danach", "--text"]).fehler).toBe("--danach braucht einen Wert");
    expect(D.aufrufLesen(["--text", "--text"]).fehler).toBe("--text ist doppelt angegeben");
    expect(D.aufrufLesen(["--streng=1"]).fehler).toBe("Unbekanntes Argument: --streng=1");
  });

  test("starteDanach: node <skript> mit stdin-Text und Zeitgrenze; Fehler und Wurf geben false statt zu werfen", () => {
    const aufrufe: { args: unknown[]; opts: Record<string, unknown> }[] = [];
    const ok = D.starteDanach("/x/a.mjs", '{"session_id":"s1"}', {
      execPath: "NODE",
      spawnSync: (...a: unknown[]) => {
        aufrufe.push({ args: a, opts: a[2] as Record<string, unknown> });
        return { status: 0 };
      },
    });
    expect(ok).toBe(true);
    expect(aufrufe[0].args[0]).toBe("NODE");
    expect(aufrufe[0].args[1]).toEqual(["/x/a.mjs"]);
    expect(aufrufe[0].opts.input).toBe('{"session_id":"s1"}');
    expect(aufrufe[0].opts.timeout).toBeLessThanOrEqual(10_000);
    expect(aufrufe[0].opts.stdio).toEqual(["pipe", "ignore", "ignore"]); // die Ausgabe des Folge-Skripts darf die Hook-JSON nicht stören
    expect(D.starteDanach("/x/a.mjs", "", { spawnSync: () => ({ error: new Error("ENOENT") }) })).toBe(false);
    expect(D.starteDanach("/x/a.mjs", "", { spawnSync: () => { throw new Error("kaputt"); } })).toBe(false);
  });

  /** Ein Folge-Skript, das HEAD des Hauptcheckouts und seinen stdin in eine Marker-Datei schreibt. */
  function folgeSkript(ordner: string, haupt: string) {
    const marker = join(ordner, "marker.json");
    const skript = join(ordner, "folge.mjs");
    writeFileSync(
      skript,
      [
        'import { execFileSync } from "node:child_process";',
        'import { readFileSync, writeFileSync } from "node:fs";',
        `const head = execFileSync("git", ["-C", ${JSON.stringify(haupt)}, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();`,
        `writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ head, stdin: readFileSync(0, "utf8") }));`,
      ].join("\n"),
    );
    return { skript, marker };
  }
  const laufe = (dir: string, input: string, ...args: string[]) =>
    execFileSync(process.execPath, [skriptPfad, ...args], { encoding: "utf8", input, env: sauberEnv({ CLAUDE_PROJECT_DIR: dir }), stdio: ["pipe", "pipe", "pipe"] });

  test("CLI: das Folge-Skript sieht den schon vorgespulten HEAD und den unveränderten stdin-Text; die Hook-Ausgabe bleibt reines JSON", () => {
    const t = aufbau();
    try {
      t.schiebe("scripts/langfuse-nachliefern.mjs", "neu\n");
      const f = folgeSkript(t.wurzel, t.haupt);
      const alt = git(t.haupt, "rev-parse", "HEAD");
      const out = laufe(t.haupt, '{"session_id":"s1","source":"startup"}', "--danach", f.skript);
      const m = JSON.parse(readFileSync(f.marker, "utf8")) as { head: string; stdin: string };
      expect(m.head).toBe(git(t.haupt, "rev-parse", "origin/main"));
      expect(m.head).not.toBe(alt);
      expect(m.stdin).toBe('{"session_id":"s1","source":"startup"}');
      expect(() => { JSON.parse(out); }).not.toThrow(); // das Folge-Skript schreibt nichts in die Ausgabe des Hooks
    } finally {
      t.aufraeumen();
    }
  });

  test("CLI: Abbruch (dirty Hauptcheckout) und fehlendes Folge-Skript: das Folge-Skript läuft trotzdem, der Hook endet ohne Fehler", () => {
    const t = aufbau();
    try {
      const f = folgeSkript(t.wurzel, t.haupt);
      writeFileSync(join(t.haupt, "a.txt"), "lokal geändert\n");
      t.schiebe("docs/x.md", "x\n");
      laufe(t.haupt, "{}", "--danach", f.skript);
      expect((JSON.parse(readFileSync(f.marker, "utf8")) as { head: string }).head).toBe(git(t.haupt, "rev-parse", "HEAD"));
      expect(() => laufe(t.haupt, "{}", "--danach", join(t.wurzel, "gibt-es-nicht.mjs"))).not.toThrow();
    } finally {
      t.aufraeumen();
    }
  });

  test("CLI: ohne --danach und im Modus --text startet nichts", () => {
    const t = aufbau();
    try {
      const f = folgeSkript(t.wurzel, t.haupt);
      laufe(t.haupt, "{}");
      laufe(t.haupt, "{}", "--text", "--danach", f.skript);
      expect(() => readFileSync(f.marker, "utf8")).toThrow();
    } finally {
      t.aufraeumen();
    }
  });

  test("Verdrahtung: SessionStart hat genau einen haupt-sync-Eintrag, der den Abgleich per --danach startet; kein paralleler Abgleich-Eintrag; SessionEnd startet ihn weiter", () => {
    const settings = JSON.parse(readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8")) as {
      hooks: Record<string, { hooks: { args?: string[] }[] }[]>;
    };
    const args = (ereignis: string) => (settings.hooks[ereignis] ?? []).flatMap((e) => e.hooks.map((h) => h.args ?? []));
    const start = args("SessionStart");
    const sync = start.filter((a) => a.some((x) => x.endsWith("/scripts/haupt-sync.mjs")));
    expect(sync).toHaveLength(1);
    const i = sync[0].indexOf("--danach");
    expect(i).toBeGreaterThan(0);
    expect(sync[0][i + 1]).toMatch(/\/scripts\/langfuse-abgleich-hook\.mjs$/);
    expect(start.filter((a) => a.some((x) => x.endsWith("/scripts/langfuse-abgleich-hook.mjs") && a !== sync[0]))).toHaveLength(0);
    expect(args("SessionEnd").some((a) => a.some((x) => x.endsWith("/scripts/langfuse-abgleich-hook.mjs")))).toBe(true);
  });
});
