/* gh-Guard: Interpreter-Liste, eval, dynamisches Kommando, Heredoc-Daten, Fehlalarm-Gegenproben und Laufzeit (#1311).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ergänzt gh-guard-stellen.test.ts: jede Shell der gemeinsamen Liste (`shell-tabellen.mjs`), Groß-/Kleinschreibung, `eval`/
 * `Invoke-Expression`, `$c api …` und `& $c` an beliebiger Stelle, bloße PowerShell-Variablen ohne Fehlalarm, Heredocs mit
 * gequotetem Begrenzer (Text, kein Aufruf) gegen solche, die an einen Interpreter gehen, die Startklasse der Regexe (kein
 * quadratisches Backtracking bei `~/~/…`) und die exakten Schranken.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/gh-guard-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tab from "../../scripts/shell-tabellen.mjs";

const hook = raw as unknown as { bewerte: (command: unknown) => { ask: boolean; reason?: string } };
const tabellen = tab as unknown as { SHELLS: Set<string>; INTERPRETER_NAMEN: string[] };
const fragt = (c: string) => assert.equal(hook.bewerte(c).ask, true, c.slice(0, 120));
const laeuft = (c: string) => assert.equal(hook.bewerte(c).ask, false, c.slice(0, 120));
const DEL = "gh api -X DELETE repos/o/r/issues/1";
const LESEN = "gh api repos/o/r/issues/1";
const schnell = (c: string, grenzeMs = 1000) => {
  const t0 = Date.now();
  const r = hook.bewerte(c);
  assert.ok(Date.now() - t0 < grenzeMs, `zu langsam (${Date.now() - t0} ms) für ${c.slice(0, 40)}…`);
  return r;
};

describe("Interpreter-Liste (eine Quelle: shell-tabellen.mjs)", () => {
  test("jede Shell der Liste, auch groß geschrieben", () => {
    for (const name of tabellen.SHELLS) {
      fragt(`${name} -c '${DEL}'`);
      fragt(`${name.toUpperCase()} -c '${DEL}'`);
    }
    fragt(`pwsh -c '${DEL}'`);
    fragt(`PowerShell -Command '${DEL}'`);
    fragt(`PWSH.EXE -Command '${DEL}'`);
    fragt(`CMD /c "${DEL}"`);
    assert.ok(tabellen.INTERPRETER_NAMEN.includes("cmd") && tabellen.INTERPRETER_NAMEN.includes("zsh"));
  });

  test("Gegenprobe: ähnliche Namen sind keine Interpreter", () => {
    laeuft(`my-bash -c '${DEL}'`);
    laeuft(`xsh -c '${DEL}'`);
  });
});

describe("eval / Invoke-Expression", () => {
  test("alle Schreibweisen", () => {
    fragt(`Invoke-Expression "${DEL}"`);
    fragt(`IEX "${DEL}"`);
    fragt(`iex "${DEL}"`);
    fragt(`Eval "${DEL}"`);
    fragt(`eval "${DEL}"`);
  });

  test("Gegenprobe: Wortteile und Bindestrich-Namen", () => {
    laeuft(`retrieval; ${LESEN}`);
    laeuft(`my-eval ${LESEN}`);
    laeuft(`prefix-iex ${LESEN}`);
  });
});

describe("dynamisches Kommando", () => {
  test("$c api an beliebiger Stelle, & $c und . $c", () => {
    fragt("c=gh; ( $c api -X DELETE repos/o/r/issues/1 )");
    fragt("c=gh; { $c api -X DELETE repos/o/r/issues/1; }");
    fragt("c=gh; ! $c api -X DELETE repos/o/r/issues/1");
    fragt("c=gh; if true; then $c api -X DELETE repos/o/r/issues/1; fi");
    fragt("c=gh; env $c api -X DELETE repos/o/r/issues/1");
    fragt("c=gh; FOO=1 $c api -X DELETE repos/o/r/issues/1");
    fragt("c=gh; R=$($c api -X DELETE repos/o/r/issues/1)");
    fragt("$c = 'gh'; try { & $c api -X DELETE repos/o/r/issues/1 } catch { }");
    fragt("$c = 'gh'; if ($true) { & $c api -X DELETE repos/o/r/issues/1 }");
    fragt("$c = 'gh'; $null = & $c api -X DELETE repos/o/r/issues/1");
  });

  test("alleinstehendes $CMD, dem ein String mit api zugewiesen wurde", () => {
    fragt('CMD="gh api -X DELETE repos/o/r/issues/1"; $CMD');
    fragt("CMD='gh api -X DELETE repos/o/r/issues/1'; ( $CMD )");
  });

  test("Gegenprobe: bloße PowerShell-Variablen und Variablen ohne api-String führen nichts aus", () => {
    laeuft(`$items = ${LESEN} --paginate | ConvertFrom-Json; $items | Select-Object -First 5`);
    laeuft(`$r = ${LESEN} | ConvertFrom-Json; $r.title`);
    laeuft(`$pr = ${LESEN}\n$pr`);
    laeuft(`$n = ${LESEN} --jq length; $n -gt 0`);
    laeuft(`CMD="echo hi"; ${LESEN}; $CMD`);
    laeuft(`N=5; ${LESEN}/comments/$N`);
  });
});

describe("Heredocs: Text mit gequotetem Begrenzer ist kein Aufruf", () => {
  test("Commit- und PR-Texte, die gh api erwähnen", () => {
    laeuft(`git commit -m "$(cat <<'EOF'\nfeat: der Guard fragt bei ${DEL}\nEOF\n)"`);
    laeuft(`gh pr create --body "$(cat <<'EOF'\nDer Guard fragt bei \`${DEL}\`\nEOF\n)"`);
    laeuft(`git commit -F - <<'MSG'\nfeat: ${DEL}\nMSG`);
    laeuft(`cat > x.md <<'EOF'\n${DEL}\nEOF`);
    laeuft(`cat > x.md <<"EOF"\n${DEL}\nEOF`);
    laeuft(`cat > x.md <<\\EOF\n${DEL}\nEOF`);
    laeuft(`cat > x.md <<-'EOF'\n\t${DEL}\n\tEOF`);
  });

  test("an einen Interpreter weitergereicht oder mit aktiver Ersetzung: es zählt", () => {
    fragt(`bash <<'EOF'\n${DEL}\nEOF`);
    fragt(`cat <<'EOF' | sh\n${DEL}\nEOF`);
    fragt(`eval "$(cat <<'EOF'\n${DEL}\nEOF\n)"`);
    fragt(`source /dev/stdin <<'EOF'\n${DEL}\nEOF`);
    fragt(`cat <<EOF\n$(${DEL})\nEOF`);
  });

  test("ein Aufruf nach dem Heredoc zählt weiter; ein nicht beendeter Heredoc wird nicht geschluckt", () => {
    fragt(`cat <<'EOF'\nnur Text\nEOF\n${DEL}`);
    fragt(`cat <<'EOF'\n${DEL}`);
  });
});

describe("Startklasse der Regexe und Fehlalarm-Gegenproben", () => {
  test("Teile von Wörtern sind keine Aufrufe", () => {
    laeuft(`xgh api -X DELETE x; ${LESEN}`);
    laeuft(`foo.gh api -X DELETE x; ${LESEN}`);
    laeuft(`x'gh' api -X DELETE x; ${LESEN}`);
    laeuft(`'foo' api -X DELETE x; ${LESEN}`);
    laeuft(`~gh api -X DELETE x; ${LESEN}`);
    laeuft(`C:gh api -X DELETE x; ${LESEN}`);
  });

  test("unquotierte Windows-Pfade zu gh.exe", () => {
    fragt("C:\\tools\\gh.exe api -X DELETE repos/o/r/issues/1");
    fragt("& C:\\tools\\gh.exe api -X DELETE repos/o/r/issues/1");
  });

  test("Laufzeit bei pfadähnlichen Folgen (kein quadratisches Backtracking)", () => {
    schnell(`${LESEN}; ` + "~/".repeat(24_000));
    schnell(`${LESEN}; ` + ":/".repeat(24_000));
    schnell("ls " + "~/".repeat(100_000));
    schnell("echo " + "x".repeat(300_000));
  });
});

describe("Schranken exakt", () => {
  test("STELLEN_MAX: 50 Fundstellen werden geprüft, 51 fragen pauschal", () => {
    laeuft(`${LESEN} `.repeat(50));
    fragt(`${LESEN} `.repeat(51));
  });

  test("Interpreter-Fundstellen: viele Wörter mit lesendem gh api am Ende fragen pauschal und schnell", () => {
    fragt("sh ".repeat(8000) + LESEN);
    schnell("sh -x ".repeat(5000) + LESEN);
    laeuft("sh ".repeat(40) + LESEN);
  });

  test("Klammern in einer Ersetzung innerhalb von Double Quotes", () => {
    fragt(`echo "$(a (b) ${DEL})"`);
    fragt(`echo "$(echo $(date); ${DEL})"`);
    laeuft(`echo "$(a (b) ${LESEN})"`);
  });

  test("updateRefs im Plural, ein Backslash vor $( entschärft nichts", () => {
    fragt("gh api graphql -f query='mutation { updateRefs(input: {}) { clientMutationId } }'");
    fragt(`echo \\$(${DEL})`);
  });
});

describe("Wrapper mit Optionen vor $GH (#1316 Z1d)", () => {
  const GH_VAR = 'GH="gh api"; ';
  test("Wrapper aus der Tabelle (eine Quelle) mit Optionen und Werten fragen", () => {
    for (const w of ["timeout 5", "sudo -u x", "nice -n 5", "xargs -I{}", "env A=1", "sudo -u x timeout 5", "time", "stdbuf -o0", "ionice -c 2"]) {
      fragt(`${GH_VAR}${w} $GH -X DELETE repos/o/r/issues/1`);
    }
  });

  test("Gegenproben: Vergleichs- und Testbefehle mit Variablen sind kein Aufruf", () => {
    laeuft("n=$(gh api repos/o/r/issues --jq length); [ $n -gt 0 ]");
    laeuft("n=$(gh api repos/o/r/issues --jq length); test $n -gt 0");
    laeuft(`${GH_VAR}echo timeout 5 $GH`);
    laeuft(`${GH_VAR}${LESEN} | sort -u $F`);
  });

  test("Laufzeit: ein langer Wrapper-Strom bleibt linear", () => {
    assert.equal(schnell(`${"sudo ".repeat(9_000)}${LESEN}`).ask, false);
    assert.equal(schnell(`${GH_VAR}${"sudo -u x ".repeat(3_000)}$GH -X DELETE x`, 2000).ask, true);
  });
});

describe("Daten-Heredoc mit Interpreter-Wörtern im Text (#1316 Z1e)", () => {
  const DEL_TEXT = "gh api -X DELETE repos/o/r/issues/1";
  test("Wörter wie bash/eval im Heredoc-Text eines Commit- oder PR-Textes sind kein Konsument", () => {
    laeuft(`git commit -F - <<'EOF'\nbash -c und eval bei ${DEL_TEXT}\nEOF`);
    laeuft(`gh pr create --body-file - <<'EOF'\nsource x, sh -c, ${DEL_TEXT}\nEOF`);
  });
  test("ein Konsument außerhalb der Daten-Heredocs hält den Body weiter für Befehlstext", () => {
    fragt(`cat > x.sh <<'EOF'\n${DEL_TEXT}\nEOF\nbash x.sh`);
    fragt(`cat <<'EOF' | sh\n${DEL_TEXT}\nEOF`);
    fragt(`bash <<'EOF'\n${DEL_TEXT}\nEOF`);
    fragt(`source /dev/stdin <<'EOF'\n${DEL_TEXT}\nEOF`);
    fragt(`git commit -F - <<'EOF'\nbash\nEOF\nbash <<'X'\n${DEL_TEXT}\nX`);
  });
});

describe("Absicherung der vier Stellen aus dem Review-Pass (#1316 Z2)", () => {
  test("doppelte Segmentierung: ohne Tool-Angabe gilt auch die PowerShell-Lesart (Pfad mit Backslash, dann Semikolon) als Trenner", () => {
    fragt(String.raw`GH="gh api"; echo C:\dev\; $GH -X DELETE repos/o/r/issues/1`);
  });

  test("der äußere Befehl ist der Kontext der Interpreter-Rekursion: `GH=…` steht draußen, `$GH` im inneren String", () => {
    fragt(`GH="gh api"; bash -c '$GH -X DELETE repos/o/r/issues/1'`);
    fragt(`GH="gh api"; echo "$($GH -X DELETE repos/o/r/issues/1)"`);
  });

  test("`&` als Aufrufoperator an jeder Stelle, `.` nur an Kommandoposition", () => {
    fragt("GH=gh; foo | & $GH api -X DELETE x");
    fragt('GH="gh api"; $r = & $GH -X DELETE repos/o/r/issues/1'); // ohne `api` hinter der Variablen: nur die `&`-Regel greift
    fragt('GH="gh api"; echo hi 2>&1 & $GH -X DELETE repos/o/r/issues/1');
    fragt("GH=gh; foo 2>&1 && x; & $GH api -X DELETE x");
    fragt("GH=gh; . $GH api -X DELETE x");
    laeuft("jq . $F repos/o/r/issues/1 # gh api");
  });
});
