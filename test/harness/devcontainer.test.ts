/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (#1460 Z4). */
/* Konsistenz-Wächter für die containerisierte Dev-Umgebung (#388).
 *
 * Mehrere Stellen nennen dieselbe Node-Version und denselben Dev-Port:
 * .nvmrc / package.json (engines), .devcontainer/devcontainer.json,
 * docker-compose.yml, Dockerfile und Dockerfile.devpanel. Solche Duplikate driften leise auseinander — jemand hebt
 * .nvmrc auf eine neue Node-Version, vergisst aber den Container, und Mitwirkende
 * bekommen eine andere Umgebung als die CI. Genau das ist der Stardew-Scope-Sinn
 * von #388 ("über Jahre und viele Mitwirkende konsistent"): Dieser Test bricht,
 * sobald die Angaben auseinanderlaufen — dann die abweichende Datei nachziehen.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL("../../" + rel, import.meta.url)), "utf8");

const nvmrc = read(".nvmrc").trim();
const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };
const devcontainer = JSON.parse(read(".devcontainer/devcontainer.json")) as {
  image: string;
  forwardPorts: number[];
  postCreateCommand: string;
};
const compose = read("docker-compose.yml");
const devpanelDockerfile = read("Dockerfile.devpanel");
const devpanelEntrypoint = read("docker/devpanel-entrypoint.sh");

// Die erwartete Major-Version ist die in .nvmrc (SSOT, so liest auch scripts/setup.mjs).
const nodeMajor = parseInt(nvmrc, 10);
// Der Dev-Port wird aus dem devcontainer abgeleitet (nicht hartcodiert), damit
// devcontainer ↔ compose aneinander gekoppelt geprüft werden.
const devPort = devcontainer.forwardPorts[0];

describe("Dev-Umgebung: Node-Version & Port halten zusammen (#388)", () => {
  test(".nvmrc ist eine sinnvolle Major-Version", () => {
    assert.ok(Number.isInteger(nodeMajor) && nodeMajor >= 22, `.nvmrc nennt keine plausible Node-Major: '${nvmrc}'`);
  });

  test("package.json engines.node deckt sich mit .nvmrc", () => {
    const engines = pkg.engines?.node ?? "";
    const m = engines.match(/(\d+)/);
    assert.ok(m, `engines.node fehlt/unlesbar in package.json: '${engines}'`);
    assert.equal(
      Number(m[1]),
      nodeMajor,
      `engines.node ('${engines}') und .nvmrc ('${nvmrc}') nennen verschiedene Major-Versionen.`,
    );
  });

  test("devcontainer pinnt dieselbe Node-Major wie .nvmrc", () => {
    assert.ok(
      devcontainer.image.includes(`:${nodeMajor}`),
      `devcontainer.json image '${devcontainer.image}' pinnt nicht Node ${nodeMajor} (erwartet ':${nodeMajor}'). ` +
        `Bei einem Node-Upgrade auch .nvmrc und docker-compose.yml nachziehen.`,
    );
  });

  test("docker-compose pinnt dieselbe Node-Major wie .nvmrc", () => {
    assert.ok(
      compose.includes(`node:${nodeMajor}`),
      `docker-compose.yml referenziert kein 'node:${nodeMajor}'-Image. ` +
        `Bei einem Node-Upgrade hier, in .nvmrc und in devcontainer.json gemeinsam anheben.`,
    );
  });

  test("devcontainer-Port = Vite-Default (5173) und compose mappt genau diesen Port", () => {
    assert.equal(devPort, 5173, `devcontainer forwardPorts erwartet Vite-Default 5173, ist aber ${devPort}.`);
    assert.ok(
      compose.includes(`${devPort}:${devPort}`),
      `docker-compose.yml mappt nicht den vom devcontainer geforwardeten Port (${devPort}:${devPort}). ` +
        `devcontainer und compose müssen denselben Port nennen.`,
    );
  });

  test("compose startet wirklich den Dev-Server und schützt node_modules per Volume", () => {
    assert.ok(compose.includes("npm run dev"), "docker-compose.yml startet keinen 'npm run dev'.");
    assert.match(compose, /--host/, "Vite muss mit --host laufen, sonst ist der Server vom Host nicht erreichbar.");
    assert.match(
      compose,
      /node_modules:\s*$|node_modules:\/app|\/app\/node_modules/m,
      "docker-compose.yml schirmt node_modules nicht per benanntem Volume ab (Bind-Mount-Falle).",
    );
  });

  test("devcontainer installiert beim Erstellen die Abhängigkeiten", () => {
    assert.match(
      devcontainer.postCreateCommand,
      /npm (install|ci)/,
      "devcontainer.json postCreateCommand sollte die Abhängigkeiten installieren.",
    );
  });

  // #334: Dockerfile.devpanel ist eine VIERTE Stelle, die die Node-Version nennt –
  // dieselbe Drift-Falle wie oben. Hier mit an .nvmrc koppeln.
  test("Dockerfile.devpanel pinnt dieselbe Node-Major wie .nvmrc (#334)", () => {
    assert.ok(
      devpanelDockerfile.includes(`node:${nodeMajor}`),
      `Dockerfile.devpanel referenziert kein 'node:${nodeMajor}'-Image. ` +
        `Bei einem Node-Upgrade auch hier (zusätzlich zu .nvmrc, devcontainer, compose) nachziehen.`,
    );
  });
});

describe("Dependabot: Node-Major nur von Hand (#1762)", () => {
  const dependabot = read(".github/dependabot.yml");
  /** Ein Eintrag je `- package-ecosystem:` (Name -> Text bis zum nächsten Eintrag). */
  const bloecke = new Map(
    dependabot
      .split(/^ {2}- package-ecosystem: /m)
      .slice(1)
      .map((b) => [/^"([^"]+)"/.exec(b)?.[1] ?? "", b] as const),
  );
  const NODE_IGNORE = /ignore:\s*\n\s*- dependency-name: "node"\s*\n\s*update-types: \["version-update:semver-major"\]/;

  test.each(["docker", "docker-compose"])("der Block `%s` ignoriert Node-Major-Updates (alle Pins ziehen gemeinsam nach)", (name) => {
    const block = bloecke.get(name);
    assert.ok(block, `dependabot.yml hat keinen Block package-ecosystem "${name}".`);
    assert.match(
      block,
      NODE_IGNORE,
      `Der Block "${name}" braucht die Ignore-Regel für node (semver-major), sonst kommt ein Einzel-PR, der die Node-Pins auseinanderzieht.`,
    );
  });
});

