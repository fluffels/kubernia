# Barrierefreiheit-Audit (#481)

> **Was ist das hier?** Eine einmalige, ganzheitliche Prüfung der Zugänglichkeit von
> KubeQuest über drei Dimensionen: **(1)** wird Status irgendwo **nur über Farbe**
> kodiert (ohne Form/Icon/Text), **(2)** ist das Spiel **vollständig per Tastatur**
> bedienbar, **(3)** halten die HUD-/Overlay-**Kontraste** grob WCAG AA (4.5:1 für
> normalen, 3:1 für großen Text)? Ergebnis ist dieser Bericht + daraus abgeleitete
> Folge-Tickets. **Dieses Ticket ist der Audit, nicht die Umsetzung.**
>
> Lebt als Doku im Repo (wie [`lernpfad-audit.md`](lernpfad-audit.md) und
> [`art-direction-audit.md`](art-direction-audit.md)), damit künftige UI-Änderungen
> dagegen geprüft werden können. Anlass: das arc42-Risiko „Barrierefreiheit ungeprüft"
> ([`arc42-architektur.md`](arc42-architektur.md)).

## Methode

Statische Analyse des Präsentations-Codes (`src/scenes/worldscene/*`, `src/ui/*`) und
aller CSS-Regeln (`style.css`). Kontraste wurden **rechnerisch** aus den effektiven
Farbwerten ermittelt (WCAG-Relative-Luminanz), **nicht** geschätzt. Wichtig dabei:
`style.css` hat **zwei** `:root`-Blöcke — der zweite (Meerblau-Palette, Z. 592 ff.)
**überschreibt** `--panel`/`--panel2`/`--text-dim` per Cascade. Maßgeblich sind die
**effektiven** Werte:

| Variable | effektiv | (früherer, überschriebener Wert) |
|---|---|---|
| `--panel` | `#122636` | ~~`#1c2433`~~ |
| `--panel2` | `#1c3c52` | ~~`#232e42`~~ |
| `--text` | `#e8f0fa` | — |
| `--text-dim` | `#9fbccb` | ~~`#9db4cc`~~ |
| `--good` / `--bad` | `#6fdc8c` / `#ff7b7b` | — |
| `--accent` / `--accent2` | `#ffc857` / `#4dd0e1` | — |

## Gesamtbefund

**Insgesamt gesund.** Tastatur-Bedienung ist durchgängig (Dimension 2), die Kontraste
erfüllen **flächendeckend WCAG AA** (Dimension 3). Die einzige echte Lücke ist ein paar
Stellen **reiner Farb-Statuscodierung** (Dimension 1) — klein, aber für einen
Rot-Grün-Sehschwäche-Anteil (~8 % der Männer) relevant, weil es ein **Lernspiel** ist.

---

## Dimension 1 — Status nur über Farbe (ohne Form/Icon/Text)

### 🔴 Echte Lücken (Fix lohnt)

- **Quiz-/Dialog-Antworten richtig/falsch** — [`src/ui/quiz.ts:169–171`](../src/ui/quiz.ts),
  CSS `.quiz-options button.correct/.wrong` + `.dlg-choices button.correct/.wrong`
  ([`style.css`](../style.css)). Die gewählte Antwort wird **nur** grün (`--good`) bzw.
  rot (`--bad`) eingefärbt; **kein** ✓/✗-Symbol oder Text-Präfix. Die Erklärung
  erscheint zwar danach, aber der unmittelbare Richtig/Falsch-Beat hängt allein an der
  Farbe. **Höchster Wert im ganzen Audit** — Quiz-Feedback ist Kern der Lernschleife.
- **Docker-Fässer laufend/gestoppt** — [`src/scenes/worldscene/clustersync.ts:129–133`](../src/scenes/worldscene/clustersync.ts).
  Gestoppte Container werden per `alpha` (1 → 0.45) gedimmt, ihr Namens-Tag wechselt von
  grün (`0x6fe09a`) auf grau (`0x8a98a8`) — **kein** Symbol/Text für „gestoppt". Status
  nur über Helligkeit + Farbe.

### 🟡 Nachrangig (bereits teils mit-signalisiert)

- **Pod-Kisten kaputter Deployments** — [`clustersync.ts:85`](../src/scenes/worldscene/clustersync.ts)
  färbt die Kiste rot (`0xff8d8d`). **Aber:** das darüber schwebende Deployment-Tag
  ([`clustersync.ts:122–125`](../src/scenes/worldscene/clustersync.ts)) trägt bereits
  **„⚠ CrashLoopBackOff / ImagePullBackOff / Pending"** als Text + Warnsymbol. Der
  Kisten-Rotton ist also **redundante Verstärkung**, nicht das einzige Signal — die
  Information kommt farbunabhängig an. Optional beim Fix mitnehmen.

### ✅ Bereits gut gelöst

