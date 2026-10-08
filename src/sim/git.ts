/* ===== Kubernia – git-Befehle (sim/git.ts) =====
 * Schritt 6/7 des sim.ts-Datei-Splits (#377, aus Epic #346, ADR 0004).
 *
 * Hier liegt die komplette `git`-Befehlsfamilie (init/status/add/commit/log/
 * branch/checkout/merge/push/fetch/pull) inklusive des kleinen, git-eigenen
 * Helfers `gitUntracked` (unversionierte Dateien). Wie bei docker (#373),
 * kubectl (#374), helm (#375) und terraform (#376) als freie Funktionen
 * ausgelagert, die die Sim-Instanz über das schmale `GitHost`-Interface
 * bekommen – so bleibt der Cluster-Zustand in EINER Hand (die `Sim`-Klasse),
 * die git-Logik aber in einer eigenen, testbaren Datei. Aufgerufen aus dem
 * `exec`-Dispatch in `sim.ts` per `gitCommand(this, …)`.
 *
 * Phaser-frei (pure Domäne): die Domänentypen kommen aus ./state – kein
 * Rückimport nach sim.ts (kein Zyklus). Die CI-Pipeline-Maschinerie liegt seit
 * #385 bei der `glab`-Familie (sim/glab.ts); `git push` stößt sie über den
 * direkten Import `runPipeline` an (eine .gitlab-ci.yml startet beim Push
 * automatisch eine Pipeline) – früher lief das über die Host-Methode `_runPipeline`.
 */
import type { ClusterState, Deployment, Broken } from "./state";
import { runPipeline } from "./glab";
import { flag, notSimulated, dispatchSub, type Dispatch, type Call, type SubEntry } from "./cliargs";

/** Was die git-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es dokumentiert
 *  die Kopplung von git an den Cluster-Zustand und vermeidet einen Import-Zyklus
 *  git ↔ sim. Statt des ganzen `ClusterState` (30+ Felder, Leaky Abstraction #516)
 *  nur die tatsächlich berührten Daten-Felder per `Pick` (ISP): `git`/`files` liest
 *  git selbst; `ci`/`deployments`/`clock` braucht die beim `git push` ausgelöste
 *  CI-Pipeline (`runPipeline`, sim/glab.ts), an die git seinen Host durchreicht.
 *  Die Feld-**Typen** bleiben über `Pick<ClusterState, …>` an die eine SSOT
 *  (sim/state.ts, #372) gebunden. Hinzu kommen die in `sim.ts` verbleibenden Helfer,
 *  die git ruft: Fehlerausgabe und – für die deploy-Stage – die Deployment-Fabrik. */
export interface GitHost extends Pick<ClusterState, "git" | "files" | "ci" | "deployments" | "clock"> {
  _err(msg: string, tip?: string): string;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
}

/** Ein git-Unterbefehl-Handler: bekommt Host + die ausgelesene Eingabe (`Call`, #1469), gibt die Ausgabe.
 *  Handler, die `c` nicht brauchen, lassen den Parameter weg – dank struktureller
 *  Kompatibilität bleiben sie zur Tabelle zuweisbar (wie bei docker `DockerHandler`). */
type GitHandler = (host: GitHost, c: Call) => string;

const COMMIT_HINTS: Readonly<Record<string, string>> = {
  "-a": "Der Simulator kennt nur die Stage: erst 'git add <datei>', dann 'git commit --message \"…\"'.",
  "--all": "Der Simulator kennt nur die Stage: erst 'git add <datei>', dann 'git commit --message \"…\"'.",
  "--amend": "Einen Commit nachträglich ändern gibt es nicht – committe die Änderung neu.",
};
const PUSH_HINTS: Readonly<Record<string, string>> = {
  "--force": "Erzwungenes Pushen gibt es nicht – hol erst die Neuigkeiten mit 'git pull'.",
  "-f": "Erzwungenes Pushen gibt es nicht – hol erst die Neuigkeiten mit 'git pull'.",
};

/** Alias → Eintrag (Handler + Flag-Tabelle; alle NACH der `git init`-Wache, also im initialisierten Repo, `init`
 *  selbst läuft davor). Ein neuer git-Unterbefehl ist ein Eintrag hier + eine Funktion unten – der Dispatcher
 *  (`gitCommand`) bleibt dünn und wächst nicht mit dem Befehlssatz (Stardew-Scope). */
