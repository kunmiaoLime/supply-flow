# Read Slack Channel

Read the Slack channel at: `<SLACK_CHANNEL_LINK>`

1. Extract the channel ID from the link's `/archives/<channel-id>` segment.
2. Use the available Slack credential in memory only. Never print, log, or expose it.
3. Before reading messages, validate that the Slack bot has access to the channel with `conversations.info` or a `conversations.history` request limited to one message.
4. If Slack reports `not_in_channel` or `is_member: false`, stop and ask the user to invite the Slack bot to the channel before continuing.
5. Read channel messages through Slack's `conversations.history` API, following cursor pagination as needed.
6. For messages with replies, retrieve the thread with `conversations.replies`.
7. Resolve sender IDs to names with `users.info` when access permits.
8. Read the most recent `<MESSAGE_LIMIT>` messages, or messages from `<DATE_RANGE>` when provided.
9. Return the results in chronological order with timestamp, sender, message text, and replies grouped beneath their root message.
10. Clearly report other access failures such as `missing_scope`, invalid channel links, or rate limits.

Channel link: `<SLACK_CHANNEL_LINK>`

Message limit: `<MESSAGE_LIMIT, e.g. 100>`

Date range: `<OPTIONAL_DATE_RANGE>`

Output mode: `<full transcript | concise summary | answer specific questions>`
