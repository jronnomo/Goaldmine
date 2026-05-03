# Workout Planner

Personal Next.js workout tracker that exposes an MCP server so Claude (via claude.ai) can act as the coach. No Anthropic API key required — coaching runs against the user's Claude Code Max subscription via claude.ai's MCP connector support.

See `CLAUDE.md` for architecture and conventions.

## Setup

```bash
npm install
cp .env.example .env.local
# fill DATABASE_URL (Neon free tier or local Postgres) and MCP_AUTH_TOKEN

npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed

npm run dev
```

App runs at http://localhost:3000. MCP endpoint will be at `/api/mcp` (Phase 3).
