# Tiefendoc: Anwendung, Persistenz, Typen & Einstieg

> On-demand-Detail zur Anwendungs-/Persistenz-Schicht. Der schlanke Always-Index steht in [CLAUDE.md](../../CLAUDE.md). Pfade sind repo-relativ als Inline-Code.

| Modul | Schicht | Inhalt |
|---|---|---|
| `src/main.ts` | Einstieg | Start & Tastatursteuerung; registriert die Szenen (`KQScenes`) und ruft beim Boot `await SaveStore.init()` vor `Game.load()`. |
| `src/types.ts` | Typen | Zentrale Typen (GameState, Quest, …). (Die Cluster-Ressourcen-Typen liegen dagegen in `src/sim/state.ts`, siehe [sim.md](sim.md).) |
| `src/game.ts` | Anwendung | Dünne **`Game`-Fassade/Barrel** (#392): deklariert den veränderlichen Spielzustand (`state`/`sim`/`incomeAcc`/`offlineEarnings`) und komponiert die öffentliche API per Spread aus den `src/game/*`-Bündeln. Re-exportiert die Freischalt-Konstanten aus `game/shared.ts`. Logik siehe unten. |
| `src/game/shared.ts` | Anwendung | Geteilte Bausteine des Splits: `part`/`GameSelf` (this-Typ, Daten-Felder getypt, Methoden permissiv), `today`, die Quest-ID↔Index-Brücke (#353), `makeDefaultState`, `isEventMode`, die Freischalt-Schwellen (`ALL_ABBREV_UNLOCKED`/`ABBREV_EARN_THRESHOLD`/`CMD_HISTORY_UNLOCK_AT`). |
| `src/game/save.ts` | Anwendung | Persistenz: `load`/`save`/`reset`/`exportData`/`importData` + **`sanitizeState`** (härtet kaputte/fehlende Felder gegen die Defaults ab, inkl. Migration alter Index-Stände → `currentQuestId`) + `LEGACY_QUEST_ID_MAP` (umbenannte Quest-IDs #354). |
| `src/game/economy.ts` | Anwendung | Hafen-Wirtschaft (`incomeRate`/`economyTick`/`eventProfile`/`EVENT_PROFILES` #71), Streak (`touchStreak`/`coinMultiplier`), XP/Rang, Dublonen und Shop (`buy`/`useConsumable`). |
| `src/game/progression.ts` | Anwendung | Quest-Fortschritt (`currentQuest`/`advanceStep`/`allQuestsDone`), Dev-/Test-Sprung (`getQuestRoadmap`/`spawnAtQuestGiver`/`jumpToQuest` #329) und freies Üben (`practiceDrillsFor`). |
| `src/game/unlocks.ts` | Anwendung | „Verdiente" Freischaltungen: Abkürzungen (#287/#297/#313) und ↑/↓-Befehlshistorie (#316) — additive Flags, die ein Alt-Stand regulär nachverdient. |
| `src/game/spaced-repetition.ts` | Anwendung | Leitner-Spaced-Repetition: Review-Plan (Box 1..5 + Fälligkeit), Review-Gate (#222/#323), freies Üben. |
| `src/runtime.ts` | Anwendung | Laufzeit-Singletons (ersetzt den früheren `window`-Shim; bricht Import-Zyklen). |
| `src/devpanel.ts` | Anwendung | Dev-/Test-Panel (#325): klickbares Panel zum Springen auf beliebigen Quest-Stand (Jump-API #329), Erststart und Reset — nur aktiv wenn `__KQ_DEVPANEL__` true (Devpanel-Build #331); Phaser-frei, DOM-Anbindung in `ui.ts`. |
| `src/store.ts` | Persistenz | **SaveStore** — siehe unten. |

## SaveStore / Persistenz (#350)

`src/store.ts` ist die SaveStore-Schicht: seit #350 **IndexedDB** als unbegrenztes Backend (localStorage/In-Memory als Fallback), Versions-Hülle `{v,data}` + Migrationskette + Backup-Slot. Damit ist das 5–10 MB-localStorage-Limit bei Stardew-Scale-Spielständen aufgehoben.

- **IndexedDB ist async, die SaveStore-API bleibt aber synchron:** ein In-Memory-Cache wird beim Boot via `await SaveStore.init()` (in `main.ts` vor `Game.load()`) aus IndexedDB hydriert; Schreibvorgänge spiegeln async dorthin. Darum musste **kein Aufrufer** auf async umgestellt werden.
- **Storage-Migration statt Versions-Bump:** der Umzug localStorage→IndexedDB hat das **Format nicht geändert** (gleiche `{v,data}`-Hülle), nur den Speicherort. Daher kein `version`-Bump, sondern eine einmalige Storage-Migration in `SaveStore.init()` (alter localStorage-Stand wird beim ersten Start nach IndexedDB gehoben). Ohne IndexedDB (privat/`file:///`/alt) bleibt der synchrone localStorage-Modus aktiv.
- **Format-Version:** aktuell `CURRENT_SAVE_VERSION = 3`. Auto-Save alle 5 s + JSON-Export/Import.
- **Eviction-Schutz (#401, ADR 0006 Befund 3):** Browser-Speicher ist „geliehen" – unter Speicherdruck löscht der Browser best-effort-Origins per LRU **komplett** (IndexedDB-Spielstand inklusive). `SaveStore.requestPersistentStorage()` (Boot, in `main.ts` nach `init()`, nicht-blockierend) markiert den Origin über `navigator.storage.persist()` als dauerhaft und misst per `navigator.storage.estimate()` die Belegung. Alles feature-detected und wirft NIE; fehlt die API (alter Browser, `file://`), läuft das Spiel wie bisher (ungeschützt) weiter. Rückgabe ist ein reines Datenobjekt `StorageHealth` (`persistSupported`/`persisted`/`usage`/`quota`/`usageRatio`/`nearQuota`) – die **Schichtung** bleibt gewahrt: store.ts kennt keine UI, den Warn-Toast bei knappem Kontingent (`nearQuota`, ab `QUOTA_WARN_RATIO = 0.8`) feuert `main.ts`. Der JSON-Export bleibt das verlässliche letzte Netz.

> **Grundregel:** Was live (auf `main`) geht, darf NIE einen bestehenden Spielstand brechen — jede Format-Änderung migrieren (Versions-Bump + Migrationskette in `store.ts`, mit echtem Alt-Stand testen). Quest-Fortschritt persistiert seit #353 per **Quest-ID** (`currentQuestId`), nicht per Zahl-Index. Details siehe [AGENTS.md › Spielstände](../../AGENTS.md).
