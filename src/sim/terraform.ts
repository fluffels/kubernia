/* ===== KubeQuest – terraform-Befehle (sim/terraform.ts) =====
 * Schritt 5/7 des sim.ts-Datei-Splits (#376, aus Epic #346, ADR 0004).
 *
 * Hier liegt die komplette `terraform`-Befehlsfamilie. Wie bei docker (#373),
 * kubectl (#374) und helm (#375) als freie Funktion ausgelagert, die die Sim-Instanz
 * über das schmale `TerraformHost`-Interface bekommt – so bleibt der Cluster-Zustand
 * in EINER Hand (die `Sim`-Klasse), die terraform-Logik aber in einer eigenen,
 * testbaren Datei. Aufgerufen aus dem `exec`-Dispatch in `sim.ts` per
 * `terraformCommand(this, …)`.
 *
 * Abgedeckt: init / get / plan / apply / destroy / state list / output /
 * force-unlock / fmt / validate. Seit #146 (Expeditions-Flotte, Phase 9) mit der
 * Mechanik für **Module** (wiederverwendbare Bausteine, die mehrere Ressourcen als
 * Einheit erzeugen), **Remote State** (`backend`-Block verlagert den State in ein
 * geteiltes „Flotten-Lager", State-Locking als Konzept) und **Provider** (mehrere
 * `provider`-Blöcke für verschiedene Anbieter, von `init` geladen) plus deklarierten
 * **Outputs**. Die Config selbst (welche Module/Provider/Outputs es gibt) kommt als
 * Daten aus dem Szenario (die simulierten .tf-Dateien); dieser Handler ist nur die
 * Mechanik darüber – keine UI/Quests (die liefern die Folge-Tickets #147ff).
 *
 * Phaser-frei (pure Domäne): die Domänentypen kommen aus ./state – kein Rückimport
 * nach sim.ts (kein Zyklus).
 */
import type { ClusterState } from "./state";

/** Was die terraform-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse: es dokumentiert
 *  die Kopplung von terraform an den Cluster-Zustand und vermeidet einen
 *  Import-Zyklus terraform ↔ sim. Die Daten-Felder (`tf`/`nodes`) kommen über
 *  `extends ClusterState` (sim/state.ts, #372); hinzu kommen die in `sim.ts`
 *  verbleibenden Helfer, die terraform ruft. */
export interface TerraformHost extends ClusterState {
  _err(msg: string, tip?: string): string;
  _reschedulePending(): void;
}

/** Module holen (`get`/`init`). Liefert eine Fehlermeldung, wenn eine Modul-Quelle nicht
 *  auflösbar ist (Fehlerfall „unbekanntes Modul"), sonst null und markiert alle als geholt. */
function fetchModules(host: TerraformHost): string | null {
  const missing = host.tf.modules.find(m => m.available === false);
  if (missing) {
    return host._err(
      'Error: Failed to download module "' + missing.name + '" (' + missing.source + '): module not found',
      "Prüfe die source des module-Blocks – diesen Baustein gibt es dort nicht.");
  }
  host.tf.modules.forEach(m => { m.fetched = true; });
  return null;
}

/** Erste Ressource, die auf einen NICHT deklarierten provider-Block zeigt (Fehlerfall
 *  „unbekannter Provider"), sonst null. Ressourcen ohne `provider` nutzen den Default. */
function unknownProvider(host: TerraformHost): string | null {
  const declared = new Set(host.tf.providers.map(p => p.name));
  const bad = host.tf.resources.find(r => r.provider && !declared.has(r.provider));
  return bad ? bad.provider! : null;
}

/** Adressen der von geholten Modulen expandierten Ressourcen (`module.<name>.<res>`). */
function moduleAddrs(host: TerraformHost): string[] {
  return host.tf.modules
    .filter(m => m.fetched)
    .flatMap(m => m.resources.map(r => "module." + m.name + "." + r));
}

