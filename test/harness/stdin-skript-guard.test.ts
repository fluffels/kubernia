/* Stdin-Skript-Guard (#1561 Z3) – ein Interpreter, der sein Programm von stdin lesen würde, wird abgelehnt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `python3 - <<EOF` und Verwandte wanderten unter Git-Bash in den Hintergrund und hielten den Worktree-Ordner; die Regel
 * stand nur als Bitte in kubernia-umsetzer.md und der FAQ. Der Hook `scripts/stdin-skript-guard.mjs` macht daraus ein deny.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as raw from "../../scripts/stdin-skript-guard.mjs";

const guard = raw as unknown as { bewerteStdinSkript: (c: unknown) => { block: true; reason: string } | null };
const blockt = (c: string) => guard.bewerteStdinSkript(c)?.block === true;

describe("deny: Interpreter liest das Programm von stdin", () => {
  test.each([
    ["python3 - mit Heredoc", "python3 - <<'EOF'\nprint(1)\nEOF"],
    ["python - mit Heredoc", "python - <<EOF\nprint(1)\nEOF"],
    ["python3.12 -", "python3.12 - <<EOF\nx\nEOF"],
    ["py -", "py - <<EOF\nx\nEOF"],
    ["node - mit Heredoc", "node - <<'EOF'\nconsole.log(1)\nEOF"],
    ["node ohne Argument mit Heredoc", "node <<'EOF'\nconsole.log(1)\nEOF"],
    ["node.exe mit Pfad", "\"/c/Program Files/nodejs/node.exe\" - <<EOF\nx\nEOF"],
    ["Pipe in python3", "cat skript.py | python3"],
    ["Pipe in node -", "echo 'console.log(1)' | node -"],
    ["Here-String", "node <<< 'console.log(1)'"],
    ["python ohne Argument (REPL)", "python3"],
    ["Wrapper timeout", "timeout 60 python3 - <<EOF\nx\nEOF"],
    ["Umgebungs-Präfix", "PYTHONIOENCODING=utf-8 python3 - <<EOF\nx\nEOF"],
    ["Optionen mit Wert davor: node -r", "node -r ./setup.js - <<EOF\nx\nEOF"],
    ["Optionen mit Wert davor: python -W", "python3 -W ignore -I - <<EOF\nx\nEOF"],
    ["Option ohne Wert, kein Programm", "node --no-warnings - <<EOF\nx\nEOF"],
    ["innerhalb von $(…)", "X=$(python3 - <<EOF\nprint(1)\nEOF\n)"],
    ["hinter &&", "cd x && python3 - <<EOF\nx\nEOF"],
    ["Programm nach --: kein Programm, nur -", "python3 -- -"],
    ["-- ohne Folgewort", "python3 --"],
  ])("%s", (_name, command) => {
    assert.ok(blockt(command), command);
  });

  test("die Begründung nennt den Ausweg (Write in den Scratchpad, dann node <pfad> / python -I <pfad>, node -e)", () => {
    const r = guard.bewerteStdinSkript("python3 - <<EOF\nx\nEOF");
    assert.match(r?.reason ?? "", /Write/);
    assert.match(r?.reason ?? "", /node <pfad>/);
    assert.match(r?.reason ?? "", /python -I <pfad>/);
    assert.match(r?.reason ?? "", /node -e/);
  });
});

describe("durchlassen: Programm kommt aus Datei, -c/-e/-m oder es ist nur eine Auskunft", () => {
  test.each([
    ["node f.mjs", "node f.mjs"],
    ["node Datei, stdin als Daten", "node f.mjs - <<EOF\ndaten\nEOF"],
    ["node -e", "node -e \"console.log(1)\""],
    ["node --eval", "node --eval 'console.log(1)'"],
    ["node -p", "node -p 'process.version'"],
    ["node --test", "node --test test/"],
    ["node --version", "node --version"],
    ["node -v", "node -v"],
    ["node -c Datei", "node -c f.mjs"],
    ["python -c", "python3 -c 'print(1)'"],
    ["node --eval=Form", "node --eval='console.log(1)'"],
    ["-- vor einer Datei", "python3 -- f.py"],
    ["Cluster mit -e/-p", "node -pe '1+1'"],
    ["Cluster mit -c", "python3 -Ic 'print(1)'"],
    ["Cluster -VV", "python3 -VV"],
    ["python -m", "python3 -m http.server"],
    ["python --version", "python3 --version"],
    ["python -V", "python -V"],
    ["python3 -I Datei, stdin als Daten", "python3 -I f.py < daten.json"],
    ["Wrapper mit Datei", "timeout 60 node f.mjs"],
    ["node -r mit Wert und Datei", "node -r ./setup.js f.mjs"],
    ["python -W mit Wert und Datei", "python3 -W ignore f.py"],
    ["Pfad aus Variable (dynamisch, ein Skript ist es)", "node $SKRIPT"],
    ["anderes Kommando mit node im Text", "echo node - && ls"],
    ["Interpreter nur als Argument", "which python3"],
    ["git-Kommando", "git commit -m 'python3 -'"],
    ["Heredoc an cat", "cat <<EOF\npython3 -\nEOF"],
    ["node_modules-Binary mit ähnlichem Namen", "nodemon f.js"],
    ["npm run", "npm run test"],
  ])("%s", (_name, command) => {
    assert.equal(guard.bewerteStdinSkript(command), null, command);
  });
});

describe("Fail-open und Eingaben", () => {
  test("nicht zerlegbarer Befehl, leere und falsche Eingaben → null", () => {
    assert.equal(guard.bewerteStdinSkript("python3 - <<EOF\nohne Ende"), null, "Heredoc ohne Terminator ist nicht zerlegbar");
    assert.equal(guard.bewerteStdinSkript(""), null);
    assert.equal(guard.bewerteStdinSkript(undefined), null);
    assert.equal(guard.bewerteStdinSkript(42), null);
  });
});
