# Notify When Complete

The user has requested one Slack direct message when the work already in
progress in this session reaches a terminal state.

Do not send a notification now. Continue the current work normally and do not
change its scope or stop early. When the work reaches a terminal state, send
exactly one concise notification using the installed `slackme` command with
the `-q` option:

- Completed: `slackme -q -e white_check_mark -t "Task complete" "<task and verified outcome>"`
- Blocked on a user decision: `slackme -q -e warning -t "Task needs decision" "<decision needed>"`
- Stopped by the user or an unrecoverable error: `slackme -q -e x -t "Task stopped" "<concrete cause>"`

Do not include credentials, access tokens, or sensitive command output in the
message. If `slackme` fails, report that failure in the normal final response.
