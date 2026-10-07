/* gh-Guard: Heredoc-Daten, dynamisches Kommando und Interpreter-Liste im Detail (#1311).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Heredoc-Regel ist bewusst konservativ: ein Body gilt nur dann als Text, wenn der Befehl davor ein Daten-Befehl ist (`cat`, `tee`,
 * `git commit`, `gh pr/issue …`), hinter dem Begrenzer nichts steht und im ganzen Befehl außerhalb von Quotes kein Interpreter,
 * `eval` oder `source` vorkommt. Jede Abweichung muss zu einer Rückfrage führen (Text darf nie versehentlich Befehl werden).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tab from "../../scripts/shell-tabellen.mjs";

const hook = raw as unknown as { bewerte: (command: unknown) => { ask: boolean } };
const tabellen = tab as unknown as { SHELLS: Set<string>; INTERPRETER_NAMEN: string[] };
const fragt = (c: string) => assert.equal(hook.bewerte(c).ask, true, c.slice(0, 120));
const laeuft = (c: string) => assert.equal(hook.bewerte(c).ask, false, c.slice(0, 120));
const DEL = "gh api -X DELETE repos/o/r/issues/1";
const LESEN = "gh api repos/o/r/issues/1";

describe("Heredoc-Body bleibt Befehlstext, wenn irgendetwas ihn ausführen könnte", () => {
  test("ein zweiter Heredoc-Marker im Body des ersten (der Body von A enthält <<'B')", () => {
    fragt(`cat <<'A'\nx <<'B'\nA\n${DEL}\nB`);
  });

  test("der Rest der Heredoc-Zeile ist ein echter Aufruf", () => {
    fragt(`cat <<'EOF'; ${DEL}\ntext\nEOF`);
    fragt(`cat > f <<'EOF' && ${DEL}\ntext\nEOF`);
  });

  test("Interpreter groß geschrieben", () => {
    fragt(`BASH <<'EOF'\n${DEL}\nEOF`);
    fragt(`cat <<'EOF' | SH\n${DEL}\nEOF`);
  });

  test("Marker in Quotes oder Kommentar ist kein Heredoc: die Folgezeile läuft wirklich", () => {
    fragt(`echo "<<'EOF'"\n${DEL}\nEOF`);
    fragt(`true # <<'EOF'\n${DEL}\nEOF`);
    fragt(`cat # <<'EOF'\n${DEL}\nEOF`);
  });

  test("der Konsument steht auf einer Folgezeile", () => {
    fragt(`cat <<'EOF' |\n${DEL}\nEOF\nsh`);
    fragt(`cat > x.sh <<'EOF'\n${DEL}\nEOF\nbash x.sh`);
    fragt(`cat > x.sh <<'EOF'\n${DEL}\nEOF\nsource x.sh`);
  });

  test("Gegenprobe: ein Wort wie eval oder source im PR-Titel (in Quotes) verhindert das Entfernen nicht", () => {
    laeuft(`gh pr create --title "fix(harness): eval und source" --body "$(cat <<'EOF'\nDer Guard fragt bei \`${DEL}\`\nEOF\n)"`);
  });

  test("Gegenprobe: Commit-Text, Datei schreiben, tee", () => {
    laeuft(`git commit -m "$(cat <<'EOF'\n${DEL}\nEOF\n)"`);
    laeuft(`tee notiz.md <<'EOF'\n${DEL}\nEOF`);
    laeuft(`gh issue comment 1 --body-file - <<'EOF'\n${DEL}\nEOF`);
  });
});

describe("dynamisches Kommando mit gequotetem oder ersetztem Kommandowort", () => {
  test("$c 'api', \"$c\" api, ${c}, Ersetzung und Backtick als Kommandowort", () => {
    fragt("c=gh; $c 'api' -X DELETE repos/o/r/issues/1");
    fragt('c=gh; "$c" api -X DELETE repos/o/r/issues/1');
    fragt('c=gh; "${c}" api -X DELETE repos/o/r/issues/1');
    fragt("$(echo gh) api -X DELETE repos/o/r/issues/1");
    fragt("`echo gh` api -X DELETE repos/o/r/issues/1");
  });

  test("Aufrufoperator ohne api direkt dahinter (Splatting, Argument aus Variable)", () => {
    fragt("$c='gh'; & $c @('api','-X','DELETE','repos/o/r/issues/1')");
    fragt("$c='gh'; $a='api'; & $c $a -X DELETE repos/o/r/issues/1");
    fragt("$c='gh'; $a='api'; . $c $a -X DELETE repos/o/r/issues/1");
    fragt("$c='gh'; $a='api'; ( & $c $a -X DELETE repos/o/r/issues/1 )");
    fragt("$c='gh'; $a='api'; { & $c $a -X DELETE repos/o/r/issues/1 }");
  });

  test("$X mit beliebigen Argumenten, wenn X einen String oder eine Ersetzung mit gh bekommt", () => {
    fragt('GH="gh api"; $GH -X DELETE repos/o/r/issues/1');
    fragt('GH="gh api"; ${GH} -X DELETE repos/o/r/issues/1');
    fragt('CMD="gh api -X DELETE repos/o/r/issues/1"; $CMD --silent');
    fragt('CMD="gh api"; $CMD repos/o/r/issues/1 -X DELETE');
    fragt(`x=$(echo "gh api -X DELETE repos/o/r/issues/1"); $x`);
    fragt(`x=$(${LESEN}); $x`);
    fragt('GH="gh api"; if true; then $GH -X DELETE repos/o/r/issues/1; fi');
  });

  test("Gegenprobe: Variablen ohne gh-Zuweisung und Variablen nicht an Kommandoposition", () => {
    laeuft(`F=a.json; ${LESEN} > out.json; jq . $F`);
    laeuft(`F=a.json; ${LESEN} > out.json && jq . $F`);
    laeuft(`x=$(${LESEN}); echo $x`);
    laeuft(`X=5; ${LESEN}; $X`);
  });

  test("& $c an jeder Stelle (Zuweisung, Klammer, Pipeline-Block), auch hinter einem PowerShell-Pfad mit Backslash am Ende", () => {
    fragt("$c='gh'; $a='api'; $r = & $c $a -X DELETE repos/o/r/issues/1");
    fragt("$c='gh'; $a='api'; $null = & $c $a -X DELETE repos/o/r/issues/1");
    fragt("$c='gh'; $r = & $c @('api','-X','DELETE','r')");
    fragt("$c='gh'; $a='api'; Write-Output (& $c $a -X DELETE repos/o/r/issues/1)");
    fragt("$c='gh'; $a='api'; [void](& $c $a -X DELETE repos/o/r/issues/1)");
    fragt("$c='gh'; $a='api'; 1..3 | % { & $c $a -X DELETE repos/o/r/issues/$_ }");
    fragt("$c='gh'; $a='api'; Set-Location C:\\dev\\; & $c $a -X DELETE repos/o/r/issues/1");
  });

  test("$X in einer Ersetzung: der äußere Befehl liefert die Zuweisung", () => {
    fragt('GH="gh api"; out=$($GH -X DELETE repos/o/r/issues/1)');
    fragt('GH="gh api"; echo "$($GH -X DELETE repos/o/r/issues/1)"');
    laeuft('GH="gh api"; out=$(echo hallo)');
  });

  test("Gegenprobe: ein & als Hintergrund-Operator oder in && / 2>&1 ist kein Aufrufoperator", () => {
    laeuft(`${LESEN} 2>&1 | head; echo $N`);
    laeuft(`${LESEN} && echo $N`);
    laeuft(`sleep 1 & echo $N; ${LESEN}`);
  });

  test("Gegenprobe: Variable als Argument von gh api (kein Kommando)", () => {
    laeuft(`N=1; ${LESEN}/comments/$N`);
    laeuft(`gh api repos/o/r/issues/$N`);
  });
});

describe("Groß geschriebenes gh und Laufzeit bei vielen unbeendeten Heredocs", () => {
  test("GH api … (Windows startet gh.exe)", () => {
    fragt("GH api -X DELETE repos/o/r/issues/1");
    fragt("Gh.exe api -X DELETE repos/o/r/issues/1");
  });

  test("viele Heredoc-Marker ohne Terminator auf einer Zeile wachsen höchstens linear (Skalierungsvergleich statt Wanduhr, #1322 Z17)", () => {
    // Minimum aus 5 Läufen je Größe nach einem Warmlauf; linear ≈ 8, quadratisch ≈ 64. Die Größen bleiben unter LAENGE_MAX
    // (50.000 Zeichen), sonst greift der Frühausstieg und misst nichts.
    const messe = (n: number) => {
      const befehl = `${LESEN};` + "<<'A' ".repeat(n) + "\n";
      hook.bewerte(befehl);
      let min = Infinity;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        hook.bewerte(befehl);
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    const klein = Math.max(messe(1000), 0.05); // Untergrenze gegen die Timer-Auflösung
    const gross = messe(8000);
    assert.ok(gross / klein < 25, `Laufzeit wächst überlinear: ${klein.toFixed(2)} ms bei 1000, ${gross.toFixed(2)} ms bei 8000 Markern`);
  });
});

describe("Wortteile in eval und Interpreter-Namen", () => {
  test("x:eval und ~eval sind keine eval-Aufrufe", () => {
    laeuft(`x:eval; ${LESEN}`);
    laeuft(`~eval ${LESEN}`);
    laeuft(`x:sh -c '${DEL}'; ${LESEN}`);
  });

  test("die Shell-Liste ist fest (ein stilles Streichen oder Ändern fällt auf)", () => {
    assert.deepEqual([...tabellen.SHELLS].sort(), ["ash", "bash", "dash", "ksh", "sh", "zsh"]);
    assert.deepEqual([...tabellen.INTERPRETER_NAMEN].sort(), ["ash", "bash", "cmd", "dash", "ksh", "powershell", "pwsh", "sh", "zsh"]);
    for (const n of ["ash", "bash", "dash", "ksh", "sh", "zsh"]) fragt(`${n} -c '${DEL}'`);
  });
});
