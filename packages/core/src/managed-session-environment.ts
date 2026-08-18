import { existsSync } from "node:fs";
import path from "node:path";
import type { ProviderLaunchSpec } from "@supply-flow/core/providers";

const HOMEBREW_BIN_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

export function withManagedSessionEnvironment(
  launch: ProviderLaunchSpec,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executableExists: (filePath: string) => boolean = existsSync
): ProviderLaunchSpec {
  const preferredPath = preferredRipgrepPath(environment.PATH, platform, executableExists);
  if (!preferredPath) {
    return launch;
  }

  return {
    ...launch,
    environment: {
      ...launch.environment,
      PATH: preferredPath
    }
  };
}

export function preferredRipgrepPath(
  currentPath: string | undefined,
  platform: NodeJS.Platform,
  executableExists: (filePath: string) => boolean
): string | null {
  if (platform !== "darwin" || !currentPath) {
    return null;
  }

  for (const directory of HOMEBREW_BIN_DIRECTORIES) {
    if (executableExists(path.join(directory, "rg"))) {
      return prependPath(directory, currentPath);
    }
  }

  return null;
}

function prependPath(directory: string, currentPath: string): string {
  return [directory, ...currentPath.split(":").filter((entry) => entry && entry !== directory)].join(
    ":"
  );
}
