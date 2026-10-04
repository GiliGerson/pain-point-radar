# Security

Pain Point Radar is a static site with no backend. Users paste their own Anthropic API key, and the app processes text written by strangers on the internet. This document lists what could go wrong and what the app does about it.

## Threat model

| Risk | Mitigation |
| --- | --- |
| API key leaks | The key is held in React state only. It is never written to localStorage, cookies, URLs or logs, and is gone when the tab closes. A "Forget key" button clears it immediately. |
| Data sent to third parties | A production Content-Security-Policy limits `connect-src` to `'self'`, `https://api.anthropic.com` and the five public source APIs: `hn.algolia.com`, `itunes.apple.com`, `api.bsky.app`, `api.github.com` and `api.stackexchange.com`. Only the search topic is sent to the source APIs, never the key. There is no analytics, and fonts are bundled rather than loaded from a CDN. |
| Prompt injection from posts | Post text is wrapped in `<untrusted>` tags and the system prompt tells the model to treat it strictly as data. The model's output is validated against a zod schema, and it can only influence theme wording and severity, never links or counts. |
| Invented quotes | Every quote is checked against the source item's text before it can appear in a report. |
| XSS from external content | All external text is rendered by React as text, never as HTML. Only `https` links are rendered, and they open with `rel="noopener noreferrer nofollow"`. Markdown export escapes Markdown syntax in external text. |
| Surprise bills | The app shows the number of posts and an estimated cost before any API call and waits for the user to confirm. Posts per run are capped at 500. |
| Clickjacking | `X-Frame-Options: DENY` is set by the hosting config (`vercel.json`). |
| Vulnerable dependencies | Few runtime dependencies (React, zod, bundled fonts). CI runs `npm audit` and Dependabot opens update PRs weekly. |
| Secrets committed to the repo | `.env` files are git-ignored. GitHub secret scanning and push protection should be enabled on the repository. |

## Known limitations

- Calling the Anthropic API from a browser requires the `anthropic-dangerous-direct-browser-access` header. This is acceptable here because each user supplies and controls their own key, but a malicious browser extension on the user's machine could still read it.
- The cost estimate is approximate and based on list prices in `src/pipeline/config.ts`.

## Reporting a problem

Please open a GitHub issue, or for anything sensitive, contact the maintainer through GitHub.
