import assert from "node:assert/strict";
import test from "node:test";
import { aiModelOptions } from "./ai-model-settings.js";
import { findProvider } from "./providers.js";

test("lists versioned Claude model choices", () => {
  assert.deepEqual(
    aiModelOptions
      .filter((option) => option.providerId === "claude-code")
      .map((option) => option.model),
    [
      "opus",
      "claude-opus-5",
      "claude-opus-4-8",
      "sonnet",
      "claude-sonnet-5",
      "claude-sonnet-4-8",
      "fable",
      "claude-fable-5",
      "claude-fable-4-8"
    ]
  );
});

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

test("configures Claude model, effort, directories, and YOLO mode", () => {
  const provider = findProvider("claude-code");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Implement the ticket.",
      additionalWritableDirectories: [" /tmp/project-context "],
      bypassApprovalsAndSandbox: true,
      model: "sonnet",
      reasoningEffort: "max",
      readOnly: false
    }),
    {
      executable: "claude",
      arguments: [
        "--model",
        "sonnet",
        "--effort",
        "max",
        "--add-dir",
        "/tmp/project-context",
        "--dangerously-skip-permissions",
        "Implement the ticket."
      ]
    }
  );
});

test("configures Claude read-only sessions in plan mode", () => {
  const provider = findProvider("claude-code");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Review the project.",
      bypassApprovalsAndSandbox: true,
      model: "opus",
      reasoningEffort: "high",
      readOnly: true
    }),
    {
      executable: "claude",
      arguments: [
        "--model",
        "opus",
        "--effort",
        "high",
        "--permission-mode",
        "plan",
        "Review the project."
      ]
    }
  );
});
