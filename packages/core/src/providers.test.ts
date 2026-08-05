import assert from "node:assert/strict";
import test from "node:test";
import { findProvider } from "./providers.js";

test("configures Codex additional writable directories and YOLO mode", () => {
  const provider = findProvider("codex");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Create project context.",
      additionalWritableDirectories: [" /tmp/project-context "],
      bypassApprovalsAndSandbox: true,
      model: "openai.gpt-5.6-terra",
      reasoningEffort: "xhigh"
    }),
    {
      executable: "codex",
      arguments: [
        "--no-alt-screen",
        "--model",
        "openai.gpt-5.6-terra",
        "--config",
        'model_reasoning_effort="xhigh"',
        "--add-dir",
        "/tmp/project-context",
        "--dangerously-bypass-approvals-and-sandbox",
        "Create project context."
      ]
    }
  );
});
