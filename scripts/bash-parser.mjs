// Kein Shebang: wird von scripts/worktree-guard-hook.mjs und test/harness/bash-parser.test.ts importiert.
/**
 * Bash-Parser für den Worktree-Guard (#1311) — Tokenizer und rekursiver Abstieg zu einem AST.
 *
 * Warum ein eigener: Der Guard muss wissen, WELCHES Kommando in WELCHEM Verzeichnis läuft. Das geht nur mit einer
 * Struktur (Liste → Und-Oder-Kette → Pipeline → Kommando), nicht mit einer Zustandsmaschine über Flags. Ein
 * npm-Shell-Parser kommt nicht in Frage (Startzeit je Hook-Aufruf, Supply-Chain, offline).
 *
 * Grammatik (Teilmenge von Bash, genug für die Guards):
 *   list     := andor ((';' | '&' | NL) andor?)*
 *   andor    := pipeline (('&&' | '||') NL* pipeline)*
 *   pipeline := '!'? command (('|' | '|&') NL* command)*
 *   command  := '(' list ')' | '{' list '}' | if | while/until | for/select | case | function | simple
 *
 * Knoten (alle mit `type`):
 *   list      { items: [{ andor, bg }] }          andor { first, rest: [{ op, pipe }] }     pipe { neg, cmds }
 *   simple    { words, substs, heredocs }         subshell/group { body, substs, heredocs }
 *   if        { clauses: [{ cond, body }], else }  loop { cond, body }       for { body, substs }
 *   case      { arms, substs }                    funcdef { name, body }
 * Wörter: { text, dynamic, quoted }. `dynamic`: enthält `$…`/Backticks (Text unvollständig). `substs` sind die
 * Listen aller `$(…)`/Backticks/`<(…)` in Wörtern und Umleitungen; `heredocs`: { delim, quoted, body, substs, static }.
 *
 * Nicht zerlegbar (`{ ok: false }`): offene Quotes/Substitutionen, fehlender Heredoc-Delimiter, `for ((…))`,
 * verirrte Schlüsselwörter (`fi`, `done`, `}`), Verschachtelung über MAX_TIEFE. Der Aufrufer fällt dann auf die
 * grobe Wortregel zurück.
 *
 * Reines Node-Skript (nur Builtins), pur.
 */

export const MAX_TIEFE = 100;

class ParseError extends Error {}

const STOP_WORDS = new Set(["then", "do", "done", "fi", "elif", "else", "esac", "}"]);
const REDIR_OP_ONLY = /^\d*(?:>>|>\||>&|<&|<>|<<<|>|<)$|^&>>?$/;
const REDIR_START = /^(?:\d*|&)(?:>>|>\||>&|<&|<>|<<<|>|<)/;

/** Wandelt ANSI-C-Quoting `$'…'` (Inhalt ohne Rand) in statischen Text. */
function ansiC(s) {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|.)/gs, (_m, e) => {
    const map = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
    if (e in map) return map[e];
    if (e[0] === "x" || e[0] === "u") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return e;
  });
}

class Parser {
  constructor(src, depth = 0) {
    this.src = src;
    this.pos = 0;
    this.pending = []; // wartende Heredocs
    this.buf = null; // ein Token Vorschau
    this.depth = depth;
  }

  fail(msg = "nicht zerlegbar") {
    throw new ParseError(msg);
  }

  enter() {
    if (++this.depth > MAX_TIEFE) this.fail("zu tief verschachtelt");
  }

  // ── Token-Ebene ───────────────────────────────────────────────────────────
  peek() {
    return (this.buf ??= this.lex());
  }

  take() {
    const t = this.peek();
    this.buf = null;
    return t;
  }

  isKw(t, ...words) {
    return t.t === "w" && !t.quoted && !t.dynamic && words.includes(t.text);
  }

  isOp(t, ...ops) {
    return t.t === "op" && ops.includes(t.op);
  }

