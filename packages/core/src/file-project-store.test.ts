import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileProjectStore } from "./file-project-store.js";
import { createProjectId } from "./project.js";

test("stores project records beneath the local projects directory", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);

  try {
    await store.create({
      project_name: "First project",
      project_id: "first-project"
    });
    await store.create({
      project_name: "Second project",
      project_id: "second-project"
    });

    assert.equal((await store.get("first-project"))?.project_name, "First project");
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(rootDirectory, "projects", "first-project", "project.json"),
          "utf8"
        )
      ),
      {
        project_name: "First project",
        project_id: "first-project"
      }
    );
    assert.deepEqual(
      (await store.list()).map((project) => project.project_id),
      ["first-project", "second-project"]
    );
    await assert.rejects(
      store.create({
        project_name: "Duplicate project",
        project_id: "first-project"
      }),
      /already exists/
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("normalizes project names into collision-safe directory ids", () => {
  assert.equal(createProjectId("Customer ACME Sync", []), "customer-acme-sync");
  assert.equal(
    createProjectId("Customer ACME Sync", ["customer-acme-sync"]),
    "customer-acme-sync-2"
  );
  assert.equal(createProjectId("Café & tea", []), "cafe-and-tea");
});
