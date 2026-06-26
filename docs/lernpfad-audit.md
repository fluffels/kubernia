# Lernpfad-Audit: Lernreihenfolge des ganzen Spiels (#227)

> **Was ist das hier?** Eine einmalige, ganzheitliche Prüfung der Lernreihenfolge: Wird
> irgendwo ein Befehl/Konzept **benutzt oder vorausgesetzt, bevor er eingeführt wurde**
> (Vorwärts-Referenz / verletzte Voraussetzung)? Ergebnis ist dieser Bericht + daraus
> abgeleitete Folge-Tickets. **Dieses Ticket ist der Audit, nicht die Umsetzung.**
>
> Lebt als Doku im Repo (wie [`art-direction-audit.md`](art-direction-audit.md)), damit
> künftige Inhalts-Änderungen dagegen geprüft werden können. Die laufende, automatisierte
> Absicherung gegen neue Vorwärts-Referenzen ist als **#235** geführt (Wächter-Test).

## Methode

Spielreihenfolge = **Array-Reihenfolge** in [`src/content/quests.ts`](../src/content/quests.ts)
(nicht die Quest-Nummer! q26 liegt zwischen q14/q15, q25 zwischen q20/q21). Über alle Quests
in dieser Reihenfolge wurde jeder Schritt klassifiziert:

- **Einführung** (`teach`-Schritt): der kanonische „🆕 Neuer Befehl"-Beat – erklärt + selbst getippt.
- **Nutzung** (`terminal`-Aufgabe oder `drill`): der Befehl wird als Aufgabe verlangt. Drills wurden
  dafür mit einer frischen `Sim` aufgerufen und ihre `solution` ausgewertet (Ground-Truth statt Raten).
- **Erwähnung** (`<code>…</code>` in `dialog`/`choice`/Aufgabentext): der Befehl taucht nur im Prosatext auf.

Für jeden Befehl (Programm + Unterbefehl als Signatur) wurde die **erste** Einführung mit der **ersten**
Nutzung/Erwähnung verglichen. Eine Nutzung *vor* der Einführung (oder ganz ohne Einführung) ist ein Befund.

## Gesamtbefund

**Strukturell ist das Curriculum gesund.** Die Domänen-Reihenfolge ist didaktisch stimmig:
Docker (q1–q3b) → kubectl imperativ (q4–q7) → kubectl deklarativ/YAML (q8) → Helm (q9–q11) →
Terraform (q12–q13) → Secrets/Security (q14, q26) → Troubleshooting (q15–q17) → Git & CI/CD
(q18–q20, q25) → eigenes Chart (q21) → NetworkPolicy/TLS/Ingress (q22–q24, q27) → GitOps/Argo (q28–q31).
Es gibt **keine** echte Cross-Quest-Vorwärts­referenz für die *großen* Befehle – jeder wird vor seiner
Verwendung in einer späteren Quest eingeführt.

**Die wiederkehrende Lücke ist eine andere:** Einige Befehle bekommen **keinen eigenen `teach`-Beat**,
sondern werden nur **inline in einer Terminal-Aufgabe** (Befehl im Aufgabentext + Hint) zum ersten Mal
verlangt. Folge: kein sauberer „🆕 Neuer Befehl"-Lernmoment, schwächere Verankerung in der
Wiederholung (Spaced Repetition hängt an `teach`/`choice`-Beats). Bei den Terminal-Basics (`ls`/`cat`)
kommt hinzu, dass sie auch im Prosatext **nie erklärt** werden.

q20 (Pipeline-Passage) zeigt vorbildlich, wie es sein soll: `glab` wird im Dialog als Werkzeug
vorgestellt, *dann* kommt der `teach`-Schritt `glab ci status`; bereits Bekanntes ist mit ↩︎ als
Wiederholung markiert. Dieses Muster ist die Messlatte für die Befunde unten.

## Befunde

Schweregrad: 🔴 Kernbefehl/zustandsändernd ohne Lernmoment · 🟠 Konsistenz/mittel · 🟡 klein.