const GIT: Dispatch<SubEntry<GitHandler>> = { cmd: "git", table: {
  init: { run: gitInit },
  status: { run: gitStatus },
  add: { run: gitAdd, flags: [flag(false, "-A", "--all")] },
  commit: { run: gitCommit, flags: [flag(true, "-m", "--message")], hints: COMMIT_HINTS },
  log: { run: gitLog },
  branch: { run: gitBranch },
  checkout: { run: gitCheckout, flags: [flag(true, "-b"), flag(false, "--ours"), flag(false, "--theirs")] },
  merge: { run: gitMerge },
  push: { run: gitPush, flags: [flag(false, "-u", "--set-upstream")], hints: PUSH_HINTS },
  fetch: { run: gitFetch },
  pull: { run: gitPull },
},
  // Echte git-Unterbefehle, die die Sim nicht kann.
  real: ["stash", "rebase", "reset", "diff", "remote", "clone", "tag", "show", "switch", "restore", "rm", "mv", "cherry-pick", "revert"],
};

export function gitCommand(host: GitHost, t: string[]): string {
  const r = dispatchSub(host, GIT, t, 1);
  if (typeof r === "string") return r;
  // `git init` läuft VOR der „ist ein Repo?"-Wache – es legt das Repo überhaupt erst an.
  if (!host.git.initialized && r.sub !== "init") {
    return host._err("⚠️ Das hier ist (noch) kein Git-Repository.", "Starte eins mit 'git init'.");
  }
  return r.entry.run(host, r.call);
}

function gitInit(host: GitHost): string {
  const g = host.git;
  if (g.initialized) return "Hinweis: Hier liegt schon ein Git-Repository (.git existiert bereits).";
  g.initialized = true;
  return "Initialisiertes leeres Git-Repository in /hafen/.git/\n📜 Ab jetzt kann Git jede Änderung an deinen Dateien festhalten.";
}

function gitUntracked(host: GitHost): string[] {
  const g = host.git;
  return Object.keys(host.files).filter(f => !g.staged.includes(f) && !g.committed.includes(f));
}

function gitStatus(host: GitHost): string {
  const g = host.git;
  const untracked = gitUntracked(host);
  let s = "Auf Branch " + g.branch + "\n";
  if (g.conflict) {
    s += "Du hast nicht zusammengeführte Pfade.\n  (behebe die Konflikte und committe das Ergebnis mit 'git commit')\n";
    s += "Nicht zusammengeführte Pfade:\n  beide geändert: " + g.conflict.file + "\n";
    s += "  ▸ Wähle eine Seite: 'git checkout --ours " + g.conflict.file + "' (deine) oder '--theirs " + g.conflict.file + "' (die hereinkommende), dann 'git add " + g.conflict.file + "'.\n";
    return s.trimEnd();
  }
  if (g.staged.length) s += "Zum Commit vorgemerkt:\n" + g.staged.map(f => "  neue Datei: " + f).join("\n") + "\n";
  if (untracked.length) s += "Unversionierte Dateien:\n" + untracked.map(f => "  " + f).join("\n") + "\n  (nutze \"git add <datei>\", um sie aufzunehmen)\n";
  if (!g.staged.length && !untracked.length) s += "Nichts zu committen, Arbeitsverzeichnis sauber ✨";
  return s.trimEnd();
}

/** `git add` auf die Konfliktdatei: nur ohne Marker gilt der Konflikt als gelöst. */
function gitResolveConflict(host: GitHost): string {
  const g = host.git;
  const file = g.conflict!.file;
  if (host.files[file] && /^(<{7}|={7}|>{7})/m.test(host.files[file])) {
    return host._err("git add: In '" + file + "' stecken noch Konfliktmarker (<<<<<<<, =======, >>>>>>>).",
      "Wähle erst eine Seite: 'git checkout --ours " + file + "' oder '--theirs " + file + "'.");
  }
  if (!g.staged.includes(file)) g.staged.push(file);
  g.conflict = null;
  return "Konflikt in '" + file + "' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.";
}

