import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSessionStore } from "./file-session-store.js";

test("stores session metadata and append-only events", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-store-"));
  const store = new FileSessionStore(rootDirectory);
  const createdAt = new Date().toISOString();

  try {
    await store.create({
      schemaVersion: 1,
      id: "session_01",
      title: "Review repository",
      goal: "Review the repository and report the highest-risk issues.",
      providerId: "codex",
      workspacePath: "/tmp/worktree",
      tmuxSessionName: "sf_session_01",
      status: "starting",
      readOnly: true,
      createdAt,
      updatedAt: createdAt
    });

    await store.appendEvent({
      schemaVersion: 1,
      sessionId: "session_01",
      timestamp: createdAt,
      type: "created",
      message: "Session record created."
    });

    const updated = await store.update("session_01", {
      status: "running",
      title: "[SXP-123] Review repository",
      readOnly: false,
      notifyWhenComplete: true
    });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: "session_01",
      timestamp: new Date().toISOString(),
      type: "notification-requested",
      message: "Completion notification requested."
    });
    const notificationCanceled = await store.update("session_01", {
      notifyWhenComplete: false
    });
    await store.appendEvent({
      schemaVersion: 1,
      sessionId: "session_01",
      timestamp: new Date().toISOString(),
      type: "notification-canceled",
      message: "Completion notification canceled."
    });
    const events = await store.readEvents("session_01");

    assert.equal(notificationCanceled.status, "running");
    assert.equal(notificationCanceled.title, "[SXP-123] Review repository");
    assert.equal(notificationCanceled.readOnly, false);
    assert.equal(updated.notifyWhenComplete, true);
    assert.equal(notificationCanceled.notifyWhenComplete, false);
    assert.equal(events.length, 3);
    assert.equal(events[0]?.type, "created");
    assert.equal(events[1]?.type, "notification-requested");
    assert.equal(events[2]?.type, "notification-canceled");
    assert.deepEqual((await store.list()).map((session) => session.id), ["session_01"]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "sessions.json"), "utf8")),
      {
        schemaVersion: 1,
        sessions: [notificationCanceled]
      }
    );

    await store.remove("session_01");
    assert.equal(await store.get("session_01"), null);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "sessions.json"), "utf8")),
      {
        schemaVersion: 1,
        sessions: []
      }
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("migrates existing session metadata into the session index", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-store-"));
  const createdAt = new Date().toISOString();
  const session = {
    schemaVersion: 1 as const,
    id: "session_legacy",
    title: "Legacy session",
    goal: "Continue the existing task.",
    providerId: "codex",
    workspacePath: "/tmp/worktree",
    tmuxSessionName: "sf_session_legacy",
    status: "stopped" as const,
    createdAt,
    updatedAt: createdAt
  };

  try {
    const sessionDirectory = path.join(rootDirectory, "sessions", session.id);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      path.join(sessionDirectory, "meta.json"),
      `${JSON.stringify(session, null, 2)}\n`,
      "utf8"
    );

    const store = new FileSessionStore(rootDirectory);
    assert.deepEqual(await store.list(), [session]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "sessions.json"), "utf8")),
      {
        schemaVersion: 1,
        sessions: [session]
      }
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
