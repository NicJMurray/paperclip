# Paperclip maintenance

Read README.md, DEPLOYMENT.md and CURATION.md. Keep Android capture frictionless: Share → Paperclip queues immediately without confirmation, categorisation or tagging. Setup is one-time. Preserve offline durability and UUID idempotency.

Keep interface text minimal and functional. The owner prefers slick, self-explanatory apps without promotional headlines, taglines or poetic descriptions. Preserve useful labels and saved-content descriptions; do not reintroduce removed decorative copy.

Keep the design balanced when removing text: resize the surrounding section instead of leaving an empty hero. A simple app-name heading is appropriate.

Paperclip is a bank of source links. Preserve source headlines and publisher descriptions instead of writing new ones; abridge only with faithful excerpts when necessary. Keep link-card images as small thumbnails so source text remains primary. Standalone saved images can use the larger image layout.

Do not expose pending or held rows through public endpoints, media routes, static files, logs or GitHub. Keep tokens hashed in D1 and encrypted on Android. Never commit pairing codes, credentials or the Android signing key. Images are in D1 chunks because R2 is not enabled; do not require another billed service without an explicit request.

The Android queue shows the latest three waiting items and a single × removal action. Preserve durable offline removal markers and server removal IDs; a delayed upload must never recreate a removed item. Queue APIs require device authentication and must not delete published records. Run Android unit tests, release build and lint when changing queue behavior. Sign updates with the original release key and increment versionCode; users install updates over the existing app.

Check Git status and safely update main before changes. Preserve unrelated changes. Run npm run build and npm test for backend/site changes. Build Android releases with the existing signing key; never replace it silently. Code deploys via the Git-connected Pages project paperclip. Weekly ChatGPT sorting updates only D1 records and curation_runs, never code. Verify actual deployment SHA and custom-domain behavior before claiming code is live.
