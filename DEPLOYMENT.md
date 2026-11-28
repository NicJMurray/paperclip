# Deployment and ownership

- Source: `NicJMurray/paperclip`, production branch `main`.
- Domain: `paperclip.njmurray.com`.
- Cloudflare account: `22c1482ec05957092be7a2df424c4543`.
- Cloudflare Pages project: `paperclip`, Git-connected, advanced Worker mode.
- Build: `npm run build && npm test`; output: `dist`.
- D1 database: `paperclip`, ID `1395d63b-ad48-4243-98fe-c94d94b4f937`; binding `DB`.
- Runtime: compatibility date `2026-10-30`, flag `nodejs_compat`.

Pages reuses the account’s existing GitHub authorisation. A separate Workers Builds project would need a build deployment token unavailable through the current connection. This app therefore uses Pages’ Worker runtime and Git builds, including its D1 binding. New shares appear through database writes, independent of code builds.

`npm run build` emits an advanced-mode `_worker.js`, `_routes.json` and an HTML fallback. The Worker embeds the small CSS/JS/HTML assets, routes every request, authenticates writes, and exposes only published content. No database dump, credentials, APK signing key, device token or private inbox is a public asset. Preview builds are disabled; the live database must not be bound to untrusted preview code.

## Database migrations

Apply the SQL files in `server/migrations/` in filename order before deploying code that needs them. `0001_initial.sql` creates the archive. `0002_queue_removal.sql` adds durable removal IDs. `0003_external_feed.sql` adds Substack snapshots. `0004_shared_files.sql` adds names for uploaded files. Use `npm run db:remote` with a D1-capable Cloudflare credential, or the connected Cloudflare API query endpoint. A code push does not run database migrations automatically.

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

## Private queue

`GET /api/queue` requires a device token and returns only the latest three pending/held records plus their total count. It does not return images, previews or device credentials. `DELETE /api/queue/:id` uses the same authentication and atomically records a removal ID and deletes an unpublished item with its image chunks. Published records return 409 and are preserved. Repeating a removal is safe; an upload arriving later with the removed UUID returns 410. Original capture UUIDs are never reused for a deliberate new share.

Android keeps removal markers separately from its outbox files, so an upload finishing concurrently cannot erase a removal request. WorkManager retries removal when connected. Server queue data is kept in memory while the app is open and refreshed only in the foreground. The public website cannot list or modify the private queue.

## Android publishing

The authenticated `POST /api/capture` endpoint publishes a share in the same database batch that stores its file chunks. It uses the title and text supplied by Android and displays a filename or URL when a share has no title. Android 1.2 sends a `file_name` field for any file. Supported images display at `/media/:id`. Other files download as attachments from `/files/:id`. Both routes require a published record. The private queue endpoints still support legacy unpublished records and offline removal requests.

## Publishing and verifying code

Run `npm ci`, `npm run build`, and `npm test`. Push checked source to `main`; verify the Git-connected Cloudflare build succeeded for that exact SHA. Check the real domain, `/api/health`, and `/api/items`. `npm run deploy` is manual recovery only and requires a suitable Cloudflare credential.

Android builds are independent of the website. The release APK is signed with the owner’s private key. GitHub Releases link to an immutable APK/checksum commit on the separate `android-releases` branch; source remains on `main`. Direct release-asset uploads are unavailable through the current connection, so the small signed binary is distributed through Git instead. Preserve the separate signing backup for future updates. No signing secrets are stored in the public repository.

## Substack likes

The `paperclip-substack-likes` Worker reads the signed-out `@nicjm` profile and the public likes data used by Substack's web app. It has no public routes. Its Cron Trigger runs daily at 07:17 UTC and writes a complete snapshot into the same D1 database. Each refresh uses one short-lived Browser Run session with scripts and subresources disabled. If the profile stops showing likes in public it clears the import. An HTTP, parsing or pagination failure preserves the last complete snapshot. Only publicly visible Notes and published posts with an everyone audience are imported. The Worker follows at most 20 pages per refresh and preserves the publication's wording and source links.

The production Pages project reads that snapshot when `SUBSTACK_CRON_FEED` is `1`. To pause refresh, remove the Worker Cron Trigger. To hide imported items, also remove the flag from `wrangler.jsonc` and redeploy Pages. The custom Worker configuration is `wrangler.substack.jsonc` and can be deployed with `npx wrangler deploy --config wrangler.substack.jsonc`. Apply `0003_external_feed.sql` before enabling the Worker on a fresh database. The Cloudflare Worker logs and D1 table `feed_sync` show recent attempts. The source is an undocumented web route and may change.

### Optional external feed


Apply `0003_external_feed.sql` before enabling the feed. Paperclip needs an authorized HTTPS endpoint for your public likes. Set `SUBSTACK_LIKES_URL` in the production Pages environment. If the endpoint requires bearer authentication, add `SUBSTACK_LIKES_TOKEN` as a secret. Redeploy after changing the production environment. Keep credentials out of the URL, the repository and the Cloudflare build logs.

The endpoint must return JSON with this shape.

```json
{
  "profile": "https://substack.com/@nicjm",
  "complete": true,
  "items": [
    {
      "public": true,
      "type": "post",
      "url": "https://example.substack.com/p/example",
      "published_at": "2026-11-01T12:00:00Z",
      "liked_at": "2026-11-16T18:30:00Z",
      "title": "Original title",
      "summary": "Original description",
      "media": []
    }
  ]
}
```

Use `note` or `post` for `type`. A Note can carry its original text as `summary` with the title omitted. Use UTC ISO timestamps or include a numeric offset. `liked_at` takes priority when supplied. Media entries take a `type` of `image` or `video`, an HTTPS `url` and optional source-provided `alt`, `caption`, `poster` (video), `width` and `height`. Supply only media the creator or provider permits to play externally. Paperclip accepts Substack-hosted images and Substack or Mux MP4/HLS URLs. Use `video: true` to categorize a video whose source only provides a link. The public response and normalized snapshot are each capped at 1 MiB.

Return the complete snapshot of eligible likes on each successful refresh, including any historical pages. A complete empty snapshot clears the imported likes. An optional `ETag` lets the endpoint return 304 when unchanged. Avoid reporting a partial or failed upstream fetch as a complete snapshot. Keep restricted content out of the public snapshot.

Paperclip refreshes in the background on the first feed request after the hourly interval. The next request sees the latest successful snapshot. For hourly refresh even when the site has no visitors, point an hourly scheduler at `https://paperclip.njmurray.com/api/items`. On a fetch or validation failure, the last successful snapshot remains available. A valid new snapshot removes unliked items. Remove `SUBSTACK_LIKES_URL` and redeploy to hide the imported feed immediately. Existing saved items and the Android inbox continue to use their current workflow.
