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
    repository_local: "/Users/example/code/ios/Apps/Supply",
    monitoring_enabled: false,
    retry_ci_enabled: false,
    status: "unknown" as const,
    unresolved_comment_count: 0,
    unreplied_comment_count: 0,
    ci_status: "unknown" as const,
    last_scanned_at: null,
    last_ci_retry_at: null,
    last_ci_retry_error: null,
    last_session_id: null
  };
  const secondPullRequest = {
    url: "https://github.com/lime/supply/pull/124",
    title: "Add ride receipt",
    number: 124,
    branch: "kun/SUP-124-ride-receipt",
    repository_local: firstPullRequest.repository_local,
    monitoring_enabled: true,
    retry_ci_enabled: true,
    status: "open" as const,
    unresolved_comment_count: 2,
    unreplied_comment_count: 1,
    ci_status: "failure" as const,
    last_scanned_at: "2026-08-04T19:30:00.000Z",
    last_ci_retry_at: "2026-08-04T19:30:30.000Z",
    last_ci_retry_error: "CircleCI did not accept the retry request.",
    last_session_id: "session_pr_review"
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
    const updatedSecondPullRequest = {
      ...secondPullRequest,
      unresolved_comment_count: 0,
      unreplied_comment_count: 0,
      ci_status: "success" as const,
      last_scanned_at: "2026-08-04T19:31:00.000Z",
      last_ci_retry_at: null,
      last_ci_retry_error: null
    };
    assert.deepEqual(
      await store.update(secondPullRequest, updatedSecondPullRequest),
      updatedSecondPullRequest
    );
    assert.equal(await store.remove(firstPullRequest.url), true);
    assert.equal(await store.remove(firstPullRequest.url), false);
    assert.deepEqual(await store.list(), [updatedSecondPullRequest]);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
