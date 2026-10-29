# Smart Campus Lost & Found

TanStack Start + Tailwind, connected to your own Supabase project.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the Supabase URL and publishable key.
3. Run your main schema, then `supabase/fixes.sql`, in Supabase SQL Editor.
4. Generate a random token and save it as the Google Secret Manager secret `siglip-service-token`. Grant the Cloud Run runtime service account access to that secret, then deploy `siglip-service` from the app directory:
   ```sh
   gcloud run deploy siglip-service \
     --source siglip-service \
     --region YOUR_REGION \
     --allow-unauthenticated \
     --memory 4Gi \
     --cpu 4 \
     --concurrency 1 \
     --timeout 900 \
     --set-secrets SIGLIP_SERVICE_TOKEN=siglip-service-token:latest
   ```
   The container loads Google's `google/siglip2-base-patch16-224` model from Hugging Face on startup. Although Cloud Run allows the HTTP request, the endpoint requires the shared token.
5. In Supabase -> Edge Functions -> Secrets, set:
   - `SIGLIP_EMBEDDING_URL`: the Cloud Run service URL
   - `SIGLIP_SERVICE_TOKEN`: the same secret configured on Cloud Run
6. Deploy the Supabase Edge Function with gateway JWT verification disabled so browser CORS preflight requests can reach the function. The function still validates the user's Bearer token itself:
   ```sh
   supabase functions deploy embed-item --no-verify-jwt
   ```
7. In Supabase -> Authentication -> Email Templates -> "Confirm signup", add `{{ .Token }}` so the email shows the 6-digit code.
8. Run `npm run dev`.

Each report compresses its selected image in the browser to a maximum dimension of 1600 pixels and a target of about 500 KB before uploading it to Supabase or generating a normalized CLIP image embedding. The compressed image remains suitable for item-level visual matching; extremely fine details may be less clear than in the original camera file. It then invokes `embed-item` to store the 512-dimensional vectors and calculate normalized cosine similarity across lost descriptions and found images. Pairs above the configured threshold are saved to `score_comparison`; the dashboard displays the top three scores per open lost report. Run `supabase/clip-migration.sql` once in the Supabase SQL Editor before using the browser CLIP flow. The initial threshold is `0.30`; change it in Supabase SQL Editor, for example:

```sql
update matching_settings
set cosine_threshold = 0.35
where singleton = true;
```

## Deploy to Netlify

The repository's app directory is `smart-campus-lost-and-found`, so set the
Netlify **Base directory** to that folder. Netlify will use `netlify.toml` for
the build configuration:

- Build command: `npm run build`
- Publish directory: `dist`

Add these environment variables in Netlify under **Project configuration ->
Environment variables** for the deploy context:

- `VITE_SUPABASE_URL`: your Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: your Supabase publishable/anon key

Do not upload `.env`. The `NITRO_PRESET=netlify` setting in `netlify.toml`
builds the TanStack Start server as a Netlify function.
