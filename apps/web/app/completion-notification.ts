import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadCompletionNotificationPrompt(projectRoot: string): Promise<string> {
  return loadPrompt(
    projectRoot,
    "notify_when_complete.md",
    "The completion-notification prompt is empty."
  );
}

export async function loadCompletionNotificationCancellationPrompt(
  projectRoot: string
): Promise<string> {
  return loadPrompt(
    projectRoot,
    "cancel_notify_when_complete.md",
    "The completion-notification cancellation prompt is empty."
  );
}

async function loadPrompt(projectRoot: string, filename: string, emptyMessage: string): Promise<string> {
  const prompt = (
    await readFile(path.join(projectRoot, "prompts", filename), "utf8")
  ).trim();
  if (!prompt) {
    throw new Error(emptyMessage);
  }

  return prompt;
}
