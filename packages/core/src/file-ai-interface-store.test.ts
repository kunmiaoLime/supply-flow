import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AiInterfaceStoreError,
  FileAiInterfaceStore
} from "./file-ai-interface-store.js";

test("returns and persists AI interface access state", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-ai-interfaces-"));
  const store = new FileAiInterfaceStore(dataDirectory);

  try {
    const defaults = await store.get();
    assert.equal(defaults.interfaces.slack.status, "unknown");
    assert.equal(defaults.interfaces.figma.checkedAt, null);
    assert.equal(defaults.interfaces.circleci.status, "unknown");

    const initialized = await store.initialize();
    assert.deepEqual(initialized, defaults);
    const updated = await store.updateInterface(
      "google-doc",
      "accessible",
      "Authenticated Google Workspace CLI can read Google Docs."
    );

    assert.equal(updated.interfaces["google-doc"].status, "accessible");
    assert.ok(updated.interfaces["google-doc"].checkedAt);
    assert.equal(
      updated.interfaces["google-doc"].detail,
      "Authenticated Google Workspace CLI can read Google Docs."
    );
    assert.deepEqual(await store.get(), updated);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(dataDirectory, "settings", "ai_interfaces.json"), "utf8")
      ),
      updated
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("adds CircleCI access state when reading a legacy status file", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-ai-interfaces-"));

  try {
    await mkdir(path.join(dataDirectory, "settings"), { recursive: true });
    await writeFile(
      path.join(dataDirectory, "settings", "ai_interfaces.json"),
      JSON.stringify({
        schemaVersion: 1,
        interfaces: {
          slack: { status: "accessible", checkedAt: null, detail: "Slack is available." },
          "google-doc": { status: "unknown", checkedAt: null, detail: null },
          confluence: { status: "unknown", checkedAt: null, detail: null },
          figma: { status: "unknown", checkedAt: null, detail: null }
        }
      }),
      "utf8"
    );

    const store = new FileAiInterfaceStore(dataDirectory);
    assert.equal((await store.get()).interfaces.circleci.status, "unknown");

    const updated = await store.updateInterface(
      "circleci",
      "needs_setup",
      "CircleCI CLI authentication is not configured."
    );
    assert.equal(updated.interfaces.slack.status, "accessible");
    assert.equal(updated.interfaces.circleci.status, "needs_setup");
    assert.equal(
      JSON.parse(
        await readFile(path.join(dataDirectory, "settings", "ai_interfaces.json"), "utf8")
      ).interfaces.circleci.status,
      "needs_setup"
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("rejects invalid AI interface state", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-ai-interfaces-"));

  try {
    await mkdir(path.join(dataDirectory, "settings"), { recursive: true });
    await writeFile(
      path.join(dataDirectory, "settings", "ai_interfaces.json"),
      JSON.stringify({ schemaVersion: 1, interfaces: {} }),
      "utf8"
    );
    await assert.rejects(
      new FileAiInterfaceStore(dataDirectory).get(),
      AiInterfaceStoreError
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