describe("Dev-Panel-Docker: Laufzeit-Passwort statt Build-Zeit (#334)", () => {
  test("baut den Dev-Panel-Build und serviert ihn schlank per nginx", () => {
    assert.match(devpanelDockerfile, /npm run build:devpanel/, "Dockerfile.devpanel muss das Dev-Panel-Bundle bauen.");
    assert.match(devpanelDockerfile, /FROM nginx:.*alpine/, "Dockerfile.devpanel sollte schlank über nginx-alpine ausliefern.");
  });

  test("verdrahtet den Entrypoint über den nginx-Startup-Hook", () => {
    assert.match(
      devpanelDockerfile,
      /docker\/devpanel-entrypoint\.sh \/docker-entrypoint\.d\//,
      "Der Entrypoint muss nach /docker-entrypoint.d/ kopiert werden (nginx führt ihn beim Start aus).",
    );
  });

  test("bäckt KEIN Passwort ins Image (Secret bleibt Laufzeit-only)", () => {
    // Im Dockerfile darf VITE_KQ_DEVPANEL_PW weder per ENV noch per ARG gesetzt
    // werden – sonst läge das Secret im Image-Layer.
    assert.doesNotMatch(
      devpanelDockerfile,
      /^\s*(ENV|ARG)\s+VITE_KQ_DEVPANEL_PW/m,
      "Dockerfile.devpanel darf VITE_KQ_DEVPANEL_PW nicht ins Image backen – das Passwort kommt zur Laufzeit.",
    );
  });

  test("Entrypoint injiziert das Passwort base64-kodiert als window.__KQ_CONFIG__ vor dem Bundle", () => {
    assert.match(devpanelEntrypoint, /VITE_KQ_DEVPANEL_PW/, "Entrypoint muss die Laufzeit-Env-Var lesen.");
    assert.match(devpanelEntrypoint, /base64/, "Entrypoint muss das Passwort base64-kodieren (escaping-sicher).");
    assert.match(devpanelEntrypoint, /__KQ_CONFIG__/, "Entrypoint muss window.__KQ_CONFIG__ setzen.");
    // Direkt hinter <head> einfügen → läuft vor dem im Body gebündelten Spielcode.
    assert.match(devpanelEntrypoint, /<head>/, "Entrypoint muss die Config hinter <head> einfügen (vor dem Bundle).");
  });

  test("Entrypoint bleibt gesperrt, wenn kein Passwort gesetzt ist, und ist idempotent", () => {
    assert.match(
      devpanelEntrypoint,
      /-z "\$PW"|-z "\$\{?VITE_KQ_DEVPANEL_PW/,
      "Entrypoint muss den leeren-Passwort-Fall behandeln (Panel bleibt gesperrt).",
    );
    assert.match(
      devpanelEntrypoint,
      /grep -q "__KQ_CONFIG__"/,
      "Entrypoint muss idempotent sein (bei vorhandener Config nicht erneut injizieren).",
    );
  });
});