function gitAdd(host: GitHost, c: Call): string {
  const g = host.git;
  const arg = c.has("-A", "--all") ? "." : c.args[0]; // -A/--all gilt wie `.` (der Sim-Arbeitsordner ist flach)
  if (!arg) return host._err("git add: Welche Datei?", "z.B. 'git add seekarte.md' – oder 'git add .' für alles.");
  // Mitten im Konflikt markiert 'git add <konfliktdatei>' (oder 'git add .') ihn als gelöst.
  if (g.conflict && (arg === "." || arg === g.conflict.file)) return gitResolveConflict(host);
  let toAdd: string[];
  if (arg === ".") {
    toAdd = gitUntracked(host);
  } else {
    if (!host.files[arg]) return host._err("git add: Die Datei '" + arg + "' gibt es hier nicht.", "Tippe 'ls' für die Dateien in diesem Ordner.");
    toAdd = g.committed.includes(arg) && !gitUntracked(host).includes(arg) ? [] : [arg];
  }
  for (const f of toAdd) if (!g.staged.includes(f)) g.staged.push(f);
  return toAdd.length ? "Vorgemerkt: " + toAdd.join(", ") + " (bereit zum Commit)." : "Nichts Neues zum Vormerken.";
}

function gitCommit(host: GitHost, c: Call): string {
  const g = host.git;
  // -m und --message sind gleichwertig; mehrere -m werden Absätze (wie echtes git). Die Tokens sind schon geklammert
  // (`shellTokens`), `-m "remove --force flag"` bleibt EINE Nachricht.
  const msg = c.values("-m", "--message").join("\n\n");
  if (c.args.length) return notSimulated(host, "'git commit " + c.args[0] + "' (nur bestimmte Pfade committen).", ['git commit --message "…"'], "Merk Dateien erst mit 'git add' vor.");
  if (!msg) return host._err("git commit: Die Commit-Nachricht fehlt.", 'Muster: git commit --message "Was du geändert hast"');
  if (g.conflict) return host._err("git commit: Der Konflikt in '" + g.conflict.file + "' ist noch nicht gelöst.",
    "Seite wählen ('git checkout --ours/--theirs " + g.conflict.file + "'), dann 'git add " + g.conflict.file + "', erst dann committen.");
  if (!g.staged.length) return host._err("git commit: Nichts vorgemerkt (nothing to commit).", "Erst 'git add <datei>', dann committen.");
  const files = g.staged.slice();
  for (const f of files) if (!g.committed.includes(f)) g.committed.push(f);
  g.staged = [];
  const hash = (0xc0ffee + g.commits.length * 7).toString(16).slice(-7);
  g.commits.push({ hash, msg, branch: g.branch, files });
  return "[" + g.branch + " " + hash + "] " + msg.split("\n")[0] + "\n " + files.length + " Datei(en) festgehalten.";
}

function gitLog(host: GitHost): string {
  const g = host.git;
  if (!g.commits.length) return "Noch keine Commits. Mach deinen ersten mit 'git commit --message \"…\"'.";
  return g.commits.slice().reverse()
    .map(c => "commit " + c.hash + "  (" + c.branch + ")\n" + c.msg.split("\n").map(l => (l ? "    " + l : "")).join("\n")).join("\n");
}

function gitBranch(host: GitHost, c: Call): string {
  const g = host.git;
  const name = c.args[0];
  if (!name) return "Branches:\n" + g.branches.map(b => (b === g.branch ? "* " : "  ") + b).join("\n");
  if (g.branches.includes(name)) return host._err("git branch: Branch '" + name + "' gibt es schon.");
  g.branches.push(name);
  return "Branch '" + name + "' angelegt. (Wechseln mit 'git checkout " + name + "'.)";
}

/** Konflikt-Auflösung: eine Seite wählen, 'git checkout --ours/--theirs [--] <datei>'. */
function gitCheckoutSide(host: GitHost, c: Call): string {
  const g = host.git;
  const ours = c.has("--ours");
  const flagName = ours ? "--ours" : "--theirs";
  const file = c.args[0];
  if (!g.conflict) return host._err("git checkout " + flagName + ": Gerade ist kein Konflikt offen.", "Diese Form wählt im Konflikt eine Seite aus.");
  if (!file || file !== g.conflict.file) return host._err("git checkout " + flagName + ": Welche Konfliktdatei?", "Im Konflikt steckt: " + g.conflict.file + ". Also: 'git checkout " + flagName + " " + g.conflict.file + "'.");
  host.files[file] = ours ? g.conflict.ours : g.conflict.theirs;
  const wer = ours ? "deine eigene (HEAD)" : "die hereinkommende (" + g.conflict.from + ")";
  return "'" + file + "' auf " + wer + " Version gesetzt. ▸ Markier die Lösung mit 'git add " + file + "', dann 'git commit'.";
}

