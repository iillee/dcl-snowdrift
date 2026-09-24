Decentraland SDK skills for Cursor and other agents live in `.agents/skills/`.

Install or refresh them (always use `add`, not `update`):

```bash
npx skills add decentraland/sdk-skills --all
```

Entry skill: `sdk-scenes`. Project coding conventions: `AGENTS.md`. Extra reference context: `dclcontext/`.

When the scene is open in Creator Hub, paste the MCP snippet from **Settings → Experimental → Expose AI assistant MCP server** into `.cursor/mcp.json` (URL and token change each app launch; do not commit tokens).

For in-world verification, launch with `npm run start -- --mcp` and use the `explorer` server in `.cursor/mcp.json` (see `unity-explorer-mcp` skill).
