export type ProviderId = "codex" | "claude-code" | "gemini-cli";

export interface ProviderLaunchSpec {
  executable: string;
  arguments: string[];
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  createLaunchSpec(): ProviderLaunchSpec;
}

class CliProviderAdapter implements ProviderAdapter {
  public constructor(
    public readonly id: ProviderId,
    public readonly displayName: string,
    private readonly executable: string
  ) {}

  public createLaunchSpec(): ProviderLaunchSpec {
    return {
      executable: this.executable,
      arguments: []
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