function gitCheckout(host: GitHost, c: Call): string {
  const g = host.git;
  if (c.has("--ours") || c.has("--theirs")) return gitCheckoutSide(host, c);
  const create = c.value("-b") !== null;
  const name = create ? c.value("-b") : c.args[0];
  if (create && c.args.length) return notSimulated(host, "einen Startpunkt bei 'git checkout -b' (" + c.args[0] + ").", ["git checkout -b <name>"], "Wechsle erst auf den Ausgangs-Branch, dann leg den neuen an.");
  if (!name) return host._err("git checkout: Welcher Branch?", "Neu + wechseln: 'git checkout -b <name>'. Nur wechseln: 'git checkout <name>'.");
  if (create) {
    if (g.branches.includes(name)) return host._err("git checkout -b: Branch '" + name + "' gibt es schon.", "Wechsle mit 'git checkout " + name + "'.");
    g.branches.push(name);
  } else if (!g.branches.includes(name)) {
    return host._err("git checkout: Branch '" + name + "' gibt es nicht.", "Neu anlegen + wechseln: 'git checkout -b " + name + "'.");
  }
  g.branch = name;
  return "Gewechselt zu Branch '" + name + "'" + (create ? " (neu angelegt)" : "") + ".";
}

function gitMerge(host: GitHost, c: Call): string {
  const g = host.git;
  const name = c.args[0];
  if (g.conflict) return host._err("git merge: Ein Merge läuft noch – es gibt einen offenen Konflikt in '" + g.conflict.file + "'.",
    "Erst lösen: Seite wählen ('git checkout --ours/--theirs " + g.conflict.file + "'), 'git add', 'git commit'.");
  if (!name) return host._err("git merge: Welchen Branch reinholen?", "Muster: 'git merge <branch>'.");
  if (!g.branches.includes(name)) return host._err("git merge: Branch '" + name + "' gibt es nicht.");
  if (name === g.branch) return host._err("git merge: Das ist schon dein aktueller Branch.", "Wechsle erst auf den Ziel-Branch, dann merge den anderen rein.");
  // Scharf gestellter Konflikt? Beide Branches haben dieselbe Datei geändert -> Merge bricht ab.
  const pc = g.pendingConflict;
  if (pc && pc.branch === name) {
    g.pendingConflict = null;
    g.conflict = { file: pc.file, ours: pc.ours, theirs: pc.theirs, from: name };
    // Die Datei trägt jetzt die Konfliktmarker – mit 'cat' sichtbar.
    host.files[pc.file] =
      "<<<<<<< HEAD (deine Version)\n" + pc.ours +
      "\n=======\n" + pc.theirs +
      "\n>>>>>>> " + name + " (hereinkommend)";
    return "Automatischer Merge von '" + pc.file + "' …\n" +
      "CONFLICT (content): Merge-Konflikt in " + pc.file + ".\n" +
      "Automatischer Merge fehlgeschlagen; behebe die Konflikte und committe das Ergebnis.\n" +
      "▸ Schau rein mit 'cat " + pc.file + "' – zwischen <<<<<<< und >>>>>>> stehen beide Versionen.";
  }
  const hash = (0xc0ffee + g.commits.length * 7).toString(16).slice(-7);
  g.commits.push({ hash, msg: "Merge Branch '" + name + "' in " + g.branch, branch: g.branch, files: [] });
  return "Merge: '" + name + "' → '" + g.branch + "' ✅ Die Arbeit aus beiden Branches ist jetzt vereint.";
}

/** `[remote [branch]]` von push/pull/fetch: in der Sim gibt es nur das Remote `origin` und den AKTUELLEN Branch.
 *  `null` = in Ordnung, sonst die fertige Fehlerausgabe (wie git: unbekanntes Remote, unbekannter Branch). */
