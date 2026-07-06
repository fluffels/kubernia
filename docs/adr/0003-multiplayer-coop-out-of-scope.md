# ADR 0003: Multiplayer/Co-op – aktuell außerhalb Scope

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-06-16 · Ticket: #87

## Status

**Akzeptiert.** Kubernia bleibt ein Single-Player-Spiel. Multiplayer/Co-op ist
bewusst außerhalb des aktuellen Scopes.

## Kontext

Stardew Valley hat Co-op: ein Host-Spielstand, andere joinen – **ein gemeinsamer
Stand**, nicht getrennte. Weil Stardew unsere Politur-Messlatte ist (#44), kommt
regelmäßig die Frage auf, ob Kubernia das auch können sollte.

Co-op wäre für uns ein **großer Architektur-Treiber**: dauerhaft laufender
Server + Netcode (Zustands-Synchronisation, Konfliktauflösung) + vermutlich
DB/Accounts. Das ist **genau der Backend-Stack, den wir bewusst nicht bauen** –
festgehalten im „kein Backend"-ADR (#85). Multiplayer hängt damit direkt an
dieser Entscheidung: Ohne Backend kein geteilter Live-Spielstand.

Der Kern-Wert von Kubernia spricht ebenfalls gegen Multiplayer:

- **Läuft offline im Browser**, als **eine einzige Datei**
  (`dist-offline/index.html`) per Doppelklick startbar, einfach verschenkbar.
  Geteilter Live-Zustand widerspricht „offline, eine Datei".
- Ist ein **Einzel-Lernpfad** für Docker/K8s/Helm/Terraform – das Lernen ist
  von Natur aus solo (eigene Quests, eigener Fortschritt, eigene Spaced
  Repetition).

## Optionen

| Option | Bewertung |
|---|---|
| **Single-Player bleiben (Status quo)** | Kein Server, kein Netcode, kein Account-System. Offline-Single-File-Wert bleibt erhalten. Voller Fokus auf Inhalt & Politur. |
| **Co-op wie Stardew (Host + Join, geteilter Stand)** | Erzwingt dauerhaften Server + Netcode + DB/Accounts – der ganze Backend-Stack, den #85 ausschließt. Bricht den Offline-eine-Datei-Wert. Großer Rewrite der Persistenz-/Laufzeitschicht für marginalen Lern-Nutzen. |
| **„Async-Multiplayer light" (Spielstände teilen/vergleichen)** | Kleiner als echtes Co-op, aber immer noch Backend/Sharing-Infrastruktur nötig. Bringt fürs **Lernziel** kaum Mehrwert. Auch das wäre ein eigenes Konzept-Ticket wert, nicht beiläufig. |

## Entscheidung

**Single-Player bleiben.** Begründung:

- Multiplayer erzwingt den Backend-Stack (Server, Netcode, DB/Accounts), den die
  „kein Backend"-Entscheidung (#85) bewusst ausschließt.
- Geteilter Live-Spielstand widerspricht dem Alleinstellungsmerkmal
  **offline, eine verschenkbare Datei**.
- Der Lern-Kern (eigene Quests, eigener Fortschritt, Spaced Repetition) ist
  **solo** – Co-op brächte fürs Lernziel kaum Mehrwert für sehr hohen Aufwand.

**Leitplanke:** Architektur **nicht aktiv für Multiplayer verbauen**, aber auch
**nichts proaktiv dafür bauen**. Kein „für später schon mal" Netcode/Sync-Code.

## Konsequenzen

**Positiv**

- Schluss mit der wiederkehrenden „Sollten wir Co-op machen?"-Diskussion – auf
  dieses ADR verweisen.
- Investitionen fließen in Inhalt, Politur und Lernpfad statt in Server/Netcode.
- Der Offline-Single-File-Wert bleibt unangetastet.

**Negativ / Grenzen**

- Kein gemeinsames Spielen mit Freunden – bewusst hingenommen, weil es nicht zum
  Lern- und Offline-Kern passt.

## Re-Evaluierungs-Trigger

Diese Entscheidung wird neu aufgemacht, wenn **einer** dieser Fälle eintritt:

- Die **„kein Backend"-Entscheidung (#85) fällt** – erst dann existiert
  überhaupt die Infrastruktur-Grundlage, auf der Multiplayer aufsetzen könnte.
- Es gibt einen **konkreten, belegten Lern-Nutzen** durch gemeinsames Spielen,
  der den Aufwand rechtfertigt (z.B. Paar-Übungen am selben Cluster).

Tritt ein Trigger ein: **eigenes Konzept-Ticket**, das Backend + DB + Netcode
**zusammen** aufmacht (sie hängen aneinander), und ein neues ADR, das dieses hier
ablöst. **Nicht** beiläufig im Rahmen eines anderen Features anfangen.

## Bestätigte Re-Evaluierung – 2026-06-19 (#291)

Beide Trigger geprüft – **kein Trigger erfüllt**, Entscheidung bestätigt:

- **ADR 0002 (kein Backend) gefallen?** Nein – alle re-eval Trigger von ADR 0002 sind ebenfalls nicht erfüllt.
- **Konkreter belegter Lern-Nutzen durch Co-op?** Nein.

Nächste Re-Evaluierung: wenn ADR 0002 fällt (kein Termin).
