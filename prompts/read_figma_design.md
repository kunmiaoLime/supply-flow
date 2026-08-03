# Read Figma Design

Read the Figma design at: `<FIGMA_DESIGN_LINK>`

1. Validate that the link is a Figma design URL in the form `https://www.figma.com/design/<FILE_KEY>/...`. Extract the file key and the `node-id` query parameter.
2. Convert the node ID from URL form to Figma API form by replacing `-` with `:`. For example, `node-id=32-17493` becomes `32:17493`.
3. If the link has no `node-id`, use the authenticated Figma integration to list the file's top-level pages, then ask the user which page or node to read. Do not guess a node.
4. Use the authenticated Figma integration. Do not scrape the Figma website, rely on public exports, or use unauthenticated HTTP requests. Treat this as a read-only task: do not modify the Figma file.
5. Read the selected node's structure and text content with the Figma metadata tool using the extracted file key and node ID. Identify the node name, frame hierarchy, screen states, components, visible labels, decision points, and connections.
6. If the metadata response is truncated, too large, or does not resolve the content needed from component instances, read the relevant child frames separately using their returned node IDs. Do not assume omitted text or screens are absent.
7. When visual fidelity, layout, images, styles, or detailed component content is needed, load the Figma design-to-code guidance required by the integration before requesting design context for the same file key and node ID. Use any returned screenshot and context only to interpret the design; do not generate or modify the design.
8. Preserve the design's hierarchy and flow. For user journeys, describe screens and decision branches in their visual order. For repeated components, describe the shared pattern once and note the variants.
9. Return the requested content with the file key, node ID, node name, and a clear summary of the relevant screens, UI states, copy, and interactions.
10. Handle errors based on the integration response:
   - For an invalid or unsupported Figma URL, ask the user for a valid Figma design link.
   - For missing `node-id`, list available pages before requesting a specific node or page.
   - For access or permission failures, ask the user to grant the authenticated Figma account access to the file.
   - Clearly report unavailable integration tools, invalid node IDs, and rate limits.

Figma design link: `<FIGMA_DESIGN_LINK>`

Output mode: `<full design inventory | concise summary | answer specific questions>`

Requested screens, states, or questions: `<OPTIONAL_SCREENS_STATES_OR_QUESTIONS>`
