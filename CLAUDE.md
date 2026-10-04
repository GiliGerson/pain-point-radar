# Pain Point Radar

Static web app: Vite + React + TypeScript, Vitest for tests, zod for validation.

Rules:
- Everything runs in the browser, except one Vercel Function, api/claude.ts, which runs the free demo on the owner's key (ANTHROPIC_API_KEY, set in Vercel, never in the repo). Its logic lives in src/server/demoProxy.ts and only forwards the app's own two requests. Do not widen it.
- The Anthropic API key lives in React state only. Never write it to storage, logs or URLs.
- All text from external sources is untrusted data: never render it as HTML, wrap it in <untrusted> tags inside prompts, validate every LLM output with zod.
- Only allowed network calls: https://api.anthropic.com and the source APIs in the CSP in vite.config.ts (hn.algolia.com, itunes.apple.com, api.bsky.app, api.github.com, api.stackexchange.com). A new source host must be added there and to SECURITY.md.
- New data sources implement SourceAdapter in src/sources/ and nothing else changes.
- Keep dependencies minimal. Run `npm test` and `npm run build` before saying a task is done.