- **Alarm-Panel** (`style.css` `.alarm`): Rot **plus** Emoji + Text („⛈️ STURMSCHADEN!")
  + Puls-Animation.
- **Rang / Streak / XP** im HUD ([`src/ui/hud.ts`](../src/ui/hud.ts)): jeweils Icon **und**
  Text-Label **und** Zahl, nicht nur Farbe.
- **Helm-Flaggen** ([`clustersync.ts:140`](../src/scenes/worldscene/clustersync.ts)): die
  Hue kodiert **Identität** (welches Release), keinen Zustand — kein Barrierefreiheits-Thema.

---

## Dimension 2 — Tastatur-Vollbedienung

**Solide, kein Blocker gefunden.** Alles ist ohne Maus erreichbar:

- **Globale Shortcuts** ([`src/main.ts`](../src/main.ts)): Bewegung (Pfeile/WASD),
  E = Interaktion, T = Terminal, J = Logbuch, B = Album, Esc = schließen/Menü,
  1–4 / ↑↓+Enter = Antwortwahl, ←/Backspace = Dialog zurückblättern (#310).
- **Modale Tastatur** als pure Logik ([`src/hud/overlaykbd.ts`](../src/hud/overlaykbd.ts)) +
  DOM-Anbindung ([`src/ui/overlay.ts:135–150`](../src/ui/overlay.ts)): ↑/↓/w/s
  navigiert Buttons, Enter/Space/E aktiviert, **Fokus wird sichtbar gesetzt**
  (`.sel`-Klasse + `▶`-Marker). Buttons laufen über `data-action`-Delegation, nicht
  über maus-only `onclick`.
- **Terminal** ([`src/ui/radio.ts:20`](../src/ui/radio.ts)): Eingabefeld wird beim
  Öffnen **automatisch fokussiert**; Enter schickt ab, ↑/↓ blättert die Historie.
- **Quiz** ([`src/ui/quiz.ts`](../src/ui/quiz.ts), #258): Ziffern 1–n wählen direkt,
  ↑/↓ markiert, Enter bestätigt.

Kleinigkeit ohne eigenen Handlungsbedarf: ein paar dynamisch erzeugte Buttons (Gate/Nudge
im Quiz) nutzen `onclick` statt `data-action`; sie liegen aber im Modal und werden von der
generischen Modal-Tastatur (`overlayKey`) miterfasst — also bedienbar.

Die Interaktions-Smokes (#480, [`e2e/interaction.spec.ts`](../e2e/interaction.spec.ts))
treiben Terminal-Eingabe und Overlay-auf/zu bereits **rein über Tastatur** — ein
laufendes Regressionsnetz für genau diese Bedienbarkeit.

---

## Dimension 3 — Kontraste (WCAG AA)

**Alle geprüften HUD-/Overlay-Paare erfüllen WCAG AA (≥ 4.5:1).** Rechnerisch mit der
effektiven Palette (s. o.):

| Paar | Kontrast | AA (4.5:1) |
|---|---:|---|
| `text` auf `panel` | 13.5:1 | ✅ |
| `text-dim` auf `panel` | 7.8:1 | ✅ |
| `text-dim` auf `panel2` | 5.8:1 | ✅ |
| `good` auf `panel` / `panel2` | 9.1 / 6.8:1 | ✅ |
| `bad` auf `panel` / `panel2` | 6.2 / 4.6:1 | ✅ |
| `accent` / `accent2` auf `panel` | 10.1 / 8.4:1 | ✅ |
| `term-text` auf `term-bg` | 15.3:1 | ✅ |
| Quiz correct/wrong-Text auf getöntem Button | 7.4 / 9.0:1 | ✅ |
| `.mastery-badge.weak` (`#ffae5a` auf getöntem Grund) | 5.9:1 | ✅ |

**Wichtige Korrektur zum ersten Analyse-Durchgang:** Eine frühere Rechnung meldete hier
mehrere „Fehler" — sie rechnete gegen die **überschriebenen** alten `:root`-Werte und
verwechselte zudem die **AAA**-Schwelle (7:1) mit **AA** (4.5:1). Mit den effektiven
Farben gibt es **keine AA-Verletzung**.

Nur der strengere **AAA**-Maßstab (7:1 für normalen Text) wird von einzelnen Paaren
knapp verfehlt (`text-dim`/`bad` auf `panel2`: 5.8 / 4.6:1). AAA ist für ein Spiel **kein
gesetztes Ziel**; bewusst akzeptiert, kein Folge-Ticket.

---

## Ergebnis & Folge-Tickets

- **Dimension 1** → **ein** fokussiertes Folge-Ticket: farb-unabhängige Statuscodierung
  nachrüsten (Quiz ✓/✗-Präfix, Docker-Fässer laufend/gestoppt-Marker, optional
  Pod-Kisten). `prio:niedrig`, `area:grafik` — das konkrete Symbol/Aussehen wird bei der
  Umsetzung mit der Maintainerin abgestimmt (Optik-Regel, [AGENTS.md](../AGENTS.md)).
- **Dimension 2** → kein Ticket (bereits vollständig bedienbar).
- **Dimension 3** → kein Ticket (WCAG AA erfüllt; AAA bewusst nicht Ziel).

Dieser Bericht ist die Referenz, gegen die neue UI/Overlays geprüft werden: **neuer
Status → nicht nur Farbe; neue Overlay-Buttons → per `data-action` + Modal-Tastatur;
neue Farbpaare → gegen die effektive Palette rechnen, nicht gegen die alten `:root`-Werte.**
