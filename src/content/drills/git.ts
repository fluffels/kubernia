import type { Sim } from "../../sim";
import { pick, rnd, ensureGit } from "./shared";
import type { DrillTask } from "./shared";

export const GIT_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "git-status": sim => {
    ensureGit(sim);
    return { text: "Zeig den aktuellen Stand deines Repos (Branch + Änderungen).", accept: [/^git\s+status$/], solution: "git status", hint: "git + ein Wort für „Stand“.", why: "status zeigt den aktuellen Branch und welche Änderungen vorgemerkt bzw. noch offen sind – der Lagebericht vor jedem Commit." };
  },
  "git-add": sim => {
    ensureGit(sim);
    const fn = "seekarte-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "# Karte";
    return { text: "Merke die neue Datei <code>" + fn + "</code> zum Commit vor.", accept: [new RegExp("^git\\s+add\\s+" + fn.replace(/[.-]/g, "\\$&") + "$")], solution: "git add " + fn, hint: "Muster: git add &lt;datei&gt;", why: "add merkt eine Datei für den nächsten Commit vor (Staging) – erst auswählen, dann mit commit festhalten. Muster: git add &lt;datei&gt;." };
  },
  "git-commit": sim => {
    ensureGit(sim);
    const fn = "notiz-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "x"; sim.exec("git add " + fn);
    const msg = pick(["Seekarte ergänzt", "Tippfehler behoben", "Route aktualisiert", "Hafen kartiert"]);
    return { text: "Halte die vorgemerkten Änderungen fest – Commit-Nachricht: <code>" + msg + "</code>.", accept: [new RegExp('^git\\s+commit\\s+(?:-m|--message)\\s+"' + msg + '"$')], solution: 'git commit --message "' + msg + '"', hint: 'Muster: git commit --message "Nachricht" (statt --message geht auch die Kurzform -m)', why: 'commit hält die vorgemerkten Änderungen als Schnappschuss mit Nachricht fest (lokal); hochgeladen wird erst mit push. Muster: git commit --message "Nachricht" – die Kurzform -m verdienst du dir durch Nutzung.' };
  },
  "git-branch": sim => {
    ensureGit(sim);
    let name = "karte-" + rnd(2, 99);
    while (sim.git.branches.includes(name)) name = "karte-" + rnd(100, 9999);
    return { text: "Lege einen neuen Branch <code>" + name + "</code> an (nur anlegen, nicht wechseln).", accept: [new RegExp("^git\\s+branch\\s+" + name + "$")], solution: "git branch " + name, hint: "Muster: git branch &lt;name&gt;", why: "branch legt einen neuen Zweig an, ohne dorthin zu wechseln (das täte checkout) – Muster: git branch &lt;name&gt;." };
  },
  "git-checkout": sim => {
    ensureGit(sim);
    let name = "feature-" + rnd(2, 99);
    while (sim.git.branches.includes(name)) name = "feature-" + rnd(100, 9999);
    return { text: "Lege den Branch <code>" + name + "</code> an UND wechsle direkt hinein.", accept: [new RegExp("^git\\s+checkout\\s+-b\\s+" + name + "$")], solution: "git checkout -b " + name, hint: "Muster: git checkout -b &lt;name&gt;", why: "checkout -b macht beides in einem Schritt: Branch anlegen UND direkt hineinwechseln – Muster: git checkout -b &lt;name&gt;." };
  },
  "git-add-all": sim => {
    ensureGit(sim);
    const fn = "aenderung-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.files[fn] = "# Notiz";
    return { text: "Merke <b>alle</b> Änderungen auf einmal zum Commit vor (mit dem Punkt-Kürzel).", accept: [/^git\s+add\s+\.$/], solution: "git add .", hint: "git add + ein einzelner Punkt = alles.", why: "Der Punkt steht für den aktuellen Ordner – git add . merkt damit alle Änderungen auf einmal vor, statt jede Datei einzeln." };
  },
  "ci-status": sim => {
    ensureGit(sim);
    if (!sim.files[".gitlab-ci.yml"]) sim.files[".gitlab-ci.yml"] = "stages: [build, test, deploy]";
    const fn = "auslieferung-" + sim.clock + "-" + rnd(100, 9999) + ".txt";
    sim.files[fn] = "x"; sim.exec("git add " + fn); sim.exec('git commit -m "Auslieferung"'); sim.exec("git push");
    return { text: "Schau nach, ob die letzte Pipeline durchgelaufen ist.", accept: [/^glab\s+ci\s+status$/], solution: "glab ci status", hint: "glab ci &lt;unterbefehl&gt; – der Befehl fürs Nachschauen.", why: "Ein Push löst die Pipeline aus; glab ci status zeigt, ob sie durchlief – kein Mensch klickt das an." };
  },
  "git-pull": sim => {
    ensureGit(sim);
    sim.git.conflict = null;
    sim.git.remoteAhead = rnd(1, 3);
    return { text: "Das Team hat gepusht: hol die neuen Commits in deinen Branch (holen + zusammenführen).", accept: [/^git\s+pull$/], solution: "git pull", hint: "git + ein Wort fürs „herziehen“.", why: "„Erst holen, dann pushen“: pull holt die neuen Commits des Teams und führt sie zusammen – so vermeidest du abgewiesene Pushes und die meisten Konflikte." };
  },
  "git-resolve": sim => {
    ensureGit(sim);
    sim.git.conflict = null;
    sim.git.pendingConflict = null;
    let br = "kollege-" + rnd(2, 99);
    while (sim.git.branches.includes(br)) br = "kollege-" + rnd(100, 99999);
    const fn = "route-" + sim.clock + "-" + rnd(100, 9999) + ".md";
    sim.mergeScenario({ gitConflict: { branch: br, file: fn, ours: "Route A (deine)", theirs: "Route B (von " + br + ")" } });
    sim.exec("git merge " + br);
    const side = pick(["--ours", "--theirs"]);
    const wer = side === "--ours" ? "<b>eigene</b>" : "<b>hereinkommende</b>";
    return { text: "Merge-Konflikt in <code>" + fn + "</code>: übernimm die " + wer + " Version.", accept: [new RegExp("^git\\s+checkout\\s+" + side + "\\s+" + fn.replace(/[.-]/g, "\\$&") + "$")], solution: "git checkout " + side + " " + fn, hint: "Muster: git checkout --ours/--theirs &lt;datei&gt;", why: "Im Konflikt wählst du eine Seite: --ours ist deine, --theirs die hereinkommende Version. Hier ist die " + wer + " gefragt – Muster: git checkout " + side + " &lt;datei&gt;." };
  },
};
