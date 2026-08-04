import assert from "node:assert/strict";
import test from "node:test";
import { findProvider } from "./providers.js";

test("configures Codex additional writable directories and YOLO mode", () => {
  const provider = findProvider("codex");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Create project context.",
      additionalWritableDirectories: [" /tmp/project-context "],
      bypassApprovalsAndSandbox: true
    }),
    {
      executable: "codex",
      arguments: [
        "--no-alt-screen",
        "--add-dir",
        "/tmp/project-context",
        "--dangerously-bypass-approvals-and-sandbox",
        "Create project context."
      ]
    }
  );
});
