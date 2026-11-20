import assert from "node:assert/strict";
import test from "node:test";
import {
  aiModelOptions,
  reasoningEffortsForProvider,
  supportsReasoningEffort
} from "./ai-model-settings.js";
import { ProjectBranchPendingReviewSessionConfigurationSchema } from "./branch.js";
import { findProvider } from "./providers.js";

test("lists versioned Claude model choices", () => {
  assert.deepEqual(
    aiModelOptions
      .filter((option) => option.providerId === "claude-code")
      .map((option) => option.model),
    [
      "opus",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "sonnet",
      "claude-sonnet-5",
      "claude-sonnet-4-8"
    ]
  );
});

test("lists the available OpenAI Codex model choices", () => {
  assert.deepEqual(
    aiModelOptions
      .filter((option) => option.providerId === "codex")
      .map((option) => option.model),
    ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]
  );
});

test("limits reasoning efforts to those supported by the selected model", () => {
  for (const model of ["gpt-6-astra", "gpt-6-sol"]) {
    assert.deepEqual(reasoningEffortsForProvider("codex", model), [
      "low", "medium", "high", "xhigh", "max", "ultra"
    ]);
    assert.equal(supportsReasoningEffort("codex", "ultra", model), true);
  }
  assert.deepEqual(reasoningEffortsForProvider("codex", "gpt-6-luna"), [
    "low", "medium", "high", "xhigh", "max"
  ]);
  assert.equal(supportsReasoningEffort("codex", "ultra", "gpt-6-luna"), false);
  assert.equal(supportsReasoningEffort("codex", "minimal", "gpt-6-astra"), false);
  assert.equal(supportsReasoningEffort("claude-code", "ultra", "opus"), false);
  assert.equal(supportsReasoningEffort("codex", null, "gpt-6-luna"), true);

  const configuration = {
    provider_id: "codex",
    model: "gpt-6-astra",
    reasoning_effort: "ultra",
    read_only: true,
    yolo_mode: false
  };
  assert.equal(ProjectBranchPendingReviewSessionConfigurationSchema.safeParse(configuration).success, true);
  assert.equal(ProjectBranchPendingReviewSessionConfigurationSchema.safeParse({
    ...configuration,
    model: "gpt-6-luna"
  }).success, false);
});

test("configures Codex additional writable directories and YOLO mode", () => {
  const provider = findProvider("codex");

  assert.deepEqual(
    provider?.createLaunchSpec({
      initialPrompt: "Create project context.",
      additionalWritableDirectories: [" /tmp/project-context "],
      bypassApprovalsAndSandbox: true,
      model: "gpt-6-astra",
      reasoningEffort: "ultra"
    }),
    {
      executable: "codex",
      arguments: [
        "--no-alt-screen",
        "--model",
        "gpt-6-astra",
        "--config",
        'model_reasoning_effort="ultra"',
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
