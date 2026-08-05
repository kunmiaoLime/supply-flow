import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AiModelSettingsSchema,
  createDefaultAiModelSettings,
  resolveAiModelDefault
} from "./ai-model-settings.js";
import { FileAiModelSettingsStore } from "./file-ai-model-settings-store.js";

test("returns defaults and persists action-specific AI model settings", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-ai-models-"));
  const store = new FileAiModelSettingsStore(dataDirectory);

  try {
    const defaults = createDefaultAiModelSettings();
    assert.deepEqual(await store.get(), defaults);
    const { codexDefault: _codexDefault, ...legacyDefaults } = defaults;
    assert.deepEqual(AiModelSettingsSchema.parse(legacyDefaults), defaults);
    assert.deepEqual(resolveAiModelDefault(defaults, "new-session"), {
      model: null,
      reasoningEffort: null,
      readOnly: true,
      yoloMode: false
    });
    const legacyActionDefaults = {
      ...legacyDefaults,
      actions: Object.fromEntries(
        Object.entries(defaults.actions).map(([action, setting]) => [
          action,
          {
            model: setting.model,
            reasoningEffort: setting.reasoningEffort
          }
        ])
      )
    };
    assert.deepEqual(AiModelSettingsSchema.parse(legacyActionDefaults), defaults);

    const saved = await store.update({
      ...defaults,
      actions: {
        ...defaults.actions,
        "implement-code": {
          ...defaults.actions["implement-code"],
          model: "openai.gpt-5.6-terra",
          reasoningEffort: "xhigh"
        }
      }
    });

    assert.equal(saved.actions["implement-code"].model, "openai.gpt-5.6-terra");
    assert.equal(saved.actions["implement-code"].reasoningEffort, "xhigh");
    assert.deepEqual(await store.get(), saved);
    assert.deepEqual(resolveAiModelDefault(saved, "implement-code"), {
      model: "openai.gpt-5.6-terra",
      reasoningEffort: "xhigh",
      readOnly: false,
      yoloMode: true
    });

    const inherited = {
      ...saved,
      codexDefault: {
        model: "gpt-5.3-codex",
        reasoningEffort: "high" as const
      }
    };
    assert.deepEqual(resolveAiModelDefault(inherited, "create-task"), {
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
      readOnly: false,
      yoloMode: true
    });
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(dataDirectory, "settings", "ai_model.json"), "utf8")
      ),
      saved
    );
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("loads the prior settings filename and migrates it on save", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-ai-models-"));
  const settingsDirectory = path.join(dataDirectory, "settings");
  const store = new FileAiModelSettingsStore(dataDirectory);
  const settings = createDefaultAiModelSettings();

  try {
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      path.join(settingsDirectory, "ai-models.json"),
      JSON.stringify(settings),
      "utf8"
    );
    assert.deepEqual(await store.get(), settings);

    await store.update(settings);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(settingsDirectory, "ai_model.json"), "utf8")),
      settings
    );
    await assert.rejects(readFile(path.join(settingsDirectory, "ai-models.json"), "utf8"));
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
