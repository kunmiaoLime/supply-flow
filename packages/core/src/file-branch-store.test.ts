import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileBranchStore } from "./file-branch-store.js";

test("tracks feature branches by repository path in branches.json", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-branches-"));
  const store = new FileBranchStore(rootDirectory);
  const feature = {
    name: "kun/SXP-123-ride-validation",
    repository_local: "/Users/example/code/ios/Apps/Supply",
    jira_ticket: "https://limebike.atlassian.net/browse/SXP-123",
    last_session_id: "session_implementation",
    review_result: null
  };

  try {
    assert.deepEqual(await store.initialize(), []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: []
      }
    );
    await store.add(feature);

    assert.deepEqual(await store.list(), [feature]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: [feature]
      }
    );
    await assert.rejects(
      store.add({
        name: "master",
        repository_local: feature.repository_local,
        jira_ticket: null,
        last_session_id: null,
        review_result: null
      }),
      /main and master branches cannot be tracked/
    );
    await assert.rejects(
      store.ensure({
        name: "main",
        repository_local: "/Users/example/code/limebike-web",
        jira_ticket: null,
        last_session_id: null,
        review_result: null
      }),
      /main and master branches cannot be tracked/
    );

    const renamed = {
      name: "kun/SXP-123-validated-ride",
      repository_local: feature.repository_local,
      jira_ticket: feature.jira_ticket,
      last_session_id: feature.last_session_id,
      review_result: "review-sxp-123.md"
    };
    assert.deepEqual(await store.update(feature, renamed), renamed);
    await assert.rejects(
      store.update(renamed, { ...renamed, name: "main" }),
      /main and master branches cannot be tracked/
    );
    assert.deepEqual(await store.list(), [renamed]);
    await assert.rejects(store.add(renamed), /already tracked/);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

test("removes default branches from legacy branch records", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-branches-"));

  try {
    await writeFile(
      path.join(rootDirectory, "branches.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          branches: [
            {
              name: "master",
              repository_local: "/Users/example/code/supply-flow"
            },
            {
              name: "main",
              repository_local: "/Users/example/code/supply-flow"
            },
            {
              name: "feature/legacy",
              repository_local: "/Users/example/code/supply-flow"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const store = new FileBranchStore(rootDirectory);
    const feature = {
      name: "feature/legacy",
      repository_local: "/Users/example/code/supply-flow",
      jira_ticket: null,
      last_session_id: null,
      review_result: null
    };
    assert.deepEqual(await store.list(), [feature]);
    assert.deepEqual(await store.initialize(), [feature]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: [feature]
      }
    );
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});

test("migrates legacy branches with no review result", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-branches-"));
  const legacyBranch = {
    name: "feature/review",
    repository_local: "/Users/example/code/supply-flow",
    jira_ticket: "https://limebike.atlassian.net/browse/SXP-456",
    last_session_id: "session_existing"
  };

  try {
    await writeFile(
      path.join(rootDirectory, "branches.json"),
      `${JSON.stringify({ schemaVersion: 1, branches: [legacyBranch] }, null, 2)}\n`,
      "utf8"
    );

    const store = new FileBranchStore(rootDirectory);
    const migratedBranch = { ...legacyBranch, review_result: null };
    assert.deepEqual(await store.initialize(), [migratedBranch]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: [migratedBranch]
      }
    );
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
