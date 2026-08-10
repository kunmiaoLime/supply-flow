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
    assert.deepEqual(defaults.authenticationCommands, {
      codex: "aws sso login --profile dev",
      "claude-code": "aws sso login"
    });
    const { globalDefault: _globalDefault, ...legacyDefaults } = defaults;
    assert.deepEqual(AiModelSettingsSchema.parse(legacyDefaults), defaults);
    assert.deepEqual(resolveAiModelDefault(defaults, "new-session"), {
      providerId: "codex",
      model: null,
      reasoningEffort: null,
      readOnly: true,
      yoloMode: false
    });
    assert.deepEqual(resolveAiModelDefault(defaults, "review-code"), {
      providerId: "codex",
      model: null,
      reasoningEffort: null,
      readOnly: false,
      yoloMode: true
    });
    assert.deepEqual(resolveAiModelDefault(defaults, "import-project"), {
      providerId: "codex",
      model: null,
      reasoningEffort: null,
      readOnly: false,
      yoloMode: true
    });
    assert.deepEqual(resolveAiModelDefault(defaults, "write-rfc"), {
      providerId: "codex",
      model: null,
      reasoningEffort: null,
      readOnly: false,
      yoloMode: true
    });
    assert.deepEqual(resolveAiModelDefault(defaults, "convert-rfc"), {
      providerId: "codex",
      model: null,
      reasoningEffort: null,
      readOnly: false,
      yoloMode: true
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
    const independentPermissions = AiModelSettingsSchema.parse({
      ...defaults,
      actions: {
        ...defaults.actions,
        "new-session": {
          ...defaults.actions["new-session"],
          yoloMode: true
        }
      }
    });
    assert.deepEqual(independentPermissions.actions["new-session"], {
      ...defaults.actions["new-session"],
      readOnly: true,
      yoloMode: true
    });

    const saved = await store.update({
      ...defaults,
      authenticationCommands: {
        codex: "aws sso login --profile staging",
        "claude-code": "aws sso login --profile staging"
      },
      actions: {
        ...defaults.actions,
        "implement-code": {
          ...defaults.actions["implement-code"],
          providerId: "codex",
          model: "openai.gpt-5.6-terra",
          reasoningEffort: "xhigh"
        }
      }
    });

    assert.equal(saved.actions["implement-code"].model, "openai.gpt-5.6-terra");
    assert.equal(saved.actions["implement-code"].providerId, "codex");
    assert.equal(saved.actions["implement-code"].reasoningEffort, "xhigh");
    assert.deepEqual(saved.authenticationCommands, {
      codex: "aws sso login --profile staging",
      "claude-code": "aws sso login --profile staging"
    });
    assert.deepEqual(await store.get(), saved);
    assert.deepEqual(resolveAiModelDefault(saved, "implement-code"), {
      providerId: "codex",
      model: "openai.gpt-5.6-terra",
      reasoningEffort: "xhigh",
      readOnly: false,
      yoloMode: true
    });

    const inherited = {
      ...saved,
      globalDefault: {
        providerId: "claude-code" as const,
        model: "sonnet",
        reasoningEffort: "high" as const
      }
    };
    assert.deepEqual(resolveAiModelDefault(inherited, "create-task"), {
      providerId: "claude-code",
      model: "sonnet",
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

test("migrates legacy Codex defaults and action selections to provider-aware settings", () => {
  const legacySettings = {
    schemaVersion: 1,
    codexDefault: {
      model: "gpt-5.3-codex",
      reasoningEffort: "high" as const
    },
    actions: {
      "new-session": {
        model: null,
        reasoningEffort: null
      },
      "initialize-context": {
        model: null,
        reasoningEffort: null
      },
      "update-context": {
        model: null,
        reasoningEffort: null
      },
      "create-task": {
        model: null,
        reasoningEffort: null
      },
      "implement-code": {
        model: "openai.gpt-5.6-terra",
        reasoningEffort: "xhigh" as const
      },
      "create-pull-request": {
        model: null,
        reasoningEffort: "low" as const
      },
      "address-pull-request": {
        model: null,
        reasoningEffort: null
      }
    }
  };

  const parsed = AiModelSettingsSchema.parse(legacySettings);
  assert.deepEqual(parsed.globalDefault, {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high"
  });
  assert.equal(parsed.actions["implement-code"].providerId, "codex");
  assert.deepEqual(parsed.authenticationCommands, {
    codex: "aws sso login --profile dev",
    "claude-code": "aws sso login"
  });
  assert.deepEqual(parsed.actions["create-pull-request"], {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "low",
    readOnly: false,
    yoloMode: true
  });
  assert.deepEqual(resolveAiModelDefault(parsed, "create-task"), {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    readOnly: false,
    yoloMode: true
  });
  assert.deepEqual(resolveAiModelDefault(parsed, "review-code"), {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    readOnly: false,
    yoloMode: true
  });
  assert.deepEqual(resolveAiModelDefault(parsed, "import-project"), {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    readOnly: false,
    yoloMode: true
  });
  assert.deepEqual(resolveAiModelDefault(parsed, "write-rfc"), {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    readOnly: false,
    yoloMode: true
  });
  assert.deepEqual(resolveAiModelDefault(parsed, "convert-rfc"), {
    providerId: "codex",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    readOnly: false,
    yoloMode: true
  });
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
