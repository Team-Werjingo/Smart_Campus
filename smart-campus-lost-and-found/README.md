# Smart Campus Lost & Found

TanStack Start + Tailwind, connected to your own Supabase project.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the two values (steps are written inside the file)
3. Supabase -> SQL Editor: run your main schema, then `supabase/fixes.sql`
4. Supabase -> Authentication -> Email Templates -> "Confirm signup": add `{{ .Token }}` so the email shows the 6-digit code
5. `npm run dev`

Matches appear once your backend fills `score_comparison`. This app calls an Edge Function named `embed-item`
after each report (see `triggerMatching` in `src/lib/items.ts`).

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