function remoteRef(host: GitHost, cmd: string, c: Call): string | null {
  const g = host.git;
  const [remote, branch] = c.args;
  if (remote !== undefined && remote !== "origin") {
    return host._err("fatal: '" + remote + "' does not appear to be a git repository", "Das einzige Remote heißt 'origin' (git push origin <branch>).");
  }
  if (c.args.length > 2 || branch?.includes(":")) return notSimulated(host, "mehrere Branches oder Refspecs bei 'git " + cmd + "'.", ["git " + cmd + " [origin [<branch>]]"]);
  if (branch === undefined || branch === g.branch || branch === "HEAD") return null;
  if (g.branches.includes(branch)) {
    return notSimulated(host, "'git " + cmd + " origin " + branch + "' für einen anderen Branch als den aktuellen.", ["git " + cmd + " [origin [" + g.branch + "]]"], "Wechsle erst mit 'git checkout " + branch + "'.");
  }
  return host._err(cmd === "push" ? "error: src refspec " + branch + " does not match any" : "fatal: couldn't find remote ref " + branch, "Welche Branches es gibt, zeigt 'git branch'.");
}

function gitFetch(host: GitHost, c: Call): string {
  const g = host.git;
  const refErr = remoteRef(host, "fetch", c);
  if (refErr) return refErr;
  if (g.remoteAhead > 0) {
    g.fetched = true;
    return "Hole von origin … origin/" + g.branch + " ist " + g.remoteAhead + " Commit(s) voraus.\n" +
      "▸ 'git fetch' LÄDT die Neuigkeiten nur herunter – deine Arbeit bleibt unberührt. Einfügen erst mit 'git pull' (oder 'git merge').";
  }
  return "Hole von origin … Schon aktuell – origin/" + g.branch + " hat nichts Neues.";
}

function gitPull(host: GitHost, c: Call): string {
  const g = host.git;
  const refErr = remoteRef(host, "pull", c);
  if (refErr) return refErr;
  if (g.conflict) return host._err("git pull: Ein Konflikt ist noch offen.", "Erst den Merge abschließen, dann wieder pullen.");
  if (g.remoteAhead > 0) {
    const n = g.remoteAhead;
    for (let i = 0; i < n; i++) {
      const hash = (0xc0ffee + g.commits.length * 7).toString(16).slice(-7);
      g.commits.push({ hash, msg: "Vom Team geholt (#" + (i + 1) + ")", branch: g.branch, files: [] });
    }
    g.remoteAhead = 0;
    g.fetched = false;
    return "Hole von origin und führe zusammen … Fast-forward ✅ " + n + " neue Commit(s) vom Team in '" + g.branch + "' geholt.\n" +
      "▸ Merkregel: erst HOLEN (pull), dann erst deine pushen – so läufst du nicht in vermeidbare Konflikte.";
  }
  return "Hole von origin … Bereits auf dem neuesten Stand. ✨";
}

function gitPush(host: GitHost, c: Call): string {
  const g = host.git;
  const refErr = remoteRef(host, "push", c);
  if (refErr) return refErr;
  if (g.conflict) return host._err("git push: Ein Merge-Konflikt ist noch offen.", "Erst lösen (Seite wählen, 'git add', 'git commit'), dann pushen.");
  if (g.remoteAhead > 0) return host._err("git push: origin/" + g.branch + " ist dir voraus (" + g.remoteAhead + " Commit(s)).",
    "Hol sie erst mit 'git pull', dann push – sonst weist der Server deinen Push ab.");
  if (!g.commits.length) return host._err("git push: Noch nichts zu pushen.", "Erst committen, dann pushen.");
  g.pushed = true;
  let msg = "Schiebe nach origin/" + g.branch + " … ✅ Deine Commits liegen jetzt auf dem Server (z.B. GitLab) – sichtbar fürs Team.";
  if (c.has("-u", "--set-upstream")) msg += "\nbranch '" + g.branch + "' set up to track 'origin/" + g.branch + "'.";
  // Liegt eine .gitlab-ci.yml im Repo, startet der Runner bei jedem Push automatisch eine Pipeline.
  if (host.files[".gitlab-ci.yml"]) {
    const p = runPipeline(host);
    msg += "\n🏃 Eine .gitlab-ci.yml liegt im Repo – der Runner startet Pipeline #" + p.id +
      " (build → test → deploy). Status checken mit 'glab ci status'.";
  }
  return msg;
}