/** Alle geplanten Ressourcen-Adressen: Top-Level + von Modulen expandiert (#146). */
function allAddrs(host: TerraformHost): string[] {
  return [...host.tf.resources.map(r => r.addr), ...moduleAddrs(host)];
}

/** Lock-Fehler, wenn der geteilte State gerade von einer anderen Crew gesperrt ist
 *  (Remote-State + Locking, #146). Sonst null. */
function lockError(host: TerraformHost): string | null {
  const tf = host.tf;
  if (tf.backend && tf.backend.locking && tf.locked) {
    const who = tf.lockHolder || "eine andere Crew";
    return host._err(
      [
        "Error: Error acquiring the state lock",
        "",
        "Lock Info:",
        "  ID:        " + (tf.backend.name || tf.backend.type) + "-lock",
        "  Who:       " + who,
        "  Backend:   " + tf.backend.type,
      ].join("\n"),
      "Mehrere Crews teilen denselben Remote-State – nur eine darf ihn zugleich ändern. " +
      "Warte, bis " + who + " fertig ist, oder löse den Lock mit 'terraform force-unlock <ID>'.");
  }
  return null;
}

export function terraformCommand(host: TerraformHost, t: string[], _raw?: string): string {
  const sub = t[1];
  if (!sub) return host._err("terraform: Unterbefehl fehlt.", "Probier 'terraform init'.");
  const tf = host.tf;

  if (sub === "get") {
    const err = fetchModules(host);
    if (err) return err;
    if (tf.modules.length === 0) return "Kein Modul referenziert – nichts zu holen.";
    return tf.modules.map(m => "- " + m.name + " in " + m.source).join("\n");
  }

  if (sub === "init") {
    // Erst die Module ziehen – schlägt fehl, wenn eine Quelle nicht auflösbar ist.
    const modErr = fetchModules(host);
    if (modErr) return modErr;
    tf.providers.forEach(p => { p.installed = true; });
    tf.initialized = true;
    const lines: string[] = [];
    if (tf.modules.length) {
      lines.push("Initializing modules...");
      tf.modules.forEach(m => lines.push("- " + m.name + " in " + m.source));
    }
    lines.push(tf.backend
      ? "Initializing the backend (" + tf.backend.type + (tf.backend.name ? ': "' + tf.backend.name + '"' : "") + ")..."
      : "Initializing the backend...");
    lines.push("Initializing provider plugins...");
    if (tf.providers.length) {
      tf.providers.forEach(p => lines.push("- Installing " + (p.source || p.name) + (p.version ? " v" + p.version : "") + "..."));
    } else {
      lines.push("- Installing hashicorp/local v2.5.1...");
    }
    lines.push("", "Terraform has been successfully initialized!", "",
      "You may now begin working with Terraform. Try running \"terraform plan\".");
    return lines.join("\n");
  }

  if (!tf.initialized && ["plan", "apply", "destroy"].includes(sub)) {
    return host._err("Error: Backend initialization required, please run \"terraform init\"", "Der Ordner muss erst initialisiert werden: 'terraform init'");
  }

  // Unbekannter Provider blockt plan/apply (nicht destroy – das räumt nur weg, was schon da ist).
  if (["plan", "apply"].includes(sub)) {
    const prov = unknownProvider(host);
    if (prov) {
      return host._err(
        'Error: provider configuration "' + prov + '" is not present',
        "Lege den provider-Block an (provider.tf) oder korrigiere den Verweis der Ressource.");
    }
  }

  if (sub === "plan") {
    if (tf.applied) {
      return "No changes. Your infrastructure matches the configuration.\n\n" +
        "Terraform hat verglichen: Was in main.tf steht, existiert schon genau so. Nichts zu tun. 🧘";
    }
    const top = tf.resources.map(r =>
      "  # " + r.addr + " will be created\n  + resource " + r.addr.replace(".", " \"") + "\" {\n      + " + r.desc + "\n    }"
    );
    const mods = moduleAddrs(host).map(a => "  # " + a + " will be created\n  + resource (aus Modul) " + a);
    const all = [...top, ...mods];
    return all.join("\n\n") +
      (all.length ? "\n\n" : "") +
      "Plan: " + allAddrs(host).length + " to add, 0 to change, 0 to destroy.";
  }

  if (sub === "apply") {
    if (tf.applied) return "No changes. Your infrastructure matches the configuration.\n\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.";
    const locked = lockError(host);
    if (locked) return locked;
    const addrs = allAddrs(host);
    tf.applied = true;
    // Neue Server werden echte Cluster-Nodes – wartende Pods bekommen Platz!
    if (tf.resources.some(r => r.addr.includes("hafen_server"))) {
      for (const name of ["ahoi-worker-3", "ahoi-worker-4"]) {
        if (!host.nodes.some(n => n.name === name)) {
          host.nodes.push({ name, status: "Ready", roles: "<none>", version: "v1.30.2" });
        }
      }
      host._reschedulePending();
    }
    let out = addrs.map(a => a + ": Creating...\n" + a + ": Creation complete after 2s").join("\n") +
      "\n\nApply complete! Resources: " + addrs.length + " added, 0 changed, 0 destroyed.";
    if (tf.outputs.length) {
      out += "\n\nOutputs:\n\n" + tf.outputs.map(o => o.name + " = " + (o.sensitive ? "<sensitive>" : '"' + o.value + '"')).join("\n");
    }
    return out;
  }

  if (sub === "destroy") {
    if (!tf.applied) return "No changes. No objects need to be destroyed.";
    const locked = lockError(host);
    if (locked) return locked;
    const addrs = allAddrs(host);
    tf.applied = false;
    host.nodes = host.nodes.filter(n => !["ahoi-worker-3", "ahoi-worker-4"].includes(n.name));
    return addrs.map(a => a + ": Destroying...\n" + a + ": Destruction complete after 1s").join("\n") +
      "\n\nDestroy complete! Resources: " + addrs.length + " destroyed.";
  }

  if (sub === "state") {
    if (t[2] !== "list") return host._err("Der Simulator kann nur 'terraform state list'.");
    if (!tf.applied) return host._err("Noch nichts im State.", "Der State füllt sich erst nach 'terraform apply'.");
    // Liest aus dem (ggf. remote liegenden) State – die Adressen sind dieselben,
    // egal ob lokal oder im „Flotten-Lager". Die Quelle entscheidet der backend-Block.
    return allAddrs(host).join("\n");
  }

  if (sub === "output") {
    // Outputs sind erst nach einem Apply bekannt (vorher steht nichts im State).
    if (!tf.applied) return host._err("Noch keine Outputs.", "Outputs sind erst nach 'terraform apply' bekannt.");
    const name = t[2];
    if (name) {
      const o = tf.outputs.find(x => x.name === name);
      if (!o) return host._err('Error: Output "' + name + '" not found', "Prüfe die deklarierten output-Blöcke.");
      return o.value; // gezielter Abruf gibt den Rohwert (wie `terraform output -raw`) – auch sensible
    }
    if (tf.outputs.length === 0) return ""; // keine output-Blöcke deklariert → echtes TF gibt nichts aus
    return tf.outputs.map(o => o.name + " = " + (o.sensitive ? "<sensitive>" : '"' + o.value + '"')).join("\n");
  }

  if (sub === "force-unlock") {
    if (!tf.backend || !tf.backend.locking) {
      return host._err("Kein sperrbarer Remote-State konfiguriert.", "force-unlock gibt es nur mit einem Backend, das State-Locking unterstützt.");
    }
    if (!tf.locked) return host._err("Der State ist nicht gesperrt.", "Es gibt gerade keinen Lock zu lösen.");
    tf.locked = false;
    const id = t[2];
    return "Terraform state has been successfully unlocked!" + (id ? "\n\nUnlocked ID: " + id : "");
  }

  if (sub === "fmt") return "main.tf";
  if (sub === "validate") return "Success! The configuration is valid.";

  return host._err("terraform: unbekannter Unterbefehl '" + sub + "'", "Tippe 'help' für alle Befehle.");
}
