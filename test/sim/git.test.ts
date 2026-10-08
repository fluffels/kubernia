/* Unit-Tests: git-Befehlsfamilie (sim/git.ts) – Teil des sim.test.ts-Splits (#383).
 * fetch/pull, push-Ablehnung und der Merge-Konflikt-Bogen (#69). Fahren über
 * sim.exec("…"); gemeinsame Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

/* ===================== git: fetch / pull (#69) ===================== */

test("git fetch: lädt nur herunter, pull holt die Commits wirklich rein", () => {
  sim.exec("git init");
  sim.mergeScenario({ gitRemoteAhead: 2 });
  const before = sim.git.commits.length;
  const fetch = sim.exec("git fetch");
  assert.ok(!fetch.error, "fetch ist kein Fehler");
  assert.match(fetch.output!, /2 Commit/, "fetch nennt die Anzahl voraus");
  assert.equal(sim.git.fetched, true, "fetch markiert geholt");
  assert.equal(sim.git.remoteAhead, 2, "fetch fügt NICHTS ein – remoteAhead bleibt 2");
  assert.equal(sim.git.commits.length, before, "fetch erzeugt keine lokalen Commits");

  const pull = sim.exec("git pull");
  assert.ok(!pull.error, "pull ist kein Fehler");
  assert.equal(sim.git.remoteAhead, 0, "pull holt alles -> nichts mehr voraus");
  assert.equal(sim.git.commits.length, before + 2, "pull fügt die 2 Team-Commits ein");
});

test("git fetch/pull ohne Neuigkeiten meldet 'aktuell' und tut nichts", () => {
  sim.exec("git init");
  assert.match(sim.exec("git fetch").output!, /aktuell|Neues/i);
  assert.match(sim.exec("git pull").output!, /neuesten Stand|aktuell/i);
});

test("git push: wird abgelehnt, solange origin voraus ist (erst pull)", () => {
  sim.exec("git init");
  sim.files["a.md"] = "x"; sim.exec("git add a.md"); sim.exec('git commit -m "a"');
  sim.mergeScenario({ gitRemoteAhead: 1 });
  const push = sim.exec("git push");
  assert.ok(push.error, "Push gegen veralteten Stand muss abgelehnt werden");
  assert.match(push.output!, /pull/i, "Hinweis: erst pullen");
  sim.exec("git pull");
  assert.ok(!sim.exec("git push").error, "nach pull klappt der push");
});

/* ===================== git: Merge-Konflikt (#69) ===================== */

function armConflict(s: KQSim) {
  s.exec("git init");
  s.files["seekarte.md"] = "deine Zeile"; s.exec("git add seekarte.md"); s.exec('git commit -m "start"');
  s.mergeScenario({ gitConflict: { branch: "kollege", file: "seekarte.md", ours: "deine Zeile", theirs: "fremde Zeile" } });
}

test("git merge: gleiche Datei beidseitig geändert -> CONFLICT mit Markern", () => {
  armConflict(sim);
  const merge = sim.exec("git merge kollege");
  assert.ok(!merge.error, "der Konflikt-Merge ist kein Simulator-Fehler, sondern eine Rückfrage");
  assert.match(merge.output!, /CONFLICT/, "meldet CONFLICT");
  assert.ok(sim.git.conflict, "Konflikt ist jetzt aktiv");
  // Datei trägt die Konfliktmarker und beide Versionen
  const f = sim.exec("cat seekarte.md").output!;
  assert.match(f, /<<<<<<</); assert.match(f, /=======/); assert.match(f, />>>>>>>/);
  assert.match(f, /deine Zeile/); assert.match(f, /fremde Zeile/);
  // status zeigt den ungelösten Pfad
  assert.match(sim.exec("git status").output!, /nicht zusammengeführt|beide geändert/i);
});

