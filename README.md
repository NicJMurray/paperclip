# Paperclip

A native Android share target and a public collection at **https://paperclip.njmurray.com/**.

## On your phone

1. Download the signed `paperclip.apk` from this repository’s Releases and install it. Android may ask you to allow installation from your browser. Android 8 or newer is required.
2. Open Paperclip once, paste your private pairing code, and tap **Connect Paperclip**.
3. In any other app, choose **Share → Paperclip**. That is the whole save flow. You can also choose Paperclip from the selected-text actions where the sending app supports Android’s standard menu.

There is no category selector, tag form, or confirmation screen. “Queued” means the phone has a durable copy; uploads run with WorkManager whenever connected. Uninstalling the app or clearing its storage removes unsent items. Open Paperclip to check the queue, check the connection or retry uploads. Keep the pairing code out of GitHub: it is a one-time credential, not the APK.

The app shows the three most recent waiting items, combining uploads on this phone with the private server inbox. Rows show the URL or image name and whether they are waiting to upload, waiting to sort, or held. Tap **×** to remove a waiting item. Removal requests persist offline and sync when connected; if sorting publishes the item first, the app reports that it was already published and does not delete the public entry. The server inbox requires a connection to refresh; the app keeps the last fetched list while it stays open.

Website updates appear automatically. For Android updates, install the newer APK over the existing app using the same signing key. Your connection and outbox remain in place; do not uninstall first. Version 1.1 adds the queue list and removal controls.

Android controls the share-sheet order. Long-press Paperclip and choose **Pin** if your phone supports it. The app cannot force itself into the first position or add a Share action to another app that does not offer one.

## What it saves

- Links and text, including the sender’s subject/title when available.
- JPEG, PNG, WebP and GIF images, including multiple images per share, up to 10 MB each and 30 images per share. A small preview helps the sorting task understand images. Readable HEIC and other Android-decodable formats are converted to JPEG. Oversized or unreadable images show an error, never a false “saved” message.
- Original supported-image bytes are kept, including any embedded metadata. Do not share private images or location metadata you do not intend to make public.
- Text is limited to 32,000 characters. Videos, audio and arbitrary files are outside this first version.

The incoming inbox is private. A scheduled ChatGPT task classifies new items into articles, tools, memes, images, videos (links), reference, notes or other, preserves source headlines and publisher descriptions, adds categories and tags, then publishes them. Link cards use small thumbnails; standalone images retain the larger image view. The website reads published records directly, so weekly sorting needs no redeployment. Uncertain or apparently private material is held for review. This is a best-effort safeguard, not a guarantee: share only material you are comfortable publishing.

## Small by design

- Native Java, Android platform views, AndroidX WorkManager. No WebView, advertising, analytics, clipboard monitoring or broad photo-library permission.
- Cloudflare Pages’ Worker runtime with a D1 SQLite database. No separate OpenAI API account or usage charges: sorting uses the connected ChatGPT task.
- Images live as bounded database chunks, atomically with their metadata. R2 is not enabled on this account; D1 keeps this small personal archive in one service. If image volume grows, move the `image_chunks` table to object storage without changing the phone’s API.
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

See [DEPLOYMENT.md](DEPLOYMENT.md) for infrastructure, pairing/revocation and scheduled publishing, and [CURATION.md](CURATION.md) for the task’s rules.