// ── engines.node der Wurzel gegen die Abhängigkeiten (#1428 Z18) ─────────────────────────────
// Anlass: likec4 verlangt eine höhere Node-Version als die Wurzel-`engines.node`; `npm ci` warnt dann nur (EBADENGINE), und
// Werkzeuge schlagen erst später fehl. Der Test hält die Wurzel-Angabe auf dem Maximum aller einfachen `>=X[.Y[.Z]]`-Minima im Lockfile.
// Bekannte Grenze: komplexere Ranges (`^`, `||`, `<`) werden übersprungen.

type LockPaket = { engines?: { node?: string } };

/** `>=X[.Y[.Z]]` → [X, Y, Z] oder null (andere Formen). */
const mindest = (range: string | undefined): [number, number, number] | null => {
  const m = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(String(range ?? ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
};
const kleiner = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));

/** Pakete im Lock, deren einfaches `engines.node`-Minimum über dem der Wurzel liegt. Pur. */
function enginesVerstoesse(packages: Record<string, LockPaket>, wurzelEngines: string | undefined): string[] {
  const wurzel = mindest(wurzelEngines);
  if (!wurzel) return [`Wurzel-engines.node „${String(wurzelEngines)}“ hat nicht die Form >=X[.Y[.Z]]`];
  return Object.entries(packages)
    .filter(([pfad]) => pfad !== "")
    .flatMap(([pfad, p]) => {
      const m = mindest(p.engines?.node);
      return m && kleiner(wurzel, m) ? [`${pfad} verlangt node ${p.engines?.node}, die Wurzel nur ${wurzelEngines}`] : [];
    });
}

