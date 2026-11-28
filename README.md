# Paperclip

A native Android share target and a public collection at **https://paperclip.njmurray.com/**.

## On your phone

1. Download the signed `paperclip.apk` from this repository’s Releases and install it. Android may ask you to allow installation from your browser. Android 8 or newer is required.
2. Open Paperclip once, paste your private pairing code, and tap **Connect Paperclip**.
3. In any other app, choose **Share → Paperclip**. That is the whole save flow. You can also choose Paperclip from the selected-text actions where the sending app supports Android’s standard menu.

There is no category selector, tag form, or confirmation screen. “Queued” means the phone has a durable copy; uploads run with WorkManager whenever connected. Uninstalling the app or clearing its storage removes unsent items. Open Paperclip to check the queue, check the connection or retry uploads. Keep the pairing code out of GitHub: it is a one-time credential, not the APK.

The app shows the three most recent waiting items, including uploads still on this phone. Tap **×** to remove a waiting item. Removal requests persist offline and sync when connected. If the upload publishes first, the app reports that it was already published and preserves the public entry.

Website updates appear automatically. Install the signed Android update over the existing app to keep your connection and outbox. Version 1.2 adds document and mixed-file shares.

For public Substack posts and Notes, use Substack's **Share → Paperclip**. If Substack only offers **Copy link**, share that link from your browser. Direct videos start when clicked on desktop and autoplay when visible on touch devices. They start muted, and the sound control carries your preference to the next video. A video that cannot play directly links to its source. Other Substack cards offer **Preview on Paperclip** and a source link. This works for recognized Substack URLs, including links copied from your Likes tab.

Android controls the share-sheet order. Long-press Paperclip and choose **Pin** if your phone supports it. The app cannot force itself into the first position or add a Share action to another app that does not offer one.

## What it saves

- Links and text, including the sender’s subject/title when available.
- Original images, documents and other files provided by Android, up to 10 MB each and 30 files per share. JPEG, PNG, WebP and GIF appear inline. Other file types use a download link.
- Embedded file metadata is preserved. Share only material you intend to make public.
- Text is limited to 32,000 characters.

Shares appear on the public website as soon as the upload succeeds. Paperclip uses the shared title, text, URL and image. If a link has no title, Paperclip displays its URL. Link cards use small thumbnails and standalone images retain the larger image view. Share only material you intend to make public.

## Small by design

- Native Java, Android platform views, AndroidX WorkManager. No WebView, advertising, analytics, clipboard monitoring or broad photo-library permission.
- Cloudflare Pages’ Worker runtime with a D1 SQLite database. Publication is part of the upload.
- Files live as bounded database chunks, atomically with their metadata. D1 keeps this small personal archive in one service. The `image_chunks` table also stores document bytes.
- Device tokens are hashed on the server and encrypted with Android Keystore on the phone. Pairing is single-use, high-entropy and expiring. A revoked phone cannot upload.
- UUIDs provide retry idempotency. Sharing the same URL deliberately twice creates two records; retrying the same upload does not.

## Development

```sh
npm ci
npm run build
npm test
npm run db:local
npm run dev
```

Node 22+ is recommended. Tests run against the real local Workers/D1 runtime and check private/public boundaries, single-use pairing, device revocation, retries, original image bytes, validation, pagination, and queue removal including upload races. Compatibility is pinned to 2026-10-30, the latest date supported by the runtime available during setup.

Build Android with Android SDK 35, Java 17+ and the checked-in Gradle wrapper:

```sh
cd android
./gradlew assembleDebug
./gradlew testReleaseUnitTest
```

Android unit tests use Robolectric to check the three-row list, URL/image labels and durable removal requests. For an installable release with the same signature as the first APK, set `PAPERCLIP_KEYSTORE` and `PAPERCLIP_STORE_PASSWORD`, keep key alias `paperclip`, then run `./gradlew assembleRelease`. Increment `versionCode` for updates. The owner’s signing backup is supplied separately and must never be committed. A different signing key requires uninstalling the previous app, which also deletes its queue and connection.

See [DEPLOYMENT.md](DEPLOYMENT.md) for infrastructure, pairing, revocation and publishing.
