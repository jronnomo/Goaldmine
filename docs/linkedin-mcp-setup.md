# LinkedIn MCP setup (optional, Claude Desktop only)

This is the setup + ToS guide for pairing Goaldmine with the third-party
**linkedin-mcp-server**, for users running a career/job-hunt/networking goal
who want their Claude Desktop coach to have live LinkedIn context. It's
entirely optional — Goaldmine's career goal support works fine without it
(you just tell your coach your numbers and it logs them).

## 1. What this is

[`linkedin-mcp-server`](https://github.com/stickerdaniel/linkedin-mcp-server)
is a third-party, local **stdio MCP server** that gives Claude Desktop tools
to read your LinkedIn profile, job postings, companies, and inbox, using your
own logged-in LinkedIn session. It installs into Claude Desktop, not into
claude.ai web or Goaldmine.

Division of responsibility: **Goaldmine never connects to LinkedIn.** This
server runs locally, on your machine, inside your own Claude Desktop app.
Goaldmine's code has zero LinkedIn imports, zero LinkedIn API calls, and
never sees your LinkedIn session.

## 2. Warning — read this first

> LinkedIn's User Agreement prohibits automated access, and accounts using
> automated tools can be restricted or banned. Use at your own risk; there is
> no guarantee of account safety.

This project is not affiliated with Goaldmine or Anthropic. It is third-party
code — review it yourself before trusting it with your LinkedIn session.

## 3. Prerequisites

- Claude Desktop installed.
- A Goaldmine career goal (optional but recommended) — create one with
  `create_goal(kind='project', template='career')` from any Goaldmine chat.

## 4. Install

**Primary path**: download the `.mcpb` bundle from the project's
[GitHub releases page](https://github.com/stickerdaniel/linkedin-mcp-server/releases)
and double-click it to install into Claude Desktop.

**Advanced path**: manual stdio configuration via `uvx`, for users who want to
run it outside the packaged bundle. See the project's own README for the
exact command — it changes independently of Goaldmine, so this doc doesn't
pin a copy of it.

## 5. Auth model

You sign in with your own LinkedIn session. Credentials and cookies stay on
your machine, inside Claude Desktop's local process. Goaldmine never sees
them, never stores them, and never requests them.

## 6. What your coach will and won't do

With the LinkedIn tools present, your coach **may read** job postings,
profiles, companies, and your inbox to inform coaching — for example, to help
you tailor an application or spot a promising opening.

Your coach will **never send** messages, connection requests, or
applications without your explicit per-action confirmation. Reading is
passive; any write to LinkedIn is propose-first, one action at a time — never
batched, never silent.

## 7. Desktop-only

On claude.ai web or mobile, these tools don't exist — there's no LinkedIn MCP
server running there. Your coach falls back to asking for your numbers
directly (applications sent, interviews, outreach messages, coffee chats,
connections) and logging them via `log_metric`, same as any other career-goal
session.

## 8. Uninstall / revoke

Remove the extension from Claude Desktop's extensions list to uninstall it.
If the tool offers its own sign-out flow, use it to end the LinkedIn session;
otherwise your normal LinkedIn session/cookie management applies (e.g.
signing out of LinkedIn in your browser, revoking active sessions from
LinkedIn's own account settings).

## 9. Troubleshooting

- **Tools not appearing in a Desktop chat** — restart Claude Desktop and
  start a new chat; MCP servers re-handshake on a fresh session.
- **Session expired** — re-login inside the LinkedIn tool's own flow (it
  should prompt you).
- **Using Goaldmine and LinkedIn tools in the same chat** — no conflict.
  They're separate MCP servers; just have both installed in Claude Desktop
  and Claude will call whichever tool fits the request.
