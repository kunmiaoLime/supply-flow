# Import Supply Flow Project

Import a Supply Flow project archive into the current destination project. The
archive may come from an older or newer version of Supply Flow, so perform a
schema-aware migration rather than copying files wholesale.

## Paths

- Supply Flow application root: <SUPPLY_FLOW_ROOT>
- ZIP archive: <IMPORT_ARCHIVE_PATH>
- Import staging directory: <IMPORT_DIRECTORY>
- Expected archive root directory: <SOURCE_ROOT_DIRECTORY>
- Import mode: <IMPORT_MODE>
- Destination project directory: <PROJECT_DIRECTORY>
- Destination project id: <PROJECT_ID>
- Destination project name: <PROJECT_NAME>

## Required outcome

1. Inspect the current file-store schemas and migration behavior under
   `packages/core/src/` before changing the destination.
2. Re-list the ZIP entries before extraction. Reject absolute paths, `..`
   traversal, or any unexpected top-level layout. Extract only beneath
   `<IMPORT_DIRECTORY>/extracted`.
3. Migrate all usable project data into `<PROJECT_DIRECTORY>`, including
   project metadata, context, context gaps/conflicts, tracked branches, pull
   requests, review artifacts, and session history when compatible.
4. The destination project's `project_id` and `project_name` must remain the
   values shown above. A collision-safe destination may differ from the
   archived project id.
5. Preserve this active import session. Do not overwrite or remove its entry
   in `sessions.json` or its directory beneath `sessions/`. Merge imported
   session data only when identifiers do not conflict.
6. Validate imported JSON against the current schemas. Do not discard fields
   or artifacts that a newer archive format introduces: retain unsupported
   data beneath `<PROJECT_DIRECTORY>/legacy-import/` and explain it to the
   user.
7. Do not modify Supply Flow source code, the source archive, or unrelated
   project directories.

## Import mode

Follow the mode named above exactly:

- `separate`: Build a new destination project from the archive. The destination
  metadata values are authoritative, because its id may have been changed to
  avoid a local collision.
- `replace`: Treat the archive as authoritative for the destination project's
  importable data. Replace known project artifacts with their migrated archive
  equivalents, but preserve this active import session and unsupported local
  data under `legacy-import/replaced-local/`.
- `merge`: Compare the archive with the existing destination project. Apply
  only additions and non-conflicting updates. Do not overwrite a conflicting
  existing value until the user decides.

For `merge`, write every unresolved conflict to
`<PROJECT_DIRECTORY>/import_conflicts.json`. Always write valid JSON with no
Markdown fences or comments, using this exact structure:

```json
{
  "schemaVersion": 1,
  "conflicts": [
    {
      "id": "import-conflict-kebab-case-id",
      "title": "Short conflict title",
      "severity": "high",
      "path": "project-relative/path.json",
      "description": "Why the existing and imported values cannot both be kept",
      "existing": {
        "reference": "destination project-relative/path.json",
        "detail": "Existing value or concise summary"
      },
      "imported": {
        "reference": "archive project-relative/path.json",
        "detail": "Imported value or concise summary"
      },
      "resolution_options": [
        "Keep the existing value",
        "Use the imported value"
      ]
    }
  ]
}
```

When merge conflicts exist, list their IDs in the terminal and wait for the
user to choose a resolution. Do not silently decide or apply a conflicting
change. When no merge conflicts remain, write the same file with an empty
`conflicts` array. Complete non-conflicting work before asking the user.