describe("engines.node der Wurzel deckt die Abhängigkeiten ab (#1428 Z18)", () => {
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, LockPaket> };

  test("kein Paket im Lockfile verlangt ein höheres einfaches Node-Minimum als package.json engines.node", () => {
    assert.deepEqual(enginesVerstoesse(lock.packages, pkg.engines?.node), []);
  });

  test("likec4 steht im Lockfile (sonst prüfte der Test ihr Minimum nicht mit)", () => {
    assert.ok(lock.packages["node_modules/likec4"], "node_modules/likec4 fehlt im package-lock.json");
  });

  test("Negativ: ein Fixture-Lock mit höherem Minimum wird gemeldet, gleiche oder niedrigere nicht, komplexe Ranges werden übersprungen", () => {
    const fixture = {
      "": {},
      "node_modules/hoch": { engines: { node: ">=24.0.0" } },
      "node_modules/gleich": { engines: { node: ">=22.22.3" } },
      "node_modules/minor": { engines: { node: ">=22.23" } },
      "node_modules/major": { engines: { node: ">=23" } },
      "node_modules/niedrig": { engines: { node: ">=18" } },
      "node_modules/komplex": { engines: { node: "^24 || ^26" } },
    };
    assert.deepEqual(enginesVerstoesse(fixture, ">=22.22.3").map((v) => v.split(" ")[0]), ["node_modules/hoch", "node_modules/minor", "node_modules/major"]);
    assert.equal(enginesVerstoesse({ x: { engines: { node: ">=24" } } }, "^22").length, 1, "nicht auswertbare Wurzel-Angabe ist selbst ein Verstoß");
  });
});

// ── Node-Pins erfüllen das Minimum engines.node (#1907) ──────────────────────────────────────
// Anlass: ein Node-Security-Release hebt die Mindestversion; ein schwebender Tag (`22`) lässt alte Patch-Stände durch.
// Scan-Umfang (geschlossene Liste): .nvmrc, Dockerfile, Dockerfile.devpanel, docker-compose.yml. Bewusst ausgenommen:
// .devcontainer/devcontainer.json (nur Major-Tag, vom Major-Kopplungstest oben geprüft).
// Bei einem Node-Security-Release engines.node anheben: dieser Test nennt dann alle nachzuziehenden Pins.
// Bekannte Grenze: geprüft wird nur die Untergrenze, kein Gleichheitstest (Dependabot darf Docker-Pins höher ziehen).
// Ein Digest-Suffix `@sha256:<64 hex>` ist erlaubt (#983 pinnt die Basis-Images per Digest); der Tag davor bleibt patch-genau.
// Bewusste Abwägung: .nvmrc ist patch-genau gepinnt (deterministische CI), Dependabot hebt es nicht; ein Security-Release hebt man von Hand.

const PIN_FORM = /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:@sha256:[0-9a-f]{64})?$/;

/** Verstöße je Quelle: kein Pin, nicht patch-genau, unter dem engines-Minimum, engines nicht auswertbar. Pur. */
function nodePinVerstoesse(pins: Record<string, string[]>, engines: string | undefined): string[] {
  const min = mindest(engines);
  if (!min) return [`engines.node „${String(engines)}“ hat nicht die Form >=X.Y.Z`];
  return Object.entries(pins).flatMap(([quelle, liste]) => {
    if (liste.length === 0) return [`${quelle}: kein Node-Pin gefunden`];
    return liste.flatMap((pin) => {
      const m = PIN_FORM.exec(pin);
      if (!m) return [`${quelle}: Pin „${pin}“ ist nicht patch-genau`];
      return kleiner([Number(m[1]), Number(m[2]), Number(m[3])], min) ? [`${quelle}: Pin „${pin}“ liegt unter ${String(engines)}`] : [];
    });
  });
}

