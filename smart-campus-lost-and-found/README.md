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

## Admin dashboard

The app's admin dashboard is available at `/admin` to accounts whose database
profile role is `admin` or `superadmin`. New accounts are assigned `user` by
default. To configure one superadmin:

1. Run `supabase/admin-dashboard.sql` in the Supabase SQL Editor **after**
   `fixes.sql` and `clip-migration.sql`.
2. In Supabase project settings -> Edge Functions -> Secrets, set `ADMIN_EMAIL`
   to the one email address that should be eligible for superadmin bootstrap.
   This is a server-side Edge Function secret; do not add it to any `VITE_*`
   variable or browser bundle. Supabase supplies the function service-role
   credential at runtime; do not copy it into the app.
3. Deploy the two functions:
   ```sh
   supabase functions deploy admin-bootstrap --no-verify-jwt
   supabase functions deploy admin-mfa --no-verify-jwt
   ```
   Each function validates the caller's Supabase access token itself. The
   bootstrap function promotes only the exact configured email, and refuses
   to replace an already established superadmin.
4. Configure Supabase Auth email delivery and the **Magic Link** email template
   to include `{{ .Token }}` so the sign-in OTP is visible in the email.
   Sign in with the configured account; the app bootstraps its superadmin role
   and requires an emailed one-time code before completing sign-in. Verification
   is tied to that Supabase auth session and expires after four hours. Opening
   `/admin` also checks verification before showing admin data. Ordinary admins
   do not need this extra prompt.

The dashboard loads its counts and report charts from Supabase and supports
7-day, 30-day, 90-day, and all-time ranges. It shows reports by type and
location, paginated score comparisons, recent reports, and found items that
are still open and kept at the office. Score comparisons and office-held items
can be browsed page by page; office photos open in a larger view. The current
report schema does not include an item-category field, so the category-style
wireframe chart is represented by Lost/Found report type rather than inferred
categories.

The SQL migration defaults every profile to `user`, blocks direct client role
updates, and gates admin report/match reads with RLS. Only a verified
superadmin can use the database RPCs to change roles or the match threshold;
the one configured server-side bootstrap is the only initial superadmin path.
Threshold changes apply to future matching runs; existing comparisons are not
recalculated automatically. Review the migration against any custom policies
in your project before applying it.

Superadmin sign-in uses the account's Supabase Auth credentials. `ADMIN_EMAIL`
is only an Edge Function secret used to authorize the one superadmin account;
do not place the account password or service-role key in a `VITE_*` variable or
browser code. Set or rotate the password through Supabase Auth.

Each report compresses its selected image in the browser to a maximum dimension of 1600 pixels and a target of about 500 KB before uploading it to Supabase or generating a normalized CLIP image embedding. The app begins loading the CLIP resources during browser idle time so they are usually ready before a user reaches the report form. The compressed image remains suitable for item-level visual matching; extremely fine details may be less clear than in the original camera file. It then invokes `embed-item` to store the 512-dimensional vectors and calculate normalized cosine similarity across lost descriptions and found images. Pairs above the configured threshold are saved to `score_comparison`; the user dashboard displays the top three scores per open lost report, while the admin dashboard can browse every comparison row. Run `supabase/clip-migration.sql` once in the Supabase SQL Editor before using the browser CLIP flow. The initial threshold is `0.30`. Once the admin migration is applied, use the
superadmin dashboard to adjust it (application users cannot update this table
directly). A database owner can still set it manually in SQL Editor during
initial setup:

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
