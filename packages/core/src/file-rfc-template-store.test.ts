import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FileRfcTemplateStore,
  MAX_RFC_TEMPLATE_LENGTH,
  RfcTemplateError
} from "./file-rfc-template-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("loads the committed RFC template used by the RFC creation workflow", async () => {
  const templatePath = path.join(repositoryRoot, "templates", "rfc_template.md");
  const template = await new FileRfcTemplateStore(templatePath).get();

  assert.equal(template.path, templatePath);
  assert.match(template.content, /^# \[RFC\] <Title>/m);
  assert.match(template.content, /^#### API Integration Contracts$/m);
});

test("loads and updates the repository RFC template", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-rfc-template-"));
  const templatePath = path.join(rootDirectory, "rfc_template.md");
  const store = new FileRfcTemplateStore(templatePath);

  try {
    await writeFile(templatePath, "# Default RFC\n", "utf8");

    assert.deepEqual(await store.get(), {
      content: "# Default RFC\n",
      path: templatePath
    });

    const updated = await store.update("# Updated RFC\n");
    assert.equal(updated.content, "# Updated RFC\n");
    assert.equal(updated.path, templatePath);
    assert.equal(await readFile(updated.path, "utf8"), "# Updated RFC\n");
    assert.deepEqual(await store.get(), updated);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("rejects empty and oversized RFC templates", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-rfc-template-"));
  const store = new FileRfcTemplateStore(path.join(rootDirectory, "rfc_template.md"));

  try {
    await assert.rejects(store.update(" \n"), RfcTemplateError);
    await assert.rejects(store.update("x".repeat(MAX_RFC_TEMPLATE_LENGTH + 1)), RfcTemplateError);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
