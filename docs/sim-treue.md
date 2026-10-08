# Sim-Treue: die Befehlsfamilien gegen die offizielle Doku (#1440, #1461)

> **Evergreen.** Ein Lernspiel vermittelt falsches Verhalten, wenn der Simulator vom echten Werkzeug abweicht, ohne es zu sagen. Die **Treue-Matrix** hält je Befehlsfamilie fest, wie nah der Simulator an der offiziellen Doku ist; ein Test macht sie vollständig, und `help <befehl>` zeigt den Spielenden die bewussten Vereinfachungen.

## Wo was liegt

| Was | Wo |
|---|---|
| Die Matrix (Daten, eine Zeile je JSON-Objekt) | `sim-treue/<familie>.json`, eine Datei je Befehlsfamilie (`kubectl`, `kubeadm`, `curl`, `nslookup`) |
| Die Texte der bewussten Vereinfachungen (für Spielende) | `grenzen` je Familie in `src/hud/helptext.ts`, sichtbar über `help <befehl>` |
| Der generische Wächter | `test/sim/sim-treue.test.ts` (Schema, Familien, Vollständigkeit); Laden und Typen in `test/support/sim-treue.ts` |
| Die Tiefe einzelner Familien | `test/sim/kubectl-treue.test.ts` (Arten, Unterverben, `kind`s) |

Die Matrix liegt unter `docs/`, nicht unter `src/`: sie wird nie ausgeliefert (kein Bundle-Gewicht), nur die Tests lesen sie.

## Doku-Quelle je Familie

| Familie | Offizielle Doku | Form |
|---|---|---|
| `kubectl` | kubernetes.io, `kubectl_<befehl>` | Unterbefehl |
| `kubeadm` | kubernetes.io, `kubeadm-<befehl>` | Unterbefehl |
| `curl` | curl.se, Manpage | Einzelbefehl |
| `nslookup` | bind9.readthedocs.io, Manpage | Einzelbefehl |

Doku-Links in der Matrix sind https auf einem **exakten** Projekt-Host (Liste im Wächter; keine Subdomain-Treffer, kein pauschales `readthedocs.io`/`github.io`). Ein neuer Host braucht eine bewusste Ergänzung dieser Liste.

## Die drei Formen

- **Unterbefehl** (`kubectl get`, `kubeadm init`): `befehl` ist der Unterbefehl. Die exportierte Registry der Familie (`KUBECTL_SUBCOMMANDS`, `KUBEADM_SUBCOMMANDS`) ist genau die Menge der `befehle`-Schlüssel und der Zeilen-Befehle, in beide Richtungen.
- **Einzelbefehl** (`curl`, `nslookup`): `befehle` enthält nur den Familiennamen, jede Zeile hat `befehl` = Familienname, mindestens eine Zeile. `ziel` ist die Art des Ziels (z.B. ClusterIP-Service), `flag` das Flag oder die Aufrufform (`<host>:<port>`, `-o <datei>`).
- **Präfix** (`aws s3 …`, `argocd app …`, `glab ci …`): `<präfix> <unterbefehl>` als `befehl`. Der Wächter kennt die Form noch nicht, sie kommt mit der ersten Familie dieser Art.

## Aufbau einer Zeile

```json
{"befehl":"get","ziel":"pods","verhalten":"gleich","ausgabe":"gleich"}
{"befehl":"get","flag":"-A","verhalten":"abweichend","ausgabe":"abweichend","tickets":[1430],"grenzen":["ein-namespace"]}
```

- Dateiebene: `hinweis`, `stand`, `befehle`, `zeilen` sind Pflicht, `clusterVersion` optional (nur wo die Version des simulierten Clusters das Verhalten bestimmt, bei `kubectl`). Unbekannte Schlüssel sind rot, auf Datei-, `befehle`- und Zeilenebene.
- `befehl` plus genau eins von `ziel` oder `flag`.
- `verhalten` (was der Befehl tut, Fehlerfälle, Aliase, Nebenwirkung) und `ausgabe` (Spalten, Format, Texte) tragen je einen Status.
- `tickets`: Pflicht bei `abweichend`, die Ticket-Nummern, in denen die Abweichung behoben wird. Gebündelt, nicht eins zu eins: mehrere Zeilen verweisen auf dasselbe Ticket.
- `grenzen`: Pflicht bei `vereinfacht`, die IDs der Spieler-Texte in `src/hud/helptext.ts` (die Familie ist der Dateiname). Auch bei `abweichend` erlaubt, solange das Ticket offen ist und die Spielenden die Lücke kennen sollen. Jede Grenze der Familie muss von mindestens einer Zeile benutzt werden.
- `doku` (optional) gilt nur für Zeilen mit eigener Quelle; je Befehl steht die Referenzseite unter `befehle`, dort bei Unterverb-Befehlen auch `dokuZiele`, die Unterverben laut Doku.

## Die drei Status

| Status | Bedeutung |
|---|---|
| `gleich` | Verhalten bzw. Ausgabe entspricht der Doku und der bekannten Ausgabe; ein Lerner merkt keinen Unterschied. Nur setzen, wenn es belegt ist, im Zweifel `vereinfacht`. |
| `vereinfacht` | Bewusst weniger als echt (gekürzte Ausgabe, feste Werte, nur ein Namespace). Spielende erfahren es über `help <befehl>`. |
| `abweichend` | Anders als echt, ohne dass es gewollt ist (Fehler oder Lücke). Gehört in ein Ticket, nicht in die Hilfe. |

