import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileBranchStore } from "./file-branch-store.js";

test("tracks branches by repository path in branches.json", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-branches-"));
  const store = new FileBranchStore(rootDirectory);
  const master = {
    name: "master",
    repository_local: "/Users/example/code/ios/Apps/Supply"
  };
  const feature = {
    name: "kun/SXP-123-ride-validation",
    repository_local: "/Users/example/code/ios/Apps/Supply"
  };

  try {
    assert.deepEqual(await store.initialize(), []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: []
      }
    );
    await store.add(feature);
    const added = await store.add(master);

    assert.deepEqual(await store.list(), [feature, master]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(rootDirectory, "branches.json"), "utf8")),
      {
        schemaVersion: 1,
        branches: [feature, master]
      }
    );
    assert.deepEqual(await store.ensure(master), { branch: master, created: false });
    assert.deepEqual(await store.ensure({
      name: "main",
      repository_local: "/Users/example/code/limebike-web"
    }), {
      branch: {
        name: "main",
        repository_local: "/Users/example/code/limebike-web"
      },
      created: true
    });

    const renamed = {
      name: "kun/SXP-123-validated-ride",
      repository_local: master.repository_local
    };
    assert.deepEqual(await store.update(feature, renamed), renamed);
    assert.equal(await store.remove(master), true);
    assert.equal(await store.remove(master), false);
    assert.deepEqual(await store.list(), [
      renamed,
      {
        name: "main",
        repository_local: "/Users/example/code/limebike-web"
      }
    ]);
    await assert.rejects(store.add(renamed), /already tracked/);
    assert.deepEqual(added, master);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
