/* ===== KubeQuest – git-Befehle (sim/git.ts) =====
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

/** Was die git-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es dokumentiert
 *  die Kopplung von git an den Cluster-Zustand und vermeidet einen Import-Zyklus
 *  git ↔ sim. Die Daten-Felder (`git`/`files`/`ci`/`deployments`) kommen über
 *  `extends ClusterState` (sim/state.ts, #372); hinzu kommen die in `sim.ts`
 *  verbleibenden Helfer, die git ruft: Fehlerausgabe, „Meintest du …?"-Vorschlag
 *  und – für die beim `git push` ausgelöste CI-Pipeline (`runPipeline`, sim/glab.ts) –
 *  die Deployment-Fabrik (`runPipeline` rollt die deploy-Stage auf `main` aus). */
export interface GitHost extends ClusterState {
  _err(msg: string, tip?: string): string;
  _suggest(word: string, list: string[]): string | null;
  _makeDeployment(name: string, image: string, replicas: number, broken?: Broken | null, envFrom?: { configMaps: string[]; secrets: string[] }, cpuHeavy?: boolean): Deployment;
}

export function gitCommand(host: GitHost, t: string[], raw: string): string {
  const sub = t[1];
  const g = host.git;
  if (sub === "init") {
    if (g.initialized) return "Hinweis: Hier liegt schon ein Git-Repository (.git existiert bereits).";
    g.initialized = true;
    return "Initialisiertes leeres Git-Repository in /hafen/.git/\n📜 Ab jetzt kann Git jede Änderung an deinen Dateien festhalten.";
  }
  if (!g.initialized) {
    return host._err("⚠️ Das hier ist (noch) kein Git-Repository.", "Starte eins mit 'git init'.");
  }
  switch (sub) {
    case "status": return gitStatus(host);
    case "add": return gitAdd(host, t);
    case "commit": return gitCommit(host, raw);
    case "log": return gitLog(host);
    case "branch": return gitBranch(host, t);
    case "checkout": return gitCheckout(host, t);
    case "merge": return gitMerge(host, t);
    case "push": return gitPush(host);
    case "fetch": return gitFetch(host);
    case "pull": return gitPull(host);
    default: {
      const guess = host._suggest(sub || "", ["init", "status", "add", "commit", "log", "branch", "checkout", "merge", "push", "fetch", "pull"]);
      return host._err("⚠️ 'git " + (sub || "") + "' kenne ich hier nicht.",
        guess ? "Meintest du 'git " + guess + "'?" : "Versuch's mit status, add, commit, log, branch, checkout, merge oder push.");
    }
  }
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

function gitAdd(host: GitHost, t: string[]): string {
  const g = host.git;
  const arg = t[2];
  if (!arg) return host._err("git add: Welche Datei?", "z.B. 'git add seekarte.md' – oder 'git add .' für alles.");
  // Mitten im Konflikt markiert 'git add <konfliktdatei>' (oder 'git add .') ihn als gelöst.
  if (g.conflict && (arg === "." || arg === g.conflict.file)) {
    if (host.files[g.conflict.file] && /^(<{7}|={7}|>{7})/m.test(host.files[g.conflict.file])) {
      return host._err("git add: In '" + g.conflict.file + "' stecken noch Konfliktmarker (<<<<<<<, =======, >>>>>>>).",
        "Wähle erst eine Seite: 'git checkout --ours " + g.conflict.file + "' oder '--theirs " + g.conflict.file + "'.");
    }
    const file = g.conflict.file;
    if (!g.staged.includes(file)) g.staged.push(file);
    g.conflict = null;
    return "Konflikt in '" + file + "' als gelöst markiert (vorgemerkt). ▸ Schließe den Merge jetzt mit 'git commit --message \"…\"' ab.";
  }
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

function gitCommit(host: GitHost, raw: string): string {
  const g = host.git;
  // -m und --message sind gleichwertig (wie echtes git + die accept-Regex, #381).
  const m = raw.match(/(?:-m|--message)\s+"([^"]*)"|(?:-m|--message)\s+'([^']*)'|(?:-m|--message)\s+(\S+)/);
  const msg = m ? (m[1] || m[2] || m[3]) : null;
  if (!msg) return host._err("git commit: Die Commit-Nachricht fehlt.", 'Muster: git commit --message "Was du geändert hast"');
  if (g.conflict) return host._err("git commit: Der Konflikt in '" + g.conflict.file + "' ist noch nicht gelöst.",
    "Seite wählen ('git checkout --ours/--theirs " + g.conflict.file + "'), dann 'git add " + g.conflict.file + "', erst dann committen.");
  if (!g.staged.length) return host._err("git commit: Nichts vorgemerkt (nothing to commit).", "Erst 'git add <datei>', dann committen.");
  const files = g.staged.slice();
  for (const f of files) if (!g.committed.includes(f)) g.committed.push(f);
  g.staged = [];
  const hash = (0xc0ffee + g.commits.length * 7).toString(16).slice(-7);
  g.commits.push({ hash, msg, branch: g.branch, files });
  return "[" + g.branch + " " + hash + "] " + msg + "\n " + files.length + " Datei(en) festgehalten.";
}

function gitLog(host: GitHost): string {
  const g = host.git;
  if (!g.commits.length) return "Noch keine Commits. Mach deinen ersten mit 'git commit --message \"…\"'.";
  return g.commits.slice().reverse()
    .map(c => "commit " + c.hash + "  (" + c.branch + ")\n    " + c.msg).join("\n");
}

function gitBranch(host: GitHost, t: string[]): string {
  const g = host.git;
  const name = t[2];
  if (!name) return "Branches:\n" + g.branches.map(b => (b === g.branch ? "* " : "  ") + b).join("\n");
  if (name.startsWith("-")) return host._err("git branch: So nicht.", "Zum Anlegen: 'git branch <name>'.");
  if (g.branches.includes(name)) return host._err("git branch: Branch '" + name + "' gibt es schon.");
  g.branches.push(name);
  return "Branch '" + name + "' angelegt. (Wechseln mit 'git checkout " + name + "'.)";
}

function gitCheckout(host: GitHost, t: string[]): string {
  const g = host.git;
  // Konflikt-Auflösung: eine Seite wählen. 'git checkout --ours/--theirs <datei>'
  if (t[2] === "--ours" || t[2] === "--theirs") {
    const side = t[2] === "--ours" ? "ours" : "theirs";
    const file = t[3];
    if (!g.conflict) return host._err("git checkout " + t[2] + ": Gerade ist kein Konflikt offen.", "Diese Form wählt im Konflikt eine Seite aus.");
    if (!file || file !== g.conflict.file) return host._err("git checkout " + t[2] + ": Welche Konfliktdatei?", "Im Konflikt steckt: " + g.conflict.file + ". Also: 'git checkout " + t[2] + " " + g.conflict.file + "'.");
    host.files[file] = side === "ours" ? g.conflict.ours : g.conflict.theirs;
    const wer = side === "ours" ? "deine eigene (HEAD)" : "die hereinkommende (" + g.conflict.from + ")";
    return "'" + file + "' auf " + wer + " Version gesetzt. ▸ Markier die Lösung mit 'git add " + file + "', dann 'git commit'.";
  }
  let name = t[2], create = false;
  if (t[2] === "-b") { create = true; name = t[3]; }
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

function gitMerge(host: GitHost, t: string[]): string {
  const g = host.git;
  const name = t[2];
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

function gitFetch(host: GitHost): string {
  const g = host.git;
  if (g.remoteAhead > 0) {
    g.fetched = true;
    return "Hole von origin … origin/" + g.branch + " ist " + g.remoteAhead + " Commit(s) voraus.\n" +
      "▸ 'git fetch' LÄDT die Neuigkeiten nur herunter – deine Arbeit bleibt unberührt. Einfügen erst mit 'git pull' (oder 'git merge').";
  }
  return "Hole von origin … Schon aktuell – origin/" + g.branch + " hat nichts Neues.";
}

function gitPull(host: GitHost): string {
  const g = host.git;
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

function gitPush(host: GitHost): string {
  const g = host.git;
  if (g.conflict) return host._err("git push: Ein Merge-Konflikt ist noch offen.", "Erst lösen (Seite wählen, 'git add', 'git commit'), dann pushen.");
  if (g.remoteAhead > 0) return host._err("git push: origin/" + g.branch + " ist dir voraus (" + g.remoteAhead + " Commit(s)).",
    "Hol sie erst mit 'git pull', dann push – sonst weist der Server deinen Push ab.");
  if (!g.commits.length) return host._err("git push: Noch nichts zu pushen.", "Erst committen, dann pushen.");
  g.pushed = true;
  let msg = "Schiebe nach origin/" + g.branch + " … ✅ Deine Commits liegen jetzt auf dem Server (z.B. GitLab) – sichtbar fürs Team.";
  // Liegt eine .gitlab-ci.yml im Repo, startet der Runner bei jedem Push automatisch eine Pipeline.
  if (host.files[".gitlab-ci.yml"]) {
    const p = runPipeline(host);
    msg += "\n🏃 Eine .gitlab-ci.yml liegt im Repo – der Runner startet Pipeline #" + p.id +
      " (build → test → deploy). Status checken mit 'glab ci status'.";
  }
  return msg;
}
