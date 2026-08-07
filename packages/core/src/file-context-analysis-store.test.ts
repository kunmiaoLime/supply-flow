import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONTEXT_CONFLICTS_FILE,
  CONTEXT_GAPS_FILE,
  ContextAnalysisError,
  FileContextAnalysisStore
} from "./file-context-analysis-store.js";
import {
  FileImportConflictStore,
  IMPORT_CONFLICTS_FILE
} from "./file-import-conflict-store.js";

test("loads structured project context gaps and conflicts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-context-analysis-"));

  try {
    await writeFile(
      path.join(directory, CONTEXT_GAPS_FILE),
      JSON.stringify({
        schemaVersion: 1,
        gaps: [
          {
            id: "gap-ride-completion-rule",
            title: "Ride completion rule is undefined",
            severity: "blocking",
            description: "The documents do not define the rider state that completes a validated ride.",
            impact: "The implementation cannot determine when to issue credit.",
            questions: ["Which terminal rider states complete a validated ride?"],
            sources: [
              {
                reference: "https://example.com/spec",
                detail: "The ride flow omits the completion state."
              }
            ]
          }
        ]
      }),
      "utf8"
    );
    await writeFile(
      path.join(directory, CONTEXT_CONFLICTS_FILE),
      JSON.stringify({
        schemaVersion: 1,
        conflicts: [
          {
            id: "conflict-credit-timing",
            title: "Credit timing conflicts",
            severity: "high",
            description: "Two sources require incompatible times to grant credit.",
            impact: "Only one timing rule can be implemented.",
            sources: [
              {
                reference: "https://example.com/product",
                detail: "Grant credit when the ride starts."
              },
              {
                reference: "https://example.com/design",
                detail: "Grant credit after the ride ends."
              }
            ],
            resolution_options: [
              "Confirm whether credit is granted at ride start or ride completion."
            ]
          }
        ]
      }),
      "utf8"
    );

    assert.deepEqual(await new FileContextAnalysisStore(directory).get(), {
      gaps: [
        {
          id: "gap-ride-completion-rule",
          title: "Ride completion rule is undefined",
          severity: "blocking",
          description: "The documents do not define the rider state that completes a validated ride.",
          impact: "The implementation cannot determine when to issue credit.",
          questions: ["Which terminal rider states complete a validated ride?"],
          sources: [
            {
              reference: "https://example.com/spec",
              detail: "The ride flow omits the completion state."
            }
          ]
        }
      ],
      conflicts: [
        {
          id: "conflict-credit-timing",
          title: "Credit timing conflicts",
          severity: "high",
          description: "Two sources require incompatible times to grant credit.",
          impact: "Only one timing rule can be implemented.",
          sources: [
            {
              reference: "https://example.com/product",
              detail: "Grant credit when the ride starts."
            },
            {
              reference: "https://example.com/design",
              detail: "Grant credit after the ride ends."
            }
          ],
          resolution_options: [
            "Confirm whether credit is granted at ride start or ride completion."
          ]
        }
      ]
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("returns null when a project has not been analyzed yet", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-context-analysis-"));

  try {
    assert.equal(await new FileContextAnalysisStore(directory).get(), null);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects a partial context analysis", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-context-analysis-"));

  try {
    await writeFile(
      path.join(directory, CONTEXT_GAPS_FILE),
      JSON.stringify({ schemaVersion: 1, gaps: [] }),
      "utf8"
    );

    await assert.rejects(
      new FileContextAnalysisStore(directory).get(),
      ContextAnalysisError
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("loads structured project import conflicts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "supply-flow-import-conflicts-"));

  try {
    await writeFile(
      path.join(directory, IMPORT_CONFLICTS_FILE),
      JSON.stringify({
        schemaVersion: 1,
        conflicts: [
          {
            id: "import-conflict-project-title",
            title: "Project title differs",
            severity: "medium",
            path: "project.json",
            description: "The imported title differs from the current project title.",
            existing: {
              reference: "project.json",
              detail: "Existing title: Supply Flow"
            },
            imported: {
              reference: "archive/project.json",
              detail: "Imported title: Supply Flow Desktop"
            },
            resolution_options: ["Keep the current title", "Use the imported title"]
          }
        ]
      }),
      "utf8"
    );

    const conflicts = await new FileImportConflictStore(directory).get();
    assert.equal(conflicts?.length, 1);
    assert.equal(conflicts?.[0]?.id, "import-conflict-project-title");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
