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
type Ergebnis = { aktion: string; grund: string; hinter: number; basis: string; gepullt: boolean; harness?: { skill: string[]; agenten: string[]; sonstige: string[] }; notiz: string };
const S = raw as unknown as {
  entscheideSync: (e: Eingabe) => { aktion: "pull" | "melden" | "nichts"; grund: string };
  ordneHarnessAenderungen: (d: string[]) => { skill: string[]; agenten: string[]; sonstige: string[]; lockGeaendert: boolean };
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
  test("ordneHarnessAenderungen: kubernia-Skill und Wurzel-AGENTS.md, Agent-Definitionen und Sonstiges getrennt (#1572)", () => {
    expect(S.ordneHarnessAenderungen([".claude/skills/kubernia/SKILL.md", "AGENTS.md"])).toMatchObject({ skill: [".claude/skills/kubernia/SKILL.md", "AGENTS.md"], agenten: [], sonstige: [] });
    expect(S.ordneHarnessAenderungen([".claude/agents/kubernia-planner.md"])).toMatchObject({ skill: [], agenten: [".claude/agents/kubernia-planner.md"] });
    expect(S.ordneHarnessAenderungen([".claude/skills/andere/SKILL.md", ".claude/settings.json", "src/content/AGENTS.md"])).toMatchObject({ skill: [], agenten: [], sonstige: [".claude/skills/andere/SKILL.md", ".claude/settings.json", "src/content/AGENTS.md"] });
    expect(S.ordneHarnessAenderungen(["docs/x.md", "src/a.ts"])).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
    expect(S.ordneHarnessAenderungen([])).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
    expect(S.ordneHarnessAenderungen(["package-lock.json"]).lockGeaendert).toBe(true);
    expect(S.ordneHarnessAenderungen([".claude/skills/kubernia-workflow/SKILL.md"]).skill).toEqual([]);
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
    const dir = mkdtempSync(join(tmpdir(), "kq-bilder-"));
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
      expect(e.harness).toEqual({ skill: [], agenten: [], sonstige: [], lockGeaendert: false });
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

  test("--text: nur der kubernia-Skill oder die Wurzel-AGENTS.md löst „Skill neu lesen“ aus; der Hook-Modus bleibt beim Neustart-Hinweis", () => {
    const e = { aktion: "pull", gepullt: true, hinter: 3, basis: "abc", harness: { skill: [".claude/skills/kubernia/SKILL.md", "AGENTS.md"], agenten: [], sonstige: [], lockGeaendert: false } };
    const text = S.ausgabe(e, true);
    expect(text).toContain("Skill neu lesen");
    expect(text).toContain("Geändert (Harness): .claude/skills/kubernia/SKILL.md, AGENTS.md");
    expect(text).toContain("git diff <Stand vor diesem Sync> HEAD -- AGENTS.md");
    expect(text).not.toContain("Sitzungsbasis");
    const hook = (JSON.parse(S.ausgabe(e, false)) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(hook).toContain("neu starten");
    expect(hook).not.toContain("Skill neu lesen");
  });

  test("--text: ohne AGENTS.md im Diff kein AGENTS.md-Hinweis; nur Agent-Definition: Pfad und Neustart-Hinweis, kein „Skill neu lesen“", () => {
    const nurSkill = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [".claude/skills/kubernia/SKILL.md"], agenten: [], sonstige: [], lockGeaendert: false } } as never, true);
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

  test("--text: der Hinweis auf übrige .claude-Dateien kommt auch im Mischfall, fehlt aber ohne solche Dateien", () => {
    const misch = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [], agenten: [".claude/agents/x.md"], sonstige: [".claude/settings.json"], lockGeaendert: false } } as never, true);
    expect(misch).toContain("Übrige .claude-Dateien");
    const ohne = S.ausgabe({ aktion: "pull", gepullt: true, hinter: 1, basis: "abc", harness: { skill: [".claude/skills/kubernia/SKILL.md"], agenten: [], sonstige: [], lockGeaendert: false } } as never, true);
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

describe("Node-Versionsprüfung (#1411)", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "kq-node-"));
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

describe("node_modules gegen package-lock.json (#1428 Z2)", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "kq-nm-"));
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
