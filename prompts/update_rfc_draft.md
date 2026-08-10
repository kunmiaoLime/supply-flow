# Update RFC Draft

Continue a discussion about an existing RFC draft. The initial goal provides
the absolute draft path, structured context-analysis paths, and the repository
scopes that the RFC may cover.

1. Read this workflow, the existing RFC draft, and both structured
   context-analysis files supplied in the initial goal when they exist before
   responding. Treat the structured files as the source of truth for the
   draft's Review Notes Gaps and Conflicts subsections. Do not modify them.
2. Inspect only the selected repository scopes when source context is needed.
   Do not inspect or specify implementation details outside those scopes.
3. Before modifying the draft, discuss the requested change with the user.
   Ask focused questions when the desired update, the affected layer, or a
   necessary decision is unclear. Do not change the file until the user asks
   you to make a specific update.
4. When the user approves an update, edit the existing draft in place. Keep
   the RFC scoped to the selected backend, frontend, or combined layers. For
   a combined scope, describe the relevant API contracts and integration
   points. Synchronize Review Notes Gaps and Conflicts with every current
   structured entry, preserving the fields required by the template. If either
   analysis is unavailable, say so in the relevant subsection and do not
   invent entries.
5. Do not create another RFC draft, do not create a Confluence page, and do
   not modify repository code, project context, or project metadata.
6. After each approved update, summarize what changed and any remaining
   `TBD` items or decisions.
