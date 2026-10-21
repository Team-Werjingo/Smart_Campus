# Smart Campus Lost & Found

TanStack Start + Tailwind, connected to your own Supabase project.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the two values (steps are written inside the file)
3. Supabase -> SQL Editor: run your main schema, then `supabase/fixes.sql`
4. Supabase -> Authentication -> Email Templates -> "Confirm signup": add `{{ .Token }}` so the email shows the 6-digit code
5. `npm run dev`

Matches appear once your backend fills `score_comparison`. This app calls an Edge Function named `embed-item`
after each report (see `triggerMatching` in `src/lib/items.ts`).
