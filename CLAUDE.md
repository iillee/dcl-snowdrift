Decentraland SDK skills for Cursor and other agents live in `.agents/skills/`.

Install or refresh them (always use `add`, not `update`). `.agents/` is git-ignored, so a fresh clone does not have the skills until you run this:

```bash
npx skills add decentraland/sdk-skills --all
```

Entry skill: `sdk-scenes`. Project coding conventions: `AGENTS.md`.

When the scene is open in Creator Hub, paste the MCP snippet from **Settings → Experimental → Expose AI assistant MCP server** into `.cursor/mcp.json` (URL and token change each app launch; do not commit tokens).

For in-world verification, launch with `npm run start -- --mcp` and use the `explorer` server in `.cursor/mcp.json` (see `unity-explorer-mcp` skill).

Project state: current handoff (what the build does, constants, files, debug flags, checks, known issues) is `docs/HANDOFF.md`; the repo overview is `README.md`. Logic checks run headless with `node scripts/<name>.mjs`. Never hand-edit `scene.json`, `assets/scene/main.composite` or `main.crdt` (Creator Hub owns them). All `src/client/devFlags.ts` toggles must be `false` in a deploy build.