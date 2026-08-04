import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FilePullRequestStore } from "./file-pull-request-store.js";

test("tracks project pull requests in prs.json", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-prs-"));
  const store = new FilePullRequestStore(rootDirectory);
  const firstPullRequest = {
    url: "https://github.com/lime/supply/pull/123",
    title: "Validate ride eligibility",
    number: 123,
    branch: "kun/SUP-123-ride-eligibility",
    repository_local: "/Users/example/code/ios/Apps/Supply"
  };
  const secondPullRequest = {
    url: "https://github.com/lime/supply/pull/124",
    title: "Add ride receipt",
    number: 124,
    branch: "kun/SUP-124-ride-receipt",
    repository_local: firstPullRequest.repository_local
  };

  try {
    assert.deepEqual(await store.initialize(), []);
    await store.add(firstPullRequest);
    await store.add(secondPullRequest);

    assert.deepEqual(await store.list(), [secondPullRequest, firstPullRequest]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "prs.json"), "utf8")),
      {
        schemaVersion: 1,
        prs: [secondPullRequest, firstPullRequest]
      }
    );
    await assert.rejects(store.add(firstPullRequest), /already tracked/);
    assert.equal(await store.remove(firstPullRequest.url), true);
    assert.equal(await store.remove(firstPullRequest.url), false);
    assert.deepEqual(await store.list(), [secondPullRequest]);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
