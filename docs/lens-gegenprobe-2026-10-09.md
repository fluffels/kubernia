# Lens-Gegenprobe 2026-10-09: braucht jede Brille Opus? (#1580)

> 📸 **Momentaufnahme vom 2026-10-09 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Herausgelöst aus [model-routing.md](model-routing.md#lens-gegenprobe-1580) (#1579): dort steht nur die gültige Entscheidung samt Verweis, hier Zahlen, Regel, Rezept und Rohwerte dieses Laufs. Jede Wiederholung bekommt eine eigene datierte Seite (`lens-gegenprobe-<datum>.md`), damit die Rohwerte nicht in model-routing.md mitwachsen. Die Ticket-Zuordnung von `laufAus`, die im Prüfauftrag unten als fehlerhaft gemessen ist, wurde danach korrigiert (Ticket aus `kq-<nr>` im Patch- oder Worktree-Pfad, #1579); die Zahlen unten sind die damaligen.

**Frage und Entscheidung.** Braucht jede Brille Opus, oder reicht Sonnet (bei der Doku-Lens auch Haiku)? Gemessen auf denselben historischen Runde-1-Patches: je Patch und Brille ein Lauf auf Opus (`kubernia-lens` ohne `model`, „Opus-neu“) und einer mit `model: "sonnet"`, bei der Doku-Lens zusätzlich `model: "haiku"`. **Ergebnis: alle vier Brillen bleiben auf Opus.** Sonnet verpasst in jeder Brille mindestens einen echten Blocker, den Opus-neu findet (Kriterium 1); die Kosten sprechen dagegen nicht (Kriterium 3 ist überall erfüllt), die Falsch-Blocker auch nicht (Kriterium 2 ist für Sonnet erfüllt). Haiku fällt bei der Doku-Lens an Kriterium 1 und 2.

**Entscheidungsregel (vor den Läufen festgelegt, Zeitstempel: Draft-PR #1585 und Ledger, 2026-10-09T12:18Z, vor dem ersten Lauf).** Eine Brille wechselt auf Sonnet (Doku-Lens: das billigste Modell, das besteht) nur, wenn alle drei gelten: (1) der Arm verpasst über alle Patches keinen echten Blocker dieser Brille, den Opus-neu findet; (2) seine Falsch-Blocker liegen höchstens bei Opus-neu plus 1, summiert über die Patches; (3) seine aufgezeichneten Kosten je Lens liegen mindestens 30 % unter Opus-neu. Opus-neu gegen das historische Opus wird nur als Streuung berichtet.

**Aufbau.** Patch-Auswahl aus `node scripts/lauf-ergebnis.mjs --von 2026-10-07T17:13:00Z --bis 2026-10-09T12:30:00Z --json` (ab `scripts/patch-abschnitte.mjs`, 2026-10-07T12:00Z). Runde-1-HEAD und historische Brillen-Ausgaben aus den Transkripten der damaligen Lenses (`scripts/subagent-laufzeit.mjs --agent kubernia-lens --json`, Feld `datei`, Patch-Pfad `kq-<nr>-r1.patch` und `erwarteter HEAD:` im Prompt, Bericht im `SubagentHandback`); die Commits per `git fetch origin pull/<pr>/head` (nur FETCH_HEAD). Je Patch ein Worktree `kq-1580-p<i>` (detached auf dem Runde-1-HEAD) und der Patch `git diff origin/main...<HEAD>`; Test-Lenses sabotierten je Patch in einem eigenen Lens-Worktree. Prompt je Patch und Brille in allen Armen bytegleich, nach der Spawn-Vorlage in `review-lenses` (Brille, Kontext-Diät und Findings-Format wörtlich), mit einer zusätzlichen ersten Zeile `Ticket: #<ursprüngliches Ticket>`, weil Requirement-Treue- und Doku-Lens ihr Ticket sonst aus dem Worktree-Namen `kq-1580-p<i>` ableiten würden. Je Lauf wurde das Modell aus dem Transkript geprüft (Feld `modelle`, siehe unten): alle 39 Läufe liefen auf dem Modell ihres Arms, der Haiku-Alias löste auf `claude-haiku-5-5` auf (nicht 4.5).

**Schiedsrichter.** Jeder Blocker eines neuen Laufs, der keinem „bekannt echten“ entspricht, ging an einen blinden Opus-Richter (`general-purpose`, `model: "opus"`, ein Lauf je Patch, alle Befunde gemischt ohne Modell-Etikett, aber mit Brille) mit dem Blocker-Maßstab aus `kubernia-lens.md`; er prüfte außerdem, ob das Delta des PR die historischen Blocker behoben hat (nur dann „bekannt echt“). Der Umsetzer hat nur tabelliert. Richterkosten: 7 Läufe, Σ 2,55 $ aufgezeichnet (alle Opus).

**Patches** (historische Runde-1-Blocker je Brille; „bekannt echt“ = vom Richter als durch das Delta behoben bestätigt; alle historischen Blocker wurden bestätigt):

| Patch | PR | Ticket | Runde-1-HEAD | Diff-Art | Arch | Req | Test | Doku |
|---|---|---|---|---|--:|--:|--:|--:|
| p1 | #1423 | #1409 | `feb1d2b2e72d` | Code (`src/`, 16 Dateien) | 1 | 1 | 1 | – |
| p2 | #1498 | #1483 | `452b84ced459` | Code (`src/`, 18 Dateien) | 1 | 1 | 1 | – |
| p3 | #1438 | #1417 | `9d307d79e915` | Code (`src/`, 4 Dateien) | 0 | 2 | 0 | – |
| p4 | #1442 | #1418 | `1c38cbf2da2f` | Code (`src/`, 6 Dateien) | 0 | 0 | 4 | – |
| p5 | #1406 | #1339 | `2376228bce70` | Code (`src/`, 7 Dateien), ohne Blocker | 0 | 0 | 0 | – |
| p6 | #1485 | #1366 | `9ac84b220fe3` | nur Markdown (7 Dateien), ohne Blocker | – | – | – | 0 |
| p7 | #1523 | #1507 | `8b97ee026cb9` | nur Markdown (1 Datei) | – | – | – | 1 |
| p8 | #1574 | #1563 | `e3e43b2511b7` | nur Markdown (2 Dateien) | – | – | – | 1 |

**Läufe** (Rohwerte: aufgezeichnete Kosten aus `node scripts/subagent-laufzeit.mjs --agent kubernia-lens --von 2026-10-09T12:18:00Z --json`, Session = Haupttranskript des Umsetzers; „echt“ zählt Befunde, die der Richter als echt oder als bekannt echt einstuft, „falsch“ die als falsch eingestuften, „verpasst“ die echten Blocker, die Opus-neu bei diesem Patch und dieser Brille meldet und der Lauf nicht):

| Patch | Brille | Arm | Session | `datei` | Modell | Kosten ($) | Requests | echt | falsch | verpasst |
|---|---|---|---|---|---|--:|--:|--:|--:|--:|
| p6 | Doku | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a48c12e3ac2ed181e.jsonl` | claude-opus-5-5 | 0.64 | 19 | 0 | 0 | - |
| p6 | Doku | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-abbfa6d139bd5291d.jsonl` | claude-sonnet-5-5 | 0.20 | 11 | 0 | 0 | 0 |
| p6 | Doku | haiku | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-aa9a4b5f25e98a46b.jsonl` | claude-haiku-5-5 | 0.02 | 12 | 1 | 1 | 0 |
| p7 | Doku | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ae3f8f37cc8f6240c.jsonl` | claude-opus-5-5 | 0.48 | 11 | 1 | 0 | - |
| p7 | Doku | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a966349821ad44f98.jsonl` | claude-sonnet-5-5 | 0.10 | 7 | 0 | 0 | 1 |
| p7 | Doku | haiku | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a0b793a5f317f9109.jsonl` | claude-haiku-5-5 | 0.04 | 15 | 0 | 1 | 1 |
| p8 | Doku | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ac3ddabbe68ae58f1.jsonl` | claude-opus-5-5 | 0.33 | 10 | 0 | 0 | - |
| p8 | Doku | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a60de0066c629b4c7.jsonl` | claude-sonnet-5-5 | 0.14 | 9 | 0 | 0 | 0 |
| p8 | Doku | haiku | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ad38c592c49f90516.jsonl` | claude-haiku-5-5 | 0.02 | 15 | 0 | 0 | 0 |
| p1 | Architektur | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a2f4d6ab770666eac.jsonl` | claude-opus-5-5 | 0.50 | 13 | 1 | 0 | - |
| p1 | Architektur | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a99594fa8b8319ab1.jsonl` | claude-sonnet-5-5 | 0.26 | 10 | 0 | 0 | 1 |
| p2 | Architektur | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ac34c06a39bf43c5f.jsonl` | claude-opus-5-5 | 0.30 | 4 | 0 | 0 | - |
| p2 | Architektur | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a6dd30306afa92589.jsonl` | claude-sonnet-5-5 | 0.15 | 5 | 0 | 0 | 0 |
| p3 | Architektur | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a26f178269c26d494.jsonl` | claude-opus-5-5 | 0.38 | 7 | 0 | 0 | - |
| p3 | Architektur | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-aa7ad84b78c5fc172.jsonl` | claude-sonnet-5-5 | 0.12 | 6 | 0 | 0 | 0 |
| p4 | Architektur | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a9a6e0ea2c3bd83eb.jsonl` | claude-opus-5-5 | 0.32 | 7 | 0 | 0 | - |
| p4 | Architektur | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a251d44fa39c656dd.jsonl` | claude-sonnet-5-5 | 0.15 | 6 | 0 | 0 | 0 |
| p5 | Architektur | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ac330432a554ba6ef.jsonl` | claude-opus-5-5 | 0.24 | 7 | 0 | 0 | - |
| p5 | Architektur | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-adfd1cc5111ffe385.jsonl` | claude-sonnet-5-5 | 0.16 | 6 | 0 | 0 | 0 |
| p1 | Requirement-Treue | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a73c9f8edd59896c6.jsonl` | claude-opus-5-5 | 0.60 | 11 | 1 | 0 | - |
| p1 | Requirement-Treue | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-abfdad8b1b664d63b.jsonl` | claude-sonnet-5-5 | 0.18 | 6 | 0 | 0 | 1 |
| p2 | Requirement-Treue | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a169ef43daaf4c5c8.jsonl` | claude-opus-5-5 | 0.35 | 6 | 1 | 0 | - |
| p2 | Requirement-Treue | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a1f80bbc50cc5535c.jsonl` | claude-sonnet-5-5 | 0.18 | 6 | 1 | 0 | 0 |
| p3 | Requirement-Treue | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a78d8a3cf16cb056e.jsonl` | claude-opus-5-5 | 0.23 | 5 | 0 | 0 | - |
| p3 | Requirement-Treue | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a0c0da30906e89894.jsonl` | claude-sonnet-5-5 | 0.11 | 4 | 0 | 0 | 0 |
| p4 | Requirement-Treue | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a7fb1500ffd48c2cb.jsonl` | claude-opus-5-5 | 0.39 | 9 | 0 | 0 | - |
| p4 | Requirement-Treue | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a8c7d899ed6935239.jsonl` | claude-sonnet-5-5 | 0.18 | 6 | 0 | 0 | 0 |
| p5 | Requirement-Treue | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-af3748264460723c0.jsonl` | claude-opus-5-5 | 0.31 | 7 | 0 | 0 | - |
| p5 | Requirement-Treue | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a5b3ff64eed3ecd43.jsonl` | claude-sonnet-5-5 | 0.12 | 6 | 0 | 0 | 0 |
| p1 | Test-Adäquanz | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a02926892a157c2f3.jsonl` | claude-opus-5-5 | 1.43 | 44 | 1 | 0 | - |
| p1 | Test-Adäquanz | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-aaad7498eb8d05d41.jsonl` | claude-sonnet-5-5 | 0.42 | 27 | 1 | 0 | 0 |
| p2 | Test-Adäquanz | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-afaf4b8ab757173c7.jsonl` | claude-opus-5-5 | 0.90 | 26 | 1 | 0 | - |
| p2 | Test-Adäquanz | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-ae4e52fbb70c200b4.jsonl` | claude-sonnet-5-5 | 0.50 | 28 | 1 | 0 | 0 |
| p3 | Test-Adäquanz | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-aa5f46b7df3ebb2e8.jsonl` | claude-opus-5-5 | 0.42 | 16 | 1 | 0 | - |
| p3 | Test-Adäquanz | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a66a0b809f94ef678.jsonl` | claude-sonnet-5-5 | 0.16 | 12 | 0 | 0 | 1 |
| p4 | Test-Adäquanz | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a52caa67c73db7015.jsonl` | claude-opus-5-5 | 0.56 | 18 | 3 | 1 | - |
| p4 | Test-Adäquanz | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-aa2d8202d8186f478.jsonl` | claude-sonnet-5-5 | 0.21 | 14 | 2 | 0 | 1 |
| p5 | Test-Adäquanz | opus | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a2ee24a10cd026a25.jsonl` | claude-opus-5-5 | 0.39 | 15 | 0 | 0 | - |
| p5 | Test-Adäquanz | sonnet | 82ec2f63 | `82ec2f63-1add-46ad-ae05-43e7ea49d697/subagents/agent-a6a168e6e090f3f8f.jsonl` | claude-sonnet-5-5 | 0.17 | 13 | 0 | 0 | 0 |

| Brille | Arm | n | Σ Kosten ($) | Δ zu Opus | Ø Requests | echt | falsch | verpasst |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| Doku | opus-neu | 3 | 1.45 | - | 13.3 | 1 | 0 | - |
| Doku | sonnet | 3 | 0.44 | -70 % | 9.0 | 0 | 0 | 1 |
| Doku | haiku | 3 | 0.07 | -95 % | 14.0 | 1 | 2 | 1 |
| Architektur | opus-neu | 5 | 1.74 | - | 7.6 | 1 | 0 | - |
| Architektur | sonnet | 5 | 0.85 | -51 % | 6.6 | 0 | 0 | 1 |
| Requirement-Treue | opus-neu | 5 | 1.88 | - | 7.6 | 2 | 0 | - |
| Requirement-Treue | sonnet | 5 | 0.76 | -59 % | 5.6 | 1 | 0 | 1 |
| Test-Adäquanz | opus-neu | 5 | 3.71 | - | 23.8 | 6 | 1 | - |
| Test-Adäquanz | sonnet | 5 | 1.45 | -61 % | 18.8 | 4 | 0 | 2 |

Σ aufgezeichnete Kosten aller 39 Läufe: 12.35 $

**Auswertung nach der Regel.** (Σ Kosten je Brille; „verpasst“ summiert über die Patches.)

| Brille | Arm | Kriterium 1 (verpasst 0) | Kriterium 2 (falsch ≤ Opus-neu + 1) | Kriterium 3 (Kosten ≤ 0,7 × Opus-neu) | Entscheidung |
|---|---|---|---|---|---|
| Architektur | Sonnet | nein: 1 verpasst (p1: `inspect.ts:618` mit `default/`, AK 3) | ja: 0 ≤ 0 + 1 | ja: −51 % | bleibt Opus |
| Requirement-Treue | Sonnet | nein: 1 verpasst (p1, dieselbe Stelle) | ja: 0 ≤ 0 + 1 | ja: −59 % | bleibt Opus |
| Test-Adäquanz | Sonnet | nein: 2 verpasst (p3 `--all-namespaces`; p4 falsch-positiver Test `targetPort ?? port`) | ja: 0 ≤ 1 + 1 | ja: −61 % | bleibt Opus |
| Doku | Sonnet | nein: 1 verpasst (p7, Requests-Vergleich zweier Gruppen) | ja: 0 ≤ 0 + 1 | ja: −70 % | bleibt Opus |
| Doku | Haiku | nein: 1 verpasst (p7) | nein: 2 > 0 + 1 (p6 §4 im Präsens, p7 Sammelticket #1568 statt #1441) | ja: −95 % | bleibt Opus |

**Richter-Urteile** (Befunde ohne Modell-Etikett; „=H<k>“ heißt: entspricht einem historischen, durch das Delta behobenen Blocker):
- p1: H1 (`inspect.ts:618`), H2 (`sim.md:36`), H3 (Test für den Weiterwurf in `tryReconcile`) alle durch das Delta behoben. Vier neue Befunde: =H1 (zwei Läufe, Architektur und Requirement-Treue), =H3 (zwei Läufe, Test-Adäquanz).
- p2: H1 bis H3 (`workloadSelector` an drei Stellen, Literal-Wächter) alle behoben. Vier neue Befunde: zwei =H2 (Requirement-Treue), zwei echt (Test-Adäquanz, Wertebereich von `nodeInternalIP`: `nodes.test.ts` prüft nur `\d{1,3}`, Mutanten mit Oktetten bis 900 blieben grün; das Delta greift es nur teilweise auf).
- p3: H1 (PV-Claim `default/`), H2 (Wortlaut-Tests) behoben. Ein neuer Befund echt (Test-Adäquanz, `--all-namespaces` ohne Test).
- p4: H1 bis H4 behoben. Acht neue Befunde: =H4 (viermal, Eingangsgrenze `buildArgoApp`), =H3 (zweimal, Headless-Drift), =H2 (einmal, `targetPort`), falsch (einmal: der Test „bleibt nach dem Sync OutOfSync“ prüft echtes Verhalten, der `⚠️`-Zweig ist praktisch unerreichbar, kein benennbarer Negativfall).
- p6: B1 falsch (ADR §4 steht im Abschnitt „Entscheidung“ und beschreibt den Zielzustand, nur ein Hinweis), B2 echt (zwei Langfuse-Zeilen des Inventars in keiner Kern- oder Modul-Zuordnung, AC 2 offen).
- p7: H1 (Requests-Vergleich) behoben; B1 =H1; B2 falsch (der Lauf prüfte das heutige Sammelticket #1568; zum Zeitpunkt des PR war #1441 offen und enthielt die Zeile „Aus #1507“).
- p8: H1 (Bedingung „Prüfweg, alle drei“ logisch zu streng) behoben und nach dem Maßstab blockierend; **kein** neuer Lauf (Opus, Sonnet, Haiku) hat ihn als Blocker gemeldet, alle drei nur als Hinweis.
- p5: kein historischer und kein neuer Blocker, kein Richter nötig. Falsch-Blocker auf dem Patch ohne Blocker: keiner (alle sechs Code-Läufe grün oder Hinweise).

**Streuung Opus-neu gegen historisches Opus** (ohne Einfluss auf die Entscheidung): gleiche Brille und Patch, historische Blocker (Code 12, Doku 2): Opus-neu fand 6 von 12 und 1 von 2; zusätzlich zwei neue echte Blocker (p2 und p3, beide Test-Adäquanz) und einen falschen (p4). Sonnet fand 4 von 12 und 0 von 2, einen neuen echten (p2, Test-Adäquanz), keinen falschen; Haiku 0 von 2, einen neuen echten (p6) und zwei falsche. Auch derselbe Opus verfehlt also die Hälfte der historischen Blocker, und eine einzelne Gegenprobe pro Arm ist ein schwaches Signal (siehe Grenzen).

**Grenzen.**
- n = 5 Code-Patches (davon 4 mit Blocker) und 3 Doku-Patches, je ein Lauf pro Arm und Patch. Ein verpasster Blocker ist bei einem Lauf kein Beweis, dass Sonnet ihn nie findet; dass Opus selbst die Hälfte der historischen Blocker verpasst, zeigt die Streuung. Die Regel ist deshalb streng gewählt, nicht statistisch belegt.
- Aufgezeichnete Kosten unterzählen den Output (nach #1558: `output_tokens` auf dem Stand von `message_start`); der Anteil ist bei Sonnet und Opus nicht gemessen. Rechnet man nur den Input-Anteil, bliebe die Rangfolge gleich, der Abstand kann sich ändern.
- Aktuelle Definition (`AGENTS.md`, Brillen, Kontext-Diät) statt der damaligen; `gh issue view` und `fremdtext.mjs` zeigen den heutigen Ticket-Stand (die Tickets sind geschlossen, einzelne Läufe sahen den bereits gemergten PR oder `main`). Die Test-Lens-Prompts tragen eine Zeile mehr („Sabotage-Proben nur im Lens-Worktree“) und den Ausnahme-Absatz der Kontext-Diät, die Prompts aller Brillen kürzen die Diät-Regel 2 auf den eigenen Regel-Ausschnitt; in allen Armen gleich.
- Die Lens-Worktrees der Test-Lenses trugen teils das ursprüngliche Ticket im Namen (`kq-1483-lens-r2`, `kq-1418-lens-r4`, `kq-1417-lens-r3`, `kq-1339-lens-r5`) statt `kq-1580-lens-r<i>`; der Edit-Guard lässt jede Nummer zu, alle wurden entfernt (`git worktree list` ohne sie, Ordner weg).
- Der Richter ist Opus, wie der Referenzarm: blind und ohne Etikett, aber nicht unabhängig vom Modell. Er prüft Behauptungen am Stand nach; bei Sammelbefunden (zwei Behauptungen in einem Eintrag) zählte der Eintrag einmal.
- Opus-neu und Sonnet sahen teils verschiedene Dateien (kein fester Lesepfad); `harness-approval.test.ts` war in zwei Sabotage-Läufen unter Last einmal rot (Timeout), einzeln grün; kein Befund.
- Aufgezeichnet 12,35 $ für die 39 Lenses plus 2,55 $ Richter; die Schätzung vorher (25 bis 40 $) lag klar darüber.

**Prüfauftrag `laufAus` (Ticket aus dem ersten `#<nr>` im Prompt).** Bestätigt: Von 382 historischen Lens-Läufen (2026-10-07T17:00Z bis 2026-10-09T12:30Z) ordnet `laufAus` bei 41 von 264 Läufen mit gesetztem `ticket` ein anderes Ticket zu als der Patch-Pfad `kq-<nr>-r<runde>.patch` bzw. der Worktree des Auftrags (zum Beispiel #1349 aus dem Satz „schon erledigt durch #1349“), bei 118 Läufen steht `null`. Diese Messung nutzt `datei` und den Patch-Pfad; die Behebung steht als Zeile im Sammelticket „Harness-Härtung (gesammelt)“.

**Rezept zum Wiederholen.** (1) Patches aus `lauf-ergebnis.mjs --json` wählen (≥ 5 Code-Patches, davon ≥ 2 mit `src/`, je Brille mindestens einer mit echtem Runde-1-Blocker, mindestens einer ohne Blocker; ≥ 3 reine `*.md`-Patches, mindestens einer mit und einer ohne Doku-Blocker); Runde-1-HEAD aus dem Auftrag der historischen Lens (`node scripts/subagent-laufzeit.mjs --agent kubernia-lens --von <ISO> --json`, `datei` lesen, `erwarteter HEAD:` im ersten User-Eintrag, Bericht im `SubagentHandback` des letzten Assistant-Eintrags). (2) `git fetch origin pull/<pr>/head`, `git worktree add --detach .claude/worktrees/kq-<nr>-p<i> <HEAD>`, `git diff origin/main...<HEAD> > <TMP>/kq-<nr>-r<i>.patch`, Delta `git diff <HEAD>..<finaler PR-Head>`. (3) Entscheidungsregel vorab in einem Draft-PR festhalten. (4) Je Patch und Brille den Prompt der Spawn-Vorlage in allen Armen bytegleich; Arme: `kubernia-lens` ohne `model`, mit `model: "sonnet"`, bei der Doku-Lens zusätzlich `model: "haiku"`; Test-Lenses desselben Patches nacheinander (gleicher Lens-Worktree), höchstens etwa 6 Läufe gleichzeitig; nach jedem Bericht eine Ledger-Zeile. (5) Modell je Lauf prüfen (`modelle` in `subagent-laufzeit.mjs --json`), Kosten und Requests aus derselben Ausgabe. (6) Ein blinder Opus-Richter je Patch (`general-purpose`, `model: "opus"`) mit Patch, Worktree, Delta, historischen Blockern und den gemischten neuen Befunden. (7) Regel anwenden, Ergebnis hier eintragen, Worktrees entfernen.

**Wiedervorlage.** Bei jedem neuen Opus- oder Sonnet-Release (Release-Watch: Ticket #1362, bis dahin Punkt 8 der Checkliste unter [Langfuse-Status überprüfen](model-routing.md#langfuse-status-überprüfen-1293)) das Rezept mit denselben Patches (die Ledger-Tabelle oben nennt PR, Ticket und Runde-1-HEAD) und derselben Regel wiederholen; ändert ein Release die Lens-Definition (Effort, Modell, Kontext-Diät), ebenso.
