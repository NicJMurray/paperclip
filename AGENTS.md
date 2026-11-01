# Paperclip maintenance

Read README.md, DEPLOYMENT.md and CURATION.md. Keep Android capture frictionless: Share → Paperclip queues immediately without confirmation, categorisation or tagging. Setup is one-time. Preserve offline durability and UUID idempotency.

Do not expose pending or held rows through public endpoints, media routes, static files, logs or GitHub. Keep tokens hashed in D1 and encrypted on Android. Never commit pairing codes, credentials or the Android signing key. Images are in D1 chunks because R2 is not enabled; do not require another billed service without an explicit request.

Check Git status and safely update main before changes. Preserve unrelated changes. Run npm run build and npm test for backend/site changes. Build Android releases with the existing signing key; never replace it silently. Code deploys via the Git-connected Pages project paperclip. Weekly ChatGPT sorting updates only D1 records and curation_runs, never code. Verify actual deployment SHA and custom-domain behavior before claiming code is live.
