# Lens-Gegenprobe 2026-10-15: `omitClaudeMd: true` für die Lens (#1568)

> 📸 **Momentaufnahme vom 2026-10-15 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Wiederholung der [Lens-Gegenprobe vom 2026-10-09](lens-gegenprobe-2026-10-09.md) mit anderer Frage: nicht das Modell, sondern die Kontextdateien (`AGENTS.md` und die globale Datei des Nutzers) im Lens-Subagenten. Die gültige Entscheidung steht in [model-routing.md › Lens-Kostenstruktur](model-routing.md#lens-kostenstruktur-1582) (a), hier Regel, Aufbau und Rohwerte.

**Frage.** Spart `omitClaudeMd: true` (Ersparnis 8 bis 21 % je Lens laut Messung #1582, T zwischen 6,9k und 16k Tokens) Kosten, ohne dass die Lens echte Blocker verpasst?

**Entscheidungsregel (vor den Hauptläufen festgelegt, mit diesem Commit).** Arm A ist die aktuelle `kubernia-lens` (mit Kontextdateien), Arm B dieselbe Definition mit `omitClaudeMd: true` unter dem Namen `kubernia-lens-ohne-kontext` (nur untracked im Experiment-Worktree). Beide Arme laufen frisch (die Lens-Definition hat sich seit dem 2026-10-09 geändert, #1582) auf den 8 Patches der Ledger vom 2026-10-09 (Prompts bytegleich aus dem Transkript der damaligen Opus-neu-Läufe, `datei` dort; Hash des ersten User-Eintrags im Subagenten-Transkript belegt es). Es gibt **eine** Agent-Definition für alle Brillen, B gilt darum nur, wenn **jede** gelaufene Brille besteht:

1. **Kriterium 1:** B verpasst keinen echten Blocker, den A in derselben Brille und auf demselben Patch findet.
2. **Kriterium 2:** die Falsch-Blocker von B liegen höchstens bei A plus 1 (summiert über die Patches der Brille).
3. **Frühstopp:** beim ersten Verpasser einer Brille laufen deren übrige Patches nicht mehr; die Brille hat nicht bestanden und damit B insgesamt nicht.

**Deckel** 25 $ (aufgezeichnet, `total_cost_usd` der Headless-Läufe samt Orchestrator und Richter). **Echt** heißt: entspricht einem historisch bekannt echten Blocker der Ledger vom 2026-10-09 oder wird von einem blinden Opus-Richter als echt eingestuft. Ist B auf keinem Weg spawnbar, endet die Gegenprobe mit „nicht fahrbar, `omitClaudeMd` bleibt aus“ (der einzige zulässige Weg zu „nicht machbar“).

**Mechanik.** Die Agent-Definitionen einer laufenden Session sind eingefroren, darum läuft jeder Lauf als eigener Headless-Prozess (`claude -p`, Arbeitsverzeichnis im Experiment-Worktree `kq-1568-exp`, der B als untracked Datei trägt). Ein direkter Aufruf mit `--agent kubernia-lens-ohne-kontext` (Hauptthread) lässt `omitClaudeMd` wirkungslos (beide Arme: 30.058 Zeichen `instructions`-Anhang, erster Call 31.860 gegen 31.448 Tokens); der Schlüssel wirkt nur beim Spawn als Subagent. Darum spawnt ein Orchestrator (Sonnet, für die Test-Brille Opus, siehe Grenzen) den Subagenten mit dem Prompt aus einer Datei. Wirkungsnachweis (Probe auf Patch p8, Doku): erster Call von A 30.768, von B 15.590 Tokens (T = 15,2k), Hash des ersten User-Eintrags beider `5fc54283d4` und gleich dem der Datei. Die Orchestrator-Kosten stehen getrennt von den Lens-Kosten (aus dem Subagenten-Transkript, aufgezeichnete Usage).

**Ergebnis: `omitClaudeMd` bleibt für die Lens aus.** B verpasst in drei von vier Brillen einen echten Blocker, den A auf demselben Patch findet (Kriterium 1); die Doku-Brille besteht. Die Ersparnis liegt mit −16 % (aufgezeichnet, −15 % geschätzt) in der Spanne der Messung #1582 (8 bis 21 %).

**Patches und Läufe.** Die 8 Patches der Ledger vom 2026-10-09 (Worktrees `kq-1580-p<i>` am Runde-1-HEAD neu angelegt, `git fetch origin pull/<pr>/head`; die Datei `kq-1580-r1.patch` im alten Scratchpad war seither überschrieben, der Patch von p1 wurde neu mit `git diff origin/main...<HEAD>` erzeugt, 16 Dateien wie in der Ledger, die Prompts von p1 zeigen auf ihn, in beiden Armen gleich). Gelaufen sind 10 Patch-Brille-Paare (20 Läufe, alle gültig, Prompt-Hash je Paar gleich) nach dem Frühstopp (Reihenfolge: Doku p6 bis p8, Requirement-Treue p1 und p3, Test-Adäquanz p3 und p4, dann Architektur und Requirement-Treue p1 und p2); nicht gelaufen sind Architektur p3 bis p5, Requirement-Treue p4 und p5, Test-Adäquanz p1, p2 und p5. Aufgezeichnete Lens-Kosten aus dem Subagenten-Transkript, „geschätzt“ nach der Output-Schätzung (Untergrenze, [Planer-Kosten](model-routing.md#planer-kosten-1558)), „erster Call“ = Input + Cache des ersten Requests, „Lauf-Session“ = Session des Headless-Prozesses (Orchestrator, Transkripte unter `~/.claude/projects/C--dev-kubernia--claude-worktrees-kq-1568-exp/<Session>/subagents/`):

| Patch | Brille | Arm | Lens-Kosten ($) | geschätzt ($) | Requests | erster Call | Blocker | Lauf-Session |
|---|---|---|--:|--:|--:|--:|--:|---|
| p6 | Doku | A | 0.51 | 0.69 | 19 | 30773 | 0 | 43fb52aa |
| p6 | Doku | B | 0.41 | 0.57 | 20 | 15595 | 0 | b2876f8c |
| p7 | Doku | A | 0.44 | 0.57 | 13 | 30769 | 1 | a0b1db2e |
| p7 | Doku | B | 0.48 | 0.66 | 19 | 15591 | 1 | 6d44dd67 |
| p8 | Doku | A | 0.41 | 0.58 | 15 | 30768 | 1 | 767901ac |
| p8 | Doku | B | 0.26 | 0.42 | 10 | 15590 | 1 | bd16ccaa |
| p1 | Architektur | A | 0.45 | 0.56 | 10 | 30441 | 0 | c43a573e |
| p1 | Architektur | B | 0.51 | 0.55 | 14 | 15263 | 1 | 1060bcf2 |
| p2 | Architektur | A | 0.39 | 0.44 | 7 | 30432 | 1 | 52586b8d |
| p2 | Architektur | B | 0.40 | 0.43 | 9 | 15254 | 0 | e23c8d69 |
| p1 | Requirement-Treue | A | 0.48 | 0.62 | 12 | 30928 | 1 | 07c14a4c |
| p1 | Requirement-Treue | B | 0.29 | 0.38 | 6 | 15750 | 1 | d0780fcd |
| p2 | Requirement-Treue | A | 0.38 | 0.49 | 8 | 30919 | 1 | fc2a1a6d |
| p2 | Requirement-Treue | B | 0.26 | 0.36 | 7 | 15741 | 0 | 7ce53920 |
| p3 | Requirement-Treue | A | 0.32 | 0.35 | 8 | 30918 | 0 | e839973b |
| p3 | Requirement-Treue | B | 0.27 | 0.30 | 11 | 15740 | 0 | 41c0144b |
| p3 | Test-Adäquanz | A | 0.70 | 0.93 | 29 | 30934 | 2 | ead16d97 |
| p3 | Test-Adäquanz | B | 0.48 | 0.65 | 30 | 15756 | 0 | d9cfb1da |
| p4 | Test-Adäquanz | A | 0.75 | 0.98 | 28 | 31067 | 4 | 109823c7 |
| p4 | Test-Adäquanz | B | 0.72 | 0.95 | 38 | 15889 | 4 | 818ef515 |

| Brille | Arm | n | Σ Lens-Kosten ($) | Σ geschätzt ($) | Ø Requests | Blocker |
|---|---|--:|--:|--:|--:|--:|
| Doku | A | 3 | 1.37 | 1.83 | 15.7 | 2 |
| Doku | B | 3 | 1.16 | 1.65 | 16.3 | 2 |
| Architektur | A | 2 | 0.84 | 1.00 | 8.5 | 1 |
| Architektur | B | 2 | 0.91 | 0.98 | 11.5 | 1 |
| Requirement-Treue | A | 3 | 1.18 | 1.46 | 9.3 | 2 |
| Requirement-Treue | B | 3 | 0.81 | 1.03 | 8.0 | 1 |
| Test-Adäquanz | A | 2 | 1.44 | 1.91 | 28.5 | 6 |
| Test-Adäquanz | B | 2 | 1.20 | 1.61 | 34.0 | 4 |

Σ aufgezeichnete Lens-Kosten A 4,83 $, B 4,07 $ (−16 %), geschätzt 6,21 $ gegen 5,27 $ (−15 %). B läuft mit mehr Requests (Test-Adäquanz 34 gegen 28,5 im Ø), der erste Call ist durchgehend um 15,2k Tokens kleiner (A 30,4k bis 31,1k, B 15,3k bis 15,9k; T = 15,2k, am oberen Rand der Spanne aus #1582).

**Blocker und Auswertung nach der Regel.** „Echt“ ist hier der Abgleich mit der Ledger vom 2026-10-09: jeder Blocker beider Arme ist ein dort bekannt echter Blocker (durch das Delta des PR behoben, vom Richter bestätigt); es gab keinen Blocker ohne Entsprechung, darum lief kein Richter (Falsch-Blocker: 0 in beiden Armen).

| Brille | Kriterium 1 (verpasst 0) | Kriterium 2 (falsch ≤ A + 1) | Entscheidung |
|---|---|---|---|
| Doku (p6 bis p8) | ja: p7 und p8 finden beide Arme den Requests-Vergleich bzw. die „alle drei“-Bedingung | ja: 0 ≤ 0 + 1 | besteht |
| Architektur (p1, p2) | **nein:** p2 `workloadSelector` an drei Stellen von Hand (A findet, B meldet „ersetzen die Literale vollständig“); in p1 findet B die Namespace-Stelle `inspect.ts:618`, die A verpasst | ja | nicht bestanden, Frühstopp |
| Requirement-Treue (p1 bis p3) | **nein:** p2 dieselbe Stelle (A findet, B: „`workloadSelector` überall: erfüllt“); p1 finden beide `inspect.ts:618` | ja | nicht bestanden, Frühstopp |
| Test-Adäquanz (p3, p4) | **nein:** p3 verpasst B zwei Blocker (`--all-namespaces` ohne Test, Wortlaut-Tests aus dem Ticket-Kommentar); p4 finden beide dieselben vier | ja | nicht bestanden, Frühstopp |

**Entscheidung: nicht umgeschaltet, `kubernia-lens.md` bleibt unverändert (kein `omitClaudeMd`).** B gilt nur, wenn jede Brille besteht; drei bestehen nicht. Kosten dafür: rund 22,2 $ aufgezeichnet (`total_cost_usd` aller Headless-Läufe: 21,74 $ für 26 Läufe, nämlich 20 gültige, vier ungültige mit dem überschriebenen p1-Patch und zwei Machbarkeitsproben, dazu 0,45 $ für zwei Orchestrator-Verweigerungen, siehe unten), Deckel 25 $ eingehalten.

**Grenzen.**
- Ein Lauf je Arm und Patch. A verpasst selbst Blocker (Architektur p1: A findet `inspect.ts:618` nicht, B schon; die Ledger vom 2026-10-09 zeigte schon, dass Opus gegen Opus die Hälfte der historischen Blocker verfehlt). Ein Verpasser von B ist darum kein Beweis, dass B ihn nie findet; die Regel ist streng gewählt, nicht statistisch belegt.
- Die Läufe stehen im Langfuse-Projekt mit; spätere Lens-Statistiken schließen sie mit `--ohne 1568` aus (Lens-Läufe im Experiment-Worktree `kq-1568-exp`, Zeitraum 2026-10-15 18:40 bis 19:40 Uhr Ortszeit).
- Ein direkter Aufruf mit `--agent kubernia-lens-ohne-kontext` (Hauptthread) ist wirkungslos (siehe oben); die Wirkung von `omitClaudeMd` gilt für den Subagenten-Spawn, wie ihn der Skill `review-lenses` nutzt.
- Ungültig und verworfen (zählen zu den Kosten): (1) vier Läufe auf Patch p1 (Architektur und Requirement-Treue, beide Arme) mit dem überschriebenen alten Patch; zwei meldeten „Auftrag defekt“; (2) die Test-Brille verweigerte der Orchestrator auf Sonnet („safeguards flagged“, `stop_reason: refusal`), die gültigen Test-Läufe nutzen Opus als Orchestrator (kein Einfluss auf die Lens, die als Subagent auf Opus läuft); (3) Machbarkeitsproben auf p8 mit `--agent` (beide Arme, ohne Wirkung von B, 0,56 $ je Lauf, nicht gezählt). Die Läufe auf p8 über den Orchestrator sind Teil der Auswertung (Ablauf dort identisch, vor dem Hauptlauf gefahren).
- Die Entscheidungsregel stand vor den Hauptläufen auf der Seite (Commit 08db425); die Machbarkeitsproben auf p8 liefen davor.

**Wiedervorlage.** Mit einem neuen Opus-Release (wie die [Gegenprobe vom 2026-10-09](lens-gegenprobe-2026-10-09.md)) oder wenn die Kontextdateien erheblich wachsen (T steigt, die Ersparnis mit); Rezept wie dort, zusätzlich: der Orchestrator-Weg über einen Subagenten-Spawn (der Hauptthread-Aufruf mit `--agent` lässt `omitClaudeMd` wirkungslos), Patches vorher neu erzeugen statt aus einem Scratchpad lesen.
