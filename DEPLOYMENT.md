# Deployment and ownership

- Source: `NicJMurray/paperclip`, production branch `main`.
- Domain: `paperclip.njmurray.com`.
- Cloudflare account: `22c1482ec05957092be7a2df424c4543`.
- Cloudflare Pages project: `paperclip`, Git-connected, advanced Worker mode.
- Build: `npm run build && npm test`; output: `dist`.
- D1 database: `paperclip`, ID `1395d63b-ad48-4243-98fe-c94d94b4f937`; binding `DB`.
- Runtime: compatibility date `2026-10-30`, flag `nodejs_compat`.

Pages reuses the account’s existing GitHub authorisation. A separate Workers Builds project would need a build deployment token unavailable through the current connection. This app therefore uses Pages’ Worker runtime and Git builds, including its D1 binding. Weekly content updates are database writes, independent of code builds.

`npm run build` emits an advanced-mode `_worker.js`, `_routes.json` and an HTML fallback. The Worker embeds the small CSS/JS/HTML assets, routes every request, authenticates writes, and exposes only published content. No database dump, credentials, APK signing key, device token or private inbox is a public asset. Preview builds are disabled; the live database must not be bound to untrusted preview code.

## Database migrations

Apply `server/migrations/0001_initial.sql` to the named D1 database before the first deployment. Future schema changes should be additive. Use `npm run db:remote` with a D1-capable Cloudflare credential, or the connected Cloudflare API query endpoint. A code push does not run database migrations automatically.

## Pair a phone

Generate 16 cryptographically random bytes as 32 lowercase hex characters. Compute its SHA-256 hex digest and insert only the digest:

```sql
INSERT INTO pairing_codes(code_hash, expires_at) VALUES (?, ?);
```

Use a UTC ISO timestamp, e.g. seven days ahead, and send the raw code privately to the owner. The app posts it once to `/api/pair`. The endpoint atomically consumes it and returns a random device token. A network failure during pairing may consume the code; generate a fresh code if that happens. Never publish pairing codes or database credentials in the public repository or release notes.

To revoke a phone:

```sql
UPDATE devices SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?;
```

Generate a new pairing code to reconnect. The phone retains failed uploads and can retry them after pairing again. The setup screen shows connection and outbox state, without adding steps to normal sharing.

## Weekly ChatGPT task

The task is **Sort Paperclip collection**, scheduled weekly on Sunday, using the owner’s connected Cloudflare tools. Its prompt contains the exact account/database IDs and the publication rules in CURATION.md. It reads pending rows from D1, examines links and image previews where possible, and uses parameterised updates to publish or hold each item. The public API selects `status = 'published'` and never exposes `shared_text`, `shared_title`, `image_preview`, devices or pairing codes. Categories/tags are stored in each item; no static export or deployment is needed.

The task writes an audit row to `curation_runs`. Check that table to confirm a run actually happened; creating a schedule is not proof of future completion. Connected-tool authorisation must remain valid. Inspect failures in ChatGPT and re-run after restoring access. Do not silently substitute API billing or enable another scheduler.

To unpublish immediately, set the item’s status to `held`; the API and media responses use `Cache-Control: no-store`. Already downloaded public content cannot be recalled. `image_chunks` references `items` with `ON DELETE CASCADE`.

## Publishing and verifying code

Run `npm ci`, `npm run build`, and `npm test`. Push checked source to `main`; verify the Git-connected Cloudflare build succeeded for that exact SHA. Check the real domain, `/api/health`, and `/api/items`. `npm run deploy` is manual recovery only and requires a suitable Cloudflare credential.

Android builds are independent of the website. The release APK is signed with the owner’s private key and published as a GitHub Release asset. Preserve the separate signing backup for future updates. No signing secrets are stored in the public repository.
