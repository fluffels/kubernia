import { execFile } from "node:child_process";
import { describe, expect, test } from "vitest";
import { fehlerText, laufe } from "../../scripts/cockpit/lauf.mjs";

const fehlerVon = (abbruch: boolean): Promise<NodeJS.ErrnoException> =>
  new Promise((resolve) => {
    const kind = execFile(process.execPath, ["-e", abbruch ? "setTimeout(() => {}, 60000)" : "process.exit(3)"], (err) => resolve(err as NodeJS.ErrnoException));
    if (abbruch) setTimeout(() => kind.kill("SIGTERM"), 300);
  });

describe("fehlerText (Cockpit-Prozessfehler, #1821)", () => {
  test("Signal-Abbruch eines echten Kindprozesses: das Signal, nie der Text \"null\"", async () => {
    const err = await fehlerVon(true);
    expect(err.code).toBeNull();
    expect(fehlerText(err)).toBe("SIGTERM");
  });
  test("Fehlercode hat Vorrang (Spawn-Fehler)", () => {
    expect(fehlerText(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
  });
  test("weder Code noch Signal: die Meldung", () => {
    expect(fehlerText(new Error("kaputt"))).toBe("kaputt");
  });
  test("Exit-Code ungleich 0 ist als Zahl lesbar", async () => {
    expect(fehlerText(await fehlerVon(false))).toBe("3");
  });
});

describe("laufe meldet einen Abbruch mit lesbarem Grund", () => {
  test("abgebrochenes Signal: code null, fehler benennt den Abbruch (nicht \"null\")", async () => {
    const r = await laufe("langfuse-vorbedingung", { signal: AbortSignal.abort() });
    expect(r.code).toBeNull();
    expect(r.fehler).toBe("ABORT_ERR");
  });
});