Zeilen mit 💡 an einer **Fehlermeldung** zählen nicht als Abweichung (Lernhilfe des Spiels). Eine 💡-Zeile in einer **Erfolgsausgabe** macht die `ausgabe`-Zelle `vereinfacht`.

## Eine Zeile abgleichen

1. Referenzseite der Familie öffnen (Tabelle oben; Ausgabespalten stehen dort oft nicht, dann gegen die bekannte Ausgabe prüfen und im Zweifel `vereinfacht`).
2. Den Simulator denselben Aufruf ausführen lassen (`sim.exec("<familie> …")` im Test oder im Spiel-Terminal).
3. Status je Zelle setzen. `abweichend`: bestehendes Sim-Ticket suchen (`gh issue list --search`) und die Zeile dort anhängen, sonst ein gebündeltes Ticket je Subsystem und Fehlertyp anlegen.

## Was der Test prüft, und was nicht

- **Schema** (jede Datei, generisch): Status-Enum, genau eins von `ziel`/`flag`, eindeutige Schlüssel, `abweichend` mit Tickets, `vereinfacht` mit bekannten `grenzen` der Familie, jede Grenze wird benutzt, Doku-Links https auf exakten Hosts, gesetzte `clusterVersion` ist `NODE_VERSION`.
- **Familien:** jeder Befehl der Dispatch-Tabelle (`SIM_COMMANDS`, ohne die Metabefehle `ls` und `cat`) hat eine Matrix-Datei oder steht in der Abbauliste `OHNE_MATRIX` im Wächter (Familie → offenes Kind-Ticket von #1452; die Liste dort ist die SSOT, hier stehen keine Nummern). Eine Matrix zu einem Abbaulisten-Eintrag macht den Eintrag stale und damit rot; eine Familie mit `grenzen` in `helptext.ts` braucht eine Matrix.
- **Vollständigkeit** je Familie über ein Spec-Objekt im Test (Form oben). Bei Unterbefehls-Familien prüft eine Sanity-Probe fail-closed, dass der „unbekannt“-Text nur den erfundenen Unterbefehl trifft.
- **kubectl-Tiefe:** bei `get` hat jede Aliasgruppe (`GET_RESOURCE_SCOPES`) genau eine Zeile. Bei `describe`, `create`, `delete`, `top` probt der Test jeden get-Alias per `exec`, bei `set`, `rollout`, `auth`, `label` die Unterverben aus `dokuZiele` plus Zeilen, bei `apply` müssen die per Mapper unterstützten `kind`s (`MAPPED_KINDS`) Zeilen haben; ändert sich der „nicht simuliert“-Text eines Befehls, schlägt die Sanity-Probe an.
- **Nicht geprüft:** ob ein Status stimmt (das ist Handarbeit gegen die Doku), `scale`, `expose`, `logs` (nur Präsenz), Flags und Aufrufformen (nur durch Zeilen, die jemand einträgt, bei Einzelbefehlen ganz), Altpfad-Arten von `apply` über `MAPPED_KINDS` hinaus.

## Neuer Befehl, neue Familie, neue Doku-Version

- Neuer Unterbefehl oder neue Ressourcenart im Simulator: Zeile in der Matrix, sonst ist der Test rot. Neue Aufrufform oder neues Flag eines Einzelbefehls: Zeile von Hand eintragen (der Wächter sieht sie nicht).
- **Neue Befehlsfamilie** (Eintrag in `COMMAND_HANDLERS`): Matrix `sim-treue/<familie>.json` nach demselben Muster, ihre `grenzen` in `helptext.ts`, ein Eintrag im Spec-Objekt des Tests (bei einer Unterbefehls-Familie mit exportierter Registry). Ohne Matrix ist der Familien-Wächter rot; wer sie bewusst später baut, trägt sie mit offenem Ticket in `OHNE_MATRIX` ein.
- Neue Doku-Version: die Referenzseiten der Zeilen mit Status `gleich` erneut ansehen; `stand` in der JSON mitziehen.
- Zwei Versionen bei `kubectl`: Clientseitiges (Flags, Spalten) prüfst du gegen die aktuelle Doku, Serverseitiges (Warnungen, Deprecations, entfernte APIs) folgt `clusterVersion` in der JSON, und die ist `NODE_VERSION` (`src/sim/nodes.ts`, ein Test koppelt beide). Beim Anheben versionsabhängiges Verhalten prüfen, z.B. die Deprecation-Warnung für v1 Endpoints ab v1.33 (der Wächter in `test/sim/kubectl-ausgabe.test.ts` zeigt die Stelle).

## Bekannte Lücken (Stand 2026-10-08)

Ressourcenarten, die echtes `kubectl` kennt und der Simulator nicht (z.B. `get namespaces`, `describe configmap`), stehen nicht in der Matrix: sie ist die Karte des Vorhandenen. Die Lücken sammeln die Sim-Tickets (Namespaces: #1430; curl-NetworkPolicy: #887; curl- und nslookup-Flags: #1510; kubeadm-join-Form: #1511).
