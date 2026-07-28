# House of Figs MCP Server

A local (stdio) MCP server that lets an AI agent work with the House of Figs
Firestore data: quiz leads, intakes, assessments, 30-day plans, Going Deeper
responses, lead metadata, blog posts, and testimonials.

## Tools

Read tools (always available):

| Tool | What it does |
|---|---|
| `list_collections` | List the exposed collections with descriptions |
| `query_documents` | Filter/sort/limit any collection |
| `get_document` | Fetch one document by id |
| `search_by_email` | Find a person's quiz sessions and intakes by email |
| `get_client_journey` | Everything for one client: intake + assessment + plan + Going Deeper + lead meta |
| `pipeline_summary` | Counts by stage/status across the funnel |

Write tools (`update_document`, `create_document`) only appear when the server
is started with `HOF_MCP_ALLOW_WRITES=true`. **Leave writes off unless you mean
it** — writes to `intakes`, `quizzes`, `assessments`, or `plans` can fire the
Cloud Function triggers in `../functions`, which send real email to admins and
clients.

## Credentials

The server uses the Firebase Admin SDK, which needs a service account:

1. Firebase Console → Project settings → Service accounts → **Generate new
   private key** (project `houseoffigs-16f71`).
2. Save the JSON somewhere private, e.g. `~/.keys/houseoffigs-admin.json`
   (never commit it).
3. Point `GOOGLE_APPLICATION_CREDENTIALS` at it (see config below).

## Connecting from Hermes Agent

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  house_of_figs:
    command: "node"
    args: ["/Users/emilybelt/Website Test/House of Figs/mcp-server/index.js"]
    env:
      GOOGLE_APPLICATION_CREDENTIALS: "/Users/emilybelt/.keys/houseoffigs-admin.json"
      # HOF_MCP_ALLOW_WRITES: "true"   # uncomment to enable write tools
```

## Connecting from Claude Code

```bash
claude mcp add house-of-figs --env GOOGLE_APPLICATION_CREDENTIALS="$HOME/.keys/houseoffigs-admin.json" -- node "/Users/emilybelt/Website Test/House of Figs/mcp-server/index.js"
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | (ADC) | Path to the service-account JSON |
| `HOF_FIREBASE_PROJECT` | `houseoffigs-16f71` | Firebase project id |
| `HOF_MCP_ALLOW_WRITES` | unset | `true` enables the write tools |
