// Kein Shebang: wird vom Dispatcher `scripts/pretooluse-hook.mjs` importiert UND von test/harness/stdin-skript-guard.test.ts.
/**
 * Stdin-Skript-Guard (#1561 Z3) — lehnt Bash-Aufrufe ab, bei denen ein Interpreter sein Programm von stdin liest
 * (`python3 - <<EOF`, `node - <<EOF`, `node <<EOF`, `cat x | python3`, `node <<< '…'`).
 *
 * Anlass: ein solcher Aufruf wanderte unter Git-Bash in den Hintergrund und hielt den Worktree-Ordner, `git worktree remove`
 * scheiterte mit „Permission denied“. Die Regel stand nur als Bitte in kubernia-umsetzer.md und der FAQ; hier wird sie
 * zum deny. Ausweg (steht in der Begründung): Skript per Write in den Scratchpad, dann `node <pfad>` bzw. `python -I <pfad>`;
 * Einzeiler per `node -e`.
 *
 * Regel je einfachem Kommando (nach Umleitungen und Wrappern): Interpreter ist python, python3, python3.x, py oder node
 * (Basisname, `.exe` optional). Optionen mit Wert werden überlesen (python: -W -X; node: -r --require --import --loader
 * --experimental-loader -C --conditions --input-type). Deny, wenn das erste Nicht-Options-Wort `-` ist, oder wenn keines
 * existiert und keine Programm- oder Auskunfts-Option vorkommt (python: -c -m -V --version -h --help; node: -e --eval -p --print
 * --test --run -c --check -v --version -h --help). `node f.mjs - <<EOF` (Datei, stdin als Daten) bleibt erlaubt, ebenso
 * `python3 -I f.py < daten.json`. Greift auch in `$(…)`, Backticks und Heredoc-Bodies mit Ersetzungen.
 *
 * Bewusste Grenzen (Bekannte Grenzen, kein Fehler des Guards):
 *  - Nur Bash: PowerShell-Pipes in `node -` (`'…' | node -`) sieht der Guard nicht.
 *  - Wörter in Strings (`bash -c '… python3 - …'`) sind nicht zerlegt.
 *  - Unbekannte Optionen mit Wert (z.B. `node --env-file x -`) lesen das Wert-Wort als Programm: der Aufruf wird durchgelassen.
 *  - Nicht zerlegbare Befehle und jeder interne Fehler: fail-open (`null`), der Guard blockt nie selbst.
 *
 * Reines Node-Skript (nur Builtins + bash-parser/worktree-guard-tabellen). `bewerteStdinSkript` ist pur und exportiert.
 */
import { einfacheKommandos, parseBash } from "./bash-parser.mjs";
import { peel, stripRedirs } from "./worktree-guard-tabellen.mjs";

const INTERPRETER = /^(?:python(?:3(?:\.\d+)?)?|py|node)$/;

/** Optionen, die das nächste Wort als Wert verbrauchen. */
const MIT_WERT = {
  python: new Set(["-W", "-X", "--check-hash-based-pycs"]),
  node: new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--input-type"]),
};
/** Optionen, die ein Programm mitbringen oder nur Auskunft geben: stdin wird dann nicht als Skript gelesen. */
const PROGRAMM_ODER_AUSKUNFT = {
  python: new Set(["-c", "-m", "-V", "--version", "-h", "--help"]),
  node: new Set(["-e", "--eval", "-p", "--print", "--test", "--run", "-c", "--check", "-v", "--version", "-h", "--help"]),
};

/** `python` oder `node` für einen Basisnamen, sonst null. */
const familie = (name) => (name === "node" ? "node" : INTERPRETER.test(name ?? "") ? "python" : null);

/** Programm-/Auskunfts-Option, auch als Cluster (`-Ic`, `-pe`) und als `--eval=…`. */
function istProgrammOption(fam, text) {
  const eq = text.startsWith("--") ? text.indexOf("=") : -1;
  const opt = eq > 0 ? text.slice(0, eq) : text;
  if (PROGRAMM_ODER_AUSKUNFT[fam].has(opt)) return true;
  if (/^-[A-Za-z]{2,}$/.test(text)) {
    const buchstaben = fam === "python" ? "cmVh" : "epcvh";
    return [...text.slice(1)].some((b) => buchstaben.includes(b));
  }
  return false;
}

/** Liest das Programm dieses Interpreter-Aufrufs von stdin? `args`: Wörter nach dem Interpreter. */
function liestStdin(fam, args) {
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (!w.dynamic && w.text === "--") return args[i + 1] ? args[i + 1].text === "-" : true;
    if (!w.dynamic && w.text === "-") return true;
    if (!w.dynamic && w.text.startsWith("-")) {
      if (istProgrammOption(fam, w.text)) return false;
      if (MIT_WERT[fam].has(w.text)) i++;
      continue;
    }
    return false; // erstes Nicht-Options-Wort: ein Skriptpfad
  }
  return true; // kein Skript, kein -c/-e/-m: der Interpreter wartet auf stdin
}

/** `{ block: true, reason }` für ein Kommando, das sein Programm von stdin liest; sonst `null`. Pure, fail-open. */
export function bewerteStdinSkript(command) {
  if (typeof command !== "string" || command.trim() === "") return null;
  const r = parseBash(command);
  if (!r.ok) return null;
  for (const roh of einfacheKommandos(r.ast, { worte: true })) {
    const worte = stripRedirs(roh);
    const p = peel(worte);
    if (p.i < 0 || p.name === null || p.dynamicCmd || p.noop) continue;
    const fam = familie(p.name);
    if (fam && liestStdin(fam, worte.slice(p.i + 1))) {
      return {
        block: true,
        reason:
          `${p.name} liest sein Programm von stdin (\`-\`, Heredoc, Pipe oder ohne Skript): unter Git-Bash wandert das in den Hintergrund und hält den Worktree-Ordner. ` +
          "Skript per Write in den Scratchpad legen, dann `node <pfad>` bzw. `python -I <pfad>` starten; Einzeiler per `node -e`.",
      };
    }
  }
  return null;
}
