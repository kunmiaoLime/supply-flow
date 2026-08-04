import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGitHubPullRequestCiStatus,
  classifyGitHubPullRequestStatus,
  countUnrepliedGitHubReviewThreads,
  githubRepositoryFromRemote,
  parseGitHubPullRequestUrl
} from "./github-pull-request.js";

test("parses and normalizes GitHub pull request links", () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl(
      "https://github.com/Lime/Supply/pull/123/?plain=1"
    ),
    {
      url: "https://github.com/Lime/Supply/pull/123",
      repository: "lime/supply",
      number: 123
    }
  );
  assert.equal(parseGitHubPullRequestUrl("https://github.com/lime/supply/issues/123"), null);
  assert.equal(parseGitHubPullRequestUrl("https://example.com/lime/supply/pull/123"), null);
  assert.equal(parseGitHubPullRequestUrl("https://github.com/lime/supply/pull/not-a-number"), null);
});

test("normalizes supported GitHub repository remotes", () => {
  assert.equal(
    githubRepositoryFromRemote("git@github.com:Lime/Supply.git"),
    "lime/supply"
  );
  assert.equal(
    githubRepositoryFromRemote("ssh://git@github.com/Lime/Supply.git"),
    "lime/supply"
  );
  assert.equal(
    githubRepositoryFromRemote("https://github.com/Lime/Supply.git"),
    "lime/supply"
  );
  assert.equal(githubRepositoryFromRemote("git@gitlab.com:lime/supply.git"), null);
  assert.equal(githubRepositoryFromRemote(null), null);
});

test("normalizes GitHub pull request state and draft status", () => {
  assert.equal(classifyGitHubPullRequestStatus("OPEN", false), "open");
  assert.equal(classifyGitHubPullRequestStatus("open", true), "draft");
  assert.equal(classifyGitHubPullRequestStatus("CLOSED", false), "closed");
  assert.equal(classifyGitHubPullRequestStatus("MERGED", false), "merged");
  assert.equal(classifyGitHubPullRequestStatus("unknown", false), "unknown");
});

test("summarizes GitHub CI checks", () => {
  assert.equal(classifyGitHubPullRequestCiStatus([]), "none");
  assert.equal(
    classifyGitHubPullRequestCiStatus([
      { conclusion: "SUCCESS", status: "COMPLETED" },
      { conclusion: "NEUTRAL", status: "COMPLETED" }
    ]),
    "success"
  );
  assert.equal(
    classifyGitHubPullRequestCiStatus([{ conclusion: null, status: "IN_PROGRESS" }]),
    "pending"
  );
  assert.equal(
    classifyGitHubPullRequestCiStatus([{ conclusion: "FAILURE", status: "COMPLETED" }]),
    "failure"
  );
  assert.equal(classifyGitHubPullRequestCiStatus(null), "unknown");
});

test("counts review threads whose latest reviewer comment has no reply", () => {
  assert.equal(
    countUnrepliedGitHubReviewThreads(
      [
        {
          isResolved: true,
          comments: [{ authorLogin: "reviewer" }, { authorLogin: "developer" }]
        },
        {
          isResolved: false,
          comments: [{ authorLogin: "reviewer" }]
        },
        {
          isResolved: true,
          comments: [
            { authorLogin: "developer" },
            { authorLogin: "reviewer" },
            { authorLogin: "developer" },
            { authorLogin: "reviewer" }
          ]
        },
        {
          isResolved: false,
          comments: [{ authorLogin: null }, { authorLogin: "developer" }]
        }
      ],
      "developer"
    ),
    2
  );
});
