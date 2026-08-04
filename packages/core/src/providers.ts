export type ProviderId = "codex" | "claude-code" | "gemini-cli";

export interface ProviderLaunchSpec {
  executable: string;
  arguments: string[];
}

export interface ProviderLaunchOptions {
  initialPrompt?: string;
  additionalWritableDirectories?: readonly string[];
  bypassApprovalsAndSandbox?: boolean;
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
    const additionalWritableDirectories =
      options?.additionalWritableDirectories
        ?.map((directory) => directory.trim())
        .filter(Boolean) ?? [];

    return {
      executable: this.executable,
      arguments: [
        ...(this.id === "codex" ? ["--no-alt-screen"] : []),
        ...(this.id === "codex"
          ? additionalWritableDirectories.flatMap((directory) => ["--add-dir", directory])
          : []),
        ...(this.id === "codex" && options?.bypassApprovalsAndSandbox
          ? ["--dangerously-bypass-approvals-and-sandbox"]
          : []),
        ...(initialPrompt ? [initialPrompt] : [])
      ]
    };
  }
}

export const defaultProviders: readonly ProviderAdapter[] = [
  new CliProviderAdapter("codex", "Codex", "codex"),
  new CliProviderAdapter("claude-code", "Claude Code", "claude"),
  new CliProviderAdapter("gemini-cli", "Gemini CLI", "gemini")
];

export function findProvider(id: string): ProviderAdapter | undefined {
  return defaultProviders.find((provider) => provider.id === id);
}
