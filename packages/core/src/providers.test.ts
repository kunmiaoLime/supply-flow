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
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-fable-4-8"
    ]
  );
});

test("lists GPT-5.6 Codex model choices", () => {
  assert.deepEqual(
    aiModelOptions
      .filter((option) => option.providerId === "codex")
      .map((option) => option.model)
      .slice(0, 3),
    ["openai.gpt-5.6-sol", "openai.gpt-5.6-terra", "openai.gpt-5.6-luna"]
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
      unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
      arguments: [
        "--model",
        "sonnet",
        "--effort",
        "max",
        "--add-dir",
        "/tmp/project-context",
        "--dangerously-skip-permissions",
        "--append-system-prompt",
        "Keep output bounded. For large command or API results, use pagination, filtering, or range limits. Write substantial artifacts incrementally to files and report paths and counts instead of dumping content. Before emitting a response that could be large, divide it into small, self-contained chunks. Complete one bounded chunk at a time and explicitly continue with the next chunk when needed.",
        "Implement the ticket."
      ]
    }
  );
});

test("configures Codex read-only YOLO sessions without write access", () => {
  const provider = findProvider("codex");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Inspect the project.",
      additionalWritableDirectories: ["/tmp/project-context"],
      bypassApprovalsAndSandbox: true,
      model: "gpt-5.3-codex",
      readOnly: true
    }),
    {
      executable: "codex",
      arguments: [
        "--no-alt-screen",
        "--model",
        "gpt-5.3-codex",
        "--sandbox",
        "read-only",
        "--ask-for-approval",
        "never",
        "Inspect the project."
      ]
    }
  );
});

test("configures Claude read-only sessions in plan mode when YOLO is off", () => {
  const provider = findProvider("claude-code");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Review the project.",
      model: "opus",
      reasoningEffort: "high",
      readOnly: true
    }),
    {
      executable: "claude",
      unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
      arguments: [
        "--model",
        "opus",
        "--effort",
        "high",
        "--permission-mode",
        "plan",
        "--append-system-prompt",
        "Keep output bounded. For large command or API results, use pagination, filtering, or range limits. Write substantial artifacts incrementally to files and report paths and counts instead of dumping content. Before emitting a response that could be large, divide it into small, self-contained chunks. Complete one bounded chunk at a time and explicitly continue with the next chunk when needed.",
        "Review the project."
      ]
    }
  );
});

test("configures Claude YOLO sessions with the local read-only policy", () => {
  const provider = findProvider("claude-code");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Inspect the project.",
      bypassApprovalsAndSandbox: true,
      model: "opus",
      reasoningEffort: "high",
      readOnly: true
    }),
    {
      executable: "claude",
      unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
      arguments: [
        "--model",
        "opus",
        "--effort",
        "high",
        "--dangerously-skip-permissions",
        "--append-system-prompt",
        "Keep output bounded. For large command or API results, use pagination, filtering, or range limits. Write substantial artifacts incrementally to files and report paths and counts instead of dumping content. Before emitting a response that could be large, divide it into small, self-contained chunks. Complete one bounded chunk at a time and explicitly continue with the next chunk when needed.",
        "Inspect the project."
      ]
    }
  );
});
