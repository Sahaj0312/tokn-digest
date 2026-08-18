# UnlockAI Digest

An English-and-German, utility-first AI news digest for UnlockAI learners. A Cloudflare Cron Trigger queues each edition, a Queue consumer fetches a deliberately small source set, deterministic noise filters remove junk, OpenAI applies a structured editorial ranking and creates localized titles and summaries, and final quality gates publish the JSON through a Cloudflare Worker backed by D1.

## Editorial standard

The digest is for non-technical professionals, creators, freelancers, and small-business owners who want practical ways to use AI. It prioritizes product capabilities, accessible releases, useful workflows, and material pricing/access changes. It rejects politics, funding, influencer drama, layoffs, robotics, infrastructure, speculative AI debate, and abstract research without a user-facing capability. Every edition contains 10–12 qualified stories, ranked with the most useful first, with no more than two from one source.

## Commands

```bash
npm install
npx wrangler types
npm run check
npm run preview
npx wrangler d1 migrations apply unlockai-digest --remote
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

For a manual production run, send a JSON message from the Cloudflare Queues dashboard to `unlockai-digest-generation`, or use the [Queues HTTP API](https://developers.cloudflare.com/queues/examples/publish-to-a-queue-via-http/). The message body is `{ "requestedAt": "<ISO-8601 timestamp>", "slot": "am" }` (use `pm` for the evening edition).

Production endpoints:

- `https://digest.unlockai.courses/latest.json`
- `https://digest.unlockai.courses/archive/YYYY-MM-DD.json`
- `https://digest.unlockai.courses/archive/YYYY-MM-DD-am.json`
- `https://digest.unlockai.courses/archive/YYYY-MM-DD-pm.json`
- `https://digest.unlockai.courses/health`

Each digest declares `availableLanguages: ["en", "de"]`. Every article includes
localized `title` and `summary` values under `localizations.en` and
`localizations.de`; the top-level `title` and `summary` remain English for older
app versions.

The Cron Trigger is scheduled for 06:50 and 18:50 UTC so the edition is normally published before the former 07:00 and 19:00 target times. The Queue retries a failed generation up to five times, and a failed edition never overwrites the last good digest.
