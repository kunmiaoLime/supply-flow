import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FilePullRequestTemplateStore,
  PullRequestTemplateError
} from "./file-pull-request-template-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("resolves the committed PR templates used by the PR creation workflow", async () => {
  const templateDirectory = path.join(repositoryRoot, "templates", "PR");
  const templates = await new FilePullRequestTemplateStore(templateDirectory).list();

  assert.deepEqual(
    templates.map((template) => template.repository),
    ["limebike/admintool", "limebike/ios", "limebike/limebike-web"]
  );
  assert.equal(
    templates.find((template) => template.repository === "limebike/admintool")?.path,
    path.join(templateDirectory, "limebike-admintool-pr-template.md")
  );
});

test("resolves a local PR template from its GitHub repository mapping", async () => {
  const templateDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));

  try {
    await mkdir(templateDirectory, { recursive: true });
    await writeFile(
      path.join(templateDirectory, "pr-template-mapping.json"),
      JSON.stringify({ "limebike/ios": "ios-pr-template.md" }),
      "utf8"
    );
    await writeFile(
      path.join(templateDirectory, "ios-pr-template.md"),
      "## Summary\n- \n",
      "utf8"
    );

    assert.deepEqual(
      await new FilePullRequestTemplateStore(templateDirectory).resolve(
        "git@github.com:LimeBike/ios.git"
      ),
      {
        content: "## Summary\n- \n",
        path: path.join(templateDirectory, "ios-pr-template.md"),
        repository: "limebike/ios"
      }
    );
  } finally {
    await rm(templateDirectory, { force: true, recursive: true });
  }
});

test("falls back when no local PR template matches the repository", async () => {
  const templateDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));

  try {
    const store = new FilePullRequestTemplateStore(templateDirectory);
    assert.equal(await store.resolve("git@github.com:limebike/ios.git"), null);
    assert.equal(await store.resolve("git@gitlab.com:limebike/ios.git"), null);
  } finally {
    await rm(templateDirectory, { force: true, recursive: true });
  }
});

test("lists, imports, and updates repository PR templates", async () => {
  const templateDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));

  try {
    const store = new FilePullRequestTemplateStore(templateDirectory);
    assert.deepEqual(await store.list(), []);

    const created = await store.create("LimeBike/android", "## Summary\n- Initial template\n");
    assert.deepEqual(created, {
      content: "## Summary\n- Initial template\n",
      path: path.join(templateDirectory, "limebike-android-pr-template.md"),
      repository: "limebike/android"
    });
    assert.deepEqual(await store.list(), [created]);
    await assert.rejects(
      store.create("limebike/android", "## Duplicate"),
      /already configured/
    );

    const updated = await store.update("limebike/android", "## Summary\n- Updated template\n");
    assert.deepEqual(updated, {
      ...created,
      content: "## Summary\n- Updated template\n"
    });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(templateDirectory, "pr-template-mapping.json"), "utf8")),
      { "limebike/android": "limebike-android-pr-template.md" }
    );
    await assert.rejects(store.update("limebike/ios", "## Summary"), /No PR template/);
  } finally {
    await rm(templateDirectory, { force: true, recursive: true });
  }
});

test("rejects local PR templates that escape the template directory", async () => {
  const templateDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-templates-"));

  try {
    await mkdir(templateDirectory, { recursive: true });
    await writeFile(
      path.join(templateDirectory, "pr-template-mapping.json"),
      JSON.stringify({ "limebike/ios": "../ios-pr-template.md" }),
      "utf8"
    );

    await assert.rejects(
      new FilePullRequestTemplateStore(templateDirectory).resolve("git@github.com:limebike/ios.git"),
      PullRequestTemplateError
    );
  } finally {
    await rm(templateDirectory, { force: true, recursive: true });
  }
});