const dockerPins = (text: string): string[] => [...text.matchAll(/\bnode:([^\s"'#]+)/g)].map((m) => m[1]);

/** Beginnt die letzte FROM-Zeile (Laufzeit-Stage) mit `nginx:`? Pur. */
const letzteStageIstNginx = (dockerfile: string): boolean => {
  const froms = dockerfile.split(/\r?\n/).filter((z) => /^FROM\s/i.test(z));
  return froms.length > 0 && /^FROM\s+nginx:/i.test(froms[froms.length - 1]);
};

describe("Node-Pins erfüllen das Minimum engines.node (#1907)", () => {
  const dockerfile = read("Dockerfile");
  const quellen: Record<string, string[]> = {
    ".nvmrc": [nvmrc],
    Dockerfile: dockerPins(dockerfile),
    "Dockerfile.devpanel": dockerPins(devpanelDockerfile),
    "docker-compose.yml": dockerPins(compose),
  };

  test("Ratchet: engines.node liegt mindestens auf dem Security-Release 22.23.4 (2026-10), künftig nur anheben", () => {
    const m = mindest(pkg.engines?.node);
    assert.ok(m, "engines.node nicht auswertbar");
    assert.ok(!kleiner(m, [22, 23, 4]), `engines.node ${String(pkg.engines?.node)} liegt unter 22.23.4`);
  });

  test.each(Object.keys(quellen))("%s: Pin ist patch-genau und erfüllt engines.node", (quelle) => {
    assert.deepEqual(nodePinVerstoesse({ [quelle]: quellen[quelle] }, pkg.engines?.node), []);
  });

  test.each(["Dockerfile", "Dockerfile.devpanel"])("%s: die Laufzeit-Stage bleibt nginx (kein Node zur Laufzeit)", (name) => {
    assert.ok(letzteStageIstNginx(name === "Dockerfile" ? dockerfile : devpanelDockerfile));
  });

  test("Negativ: schwebende, zu alte, fehlende und unauswertbare Angaben werden gemeldet", () => {
    const v = (pin: string[]) => nodePinVerstoesse({ q: pin }, ">=22.23.4");
    assert.equal(v(["22"]).length, 1);
    assert.match(v(["22"])[0], /nicht patch-genau/);
    assert.match(v(["22-bookworm-slim"])[0], /nicht patch-genau/);
    assert.match(v(["22.22.3-bookworm-slim"])[0], /liegt unter/);
    assert.match(v(["22.23.3-bookworm-slim"])[0], /liegt unter/, "gleiche Minor, älterer Patch: der Security-Fall");
    assert.match(v(["22.23-bookworm-slim"])[0], /nicht patch-genau/, "Minor-genauer Tag schwebt im Patch");
    assert.match(v(["22.23.4x"])[0], /nicht patch-genau/, "End-Anker");
    assert.match(v([])[0], /kein Node-Pin/);
    for (const ok of ["22.23.4-bookworm-slim", "v22.23.4", "22.24.0", "24.1.0-slim"]) assert.deepEqual(v([ok]), [], ok);
    assert.equal(nodePinVerstoesse({ q: ["22.23.4"] }, "^22").length, 1);
  });

  test("Digest-Suffix: erlaubt hinter einem patch-genauen Tag, der Tag davor wird weiter geprüft", () => {
    const v = (pin: string) => nodePinVerstoesse({ q: [pin] }, ">=22.23.4");
    const d = `@sha256:${"a".repeat(64)}`;
    assert.deepEqual(v(`22.23.4-bookworm-slim${d}`), []);
    assert.match(v(`22-bookworm-slim${d}`)[0], /nicht patch-genau/);
    assert.match(v(`22.22.3-bookworm-slim${d}`)[0], /liegt unter/);
    assert.match(v("22.23.4@sha256:abc")[0], /nicht patch-genau/, "kurzer Digest");
  });

  test("Negativ: eine Node-Stage als letzte wird nicht als nginx-Laufzeit gewertet", () => {
    assert.equal(letzteStageIstNginx("FROM node:22.23.4 AS build\nFROM nginx:1.31-alpine\n"), true);
    assert.equal(letzteStageIstNginx("FROM nginx:1.31-alpine\nFROM node:22.23.4 AS build\n"), false);
    assert.equal(letzteStageIstNginx("RUN x\n"), false);
    assert.equal(letzteStageIstNginx("FROM nginx:1.31-alpine\n# Daten FROM build\n"), true, "FROM-Anker: Kommentar zählt nicht als Stage");
  });
});
