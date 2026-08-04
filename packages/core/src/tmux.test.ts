import assert from "node:assert/strict";
import test from "node:test";
import { TmuxAdapter, type TmuxCommandResult } from "./tmux.js";

test("uses literal tmux input and a separately submitted Enter key", async () => {
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
  assert.deepEqual(commands[2], [
    "send-keys",
    "-t",
    "sf_session_01",
    "-l",
    "Review this repository."
  ]);
  assert.deepEqual(commands[3], ["send-keys", "-t", "sf_session_01", "Enter"]);
  assert.deepEqual(commands[4], [
    "send-keys",
    "-t",
    "sf_session_01",
    "-l",
    "continue"
  ]);
  assert.deepEqual(commands[5], [
    "resize-window",
    "-t",
    "sf_session_01",
    "-x",
    "180",
    "-y",
    "48"
  ]);
});

function emptyResult(): TmuxCommandResult {
  return {
    stdout: "",
    stderr: ""
  };
}
