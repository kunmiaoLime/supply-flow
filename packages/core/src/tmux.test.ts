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
    }
  });
  await adapter.sendInput("sf_session_01", "Review this repository.");

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
    "send-keys",
    "-t",
    "sf_session_01",
    "-l",
    "Review this repository."
  ]);
  assert.deepEqual(commands[2], ["send-keys", "-t", "sf_session_01", "Enter"]);
});

function emptyResult(): TmuxCommandResult {
  return {
    stdout: "",
    stderr: ""
  };
}
