import assert from "node:assert/strict";
import test from "node:test";
import { TmuxAdapter, type TmuxCommandResult } from "./tmux.js";

test("pastes action prompts before separately submitting Enter", async () => {
  const commands: string[][] = [];
  const waits: number[] = [];
  const adapter = new TmuxAdapter(async (arguments_) => {
    commands.push(arguments_);
    return emptyResult();
  }, async (milliseconds) => {
    waits.push(milliseconds);
  });

  await adapter.createSession({
    sessionName: "sf_session_01",
    workspacePath: "/tmp/worktree",
    launch: {
      executable: "codex",
      arguments: ["--model", "gpt-5"]
    },
    outputPath: "/tmp/session.log"
  });
  await adapter.sendInput("sf_session_01", "Review this repository.");
  await adapter.sendTerminalInput("sf_session_01", "continue");
  await adapter.resizeSession("sf_session_01", 180, 48);

  assert.deepEqual(commands[0], [
    "new-session",
    "-d",
    "-s",
    "sf_session_01",
    "-c",
    "/tmp/worktree",
    "'codex' '--model' 'gpt-5'"
  ]);
  assert.deepEqual(commands[1], [
    "pipe-pane",
    "-o",
    "-t",
    "sf_session_01",
    "cat >> '/tmp/session.log'"
  ]);
  assert.equal(commands[2]?.[0], "set-buffer");
  assert.equal(commands[2]?.[1], "-b");
  assert.match(commands[2]?.[2] ?? "", /^sf_prompt_[a-f0-9]{32}$/);
  assert.equal(commands[2]?.[3], "Review this repository.");
  assert.deepEqual(commands[3], [
    "paste-buffer",
    "-p",
    "-d",
    "-b",
    commands[2]?.[2],
    "-t",
    "sf_session_01"
  ]);
  assert.deepEqual(commands[4], ["send-keys", "-t", "sf_session_01", "Enter"]);
  assert.deepEqual(commands[5], [
    "send-keys",
    "-t",
    "sf_session_01",
    "-l",
    "continue"
  ]);
  assert.deepEqual(commands[6], [
    "resize-window",
    "-t",
    "sf_session_01",
    "-x",
    "180",
    "-y",
    "48"
  ]);
  assert.deepEqual(waits, [600]);
});

test("waits longer for larger action prompts before submitting", async () => {
  const waits: number[] = [];
  const adapter = new TmuxAdapter(async () => emptyResult(), async (milliseconds) => {
    waits.push(milliseconds);
  });

  await adapter.sendInput("sf_session_01", "x".repeat(16_000));

  assert.deepEqual(waits, [2_100]);
});

test("unsets requested environment variables before launching a provider", async () => {
  const commands: string[][] = [];
  const adapter = new TmuxAdapter(async (arguments_) => {
    commands.push(arguments_);
    return emptyResult();
  });

  await adapter.createSession({
    sessionName: "sf_session_01",
    workspacePath: "/tmp/worktree",
    launch: {
      executable: "claude",
      unsetEnvironment: ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
      arguments: ["--model", "sonnet"]
    }
  });

  assert.deepEqual(commands, [
    [
      "new-session",
      "-d",
      "-s",
      "sf_session_01",
      "-c",
      "/tmp/worktree",
      "'env' '-u' 'CLAUDE_CODE_MAX_OUTPUT_TOKENS' 'claude' '--model' 'sonnet'"
    ]
  ]);
});

test("sets requested environment variables before launching a provider", async () => {
  const commands: string[][] = [];
  const adapter = new TmuxAdapter(async (arguments_) => {
    commands.push(arguments_);
    return emptyResult();
  });

  await adapter.createSession({
    sessionName: "sf_session_01",
    workspacePath: "/tmp/worktree",
    launch: {
      executable: "codex",
      environment: {
        PATH: "/opt/homebrew/bin:/usr/bin"
      },
      arguments: ["--model", "gpt-5"]
    }
  });

  assert.deepEqual(commands, [
    [
      "new-session",
      "-d",
      "-s",
      "sf_session_01",
      "-c",
      "/tmp/worktree",
      "'env' 'PATH=/opt/homebrew/bin:/usr/bin' 'codex' '--model' 'gpt-5'"
    ]
  ]);
});

test("treats a missing tmux server as no active sessions", async () => {
  const adapter = new TmuxAdapter(async () => {
    throw Object.assign(new Error("tmux exited"), {
      stderr: "error connecting to /private/tmp/tmux-501/default (No such file or directory)"
    });
  });

  assert.deepEqual(await adapter.listSessions(), []);
});

test("propagates tmux listing errors other than a missing server", async () => {
  const adapter = new TmuxAdapter(async () => {
    throw Object.assign(new Error("tmux is unavailable"), {
      stderr: "command not found"
    });
  });

  await assert.rejects(() => adapter.listSessions(), /tmux is unavailable/);
});

function emptyResult(): TmuxCommandResult {
  return {
    stdout: "",
    stderr: ""
  };
}
