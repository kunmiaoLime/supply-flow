import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderLaunchSpec } from "@supply-flow/core/providers";

const execFile = promisify(execFileCallback);

export interface TmuxCommandResult {
  stdout: string;
  stderr: string;
}

export type TmuxCommandRunner = (arguments_: string[]) => Promise<TmuxCommandResult>;

export interface CreateTmuxSessionInput {
  sessionName: string;
  workspacePath: string;
  launch: ProviderLaunchSpec;
  outputPath?: string;
}

export class TmuxAdapter {
  public constructor(private readonly run: TmuxCommandRunner = defaultTmuxCommandRunner) {}

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
    await this.run(["send-keys", "-t", sessionName, "-l", input]);
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

function toShellCommand(launch: ProviderLaunchSpec): string {
  return [launch.executable, ...launch.arguments].map(quoteForShell).join(" ");
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