test("git: Konflikt blockiert commit/push/zweiten merge bis zur Auflösung", () => {
  armConflict(sim);
  sim.exec("git merge kollege");
  assert.ok(sim.exec("git commit -m \"x\"").error, "commit mit offenem Konflikt wird abgelehnt");
  assert.ok(sim.exec("git push").error, "push mit offenem Konflikt wird abgelehnt");
  assert.ok(sim.exec("git merge kollege").error, "zweiter merge mitten im Konflikt wird abgelehnt");
  // add VOR der Seitenwahl (Marker noch drin) wird abgelehnt
  assert.ok(sim.exec("git add seekarte.md").error, "add bei noch vorhandenen Markern meckert");
});

test("git checkout --theirs/--ours: Seite wählen, dann add+commit löst den Konflikt", () => {
  armConflict(sim);
  sim.exec("git merge kollege");
  // falsche Datei wird abgelehnt
  assert.ok(sim.exec("git checkout --theirs gibtsnicht.md").error, "nur die Konfliktdatei zählt");
  const co = sim.exec("git checkout --theirs seekarte.md");
  assert.ok(!co.error);
  assert.equal(sim.files["seekarte.md"], "fremde Zeile", "Arbeitsdatei = hereinkommende Version");
  assert.ok(sim.git.conflict, "vor 'git add' gilt der Konflikt noch als offen");
  const add = sim.exec("git add seekarte.md");
  assert.ok(!add.error);
  assert.equal(sim.git.conflict, null, "add markiert den Konflikt als gelöst");
  const commit = sim.exec('git commit -m "geloest"');
  assert.ok(!commit.error, "jetzt schließt der commit den Merge ab");
});

test("git checkout --ours: behält die eigene Version", () => {
  armConflict(sim);
  sim.exec("git merge kollege");
  sim.exec("git checkout --ours seekarte.md");
  assert.equal(sim.files["seekarte.md"], "deine Zeile");
});

test("git checkout --theirs ohne Konflikt meldet einen Fehler", () => {
  sim.exec("git init");
  assert.ok(sim.exec("git checkout --theirs seekarte.md").error, "ohne offenen Konflikt sinnlos");
});

