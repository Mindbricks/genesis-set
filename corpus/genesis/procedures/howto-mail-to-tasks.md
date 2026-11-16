# Genesis additions: How-to: incoming mail opens tasks and meetings, answered from the owner's mailbox

These notes add to the mind-set procedure `procedures/howto-mail-to-tasks.md` (installed at
`~/.mind-set/current/procedures/howto-mail-to-tasks.md`). Follow that procedure; at each place below,
do what this file says. They hold what is true of the Genesis compiler and the code it
generates, and the Genesis Compiler API steps.

## 1. In "4. Who is admitted (do not fight it, design with it)"

Instead of the mind-set step that starts "## 5. Validate the blueprint 1. `mind-set validate blueprint.json` is ...":

#### 5. Verify the running service

1. Compile; the Genesis Compiler API's validation is green (the template
   has no address and its own listen topic; every mail action on it
   carries `mailbox`).
2. As a user, connect a mailbox: `GET /my-mailboxes` lists `workMail`
   with `connect: oauth`; the consent lands back with `?mailbox=<address>`.
3. `GET /health/details` (operator) on the mcpbff shows the
   `connectedMailboxes` block with `listening: 1`.
4. Send a mail to that address. Within the poll interval the Kafka api
   runs: a `task` / `meeting` row stamped with the owner, and, when
   `acknowledge` fired, a reply in the sender's inbox FROM the owner's
   address, threaded.
5. Negative: call `POST /mail/workMail/read` with another user's session
   and the first user's address: `404 MAILBOX_NOT_FOUND`.
