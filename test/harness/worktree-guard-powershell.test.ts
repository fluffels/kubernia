/* Worktree-Guard für das PowerShell-Tool (#1311, Z25).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Der Bash-Hook (`worktree-guard-hook.mjs`) hängt nur am Matcher `Bash`; über das PowerShell-Tool lief ein
 * Commit im geteilten Haupt-Checkout ungeprüft durch (`Set-Location <hauptcheckout>; git commit …`). Der
 * Hook `scripts/worktree-guard-powershell.mjs` bewertet den Befehl mit einem Tokenizer. Die Tests geben
 * Dateisystem und Git-Kontext per Injektion vor (Haupt-Checkout `/repo/main`, Worktree `/repo/wt/kq-1`),
 * damit sie auf Windows und Linux gleich laufen (der Unterordner-Fall mit echtem git steht in worktree-guard.test.ts); die Payload-`cwd` folgt laut Probe dem persistenten
 * `Set-Location` früherer Aufrufe (siehe Hook-Kopf).
 *
 * Ehrliche Grenze: kein vollständiger PowerShell-Parser (siehe Hook-Kopf).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/worktree-guard-powershell.mjs";

type Token = { value: string; literal: boolean };
type Stmt = { tokens: Token[]; raw: string; sep: string };
type Deps = { istOrdner: (p: string) => boolean; kontext: (dir: string) => { relevant: boolean; isMainWorktree: boolean; toplevel?: string } };
const g = raw as unknown as {
  zerlege: (src: string) => Stmt[];
  bewertePowerShell: (o: { command?: string; cwd?: string; repoRoot?: string; deps?: Deps }) => { block: boolean; reason?: string };
  parseHookInput: (t: string) => { tool?: string; cwd?: string; command?: string };
  normPfad: (p: string) => string;
};

const lies = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const HAUPT = "/repo/main";
const WT = "/repo/wt/kq-1";
const ORDNER = new Set([HAUPT, WT, `${HAUPT}/src`, "/repo/wt"].map((p) => g.normPfad(p)));
const deps: Deps = {
  istOrdner: (p) => ORDNER.has(g.normPfad(p)),
  kontext: (dir) => {
    const d = g.normPfad(dir);
    if (d === g.normPfad(HAUPT) || d.startsWith(g.normPfad(HAUPT) + "/")) return { relevant: true, isMainWorktree: true, toplevel: g.normPfad(HAUPT) };
    if (d === g.normPfad(WT)) return { relevant: true, isMainWorktree: false, toplevel: g.normPfad(WT) };
    return { relevant: false, isMainWorktree: false }; // fremdes Repo
  },
};
const pruefe = (command: string, cwd: string = HAUPT) => g.bewertePowerShell({ command, cwd, repoRoot: HAUPT, deps });
const blockt = (command: string, cwd?: string) => assert.equal(pruefe(command, cwd).block, true, command);
const laeuft = (command: string, cwd?: string) => assert.equal(pruefe(command, cwd).block, false, command);

describe("Tokenizer: was zählt als Befehl (#1311)", () => {
  const worte = (s: string) => g.zerlege(s).map((st) => st.tokens.map((t) => t.value));

  test("Trenner ; && || | Zeilenumbruch und Blöcke", () => {
    assert.deepEqual(worte("a b; c && d || e | f\ng { h }"), [["a", "b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
    assert.deepEqual(g.zerlege("a && b; c").map((s) => s.sep), ["&&", ";", ""]);
  });

  test("Strings, Backtick-Escape, Here-Strings und Kommentare sind kein Befehl", () => {
    assert.deepEqual(worte(`git commit -m 'a; git push'`), [["git", "commit", "-m", "a; git push"]]);
    assert.deepEqual(worte(`echo "x \`" y; z"`), [['echo', 'x " y; z']]);
    assert.deepEqual(worte("echo @'\nzeile; git push\n'@ ; ls"), [["echo", "zeile; git push"], ["ls"]]);
    assert.deepEqual(worte("ls # git push\nlsa"), [["ls"], ["lsa"]]);
    assert.deepEqual(worte("ls <# git push; #> ok"), [["ls", "ok"]]);
    assert.deepEqual(worte("a `\nb"), [["a", "b"]], "Zeilenfortsetzung per Backtick");
  });

  test("literal markiert reine '…'-Tokens", () => {
    const [st] = g.zerlege(`x '$a' "$b" $c`);
    assert.deepEqual(st.tokens.map((t) => t.literal), [false, true, false, false]);
  });
});

describe("Haupt-Checkout: commit/push wird geblockt (Z25)", () => {
  test("direkt im Haupt-Checkout", () => {
    blockt("git commit -m x");
    blockt("git push -u origin feature/x");
    blockt("git.exe commit -m x");
    blockt("& git commit -m x");
    blockt(`& 'C:\\Program Files\\Git\\cmd\\git.exe' push`);
  });

  test("der Ausweichweg: Set-Location in den Haupt-Checkout, dann commit (auch aus dem Worktree heraus)", () => {
    blockt(`Set-Location ${HAUPT}; git commit -m x`, WT);
    blockt(`cd ${HAUPT} && git push`, WT);
    blockt(`sl ${HAUPT}\ngit commit -m x`, WT);
    blockt(`Push-Location -Path ${HAUPT}; git commit -m x`, WT);
    blockt(`Set-Location -LiteralPath ${HAUPT}/src; git push`, WT);
    blockt(`git -C ${HAUPT} commit -m x`, WT);
    blockt(`git -C ${HAUPT} -c user.name=x commit -m x`, WT);
  });

  test("Set-Location auf einen FEHLENDEN Ordner: der Ort bleibt, `;` läuft weiter → geblockt", () => {
    blockt("Set-Location /gibt/es/nicht; git commit -m x");
    blockt("cd /gibt/es/nicht\ngit commit -m x");
  });

  test("Verkettung: nach && läuft der Nachfolger bei fehlgeschlagenem cd gar nicht, nach || schon", () => {
    laeuft("cd /gibt/es/nicht && git commit -m x", WT);
    blockt("cd /gibt/es/nicht || git commit -m x");
    laeuft(`cd ${WT} || git commit -m x`, HAUPT);
  });

  test("Verkettung mit Start im Haupt-Checkout: ein fehlgeschlagenes cd überspringt den &&-Nachfolger, ein gelungenes den ||-Nachfolger", () => {
    // cwd = HAUPT: nur das Überspringen lässt den commit durch (sonst läge er im Haupt-Checkout)
    laeuft("cd /gibt/es/nicht && git commit -m x", HAUPT);
    laeuft(`cd ${HAUPT}/src || git commit -m x`, HAUPT);
    laeuft(`cd /gibt/es/nicht && cd ${HAUPT} && git commit -m x`, WT);
  });

  test("nur ein ausgewerteter Ortswechsel überspringt Nachfolger: nach jedem anderen Vorgänger läuft der Nachfolger und wird geprüft", () => {
    blockt("git diff --quiet || git commit -am x", HAUPT);
    blockt("Test-Path x || git push", HAUPT);
    blockt("git status && git commit -m x", HAUPT);
    blockt("Write-Output hallo || git commit -m x", HAUPT);
    blockt("cd $unbekannt || git commit -m x", HAUPT); // nicht auswertbarer Ortswechsel: weder gelungen noch gescheitert
    laeuft(`git diff --quiet || git commit -am x`, WT);
  });

  test("der Status eines früheren Ortswechsels überdauert kein späteres Statement (ortStatus wird je Statement zurückgesetzt)", () => {
    // ohne Reset würde der alte Status (gescheitert bzw. gelungen) einen späteren Nachfolger überspringen
    blockt("cd /gibt/es/nicht; git status && git commit -m x", HAUPT);
    blockt(`cd ${HAUPT}/src; git diff --quiet || git commit -am x`, WT);
    blockt("cd /gibt/es/nicht\ngit status && git commit -m x", HAUPT);
  });

  test("der Ort nach einem fehlgeschlagenen cd bleibt erhalten, ein späteres cd setzt ihn neu", () => {
    blockt(`cd /gibt/es/nicht; cd ${HAUPT} && git commit -m x`, WT);
    laeuft(`cd /gibt/es/nicht; cd ${WT} && git commit -m x`, HAUPT);
  });

  test("relatives und mehrfaches git -C wird gegen den aktuellen Ort aufgelöst", () => {
    blockt("git -C ../../main commit -m x", WT);
    laeuft("git -C ../../wt/kq-1 commit -m x", WT);
    blockt(`git -C /repo -C main commit -m x`, WT);
    laeuft(`git -C /repo/wt -C kq-1 commit -m x`, HAUPT);
  });

  test("bekannte Grenze (festgehalten): ein Ortswechsel IM String eines Interpreters wird nicht ausgewertet", () => {
    // Wer diese Lücke schließt, dreht die erste Zeile um (blockt statt läuft): das ist dann keine Regression.
    // `bash -c "cd <haupt> && git commit"` aus dem Worktree: die grobe Regel prüft gegen den aktuellen Ort (WT) und lässt durch.
    laeuft(`bash -c "cd ${HAUPT} && git commit -m x"`, WT);
    blockt(`bash -c "git commit -m x"`, HAUPT);
  });

  test("Interpreter-Umwege: iex, pwsh -c, cmd /c, Start-Process mit git commit/push", () => {
    blockt(`iex "git commit -m x"`);
    blockt(`Invoke-Expression 'git push'`);
    blockt(`pwsh -c "git commit -m x"`);
    blockt(`cmd /c git commit -m x`);
    blockt(`Start-Process git -ArgumentList 'push'`);
    laeuft(`iex "git status"`);
    laeuft(`iex "git commit -m x"`, WT);
  });

  test("nicht auswertbares Ziel bei commit/push ist fail-closed (Variable, Ausdruck)", () => {
    const r = pruefe("git -C $unbekannt commit -m x", WT);
    assert.equal(r.block, true);
    assert.match(r.reason ?? "", /literal/);
    blockt("git -C (Join-Path $a b) push", WT);
    blockt("Set-Location $irgendwas; git commit -m x", WT);
  });

  test("--work-tree und --git-dir zeigen auf den Haupt-Checkout: geblockt, auf den Worktree: durch", () => {
    blockt(`git --work-tree=${HAUPT} commit -m x`, WT);
    blockt(`git --work-tree ${HAUPT} push`, WT);
    blockt(`git --git-dir=${HAUPT}/.git commit -m x`, WT);
    laeuft(`git --work-tree=${WT} commit -m x`, HAUPT);
    laeuft(`git --git-dir=${WT}/.git commit -m x`, HAUPT);
    blockt("git --work-tree=$unbekannt commit -m x", WT);
  });

  test("die Meldung nennt den Worktree-Weg", () => {
    assert.match(pruefe("git commit -m x").reason ?? "", /git -C <worktree-pfad>/);
  });
});

describe("Worktree und harmlose Aufrufe laufen durch", () => {
  test("im Worktree selbst", () => {
    laeuft("git commit -m x", WT);
    laeuft("git push -u origin feature/x", WT);
  });

  test("git -C <worktree> vom Haupt-Checkout aus, relativ und absolut", () => {
    laeuft(`git -C ${WT} commit -m x`);
    laeuft(`git -C ${WT} add -A; git -C ${WT} commit -m x`);
    laeuft(`git -C ../wt/kq-1 commit -m x`, `${HAUPT}/src`.replace("/src", ""));
  });

  test("cd in den Worktree, dann commit/push", () => {
    laeuft(`cd ${WT}; git push`);
    laeuft(`Set-Location ${WT}\ngit commit -m x`);
    laeuft(`Push-Location ${WT} && git commit -m x`);
  });

  test("Variablen mit Literal werden aufgelöst (der übliche Eigen-Aufruf)", () => {
    laeuft(`$W='${WT}'; git -C $W add -A; git -C $W commit -m x`);
    laeuft(`$W = "${WT}"; Set-Location $W; git commit -m x`);
    blockt(`$W='${HAUPT}'; git -C $W commit -m x`, WT);
  });

  test("andere git-Befehle und Text, der nur so aussieht", () => {
    laeuft("git status; git log --oneline -3; git diff");
    laeuft(`Write-Output 'git commit'`);
    laeuft(`echo "git push"`);
    laeuft("# git commit\nls");
    laeuft("<# git push #> ls");
    laeuft("git log --grep=push");
    laeuft("gh pr create --title 'git commit fix'");
    laeuft("Get-Content @'\ngit commit\n'@");
  });

  test("fremdes Repo und fehlende Eingaben: fail-open", () => {
    laeuft("git commit -m x", "/anderswo");
    assert.equal(g.bewertePowerShell({ command: "git commit", repoRoot: HAUPT, deps }).block, false, "kein cwd");
    assert.equal(g.bewertePowerShell({ cwd: HAUPT, repoRoot: HAUPT, deps }).block, false, "kein Befehl");
    assert.equal(g.bewertePowerShell({ command: "", cwd: HAUPT, repoRoot: HAUPT, deps }).block, false);
  });
});

describe("Verdrahtung (#1311)", () => {
  test("Payload: Tool, cwd und Befehl; kaputtes JSON ergibt {}", () => {
    assert.deepEqual(g.parseHookInput('{"tool_name":"PowerShell","cwd":"C:\\\\x","tool_input":{"command":"ls"}}'), { tool: "PowerShell", cwd: "C:\\x", command: "ls" });
    assert.deepEqual(g.parseHookInput("{kaputt"), {});
  });

  test("settings.json registriert den PowerShell-Hook, der Bash-Hook bleibt auf Bash", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as { hooks: { PreToolUse: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const von = (name: string) => s.hooks.PreToolUse.find((e) => e.hooks.some((h) => (h.args ?? []).some((a) => a.endsWith(`scripts/${name}`))));
    assert.equal(von("worktree-guard-powershell.mjs")?.matcher, "PowerShell");
    assert.equal(von("worktree-guard-hook.mjs")?.matcher, "Bash");
  });

  test("die FAQ beschreibt den PowerShell-Hook und behauptet nicht, das Tool sei ungedeckt", () => {
    const faq = lies("docs/agent-harness-faq.md");
    assert.doesNotMatch(faq, /PowerShell-Tool deckt der Hook nicht ab/);
    assert.match(faq, /worktree-guard-powershell/);
  });
});
