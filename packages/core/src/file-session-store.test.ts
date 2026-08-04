import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

    const updated = await store.update("session_01", { status: "running" });
    const events = await store.readEvents("session_01");

    assert.equal(updated.status, "running");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "created");
    assert.deepEqual((await store.list()).map((session) => session.id), ["session_01"]);

    await store.remove("session_01");
    assert.equal(await store.get("session_01"), null);
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
