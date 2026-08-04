import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareFollowUpAiSessionPrompt,
  prepareInitialAiSessionPrompt,
  sendAiSessionPrompt
} from "./session-prompt.js";

test("preserves initial session prompts and normalizes follow-up prompts", () => {
  const prompt = "  First line.\n\n  Second line.  ";

  assert.equal(prepareInitialAiSessionPrompt(prompt), "First line.\n\n  Second line.");
  assert.equal(prepareFollowUpAiSessionPrompt(prompt), "First line. Second line.");
  assert.throws(() => prepareInitialAiSessionPrompt(" \n "), /cannot be empty/);
});

test("delivers every follow-up prompt through the shared transport", async () => {
  const sent: Array<{ sessionName: string; input: string }> = [];

  await sendAiSessionPrompt(
    {
      async sendInput(sessionName, input) {
        sent.push({ sessionName, input });
      }
    },
    "sf_session_01",
    "First line.\nSecond line."
  );

  assert.deepEqual(sent, [
    {
      sessionName: "sf_session_01",
      input: "First line. Second line."
    }
  ]);
});
