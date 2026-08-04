import assert from "node:assert/strict";
import test from "node:test";
import {
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
