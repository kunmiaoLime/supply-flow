import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderLaunchSpec } from "@supply-flow/core/providers";

const execFile = promisify(execFileCallback);

export interface TmuxCommandResult {
  stdout: string;
  stderr: string;
}

export type TmuxCommandRunner = (arguments_: string[]) => Promise<TmuxCommandResult>;
export type TmuxWait = (milliseconds: number) => Promise<void>;

export interface CreateTmuxSessionInput {
  sessionName: string;
  workspacePath: string;
  launch: ProviderLaunchSpec;
  outputPath?: string;
}

export class TmuxAdapter {
  public constructor(
    private readonly run: TmuxCommandRunner = defaultTmuxCommandRunner,
    private readonly wait: TmuxWait = waitForTerminalInput
  ) {}

  public async version(): Promise<string> {
    const result = await this.run(["-V"]);
    return result.stdout.trim();
  }

  public async createSession(input: CreateTmuxSessionInput): Promise<void> {
    assertSessionName(input.sessionName);
    const command = toShellCommand(input.launch);

    await this.run([
      "new-session",
      "-d",
      "-s",
      input.sessionName,
      "-c",
      input.workspacePath,
      command
    ]);

    if (input.outputPath) {
      await this.run([
        "pipe-pane",
        "-o",
        "-t",
        input.sessionName,
        `cat >> ${quoteForShell(input.outputPath)}`
      ]);
    }
  }

  public async sendInput(sessionName: string, input: string): Promise<void> {
    assertSessionName(sessionName);
    const bufferName = `sf_prompt_${randomUUID().replaceAll("-", "")}`;

    try {
      await this.run(["set-buffer", "-b", bufferName, input]);
      await this.run(["paste-buffer", "-p", "-d", "-b", bufferName, "-t", sessionName]);
    } catch (error) {
      try {
        await this.run(["delete-buffer", "-b", bufferName]);
      } catch {
        // The buffer may already have been removed after a successful paste.
      }
      throw error;
    }

    await this.wait(promptSettleDelay(input));
    await this.run(["send-keys", "-t", sessionName, "Enter"]);
  }

  public async sendTerminalInput(sessionName: string, input: string): Promise<void> {
    assertSessionName(sessionName);
    if (!input) {
      return;
    }

    await this.run(["send-keys", "-t", sessionName, "-l", input]);
  }

  public async resizeSession(sessionName: string, columns: number, rows: number): Promise<void> {
    assertSessionName(sessionName);
    assertTerminalDimension(columns, "columns");
    assertTerminalDimension(rows, "rows");
    await this.run([
      "resize-window",
      "-t",
      sessionName,
      "-x",
      String(columns),
      "-y",
      String(rows)
    ]);
  }

  public async captureOutput(sessionName: string, lines = 200): Promise<string> {
    assertSessionName(sessionName);
    const result = await this.run([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      sessionName,
      "-S",
      `-${lines}`
    ]);
    return result.stdout;
  }

  public async listSessions(): Promise<string[]> {
    const result = await this.run(["list-sessions", "-F", "#{session_name}"]);
    return result.stdout.split("\n").filter(Boolean);
  }

  public async terminateSession(sessionName: string): Promise<void> {
    assertSessionName(sessionName);
    await this.run(["kill-session", "-t", sessionName]);
  }
}

async function defaultTmuxCommandRunner(arguments_: string[]): Promise<TmuxCommandResult> {
  const result = await execFile("tmux", arguments_, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function waitForTerminalInput(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function promptSettleDelay(input: string): number {
  const baseDelay = 500;
  const perKilobyteDelay = 100;
  const maximumDelay = 2_500;
  const inputKilobytes = Math.ceil(Buffer.byteLength(input, "utf8") / 1_024);
  return Math.min(maximumDelay, baseDelay + inputKilobytes * perKilobyteDelay);
}

function toShellCommand(launch: ProviderLaunchSpec): string {
  const unsetEnvironment = launch.unsetEnvironment ?? [];

  for (const name of unsetEnvironment) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid environment variable name: "${name}".`);
    }
  }

  return [
    ...(unsetEnvironment.length > 0
      ? ["env", ...unsetEnvironment.flatMap((name) => ["-u", name])]
      : []),
    launch.executable,
    ...launch.arguments
  ]
    .map(quoteForShell)
    .join(" ");
}

function quoteForShell(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertSessionName(value: string): void {
  if (!/^sf_[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid tmux session name: "${value}".`);
  }
}

function assertTerminalDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error(`Invalid terminal ${label}: "${value}".`);
  }
}
