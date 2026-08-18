import type { ReasoningEffort } from "@supply-flow/core/ai-model-settings";

export type ProviderId = "codex" | "claude-code" | "gemini-cli";

export interface ProviderLaunchSpec {
  executable: string;
  arguments: string[];
  unsetEnvironment?: readonly string[];
  environment?: Readonly<Record<string, string>>;
}

export interface ProviderLaunchOptions {
  initialPrompt?: string;
  additionalWritableDirectories?: readonly string[];
  bypassApprovalsAndSandbox?: boolean;
  readOnly?: boolean;
  model?: string | null;
  reasoningEffort?: ReasoningEffort | null;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  createLaunchSpec(options?: ProviderLaunchOptions): ProviderLaunchSpec;
}

class CliProviderAdapter implements ProviderAdapter {
  public constructor(
    public readonly id: ProviderId,
    public readonly displayName: string,
    private readonly executable: string
  ) {}

  public createLaunchSpec(options?: ProviderLaunchOptions): ProviderLaunchSpec {
    const initialPrompt = options?.initialPrompt?.trim();
    const model = options?.model?.trim();
    const additionalWritableDirectories =
      options?.additionalWritableDirectories
        ?.map((directory) => directory.trim())
        .filter(Boolean) ?? [];

    return {
      executable: this.executable,
      ...(this.id === "claude-code"
        ? { unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] }
        : {}),
      arguments: [
        ...(this.id === "codex" ? ["--no-alt-screen"] : []),
        ...(model ? ["--model", model] : []),
        ...(this.id === "codex" && options?.reasoningEffort
          ? ["--config", `model_reasoning_effort="${options.reasoningEffort}"`]
          : []),
        ...(this.id === "claude-code" && options?.reasoningEffort
          ? ["--effort", options.reasoningEffort]
          : []),
        ...(this.id === "codex" && options?.readOnly
          ? ["--sandbox", "read-only"]
          : []),
        ...((this.id === "claude-code" || (this.id === "codex" && !options?.readOnly))
          ? additionalWritableDirectories.flatMap((directory) => ["--add-dir", directory])
          : []),
        ...(this.id === "claude-code" &&
        options?.readOnly &&
        !options?.bypassApprovalsAndSandbox
          ? ["--permission-mode", "plan"]
          : []),
        ...(this.id === "codex" && !options?.readOnly && options?.bypassApprovalsAndSandbox
          ? ["--dangerously-bypass-approvals-and-sandbox"]
          : []),
        ...(this.id === "codex" && options?.readOnly && options?.bypassApprovalsAndSandbox
          ? ["--ask-for-approval", "never"]
          : []),
        ...(this.id === "claude-code" && options?.bypassApprovalsAndSandbox
          ? ["--dangerously-skip-permissions"]
          : []),
        ...(this.id === "claude-code"
          ? ["--append-system-prompt", claudeOutputManagementPolicy]
          : []),
        ...(initialPrompt ? [initialPrompt] : [])
      ]
    };
  }
}

const claudeOutputManagementPolicy = [
  "Keep output bounded. For large command or API results, use pagination, filtering, or range limits.",
  "Write substantial artifacts incrementally to files and report paths and counts instead of dumping content.",
  "Before emitting a response that could be large, divide it into small, self-contained chunks.",
  "Complete one bounded chunk at a time and explicitly continue with the next chunk when needed."
].join(" ");

export const defaultProviders: readonly ProviderAdapter[] = [
  new CliProviderAdapter("codex", "Codex", "codex"),
  new CliProviderAdapter("claude-code", "Claude Code", "claude"),
  new CliProviderAdapter("gemini-cli", "Gemini CLI", "gemini")
];

export function findProvider(id: string): ProviderAdapter | undefined {
  return defaultProviders.find((provider) => provider.id === id);
}
