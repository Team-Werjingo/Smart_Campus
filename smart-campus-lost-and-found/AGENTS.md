<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Stack is TanStack Start + Supabase (Postgres/pgvector, Auth, Storage) using the project's own schema: profiles, lost_items, found_items, lost_embeddings, found_embeddings, score_comparison, messages.
- The browser talks to Supabase directly under RLS. Reports are inserted from `ReportForm`, photos go to the private `report-images` bucket under `{userId}/...`.
- Matching runs in the backend (Edge Function `embed-item`, called by `triggerMatching` in `src/lib/items.ts`); it calls the SigLIP 2 service in `siglip-service/`, stores 768-dimensional vectors, and writes above-threshold cosine scores to `score_comparison`. The configurable threshold is in `matching_settings`.
- Chat lives in `messages`, one conversation per (lost_id, found_id) pair that exists in `score_comparison`.