  lex() {
    const { src } = this;
    for (;;) {
      const ch = src[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") this.pos++;
      else if (ch === "\\" && src[this.pos + 1] === "\n") this.pos += 2;
      else if (ch === "#") while (this.pos < src.length && src[this.pos] !== "\n") this.pos++;
      else break;
    }
    if (this.pos >= src.length) {
      if (this.pending.length) this.fail("Heredoc ohne Ende");
      return { t: "eof" };
    }
    const ch = src[this.pos];
    const next = src[this.pos + 1];
    if (ch === "\n") {
      this.pos++;
      this.readHeredocBodies();
      return { t: "op", op: "\n" };
    }
    if (ch === ";") {
      const op = src.startsWith(";;&", this.pos) ? ";;&" : next === ";" ? ";;" : next === "&" ? ";&" : ";";
      this.pos += op.length;
      return { t: "op", op };
    }
    if (ch === "&" && next !== ">") {
      const op = next === "&" ? "&&" : "&";
      this.pos += op.length;
      return { t: "op", op };
    }
    if (ch === "|") {
      const op = next === "|" ? "||" : next === "&" ? "|&" : "|";
      this.pos += op.length;
      return { t: "op", op };
    }
    if (ch === "(" || ch === ")") {
      this.pos++;
      return { t: "op", op: ch };
    }
    if (ch === "<" && next === "<" && src[this.pos + 2] !== "<") {
      this.pos += 2;
      return { t: "h", ref: this.heredocStart() };
    }
    return this.readWord();
  }

  /** `<<[-]DELIM`: pos steht hinter `<<`. */
  heredocStart() {
    const { src } = this;
    const strip = src[this.pos] === "-";
    if (strip) this.pos++;
    while (src[this.pos] === " " || src[this.pos] === "\t") this.pos++;
    let delim = "";
    let quoted = false;
    while (this.pos < src.length && !/[\s;|&()<>]/.test(src[this.pos])) {
      const ch = src[this.pos];
      if (ch === "'" || ch === '"') {
        const end = src.indexOf(ch, this.pos + 1);
        if (end < 0) this.fail();
        delim += src.slice(this.pos + 1, end);
        quoted = true;
        this.pos = end + 1;
      } else if (ch === "\\") {
        delim += src[this.pos + 1] ?? "";
        quoted = true;
        this.pos += 2;
      } else {
        delim += ch;
        this.pos++;
      }
    }
    if (!delim) this.fail();
    const ref = { delim, strip, quoted, body: "", substs: [], static: true };
    this.pending.push(ref);
    return ref;
  }

  /** Nach einem Zeilenumbruch: die Bodies der vorgemerkten Heredocs lesen. */
  readHeredocBodies() {
    const { src } = this;
    while (this.pending.length) {
      const ref = this.pending.shift();
      let body = "";
      for (;;) {
        if (this.pos >= src.length) this.fail("Heredoc ohne Ende");
        const end = src.indexOf("\n", this.pos);
        const line = src.slice(this.pos, end < 0 ? src.length : end).replace(/\r$/, "");
        this.pos = end < 0 ? src.length : end + 1;
        if ((ref.strip ? line.replace(/^\t+/, "") : line) === ref.delim) break;
        if (end < 0) this.fail("Heredoc ohne Ende");
        body += (ref.strip ? line.replace(/^\t+/, "") : line) + "\n";
      }
      ref.body = body;
      if (!ref.quoted) {
        ref.static = !/[$`]/.test(body);
        if (!ref.static) ref.substs = new Parser(body, this.depth).scanBody();
      }
    }
  }

  /** Heredoc-Body (unquotierter Delimiter): nur `$(…)` und Backticks sind aktiv. */
  scanBody() {
    const out = [];
    const { src } = this;
    while (this.pos < src.length) {
      const ch = src[this.pos];
      if (ch === "\\") this.pos += 2;
      else if (ch === "$" && src[this.pos + 1] === "(") {
        this.pos += 2;
        out.push(this.subst());
      } else if (ch === "`") {
        this.pos++;
        out.push(this.backtick());
      } else this.pos++;
    }
    return out;
  }

  /** pos steht hinter `(`: Liste bis `)` lesen. */
  subst() {
    const list = this.parseList((t) => this.isOp(t, ")"));
    if (!this.isOp(this.take(), ")")) this.fail("Substitution offen");
    return list;
  }

  /** pos steht hinter dem öffnenden Backtick. */
  backtick() {
    const { src } = this;
    let end = this.pos;
    while (end < src.length && src[end] !== "`") end += src[end] === "\\" ? 2 : 1;
    if (end >= src.length) this.fail("Backtick offen");
    const inner = src.slice(this.pos, end).replace(/\\([`\\$])/g, "$1");
    this.pos = end + 1;
    const p = new Parser(inner, this.depth);
    p.enter();
    return p.program();
  }

  /** pos steht hinter dem öffnenden `"`. */
  readDouble(w) {
    const { src } = this;
    for (;;) {
      if (this.pos >= src.length) this.fail("Quote offen");
      const ch = src[this.pos];
      if (ch === '"') {
        this.pos++;
        return;
      }
      if (ch === "\\") {
        const n = src[this.pos + 1];
        if (n !== undefined && '$`"\\\n'.includes(n)) {
          if (n !== "\n") w.text += n;
          this.pos += 2;
        } else {
          w.text += "\\";
          this.pos++;
        }
      } else if (ch === "`") {
        w.dynamic = true;
        this.pos++;
        w.substs.push(this.backtick());
      } else if (ch === "$") {
        w.dynamic = true;
        if (src[this.pos + 1] === "(") {
          this.pos += 2;
          w.substs.push(this.subst());
        } else this.pos++;
      } else {
        w.text += ch;
        this.pos++;
      }
    }
  }

  readWord() {
    const { src } = this;
    const w = { t: "w", text: "", dynamic: false, quoted: false, substs: [] };
    while (this.pos < src.length) {
      const ch = src[this.pos];
      const next = src[this.pos + 1];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ";" || ch === ")") break;
      if (ch === "|" && !w.text.endsWith(">")) break;
      if (ch === "&") {
        if (next === "&" || !(/[<>]$/.test(w.text) || next === ">")) break;
        w.text += ch;
        this.pos++;
      } else if (ch === "(") {
        if (!/[<>]$/.test(w.text)) break; // sonst Funktionsdefinition oder Fehler (Parser entscheidet)
        w.text = w.text.slice(0, -1); // <(…) / >(…): Prozess-Substitution
        w.dynamic = true;
        this.pos++;
        w.substs.push(this.subst());
      } else if (ch === "<" && next === "<" && src[this.pos + 2] !== "<" && w.text !== "" && !w.text.endsWith("<")) {
        break; // Heredoc hinter einem Wort: eigenes Token
      } else if (ch === "\\") {
        if (next === "\n") this.pos += 2; // Zeilenfortsetzung
        else {
          if (next !== undefined) w.text += next;
          w.quoted = true;
          this.pos += 2;
        }
      } else if (ch === "'") {
        const end = src.indexOf("'", this.pos + 1);
        if (end < 0) this.fail("Quote offen");
        w.text += src.slice(this.pos + 1, end);
        w.quoted = true;
        this.pos = end + 1;
      } else if (ch === '"') {
        w.quoted = true;
        this.pos++;
        this.readDouble(w);
      } else if (ch === "$" && next === "'") {
        let end = this.pos + 2;
        while (end < src.length && src[end] !== "'") end += src[end] === "\\" ? 2 : 1;
        if (end >= src.length) this.fail("Quote offen");
        w.text += ansiC(src.slice(this.pos + 2, end));
        w.quoted = true;
        this.pos = end + 1;
      } else if (ch === "$" && next === '"') {
        w.quoted = true;
        this.pos += 2;
        this.readDouble(w);
      } else if (ch === "`") {
        this.pos++;
        w.dynamic = true;
        w.substs.push(this.backtick());
      } else if (ch === "$") {
        w.dynamic = true;
        if (next === "(") {
          this.pos += 2;
          w.substs.push(this.subst());
        } else this.pos++;
      } else {
        w.text += ch;
        this.pos++;
      }
    }
    return w;
  }

  // ── Grammatik ─────────────────────────────────────────────────────────────
  program() {
    const list = this.parseList(() => false);
    if (this.peek().t !== "eof") this.fail("unerwartetes Token");
    return list;
  }

  skipNewlines() {
    while (this.isOp(this.peek(), "\n")) this.take();
  }

  parseList(isStop) {
    this.enter();
    const items = [];
    for (;;) {
      let t = this.peek();
      while (this.isOp(t, "\n", ";")) {
        this.take();
        t = this.peek();
      }
      if (t.t === "eof" || isStop(t)) break;
      const andor = this.parseAndOr();
      let bg = false;
      t = this.peek();
      if (this.isOp(t, "&")) {
        this.take();
        bg = true;
      } else if (this.isOp(t, ";", "\n")) this.take();
      items.push({ andor, bg });
    }
    this.depth--;
    return { type: "list", items };
  }

  parseAndOr() {
    const first = this.parsePipeline();
    const rest = [];
    while (this.isOp(this.peek(), "&&", "||")) {
      const op = this.take().op;
      this.skipNewlines();
      rest.push({ op, pipe: this.parsePipeline() });
    }
    return { type: "andor", first, rest };
  }

  parsePipeline() {
    let neg = false;
    while (this.isKw(this.peek(), "!")) {
      this.take();
      neg = !neg;
    }
    const cmds = [this.parseCommand()];
    while (this.isOp(this.peek(), "|", "|&")) {
      this.take();
      this.skipNewlines();
      cmds.push(this.parseCommand());
    }
    return { type: "pipe", neg, cmds };
  }

  expectKw(word) {
    if (!this.isKw(this.take(), word)) this.fail(`'${word}' erwartet`);
  }

  /** Umleitungen hinter einem zusammengesetzten Kommando (`done < <(x)`, `} 2>&1`, `fi <<EOF`). */
  redirs(node) {
    node.substs = [];
    node.heredocs = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "h") {
        node.heredocs.push(this.take().ref);
      } else if (t.t === "w" && !t.quoted && REDIR_START.test(t.text)) {
        this.take();
        node.substs.push(...t.substs);
        if (REDIR_OP_ONLY.test(t.text) && this.peek().t === "w") node.substs.push(...this.take().substs);
      } else if (t.t === "w" && REDIR_START.test(t.text)) {
        this.take();
        node.substs.push(...t.substs);
      } else return node;
    }
  }

  parseCommand() {
    const t = this.peek();
    if (this.isOp(t, "(")) {
      this.take();
      const body = this.parseList((x) => this.isOp(x, ")"));
      if (!this.isOp(this.take(), ")")) this.fail("')' erwartet");
      return this.redirs({ type: "subshell", body });
    }
    if (t.t === "w" && !t.quoted && !t.dynamic) {
      switch (t.text) {
        case "{": {
          this.take();
          const body = this.parseList((x) => this.isKw(x, "}"));
          this.expectKw("}");
          return this.redirs({ type: "group", body });
        }
        case "if":
          return this.parseIf();
        case "while":
        case "until": {
          this.take();
          const cond = this.parseList((x) => this.isKw(x, "do"));
          this.expectKw("do");
          const body = this.parseList((x) => this.isKw(x, "done"));
          this.expectKw("done");
          return this.redirs({ type: "loop", cond, body });
        }
        case "for":
        case "select":
          return this.parseFor();
        case "case":
          return this.parseCase();
        case "function":
          return this.parseFunction();
        default:
          if (STOP_WORDS.has(t.text)) this.fail("verirrtes Schlüsselwort");
      }
    }
    return this.parseSimple();
  }

  parseIf() {
    this.take();
    const clauses = [];
    let elseBody = null;
    for (;;) {
      const cond = this.parseList((x) => this.isKw(x, "then"));
      this.expectKw("then");
      const body = this.parseList((x) => this.isKw(x, "elif", "else", "fi"));
      clauses.push({ cond, body });
      const t = this.take();
      if (this.isKw(t, "elif")) continue;
      if (this.isKw(t, "else")) {
        elseBody = this.parseList((x) => this.isKw(x, "fi"));
        this.expectKw("fi");
      } else if (!this.isKw(t, "fi")) this.fail("'fi' erwartet");
      break;
    }
    return this.redirs({ type: "if", clauses, else: elseBody });
  }

  parseFor() {
    this.take();
    const v = this.take();
    if (v.t !== "w") this.fail("for ((…)) nicht unterstützt");
    const substs = [];
    this.skipNewlines();
    if (this.isKw(this.peek(), "in")) {
      this.take();
      while (this.peek().t === "w") substs.push(...this.take().substs);
    }
    while (this.isOp(this.peek(), ";", "\n")) this.take();
    this.expectKw("do");
    const body = this.parseList((x) => this.isKw(x, "done"));
    this.expectKw("done");
    return this.redirs({ type: "for", body, substs: [...substs] });
  }

  parseCase() {
    this.take();
    const subject = this.take();
    if (subject.t !== "w") this.fail();
    this.skipNewlines();
    this.expectKw("in");
    const arms = [];
    const substs = [...subject.substs];
    for (;;) {
      while (this.isOp(this.peek(), "\n", ";")) this.take();
      if (this.isKw(this.peek(), "esac")) {
        this.take();
        break;
      }
      if (this.isOp(this.peek(), "(")) this.take();
      for (;;) {
        const p = this.take();
        if (p.t !== "w") this.fail("Case-Muster erwartet");
        substs.push(...p.substs);
        if (this.isOp(this.peek(), "|")) this.take();
        else break;
      }
      if (!this.isOp(this.take(), ")")) this.fail("')' erwartet");
      arms.push(this.parseList((x) => this.isKw(x, "esac") || this.isOp(x, ";;", ";&", ";;&")));
      if (this.isOp(this.peek(), ";;", ";&", ";;&")) this.take();
    }
    return this.redirs({ type: "case", arms, substs });
  }

  parseFunction() {
    this.take();
    const name = this.take();
    if (name.t !== "w") this.fail();
    if (this.isOp(this.peek(), "(")) {
      this.take();
      if (!this.isOp(this.take(), ")")) this.fail();
    }
    this.skipNewlines();
    return { type: "funcdef", name: name.text, body: this.parseCommand() };
  }

  parseSimple() {
    const words = [];
    const substs = [];
    const heredocs = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "h") {
        heredocs.push(this.take().ref);
      } else if (t.t === "w") {
        this.take();
        words.push({ text: t.text, dynamic: t.dynamic, quoted: t.quoted });
        substs.push(...t.substs);
      } else if (this.isOp(t, "(") && words.length === 1 && !words[0].dynamic) {
        // Funktionsdefinition `name() compound`
        this.take();
        if (!this.isOp(this.take(), ")")) this.fail();
        this.skipNewlines();
        return { type: "funcdef", name: words[0].text, body: this.parseCommand() };
      } else break;
    }
    if (!words.length && !heredocs.length) this.fail("leeres Kommando");
    return { type: "simple", words, substs, heredocs };
  }
}

/** Zerlegt `command`; `{ ok: true, ast }` oder `{ ok: false, reason }`. */
export function parseBash(command) {
  try {
    return { ok: true, ast: new Parser(String(command ?? "")).program() };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    if (e instanceof RangeError) return { ok: false, reason: "Stack erschöpft" };
    throw e;
  }
}
