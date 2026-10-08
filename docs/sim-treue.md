# Sim-Treue: kubectl gegen die offizielle Doku (#1440)

> **Evergreen.** Ein Lernspiel vermittelt falsches Verhalten, wenn der Simulator von echtem `kubectl` abweicht, ohne es zu sagen. Die **Treue-Matrix** hält je Befehl und Ressourcenart fest, wie nah der Simulator an der Doku (kubernetes.io) ist; ein Test macht sie vollständig, und `help kubectl` zeigt den Spielenden die bewussten Vereinfachungen.

## Wo was liegt

| Was | Wo |
|---|---|
| Die Matrix (Daten, eine Zeile je JSON-Objekt) | [`sim-treue/kubectl.json`](sim-treue/kubectl.json), eine Datei je Befehlsfamilie |
| Die Texte der bewussten Vereinfachungen (für Spielende) | `grenzen` je Familie in `src/hud/helptext.ts`, sichtbar über `help kubectl` |
| Der Wächter | `test/sim/kubectl-treue.test.ts` (Domänen-Fitness) |

Die Matrix liegt unter `docs/`, nicht unter `src/`: sie wird nie ausgeliefert (kein Bundle-Gewicht), nur der Test liest sie.

## Aufbau einer Zeile

```json
{"befehl":"get","ziel":"pods","verhalten":"gleich","ausgabe":"gleich"}
{"befehl":"get","flag":"-A","verhalten":"abweichend","ausgabe":"abweichend","tickets":[1430],"grenzen":["ein-namespace"]}
```

- `befehl` plus genau eins von `ziel` (Ressourcenart, Unterverb, bei `apply` das `kind`) oder `flag` (Flag oder Aufrufform).
- `verhalten` (was der Befehl tut, Fehlerfälle, Aliase, Nebenwirkung) und `ausgabe` (Spalten, Format, Texte) tragen je einen Status.
- `tickets`: Pflicht bei `abweichend`, die Ticket-Nummern, in denen die Abweichung behoben wird. Gebündelt, nicht eins zu eins: mehrere Zeilen verweisen auf dasselbe Ticket.
- `grenzen`: Pflicht bei `vereinfacht`, die IDs der Spieler-Texte in `src/hud/helptext.ts`. Auch bei `abweichend` erlaubt, solange das Ticket offen ist und die Spielenden die Lücke kennen sollen.
- `doku` (optional) gilt nur für Zeilen mit eigener Quelle; je Befehl steht die Referenzseite unter `befehle`, dort bei Unterverb-Befehlen auch `dokuZiele`, die Unterverben laut Doku.

## Die drei Status

| Status | Bedeutung |
|---|---|
| `gleich` | Verhalten bzw. Ausgabe entspricht der Doku und der bekannten kubectl-Ausgabe; ein Lerner merkt keinen Unterschied. Nur setzen, wenn es belegt ist, im Zweifel `vereinfacht`. |
| `vereinfacht` | Bewusst weniger als echt (gekürzte Ausgabe, feste Werte, nur ein Namespace). Spielende erfahren es über `help kubectl`. |
| `abweichend` | Anders als echt, ohne dass es gewollt ist (Fehler oder Lücke). Gehört in ein Ticket, nicht in die Hilfe. |

## Eine Zeile abgleichen

1. Referenzseite öffnen: `https://kubernetes.io/docs/reference/kubectl/generated/kubectl_<befehl>/` (Flags, Beispiele; Ausgabespalten stehen dort oft nicht, dann gegen die bekannte Ausgabe prüfen und im Zweifel `vereinfacht`).
2. Den Simulator denselben Aufruf ausführen lassen (`sim.exec("kubectl …")` im Test oder im Spiel-Terminal).
3. Status je Zelle setzen. `abweichend`: bestehendes Sim-Ticket suchen (`gh issue list --search`) und die Zeile dort anhängen, sonst ein gebündeltes Ticket je Subsystem und Fehlertyp anlegen.

## Was der Test prüft, und was nicht

- Schema: Status-Enum, genau eins von `ziel`/`flag`, eindeutige Schlüssel, `abweichend` mit Tickets, `vereinfacht` mit bekannten `grenzen`, jede Grenze wird benutzt, Doku-Links nur https auf erlaubten Hosts.
- Vollständigkeit: die Befehle der Matrix sind genau die registrierten Unterbefehle (`KUBECTL_SUBCOMMANDS`). Bei `get` hat jede Aliasgruppe (`GET_RESOURCE_SCOPES`) genau eine Zeile. Bei `describe`, `create`, `delete`, `top` probt der Test jeden get-Alias per `exec` und vergleicht die unterstützten Arten mit den Zeilen, bei `set`, `rollout`, `auth`, `label` die Unterverben aus `dokuZiele` plus Zeilen, bei `apply` müssen die per Mapper unterstützten `kind`s (`MAPPED_KINDS`) Zeilen haben.
- Fail-closed: ändert sich der „nicht simuliert“-Text eines Befehls, schlägt die Sanity-Probe an.
- **Nicht geprüft:** ob ein Status stimmt (das ist Handarbeit gegen die Doku), `scale`, `expose`, `logs` (nur Präsenz), Flags (nur durch Zeilen, die jemand einträgt), Altpfad-Arten von `apply` über `MAPPED_KINDS` hinaus.

## Neuer Befehl, neue Art, neue Doku-Version

- Neuer Unterbefehl oder neue Ressourcenart im Simulator: Zeile in der Matrix, sonst ist der Test rot.
- Weitere Befehlsfamilien (helm, docker, git, terraform, argocd, glab, aws, kubeadm, curl, nslookup): je eine Datei `sim-treue/<familie>.json` nach demselben Muster, der Test wird dann um die Familie erweitert.
- Zwei Versionen: Clientseitiges (Flags, Spalten) prüfst du gegen die aktuelle Doku, Serverseitiges (Warnungen, Deprecations, entfernte APIs) folgt `clusterVersion` in der JSON, und die ist `NODE_VERSION` (`src/sim/nodes.ts`, ein Test koppelt beide). Beide stehen auf v1.37.
- Neue K8s-Version anheben, in dieser Reihenfolge:
  1. Die Druckspalten gegen die Matrix prüfen: `pkg/printers/internalversion/printers.go` zwischen den Release-Branches diffen (alle simulierten Arten, auch `-o wide`).
  2. Release-Blog und CHANGELOG, Abschnitt „Deprecations and removals“, auf Arten und Verhalten der Sim lesen.
  3. Laufzeit-Support prüfen (containerd, Kernel) und `NODE_SYSTEM_INFO` in `src/sim/nodes.ts` nachziehen.
  4. `NODE_VERSION` und `clusterVersion` anheben; die `hafen_cluster`-Version in den Quest-Daten (`version = "x.y.z"` in Terraform-Texten) zieht ein Wächter in `test/sim/nodes.test.ts` mit. Node-Specs der Quests tragen keine Version, sie folgt `NODE_VERSION`; ein Save-Format-Bump ist nur nötig, wenn der Snapshot die alte Version festhält (`migrations[9]`).
  5. Serverwarnungen als Feld `deprecationWarning` in der Registry (`src/sim/kubectl/resources.ts`) pflegen; `stand` in der JSON mitziehen.

## Bekannte Lücken (Stand 2026-10-08)

Ressourcenarten, die echtes `kubectl` kennt und der Simulator nicht (z.B. `get namespaces`, `describe configmap`), stehen nicht in der Matrix: sie ist die Karte des Vorhandenen. Die Lücken sammeln die Sim-Tickets (Namespaces: #1430).
