import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    auto_resolve_issues: false,
    status: "unknown" as const,
    unresolved_comment_count: 0,
    unreplied_comment_count: 0,
    ci_status: "unknown" as const,
    has_merge_conflict: false,
    approval_status: "unknown" as const,
    required_review_party_count: 0,
    approved_review_party_count: 0,
    last_scanned_at: null,
    last_ci_retry_at: null,
    last_ci_retry_error: null,
    active_issue_fingerprints: [],
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
    auto_resolve_issues: true,
    status: "open" as const,
    unresolved_comment_count: 2,
    unreplied_comment_count: 1,
    ci_status: "failure" as const,
    has_merge_conflict: true,
    approval_status: "pending" as const,
    required_review_party_count: 3,
    approved_review_party_count: 1,
    last_scanned_at: "2026-08-04T19:30:00.000Z",
    last_ci_retry_at: "2026-08-04T19:30:30.000Z",
    last_ci_retry_error: "CircleCI did not accept the retry request.",
    active_issue_fingerprints: ["review-thread:PRRT_example", "ci:circleci:workflow_example"],
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
      approval_status: "approved" as const,
      approved_review_party_count: 3,
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

test("adds auto-resolution defaults to existing pull requests", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-prs-"));
  const legacyPullRequest = {
    url: "https://github.com/lime/supply/pull/123",
    title: "Validate ride eligibility",
    number: 123,
    branch: "kun/SUP-123-ride-eligibility",
    repository_local: "/Users/example/code/ios/Apps/Supply",
    monitoring_enabled: true,
    retry_ci_enabled: false,
    status: "open",
    unresolved_comment_count: 1,
    unreplied_comment_count: 0,
    ci_status: "success",
    approval_status: "pending",
    required_review_party_count: 1,
    approved_review_party_count: 0,
    last_scanned_at: "2026-08-20T19:30:00.000Z",
    last_ci_retry_at: null,
    last_ci_retry_error: null,
    last_session_id: null
  };

  try {
    await writeFile(
      path.join(rootDirectory, "prs.json"),
      `${JSON.stringify({ schemaVersion: 1, prs: [legacyPullRequest] })}\n`,
      "utf8"
    );

    assert.deepEqual(await new FilePullRequestStore(rootDirectory).list(), [
      {
        ...legacyPullRequest,
        auto_resolve_issues: false,
        has_merge_conflict: false,
        active_issue_fingerprints: []
      }
    ]);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
