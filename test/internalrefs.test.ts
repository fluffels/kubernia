/* Interne-Referenzen-Wächter (#990) — hält Arbeitgeber-/Kundenbezüge aus dem öffentlichen Repo.
 *
 * Analog zu test/context-size.test.ts (#719): die Prüflogik wird aus
 * scripts/check-internalrefs.mjs importiert — EINE Quelle der Wahrheit für CLI und Test.
 *
 * WICHTIG: Dieser Test arbeitet mit DUMMY-Begriffen. Die echten Begriffe stehen bewusst nur
 * base64-kodiert im Skript (Begründung im Datei-Kopf dort) — sie hier für einen Red-Green-Fall
 * im Klartext hinzuschreiben würde genau den Fehler begehen, den das Gate verhindern soll.
 * Wo der Test die echten Begriffe braucht, holt er sie über `decodeTerms()`, ohne sie zu nennen.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:internalrefs)
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FREMD } from "./support/fremd-config";

// Temp-Ordner dieser Datei: jeder Test legt über `tempOrdner()` an, `afterEach` räumt auf (kein Rest im Temp-Verzeichnis).
const angelegt: string[] = [];
const tempOrdner = (praefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  angelegt.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of angelegt.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// Anders als die älteren Gate-Tests (diffsize/context-size) wird der Namespace EINMAL über
// `unknown` auf ein lokales Interface gebracht, statt jeden Export einzeln aus einem
// error-typed Wert zu ziehen — das kommt ohne `no-unsafe-*`-Suppressions aus (Ratchet #868).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawModule from "../scripts/check-internalrefs.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBasis from "../scripts/check-basis.mjs";

type Violation = { file: string; line: number; term: string; kind: "ref" | "name" | "pfad"; excerpt: string };

type InternalRefsApi = {
  PLATZHALTER_NUTZER: string[];
  FIXTURE_WURZELN: string[];
  pfadBefunde: (files: string[], readFile: (f: string) => string, opt?: { repo?: string | null }) => Violation[];
  ENCODED_TERMS: string[];
  ENCODED_NAME_TERMS: string[];
  decodeTerms: (encoded?: string[]) => string[];
  encodeTerm: (term: string) => string;
  buildTermPattern: (term: string, opts?: { stem?: boolean }) => RegExp;
  listBranchCommitMessages: (root: string, exec: () => string) => { name: string; text: string }[];
  findViolations: (
    files: string[],
    terms: string[],
    readFile: (f: string) => string,
    nameTerms?: string[],
  ) => Violation[];
  runCheck: (
    root?: string,
    io?: {
      listFiles?: (root: string) => string[];
      listCommits?: (root: string) => { name: string; text: string }[];
      readFile?: (rel: string) => string;
      terms?: string[];
      nameTerms?: string[];
    },
  ) => { files: string[]; violations: Violation[] };
  checkedLabel: (kind: "repo" | "text") => string;
  addTerm: (term: string, selfPath: string, listName?: string) => { ok: boolean; reason?: string; encoded?: string; count?: number };
  main: (argv: string[], deps?: { self?: string; out?: (m: string) => void; err?: (m: string) => void }) => number;
};

const {
  PLATZHALTER_NUTZER,
  FIXTURE_WURZELN,
  pfadBefunde,
  ENCODED_TERMS,
  ENCODED_NAME_TERMS,
  listBranchCommitMessages,
  decodeTerms,
  encodeTerm,
  buildTermPattern,
  findViolations,
  runCheck,
  checkedLabel,
  addTerm,
  main,
} = rawModule as unknown as InternalRefsApi;
// isCheckable steht in der Gate-Lib scripts/check-basis.mjs (#1579).
const isCheckable = (rawBasis as unknown as { isCheckable: (file: string) => boolean }).isCheckable;

const DUMMY = "zzzdummyfirma";
const readRepo = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

describe("Interne-Referenzen-Wächter (#990)", () => {
  test("das Repo ist frei von den gelisteten Begriffen", () => {
    // Der eigentliche Wächter. Schlägt er an, ist die Fundstelle neutral umzuformulieren —
    // NICHT die Liste zu kürzen.
    const { violations } = runCheck();
    assert.deepEqual(
      violations.map((v) => `${v.file}:${v.line}`),
      [],
      "Interne Referenz(en) gefunden — neutral umformulieren (die Sache benennen, nicht die Herkunft).",
    );
    // Eigener Timeout (FAQ § Test-Timeouts): runCheck() startet echte Git-Kindprozesse und liest ~760 Quellen; unter Last
    // riss der 5-s-Default (#1460 Z3).
  }, 30_000);

  test("Detektion greift wirklich (Red-Green)", () => {
    // No-op-Schutz: ein Wächter, der nie anschlägt, wäre wertlos.
    const hit = findViolations(["doc.md"], [DUMMY], () => `Vorbild ist die ${DUMMY}-Pipeline (#532).`);
    assert.equal(hit.length, 1, "Ein klarer Treffer muss gefunden werden.");
    assert.equal(hit[0]?.line, 1);

    const clean = findViolations(["doc.md"], [DUMMY], () => "Vorbild sind produktive Pipelines.");
    assert.deepEqual(clean, [], "Neutral formulierter Text darf nicht anschlagen.");
  });

  test("Wortgrenzen verhindern Zufallstreffer in base64-Blobs", () => {
    // Das ist kein Feinschliff, sondern notwendig: ohne Wortgrenzen wäre das Gate auf dem
    // aktuellen Stand sofort rot, weil fonts.css eine base64-`@font-face` enthält, in der
    // zufällig ein Listenbegriff als Substring steckt (siehe nächster Test).
    assert.equal(buildTermPattern(DUMMY).test(`AA${DUMMY}BB`), false, "Substring ohne Wortgrenzen: kein Treffer.");
    assert.equal(buildTermPattern(DUMMY).test(`ein ${DUMMY}.`), true, "Als eigenes Wort: Treffer.");
    assert.equal(buildTermPattern(DUMMY).test(DUMMY.toUpperCase()), true, "Case-insensitive.");
  });

  test("fonts.css bleibt in der Prüfung und ist trotz base64-Zufall grün", () => {
    // Regressionsschutz für die Design-Entscheidung oben: die Datei wird NICHT ausgeschlossen,
    // sondern korrekt bewertet. Die echten Begriffe kommen dekodiert aus dem Skript, damit
    // hier kein Klartext steht.
    assert.equal(isCheckable("fonts.css"), true, "fonts.css darf nicht pauschal ausgeschlossen werden.");
    const raw = readRepo("fonts.css");
    const terms = decodeTerms();
    const naive = terms.some((t) => raw.toLowerCase().includes(t.toLowerCase()));
    assert.equal(naive, true, "Annahme dieses Tests: ein naiver Substring-Match würde hier treffen.");
    assert.deepEqual(findViolations(["fonts.css"], terms, () => raw), [], "Mit Wortgrenzen muss es grün sein.");
  });

  test("die Begriffsliste ist nicht leer und steht nirgends im Klartext im Repo", () => {
    assert.ok(ENCODED_TERMS.length > 0, "Eine leere Liste wäre ein stiller No-op.");
    // Jeder Begriff muss dekodierbar und nicht-trivial sein; der Klartext-Test ist der
    // runCheck() oben (er würde das Skript/den Test selbst mit erfassen).
    for (const term of decodeTerms()) assert.ok(term.length >= 3, "Zu kurze Begriffe erzeugen nur Rauschen.");
  });

  test("Kodierung ist ein verlustfreier Roundtrip", () => {
    assert.deepEqual(decodeTerms([encodeTerm(DUMMY)]), [DUMMY]);
    assert.deepEqual(decodeTerms(decodeTerms().map(encodeTerm)), decodeTerms());
  });

  test("Binärassets und das Lockfile sind ausgeschlossen, Quelltext nicht", () => {
    assert.equal(isCheckable("package-lock.json"), false, "base64-Integrity-Hashes erzeugen Rauschen.");
    assert.equal(isCheckable("assets/pixellab/held.png"), false);
    assert.equal(isCheckable("assets/fonts/silkscreen.woff2"), false);
    assert.equal(isCheckable("AGENTS.md"), true);
    assert.equal(isCheckable("src/game.ts"), true);
    assert.equal(isCheckable("docs/agent-harness.md"), true);
  });

  test("mehrere Fundstellen werden je Zeile einzeln gemeldet", () => {
    const hits = findViolations(["a.md"], [DUMMY], () => `erste ${DUMMY}\nharmlos\ndritte ${DUMMY}`);
    assert.deepEqual(
      hits.map((h) => h.line),
      [1, 3],
      "Jede betroffene Zeile soll einzeln auffindbar sein.",
    );
  });

  test("nicht lesbare Dateien kippen das Gate nicht (fail-open wie check:diffsize)", () => {
    const hits = findViolations(["weg.md", "da.md"], [DUMMY], (f) => {
      if (f === "weg.md") throw new Error("ENOENT");
      return `hier steht ${DUMMY}`;
    });
    assert.deepEqual(
      hits.map((h) => h.file),
      ["da.md"],
      "Eine unlesbare Datei wird übersprungen, die lesbare weiter geprüft.",
    );
  });
  test("Namensbezüge matchen als Wortstamm: Flexion und Komposita ohne eigenen Eintrag (#1217)", () => {
    // Dummy-Stamm statt echtem Namen. Ein Herkunftsbegriff braucht für den Genitiv einen eigenen
    // Eintrag, ein Namensbezug nicht — das nagelt der Test fest, damit niemand Flexionsformen
    // doppelt pflegt oder den Stamm-Match still zurückbaut.
    const stamm = "zzzdummyname";
    const flexion = [`${stamm}s Review`, `${stamm}-Skript`, `${stamm}Notiz`, `Review von ${stamm}.`];
    for (const text of flexion) {
      const hits = findViolations(["a.md"], [], () => text, [stamm]);
      assert.equal(hits.length, 1, `Namensbezug muss treffen: ${text}`);
      assert.equal(hits[0]?.kind, "name");
    }
    assert.deepEqual(findViolations(["a.md"], [], () => `xx${stamm}`, [stamm]), [], "Wortanfang bleibt Pflicht.");
    // Gegenprobe: derselbe Begriff als Herkunftsbegriff trifft die Flexion NICHT.
    assert.deepEqual(findViolations(["a.md"], [DUMMY], () => `${DUMMY}s Pipeline`), []);
  });

  test("Treffer tragen ihre Art, die Namensliste ist nicht leer und dekodierbar (#1217)", () => {
    assert.ok(ENCODED_NAME_TERMS.length > 0, "Eine leere Namensliste wäre ein stiller No-op.");
    for (const term of decodeTerms(ENCODED_NAME_TERMS)) assert.ok(term.length >= 3);
    const hit = findViolations(["a.md"], [DUMMY], () => DUMMY)[0];
    assert.equal(hit?.kind, "ref");
  });

  test("Commit-Messages werden als Pseudo-Dateien geprüft; ohne Vergleichs-Basis leer (#1217)", () => {
    const log = () =>
      [`aaaaaaa1111\x00feat: ok\n\nBody ${DUMMY}\x01`, `bbbbbbb2222\x00fix: harmlos\x01`].join("");
    const commits = listBranchCommitMessages("/x", log);
    assert.deepEqual(commits.map((c) => c.name), ["commit:aaaaaaa", "commit:bbbbbbb"]);
    const hits = findViolations(
      commits.map((c) => c.name),
      [DUMMY],
      (f) => commits.find((c) => c.name === f)?.text ?? "",
    );
    assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), ["commit:aaaaaaa:3"]);

    const keineBasis = () => { throw new Error("unknown revision origin/main"); };
    assert.deepEqual(listBranchCommitMessages("/x", keineBasis), [], "fail-open wie check:diffsize");
  });

  test("listBranchCommitMessages fragt origin/main..HEAD im übergebenen Verzeichnis ab (#1239)", () => {
    const aufrufe: { cmd: string; args: string[]; cwd: unknown }[] = [];
    const exec = ((cmd: string, args: string[], opts: { cwd: unknown }) => {
      aufrufe.push({ cmd, args, cwd: opts.cwd });
      return "";
    }) as unknown as () => string;
    listBranchCommitMessages("/repo", exec);
    assert.equal(aufrufe[0].cmd, "git");
    assert.deepEqual(aufrufe[0].args.slice(0, 2), ["log", "origin/main..HEAD"]);
    assert.equal(aufrufe[0].cwd, "/repo");
  });

  test("runCheck verdrahtet Dateien, Commit-Messages und beide Begriffslisten (#1239)", () => {
    const io = {
      listFiles: () => ["a.md", "bild.png"],
      listCommits: () => [{ name: "commit:abc1234", text: `feat: harmlos\n\nBody ${DUMMY}` }],
      readFile: (rel: string) => (rel === "a.md" ? "Name: zzzname" : ""),
      terms: [DUMMY],
      nameTerms: ["zzzname"],
    };
    const r = runCheck("/x", io);
    assert.deepEqual(r.files, ["a.md", "commit:abc1234"], "nicht prüfbare Dateien (png) fallen raus, Commits kommen dazu");
    assert.deepEqual(
      r.violations.map((v) => `${v.file}:${v.kind}`).sort(),
      ["a.md:name", "commit:abc1234:ref"],
      "Begriffsliste UND Namensliste greifen, auch in Commit-Messages",
    );
  });

  test("PR-Text-Workflow prüft Titel/Body per --text, auch nach Edit, ohne Interpolation ins Skript (#1239)", () => {
    const yml = readRepo(".github/workflows/internalrefs-pr-text.yml");
    assert.match(yml, /types: \[[^\]]*edited[^\]]*\]/, "ein nachträglich geänderter PR-Text muss neu geprüft werden");
    assert.match(yml, /check-internalrefs\.mjs --text/);
    const run = yml.split(/\r?\n/).filter((l) => l.includes("run:")).join("\n");
    assert.doesNotMatch(run, /\$\{\{/, "Titel/Body nur über env, nie per ${{ }} in den Shell-Befehl (Injection)");
  });

  test("Erfolgsmeldung nennt die tatsächlich geprüften Quellen (#1239)", () => {
    assert.match(checkedLabel("repo"), /Dateien, Commit-Messages/);
    assert.match(checkedLabel("text"), /Text von stdin/);
    assert.doesNotMatch(checkedLabel("text"), /Dateien/);
  });

  test("addTerm trägt in die gewählte Liste ein und lässt die andere unberührt (#1217)", () => {
    const dir = tempOrdner("kq-internalrefs-");
    const file = join(dir, "liste.mjs");
    const source = 'export const ENCODED_TERMS = ["YQ=="];' + String.fromCharCode(10) + 'export const ENCODED_NAME_TERMS = ["Yg=="];' + String.fromCharCode(10);
    writeFileSync(file, source);

    const res = addTerm(DUMMY, file, "ENCODED_NAME_TERMS");
    assert.equal(res.ok, true);
    const after = readFileSync(file, "utf8");
    assert.ok(after.includes('ENCODED_TERMS = ["YQ=="]'), "Herkunftsliste bleibt unverändert.");
    assert.ok(after.includes(encodeTerm(DUMMY)), "Der Namensliste wurde der kodierte Begriff angehängt.");
    assert.ok(!after.includes(DUMMY), "Kein Klartext in der Datei.");

    assert.equal(addTerm(DUMMY, file, "ENCODED_NAME_TERMS").ok, false, "Doppelt eintragen wird abgelehnt.");
    assert.equal(addTerm("  ", file).ok, false, "Leerer Begriff wird abgelehnt.");
    assert.equal(addTerm(DUMMY, file, "GIBT_ES_NICHT").ok, false, "Unbekannte Liste wird gemeldet.");
  });

  test("Architekturmodell-Dateien (.c4/.d2) werden geprüft (#1420)", () => {
    assert.equal(isCheckable("docs/architektur/x.c4"), true);
    assert.equal(isCheckable("docs/architektur/x.d2"), true);
    const hits = findViolations(["docs/architektur/spiel.c4"], [DUMMY], () => `x = modul '${DUMMY}'`);
    assert.equal(hits.length, 1, "Ein Begriff in .c4-Text wird gefunden.");
  });
});

describe("CLI-Flags (#1837)", () => {
  const SKRIPT = fileURLToPath(new URL("../scripts/check-internalrefs.mjs", import.meta.url));
  const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
  const kopie = () => {
    const f = join(tempOrdner("kq-ir-"), "kopie.mjs");
    copyFileSync(SKRIPT, f);
    return f;
  };
  const lauf = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, run: (self: string) => main(argv, { self, out: (m) => out.push(m), err: (m) => err.push(m) }) };
  };
  const zahl = (f: string, liste: string) => {
    const m = new RegExp(String.raw`export const ${liste} = \[([^\]]*)\]`).exec(readFileSync(f, "utf8"));
    return m ? [...m[1].matchAll(/"[^"]+"/g)].length : -1;
  };

  test("--add wächst nur ENCODED_TERMS der Kopie, das echte Skript bleibt unverändert", () => {
    const vorher = hash(SKRIPT);
    const f = kopie();
    const t = lauf(["--add", DUMMY]);
    assert.equal(t.run(f), 0);
    assert.equal(zahl(f, "ENCODED_TERMS"), ENCODED_TERMS.length + 1);
    assert.equal(zahl(f, "ENCODED_NAME_TERMS"), ENCODED_NAME_TERMS.length);
    assert.match(t.out.join("\n"), /aufgenommen/);
    assert.equal(hash(SKRIPT), vorher);
  });

  test("--add-name wächst nur ENCODED_NAME_TERMS der Kopie", () => {
    const f = kopie();
    assert.equal(lauf(["--add-name", DUMMY]).run(f), 0);
    assert.equal(zahl(f, "ENCODED_NAME_TERMS"), ENCODED_NAME_TERMS.length + 1);
    assert.equal(zahl(f, "ENCODED_TERMS"), ENCODED_TERMS.length);
  });

  test("ohne Flag und mit leerem Begriff bleibt die Kopie unberührt; --add mit doppeltem Begriff ist Exit 1", () => {
    const f = kopie();
    const vorher = hash(f);
    lauf([]).run(f);
    assert.equal(hash(f), vorher, "ohne Flag schreibt main nie in die Kopie");
    assert.equal(lauf(["--add", "  "]).run(f), 1);
    assert.equal(hash(f), vorher, "ein leerer Begriff schreibt nichts");
    assert.equal(lauf(["--add", DUMMY]).run(f), 0);
    const doppelt = lauf(["--add", DUMMY]);
    assert.equal(doppelt.run(f), 1);
    assert.match(doppelt.err.join("\n"), /schon in der Liste/);
    assert.notEqual(hash(f), vorher);
  });

  test("unbekanntes Flag: Aufruf-Fehler mit Exit 2", () => {
    const t = lauf(["--gibtsnicht"]);
    assert.equal(t.run(SKRIPT), 2);
    assert.match(t.err.join("\n"), /Aufruf: node scripts\/check-internalrefs\.mjs/);
  });

  const text = (stdin: string) => spawnSync(process.execPath, [SKRIPT, "--text"], { input: stdin, encoding: "utf8" });
  test("--text: harmloser stdin ist Exit 0, ein echter Begriff Exit 1 ohne ihn auszugeben", () => {
    const sauber = text("Ein ganz harmloser Satz.");
    assert.equal(sauber.status, 0);
    const begriff = decodeTerms()[0];
    const treffer = text(`vor ${begriff} nach`);
    assert.equal(treffer.status, 1);
    assert.ok(!(treffer.stdout + treffer.stderr).includes(begriff), "der Begriff darf nicht ausgegeben werden");
  });
});

// Die Beispielpfade werden aus Teilen gebaut: ein Literal träfe die Pfadregel in dieser Testdatei selbst.
describe("Pfadregel (#1888)", () => {
  const win = (...teile: string[]) => teile.join("\\");
  const fremderRepo = FREMD.repo.split("/")[1] ?? "";
  const befund = (datei: string, zeile: string, repo: string | null = fremderRepo) => pfadBefunde([datei], () => zeile, { repo }).map((b) => b.term);

  test("Benutzerordner: Platzhalter grün, ein nicht gelisteter Name rot (Windows, macOS, Linux; auch mit Satzzeichen dahinter)", () => {
    for (const seg of PLATZHALTER_NUTZER) {
      assert.deepEqual(befund("docs/a.md", win("C:", "Users", seg, "x")), [], seg);
      assert.deepEqual(befund("docs/a.md", `/home/${seg}/x`), [], seg);
    }
    for (const ok of ["/home/<name>/x", "/Users/$HOME/x", win("C:", "Users", "%USERNAME%", "x"), win("C:", "Users", "<name>")]) assert.deepEqual(befund("docs/a.md", ok), [], ok);
    assert.deepEqual(befund("docs/a.md", win("C:", "Users", "KEINPLATZHALTER", "x")), ["nutzer"]);
    assert.deepEqual(befund("docs/a.md", "siehe " + ["", "Users", "KEINPLATZHALTER", "x"].join("/")), ["nutzer"]);
    assert.deepEqual(befund("docs/a.md", ["", "home", "KEINPLATZHALTER"].join("/") + "."), ["nutzer"]);
    assert.deepEqual(befund("docs/a.md", "(/home/x.)"), [], "Satzzeichen hinter dem Platzhalter");
    assert.deepEqual(befund("README.md", win("D:", "", "Users", "KEINPLATZHALTER")), ["nutzer"], "doppelter Trenner");
  });

  test("Benutzerordner-URLs und Teilwörter sind kein Pfad", () => {
    assert.deepEqual(befund("docs/a.md", "https://example.org/home/KEINPLATZHALTER/x"), []);
    assert.deepEqual(befund("docs/a.md", "src/home/KEINPLATZHALTER/x.ts"), []);
  });

  test("Laufwerkspfade in test/ und scripts/: nur Fixture-Wurzeln, in Docs frei", () => {
    for (const w of FIXTURE_WURZELN) assert.equal(w, w.toLowerCase(), "Liste klein geschrieben, sonst trifft der Vergleich nie");
    const fremd = win("D:", "KeineWurzel", "x");
    assert.deepEqual(befund("test/a.test.ts", fremd), ["wurzel"]);
    assert.deepEqual(befund("scripts/a.mjs", fremd), ["wurzel"]);
    assert.deepEqual(befund("docs/a.md", fremd), []);
    assert.deepEqual(befund("test/a.test.ts", win("C:", "tmp", "x")), []);
    assert.deepEqual(befund("test/a.test.ts", win("C:", "Temp", "x")), [], "Groß-/Kleinschreibung egal");
    assert.deepEqual(befund("test/a.test.ts", "const t = 'a:\\n';"), [], "kleines Laufwerk ist ein JS-Escape");
    assert.deepEqual(befund("test/a.test.ts", "const t = 'a:\\nfoo';"), [], "Großbuchstaben-Pflicht: kleines Laufwerk mit unbekannter Wurzel");
    assert.deepEqual(befund("test/a.test.ts", "(C:/tmp.)"), [], "Satzzeichen hinter der Wurzel");
    assert.deepEqual(befund("test/a.test.ts", "`C:\\${name}\\x`"), [], "Template-Teil sieht die Regel nicht");
  });

  test("Repo-Name als Segment eines Laufwerkspfads ist rot (Name aus der Config), Fremdname und Fixture-Wurzel grün", () => {
    assert.ok(fremderRepo.length > 0);
    assert.deepEqual(befund("test/a.test.ts", `C:/dev/${fremderRepo}/x`), ["repo"]);
    assert.deepEqual(befund("test/a.test.ts", win("C:", "dev", fremderRepo.toUpperCase(), "x")), ["repo"], "ohne Groß-/Kleinschreibung");
    assert.deepEqual(befund("docs/a.md", `C:/dev/${fremderRepo}/x`), ["repo"], "auch in Docs");
    assert.deepEqual(befund("test/a.test.ts", "C:/dev/repo/x"), []);
    assert.deepEqual(befund("test/a.test.ts", `C:/dev/${fremderRepo}`, null), [], "ohne Repo-Name entfällt die Regel");
    assert.deepEqual(befund("test/a.test.ts", `/${fremderRepo}/x`), [], "Unix-Pfade und URL-Pfade trägt den Namen zu Recht");
  });

  test("runCheck verdrahtet die Pfadregel (Treffer tragen kind pfad)", () => {
    const io = { listFiles: () => ["test/a.test.ts"], listCommits: () => [], readFile: () => `C:/dev/${fremderRepo}/x`, terms: [], nameTerms: [], repo: fremderRepo } as Parameters<typeof runCheck>[1];
    const r = runCheck("/x", io);
    assert.deepEqual(r.violations.map((v) => `${v.file}:${v.kind}:${v.term}`), ["test/a.test.ts:pfad:repo"]);
  });
});