### A) Terminal-Basics werden nie eingeführt — `ls`, `cat` 🔴
- `cat` zuerst verlangt in **q3b** (`t-cat-dockerfile`: „Lies den Bauplan: `cat Dockerfile`"), danach
  q8, q14, q20, q29. Es gibt nie einen „🆕 was macht `cat`"-Beat; spätestens q20 behandelt `cat` als
  längst bekannt („wie bei meiner Seekarte").
- `ls` zuerst verlangt in **q8** (`t-ada-1`: „Schau mit `ls` nach", Hint „Zwei Buchstaben"), erneut q29.
  Nie eingeführt – was ein Terminal/eine Datei/ein Verzeichnis ist, wird vorausgesetzt.
- **Bereits ticketiert:** #213 (`cat` erklären), #215 (Grundlagen-Lerneinheit Terminal-Basics ls/cd/pwd/cat
  *vor* erster Verwendung). Der Audit bestätigt sie und pinnt die Erst-Verwendung (q3b für `cat`, q8 für `ls`).
  → **kein neues Ticket**, stattdessen Fundstellen an #215 kommentiert.

### B) Befehle ohne eigenen `teach`-Beat (nur inline in einer Terminal-Aufgabe) 🔴/🟠
| Befehl | erste Nutzung | Status | Folge |
|---|---|---|---|
| `kubectl delete (pod)` | q7 `t-storm-2` (Sturm-Test) | kalt, danach gedrillt; zustandsändernd | **neues Ticket** (🔴) |
| `kubectl logs` | q16 `t-j16-2` (Das Flackern) | kalt, Kern-Debugging-Befehl | **neues Ticket** (🔴), Querverweis #230 |
| `helm search repo` | q9 `t-runa-2` | inline gezeigt | **neues Ticket** (🟠, gebündelt) |
| `helm list` | q10 `t-runa-3` | inline, danach gedrillt | **neues Ticket** (🟠, gebündelt) |
| `helm repo update` | q9 `t-runa-1` | inline (Geschwister von `helm repo add`, das eingeführt wird) | **neues Ticket** (🟠, gebündelt) |
| `argocd app list` | q29 `t-argo-list` | inline, während `argocd app get`/`sync` echte `teach`-Schritte sind | ✅ **erledigt (#250)** – `t-argo-list` ist jetzt ein eigener `teach`-Beat mit 🆕-Intro |

`kubectl get ingress`/`get deployments`/`get services` zählen **nicht** dazu: `kubectl get` ist
in q4 eingeführt, hier kommen nur neue Ressourcentypen dazu (eigenes Thema: #208/#226 Glossar).

### C) Drill verlangt eine nie eingeführte Befehlsform — `git branch` ✅ erledigt (#251)
Der Drill `git-branch` (reines `git branch <name>`, anlegen *ohne* wechseln) war im Pool von **q19**
(`git-feature-branch`), q19 lehrte aber nur `git checkout -b` (anlegen **und** wechseln) – die reine
`git branch`-Form wurde also geübt, ohne je gezeigt worden zu sein. **Behoben (#251, Variante A):**
`git-feature-branch` führt `git branch <name>` jetzt als eigenen `teach`-Schritt (`t-git-branch`,
Branch `reserve-route`) direkt nach `git checkout -b` ein und grenzt beide ausdrücklich ab
(nur anlegen vs. anlegen + wechseln).

### D) Übungs-Freischaltung vor Story-Einführung — `k-logs` 🟡
In `PRACTICE` ist der `k-logs`-Drill bei Juno mit `after: q15` freigeschaltet, `kubectl logs` wird in
der Story aber erst in **q16** eingeführt/verwendet. Ein:e Spieler:in könnte `logs` üben, bevor die
Story es einführt. Klein (Üben ist optional), wird mit dem `kubectl logs`-Ticket (B) miterledigt:
nach Einführung in q16 die Freischaltung auf `after: q16` ziehen.

## Konzept-Ebene (nicht-Befehle)

Begriffe (Pod, Deployment, Service, Ingress, Secret, ConfigMap, Image/Tag, Registry, Namespace,
detached, nginx …) werden im Dialog eingeführt. Die hier in der „Auslöser"-Runde aufgefallenen
Einzelfälle sind bereits punktuell ticketiert und müssen **nicht** doppelt erfasst werden:
#208 (Suffixe/IDs), #209 (detached `-d`), #210 (Image vs. Wunschname), #211 (Flag-Reihenfolge),
#212 (nginx), #213 (`cat`), #215 (Terminal-Basics), #216/#217 (Stapel-Spiel), #224 (Tag/latest),
#225 (Befehls-Anatomie), #226 (Glossar/Begriffs-Auffrischung), #230 (`describe` vs `logs`),
#231 (Kralle-Quiz Bausteine), #235 (automatischer Wächter).

## Automatischer Wächter (→ #235)

Die hier benutzte Logik ist der Keim für den Dauer-Test in #235. Vorgeschlagene Regel, prüfbar analog
zum Durchspiel-Test [`test/quests.test.ts`](../test/quests.test.ts):

> Laufe die Quests in Array-Reihenfolge ab und führe ein Set „bisher eingeführter Befehls-Signaturen"
> mit. Eine Signatur gilt als eingeführt, sobald sie in einem `teach.cmd.solution` vorkommt. Für jede
> in einem `terminal.tasks[].solution` oder in einem gezogenen `drill` verlangte Signatur muss sie zu
> diesem Zeitpunkt bereits im Set sein – sonst schlägt der Test fehl. Terminal-Basics (`ls`/`cat`) und
> bewusst inline eingeführte Befehle laufen über eine kleine, dokumentierte Ausnahmeliste, die mit den
> Tickets aus B/C nach und nach leerläuft.

## Anhang: Einführungs-vs-Nutzungs-Tabelle (Auszug)

`intro` = erster `teach`, `use` = erste Terminal-/Drill-Aufgabe, `qN#k` = Quest-id # globaler Schritt.

```
docker pull/run/ps/stop/build/tag        intro q1–q3b   ✓ vor Nutzung
docker images                            intro q3b      ✓
kubectl get / describe / scale / expose  intro q4–q7    ✓
kubectl create deployment                intro q6       ✓
kubectl delete (pod)                     intro —        ✗ kalt ab q7        → B
kubectl apply -f                         intro q8       ✓
kubectl logs                             intro —        ✗ kalt ab q16       → B
kubectl rollout restart                  intro q16      ✓
kubectl create secret generic / tls      intro q14/q23  ✓
kubectl set resources                    intro q27      ✓
helm repo add                            intro q9       ✓
helm repo update                         intro —        ✗ inline q9         → B
helm search repo                         intro —        ✗ inline q9         → B
helm list                                intro —        ✗ inline q10        → B
helm install/upgrade/rollback            intro q10/q11  ✓
helm create/lint/package/install-local   intro q21      ✓
terraform init/plan/apply/state/destroy  intro q12/q13  ✓ (vor Nutzung q17)
git init/status/add/commit/log           intro q18      ✓
git branch                               intro q19      ✓ (#251)
git checkout -b / merge / push / fetch / pull  intro q19/q20/q25  ✓
glab ci status                           intro q20      ✓ (glab im Dialog vorab)
argocd app get / sync                    intro q29      ✓
argocd app list                          intro q29      ✓ (#250)
ls / cat                                 intro —        ✗ nie erklärt       → A (#213/#215)
```
