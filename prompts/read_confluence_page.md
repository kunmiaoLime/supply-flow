# Read Confluence Page

Read the Confluence page at: `<CONFLUENCE_PAGE_LINK>`

1. Validate that the link is a Confluence Cloud page URL. Extract its base URL (for example, `https://<SITE>.atlassian.net/wiki`) and page ID from the `/pages/<PAGE_ID>` path segment.
2. Use the Confluence API credentials stored in the macOS Keychain. Retrieve them only into shell variables:
   ```sh
   confluence_api_email="$(security find-generic-password -s confluence-api-email -w)"
   confluence_api_token="$(security find-generic-password -s confluence-api-token -w)"
   ```
   Never print, log, export, or write either credential to disk.
3. Retrieve the page's metadata and storage-format body through the Confluence REST API:
   ```sh
   curl --silent --show-error --fail-with-body \
     --user "$confluence_api_email:$confluence_api_token" \
     --header 'Accept: application/json' \
     '<CONFLUENCE_BASE_URL>/api/v2/pages/<PAGE_ID>?body-format=storage'
   ```
   Keep the response in memory. Do not use unauthenticated browser requests or redirect the response to a file.
4. Confirm that the response identifies the requested page. Use its `title`, `status`, version metadata, and `body.storage.value`.
5. Convert the storage-format XHTML into readable structured content with a structured XHTML or HTML parser. Do not parse markup with regular expressions. Preserve document order and hierarchy, including headings, paragraphs, lists, tables, code blocks, links, attachments, and Confluence macros. For `code` macros, extract the language and plain-text body. For link or Google Drive macros, extract their labels and URLs. For image or attachment macros, retain the attachment name. For other embedded resources that cannot be read, retain their labels, URLs, macro names, and textual parameters.
6. Return the requested content with its section hierarchy intact. Do not expose credentials, raw authorization headers, or other sensitive authentication details.
7. Handle errors based on the command response:
   - If either Keychain entry is unavailable, stop and ask the user to restore `confluence-api-email` and `confluence-api-token` access in the macOS Keychain.
   - For `401 Unauthorized`, ask the user to restore or renew the Confluence API credentials.
   - For `403 Forbidden`, ask the user to grant the authenticated Confluence account access to the page.
   - For `404 Not Found`, ask the user to verify the page link and that the authenticated account can access it.
   - Clearly report malformed links, unsupported Confluence URL formats, API errors, and rate limits.

Page link: `<CONFLUENCE_PAGE_LINK>`

Output mode: `<full transcript | concise summary | answer specific questions>`

Requested sections or questions: `<OPTIONAL_SECTIONS_OR_QUESTIONS>`
