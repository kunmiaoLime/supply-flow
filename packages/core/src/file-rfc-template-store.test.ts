import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileRfcTemplateStore,
  MAX_RFC_TEMPLATE_LENGTH,
  RfcTemplateError
} from "./file-rfc-template-store.js";

test("loads the default RFC template and persists a local update", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-rfc-template-"));
  const defaultTemplatePath = path.join(rootDirectory, "default-rfc-template.md");
  const dataDirectory = path.join(rootDirectory, "data");
  const store = new FileRfcTemplateStore(dataDirectory, defaultTemplatePath);

  try {
    await writeFile(defaultTemplatePath, "# Default RFC\n", "utf8");

    assert.deepEqual(await store.get(), {
      content: "# Default RFC\n",
      path: defaultTemplatePath
    });

    const updated = await store.update("# Local RFC\n");
    assert.equal(updated.content, "# Local RFC\n");
    assert.equal(
      updated.path,
      path.join(dataDirectory, "templates", "RFC", "rfc_template.md")
    );
    assert.equal(await readFile(updated.path, "utf8"), "# Local RFC\n");
    assert.deepEqual(await store.get(), updated);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("rejects empty and oversized RFC templates", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-rfc-template-"));
  const store = new FileRfcTemplateStore(
    path.join(rootDirectory, "data"),
    path.join(rootDirectory, "default-rfc-template.md")
  );

  try {
    await assert.rejects(store.update(" \n"), RfcTemplateError);
    await assert.rejects(store.update("x".repeat(MAX_RFC_TEMPLATE_LENGTH + 1)), RfcTemplateError);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
