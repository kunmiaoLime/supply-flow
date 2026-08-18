import assert from "node:assert/strict";
import test from "node:test";
import { preferredRipgrepPath, withManagedSessionEnvironment } from "./managed-session-environment.js";

test("prefers Homebrew ripgrep for managed macOS sessions", () => {
  assert.equal(
    preferredRipgrepPath(
      "/opt/homebrew/Caskroom/codex/0.147.0/codex-path:/opt/homebrew/bin:/usr/bin",
      "darwin",
      (filePath) => filePath === "/opt/homebrew/bin/rg"
    ),
    "/opt/homebrew/bin:/opt/homebrew/Caskroom/codex/0.147.0/codex-path:/usr/bin"
  );
});

test("preserves provider launch details while adding the preferred session PATH", () => {
  assert.deepEqual(
    withManagedSessionEnvironment(
      {
        executable: "claude",
        arguments: ["--model", "opus"],
        unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"]
      },
      {
        PATH: "/opt/homebrew/Caskroom/codex/0.147.0/codex-path:/opt/homebrew/bin:/usr/bin"
      },
      "darwin",
      (filePath) => filePath === "/opt/homebrew/bin/rg"
    ),
    {
      executable: "claude",
      arguments: ["--model", "opus"],
      unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
      environment: {
        PATH: "/opt/homebrew/bin:/opt/homebrew/Caskroom/codex/0.147.0/codex-path:/usr/bin"
      }
    }
  );
});

test("does not alter the PATH outside macOS or without a package-manager ripgrep", () => {
  assert.equal(preferredRipgrepPath("/usr/bin:/bin", "linux", () => true), null);
  assert.deepEqual(
    withManagedSessionEnvironment(
      { executable: "codex", arguments: [] },
      { PATH: "/opt/homebrew/Caskroom/codex/0.147.0/codex-path:/usr/bin" },
      "darwin",
      () => false
    ),
    { executable: "codex", arguments: [] }
  );
});
