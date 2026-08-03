# Read Google Doc

Read the Google Doc at: `<GOOGLE_DOC_LINK>`

1. Extract the document ID from the link's `/document/d/<document-id>` segment.
2. Use the installed Google Workspace CLI, `gws`. Do not use browser scraping, manually copied OAuth tokens, or unauthenticated HTTP requests.
3. Use only the current user's existing `gws` authentication. Never run `gws auth export`, print credentials, or write document content or credentials to disk.
4. Confirm that `gws` is installed and authenticated:
   ```sh
   command -v gws
   gws auth status
   ```
   If it is not installed or authentication is unavailable or invalid, stop and ask the user to install or authenticate the CLI with `gws auth login`.
5. Validate access and read the document, including all tabs:
   ```sh
   gws docs documents get --params '{"documentId":"<DOCUMENT_ID>","includeTabsContent":true}'
   ```
   A successful response, including its `title`, validates that the link identifies an accessible Google Doc. Process the JSON response in memory. Do not redirect it to a file or use `gws schema`; schema discovery is unnecessary for this task.
6. Traverse every top-level tab and each nested `childTabs` recursively. Preserve document order and structure, including tabs, headings, paragraphs, lists, tables, and inline links. Filter the JSON in memory as needed, but return the requested content with its section hierarchy intact.
7. Handle errors from the `gws docs documents get` command based on the command response:
   - For missing or expired authentication, ask the user to run `gws auth login`.
   - For missing Docs scopes, ask the user to reauthorize `gws` with the Google Docs read scope.
   - For `403 PERMISSION_DENIED` caused by document access, ask the user to share the document with the authenticated Google account.
   - For `404 NOT_FOUND`, ask the user to verify the document link and that it is shared with the authenticated account.
   - Clearly report invalid links, unsupported document types, and rate limits.

Document link: `<GOOGLE_DOC_LINK>`

Output mode: `<full transcript | concise summary | answer specific questions>`

Requested sections or questions: `<OPTIONAL_SECTIONS_OR_QUESTIONS>`