test("Konflikt überlebt snapshot/restore (auch nach Reload lösbar)", () => {
  armConflict(sim);
  sim.exec("git merge kollege");
  const restored = new KQSim(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(restored.git.conflict, "offener Konflikt bleibt nach restore erhalten");
  assert.match(restored.exec("cat seekarte.md").output!, /<<<<<<</, "Marker noch da");
  restored.exec("git checkout --theirs seekarte.md");
  restored.exec("git add seekarte.md");
  assert.ok(!restored.exec('git commit -m "ok"').error, "nach Reload genauso lösbar");
});

test("remoteAhead + scharf gestellter Konflikt überstehen mehrfaches mergeScenario (kein Reset durch Reload)", () => {
  sim.exec("git init");
  const setup = { gitRemoteAhead: 2, gitConflict: { branch: "kollege", file: "k.md", ours: "a", theirs: "b" } };
  sim.mergeScenario(setup);
  assert.equal(sim.git.remoteAhead, 2);
  sim.exec("git pull");
  assert.equal(sim.git.remoteAhead, 0, "nach pull aufgeholt");
  // erneutes Einmischen desselben Szenarios (wie beim Laden eines Spielstands) darf NICHT zurücksetzen
  sim.mergeScenario(setup);
  assert.equal(sim.git.remoteAhead, 0, "remoteAhead bleibt 0 – kein Wiederhochsetzen");
  assert.equal(sim.git.branches.filter(b => b === "kollege").length, 1, "Branch nicht doppelt angelegt");
});

/* ===================== #1469: Eingabetreue – push/pull/fetch, commit, checkout, add ===================== */

function repoMitCommit(): KQSim {
  const s = freshSim();
  s.exec("git init");
  s.files["a.md"] = "x";
  s.exec("git add a.md");
  s.exec('git commit -m "a"');
  return s;
}

test("git push -u origin main: Tracking-Zeile; ohne -u keine", () => {
  const s = repoMitCommit();
  const r = s.exec("git push -u origin main");
  assert.equal(r.error, false);
  assert.match(r.output!, /branch 'main' set up to track 'origin\/main'\./);
  assert.doesNotMatch(s.exec("git push origin main").output!, /set up to track/);
  assert.match(s.exec("git push --set-upstream origin").output!, /set up to track/);
});

test("git push/pull/fetch: nur origin und der aktuelle Branch zählen", () => {
  const s = repoMitCommit();
  for (const cmd of ["git push foo", "git pull foo main", "git fetch foo"]) {
    const r = s.exec(cmd);
    assert.equal(r.error, true, cmd);
    assert.match(r.output!, /fatal: 'foo' does not appear to be a git repository/, cmd);
  }
  assert.match(s.exec("git push origin nope").output!, /error: src refspec nope does not match any/);
  assert.match(s.exec("git pull origin nope").output!, /fatal: couldn't find remote ref nope/);
  assert.match(s.exec("git fetch origin nope").output!, /fatal: couldn't find remote ref nope/);
  assert.equal(s.exec("git push origin main").error, false);
  assert.equal(s.exec("git pull origin main").error, false);
  assert.equal(s.exec("git pull origin HEAD").error, false);
});

test("git push origin <anderer Branch>: nicht simuliert mit Hinweis; Refspec und zu viele Argumente ebenso", () => {
  const s = repoMitCommit();
  s.exec("git branch feature");
  const r = s.exec("git push origin feature");
  assert.equal(r.error, true);
  assert.match(r.output!, /Nicht simuliert: 'git push origin feature'/);
  assert.match(r.output!, /git checkout feature/);
  assert.equal(s.git.pushed, false, "nichts wurde gepusht");
  assert.match(s.exec("git push origin main:main").output!, /Nicht simuliert:/);
  assert.match(s.exec("git push origin main feature").output!, /Nicht simuliert:/);
});

test("git push --force: abgelehnt mit Hinweis, nichts gepusht; unbekannte Flags bei pull/fetch ebenso", () => {
  const s = repoMitCommit();
  const r = s.exec("git push --force");
  assert.match(r.output!, /Nicht simuliert: das Flag '--force' bei 'git push'\. Erzwungenes Pushen gibt es nicht/);
  assert.equal(s.git.pushed, false);
  assert.match(s.exec("git pull --rebase").output!, /das Flag '--rebase' bei 'git pull'/);
  assert.match(s.exec("git fetch --all").output!, /das Flag '--all' bei 'git fetch'/);
});

test("git commit: Nachricht in Anführungszeichen bleibt EINE Nachricht, in allen Schreibweisen", () => {
  for (const [cmd, msg] of [
    ['git commit -m "a b"', "a b"],
    ['git commit --message="a b"', "a b"],
    ["git commit -m 'a b'", "a b"],
    ["git commit -m wort", "wort"],
    ['git commit -m "remove --force flag"', "remove --force flag"],
    ['git commit -m"ohne leerzeichen"', "ohne leerzeichen"],
  ] as const) {
    const s = freshSim();
    s.exec("git init");
    s.files["a.md"] = "x";
    s.exec("git add a.md");
    const r = s.exec(cmd);
    assert.equal(r.error, false, cmd);
    assert.equal(s.git.commits[0].msg, msg, cmd);
  }
});

test("git commit: mehrere -m werden Absätze, git log rückt jede Zeile ein", () => {
  const s = freshSim();
  s.exec("git init");
  s.files["a.md"] = "x";
  s.exec("git add a.md");
  const r = s.exec('git commit -m "Titel" -m "Text dazu"');
  assert.match(r.output!, /\] Titel\n/, "die Kopfzeile nennt nur die erste Zeile");
  assert.equal(s.git.commits[0].msg, "Titel\n\nText dazu");
  const log = s.exec("git log").output!;
  assert.match(log, /\n {4}Titel\n\n {4}Text dazu/);
});

test("git commit: ohne Nachricht, -a, --amend und Pfade lehnen ab (nichts committet)", () => {
  const s = freshSim();
  s.exec("git init");
  s.files["a.md"] = "x";
  s.exec("git add a.md");
  assert.match(s.exec("git commit").output!, /Commit-Nachricht fehlt/);
  assert.match(s.exec("git commit -m").output!, /flag needs an argument/);
  assert.match(s.exec("git commit -am x").output!, /Nicht simuliert: das Flag '-a' bei 'git commit'\. Der Simulator kennt nur die Stage/);
  assert.match(s.exec('git commit --amend -m "x"').output!, /das Flag '--amend'/);
  assert.match(s.exec('git commit -m "x" a.md').output!, /Nicht simuliert: 'git commit a\.md/);
  assert.equal(s.git.commits.length, 0);
});

test("git checkout -b: ein Startpunkt ist nicht simuliert (nichts angelegt), ohne Startpunkt legt es an; unbekannte Flags lehnen ab", () => {
  const s = freshSim();
  s.exec("git init");
  const start = s.exec("git checkout -b neu main");
  assert.equal(start.error, true);
  assert.match(start.output!, /Nicht simuliert: einen Startpunkt bei 'git checkout -b' \(main\)/);
  assert.equal(s.git.branches.includes("neu"), false);
  assert.equal(s.exec("git checkout -b neu").error, false);
  assert.equal(s.git.branch, "neu");
  assert.match(s.exec("git checkout --bogus").output!, /das Flag '--bogus' bei 'git checkout'/);
});

test("git checkout --theirs -- datei: die Datei steht hinter dem Terminator", () => {
  const s = freshSim();
  s.exec("git init");
  s.files["seekarte.md"] = "deine Zeile";
  s.exec("git add seekarte.md");
  s.exec('git commit -m "start"');
  s.mergeScenario({ gitConflict: { file: "seekarte.md", ours: "A", theirs: "B", branch: "kollege" } });
  s.exec("git merge kollege");
  assert.ok(s.git.conflict, "der Konflikt steht");
  assert.equal(s.exec("git checkout --theirs -- seekarte.md").error, false);
  assert.equal(s.files["seekarte.md"], "B");
});

test("git add -A gilt wie `.`", () => {
  const s = freshSim();
  s.exec("git init");
  s.files["a.md"] = "x";
  s.files["b.md"] = "y";
  assert.match(s.exec("git add -A").output!, /Vorgemerkt: a\.md, b\.md/);
  assert.deepEqual(s.git.staged, ["a.md", "b.md"]);
  assert.match(s.exec("git add --all").output!, /Nichts Neues/);
});

test("git: echte, nicht simulierte Unterbefehle und Flags vor dem Unterbefehl; Tippfehler mit Vorschlag; Prototyp-Schlüssel", () => {
  const s = repoMitCommit();
  for (const cmd of ["git stash", "git rebase main", "git reset --hard", "git diff", "git remote -v", "git clone x", "git tag v1", "git show", "git switch x", "git restore a.md", "git rm a.md", "git mv a b", "git cherry-pick x", "git revert x", "git --version", "git -C . status"]) {
    const r = s.exec(cmd);
    assert.equal(r.error, true, cmd);
    assert.match(r.output!, /Nicht simuliert:/, cmd);
    assert.match(r.output!, /Der Simulator kann: git init/, cmd);
  }
  assert.match(s.exec("git stauts").output!, /unbekannter Unterbefehl 'stauts'[\s\S]*Meintest du 'git status'\?/);
  for (const cmd of ["git constructor", "git toString", "git __proto__"]) {
    const r = s.exec(cmd);
    assert.equal(r.error, true, cmd);
    assert.match(r.output!, /unbekannter Unterbefehl/, cmd);
  }
  assert.match(s.exec("git status -s").output!, /das Flag '-s' bei 'git status'/);
  assert.match(freshSim().exec("git constructor").output!, /unbekannter Unterbefehl/, "die Eingabe gilt vor der Repo-Wache");
  assert.match(freshSim().exec("git status").output!, /kein Git-Repository/, "ein gültiger Befehl ohne Repo trifft die Wache");
});

test("git init: Flags lehnen ab, das Repo entsteht nicht", () => {
  const s = freshSim();
  const r = s.exec("git init -b main");
  assert.match(r.output!, /das Flag '-b' bei 'git init'/);
  assert.equal(s.git.initialized, false);
});
