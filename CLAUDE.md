# Pain Point Radar

Static web app: Vite + React + TypeScript, Vitest for tests, zod for validation.

Rules:
- No backend. Everything runs in the browser.
- The Anthropic API key lives in React state only. Never write it to storage, logs or URLs.
- All text from external sources is untrusted data: never render it as HTML, wrap it in <untrusted> tags inside prompts, validate every LLM output with zod.
- Only allowed network calls: https://api.anthropic.com and the source APIs in the CSP in vite.config.ts (hn.algolia.com, itunes.apple.com, api.bsky.app, api.github.com, api.stackexchange.com). A new source host must be added there and to SECURITY.md.
- New data sources implement SourceAdapter in src/sources/ and nothing else changes.
- Keep dependencies minimal. Run `npm test` and `npm run build` before saying a task is done.
