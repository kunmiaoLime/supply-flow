import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileProjectStore } from "./file-project-store.js";
import {
  createProjectId,
  ProjectRfcDraftPathSchema
} from "./project.js";

test("stores project records beneath the local projects directory", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);

  try {
    await store.create({
      project_name: "First project",
      project_id: "first-project",
      repos: [],
      documents: [],
      tasks: []
    });
    await store.create({
      project_name: "Second project",
      project_id: "second-project",
      repos: [],
      documents: [],
      tasks: []
    });

    const repository = {
      name: "Web application",
      remote: "git@github.com:lime/supply-flow.git",
      local: "/Users/example/code/supply-flow"
    };
    const document = {
      type: "figma" as const,
      link: "https://www.figma.com/design/documents",
      title: "Validated rides design"
    };
    const task = {
      title: "Implement project context",
      jira_ticket: "https://limebike.atlassian.net/browse/SUP-123"
    };
    const updated = await store.update("first-project", {
      repos: [repository],
      documents: [document],
      tasks: [task]
    });

    assert.deepEqual(updated.repos, [repository]);
    assert.deepEqual(updated.documents, [document]);
    assert.deepEqual(updated.tasks, [task]);
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
        project_id: "first-project",
        repos: [repository],
        documents: [document],
        tasks: [task]
      }
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(rootDirectory, "projects", "second-project", "sessions.json"),
          "utf8"
        )
      ),
      {
        schemaVersion: 1,
        sessions: []
      }
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(rootDirectory, "projects", "second-project", "branches.json"),
          "utf8"
        )
      ),
      {
        schemaVersion: 1,
        branches: []
      }
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(rootDirectory, "projects", "second-project", "prs.json"),
          "utf8"
        )
      ),
      {
        schemaVersion: 1,
        prs: []
      }
    );
    assert.deepEqual(
      (await store.list()).map((project) => project.project_id),
      ["first-project", "second-project"]
    );
    await assert.rejects(
      store.create({
        project_name: "Duplicate project",
        project_id: "first-project",
        repos: [],
        documents: [],
        tasks: []
      }),
      /already exists/
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("migrates legacy requirement sources to documents", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);
  const document = {
    type: "slack" as const,
    link: "https://lime.enterprise.slack.com/archives/C0123456789"
  };
  const projectPath = path.join(
    rootDirectory,
    "projects",
    "legacy-project",
    "project.json"
  );

  try {
    await mkdir(path.dirname(projectPath), { recursive: true });
    await writeFile(
      projectPath,
      `${JSON.stringify(
        {
          project_name: "Legacy project",
          project_id: "legacy-project",
          repos: [],
          requirements: [document]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    assert.deepEqual((await store.get("legacy-project"))?.documents, [
      { ...document, title: null }
    ]);
    assert.deepEqual((await store.get("legacy-project"))?.tasks, []);
    assert.deepEqual(JSON.parse(await readFile(projectPath, "utf8")), {
      project_name: "Legacy project",
      project_id: "legacy-project",
      repos: [],
      documents: [{ ...document, title: null }],
      tasks: []
    });
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("assigns only missing document titles", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);
  const document = {
    type: "confluence" as const,
    link: "https://limebike.atlassian.net/wiki/spaces/DOC/pages/12345",
    title: null
  };

  try {
    await store.create({
      project_name: "Document titles",
      project_id: "document-titles",
      repos: [],
      documents: [document],
      tasks: []
    });

    const assigned = await store.assignMissingDocumentTitle(
      "document-titles",
      document,
      "Validated Test Ride RFC"
    );
    assert.equal(assigned.assigned, true);
    assert.equal(assigned.project.documents[0]?.title, "Validated Test Ride RFC");

    const retained = await store.assignMissingDocumentTitle(
      "document-titles",
      document,
      "Replacement title"
    );
    assert.equal(retained.assigned, false);
    assert.equal(retained.project.documents[0]?.title, "Validated Test Ride RFC");
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("persists project-local Markdown document sources", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);
  const markdownDocument = {
    type: "markdown" as const,
    link: "markdowns/validated-test-ride.md",
    title: "Validated test ride notes"
  };

  try {
    await store.create({
      project_name: "Local Markdown",
      project_id: "local-markdown",
      repos: [],
      documents: [markdownDocument],
      tasks: []
    });

    assert.deepEqual((await store.get("local-markdown"))?.documents, [markdownDocument]);
    await assert.rejects(
      store.update("local-markdown", {
        documents: [
          {
            type: "markdown",
            link: "../validated-test-ride.md",
            title: null
          }
        ]
      }),
      /Markdown documents must reference/
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("persists project-local RFC drafts", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);
  const rfcDraft = {
    type: "rfc-draft" as const,
    link: "rfcs/validated-test-ride.md",
    title: "Validated Test Ride",
    rfc_session_id: "session_writer",
    repository_locals: ["/tmp/supply-api", "/tmp/supply-web"]
  };

  try {
    await store.create({
      project_name: "RFC drafts",
      project_id: "rfc-drafts",
      repos: [],
      documents: [rfcDraft],
      tasks: []
    });

    assert.deepEqual((await store.get("rfc-drafts"))?.documents, [rfcDraft]);
    assert.equal(
      ProjectRfcDraftPathSchema.parse("rfcs/validated-test-ride.md"),
      "rfcs/validated-test-ride.md"
    );
    await assert.rejects(
      store.update("rfc-drafts", {
        documents: [
          {
            type: "rfc-draft",
            link: "markdowns/validated-test-ride.md",
            title: "Validated Test Ride"
          }
        ]
      }),
      /RFC drafts must reference/
    );
    await assert.rejects(
      store.update("rfc-drafts", {
        documents: [
          {
            type: "rfc-draft",
            link: "rfcs/validated-test-ride.md",
            title: "Validated Test Ride",
            rfc_session_id: "session_writer",
            repository_locals: ["/tmp/supply-api", "/tmp/supply-api"]
          }
        ]
      }),
      /repository scopes must be unique/
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

test("removes a complete project directory", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-projects-"));
  const store = new FileProjectStore(rootDirectory);
  const projectDirectory = path.join(rootDirectory, "projects", "removable-project");

  try {
    await store.create({
      project_name: "Removable project",
      project_id: "removable-project",
      repos: [],
      documents: [],
      tasks: []
    });
    await writeFile(path.join(projectDirectory, "context.md"), "# Temporary context\n", "utf8");

    assert.equal(await store.remove("removable-project"), true);
    assert.equal(await store.get("removable-project"), null);
    await assert.rejects(readFile(path.join(projectDirectory, "context.md"), "utf8"), /ENOENT/);
    assert.equal(await store.remove("removable-project"), false);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
