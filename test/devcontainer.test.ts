/* Konsistenz-Wächter für die containerisierte Dev-Umgebung (#388).
 *
 * Es gibt jetzt DREI Stellen, die dieselbe Node-Version und denselben Dev-Port
 * nennen: .nvmrc / package.json (engines), .devcontainer/devcontainer.json und
 * docker-compose.yml. Solche Duplikate driften leise auseinander — jemand hebt
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

const read = (rel: string) => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

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
      Number(m![1]),
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
