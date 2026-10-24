-- Run once in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- Run it AFTER your main schema.

-- 1) Keep the signup trigger aligned with the profiles table in the main schema.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Campus user'
    )
  );
  return new;
end $$;

-- 2) Owners must be able to see the found item that matched them, and finders must be able to see
--    the lost item of the person claiming it. Security definer helpers avoid policy loops.
create or replace function can_see_found(p_found uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from score_comparison s join lost_items l on l.id = s.lost_id
    where s.found_id = p_found and l.user_id = auth.uid()
  )
$$;

create or replace function can_see_lost(p_lost uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from score_comparison s join found_items f on f.id = s.found_id
    where s.lost_id = p_lost and f.user_id = auth.uid()
  )
$$;

create policy found_select_matched on found_items for select to authenticated
  using (can_see_found(id));
create policy lost_select_matched on lost_items for select to authenticated
  using (can_see_lost(id));

-- 3) Photo bucket (private, shown through signed links) and its rules.
insert into storage.buckets (id, name, public) values ('report-images', 'report-images', false)
on conflict (id) do nothing;

create policy report_images_read on storage.objects for select to authenticated
  using (bucket_id = 'report-images');
create policy report_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'report-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4) Live chat.
alter publication supabase_realtime add table messages;

-- 5) Configurable cross-modal cosine similarity threshold.
create table if not exists matching_settings (
  singleton boolean primary key default true check (singleton),
  cosine_threshold real not null default 0.30 check (cosine_threshold >= 0 and cosine_threshold <= 1)
);

insert into matching_settings (singleton, cosine_threshold)
values (true, 0.30)
on conflict (singleton) do nothing;

alter table matching_settings enable row level security;
revoke all on matching_settings from public, anon, authenticated;

-- Called only by the embed-item Edge Function using its service-role client.
create or replace function refresh_item_matches(p_type text, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_threshold real;
  v_embedding extensions.vector(768);
begin
  select cosine_threshold
  into v_threshold
  from matching_settings
  where singleton = true;

  if v_threshold is null then
    raise exception 'Matching threshold is not configured';
  end if;

  if p_type = 'found' then
    select image_embedding into v_embedding
    from found_embeddings
    where found_id = p_item_id;

    if v_embedding is null then
      raise exception 'Found item has no image embedding';
    end if;

    insert into score_comparison (lost_id, found_id, score)
    select le.lost_id, p_item_id, similarity.score
    from lost_embeddings le
    join lost_items li on li.id = le.lost_id and li.status = 'open'
    join found_items fi on fi.id = p_item_id and fi.status = 'open'
    cross join lateral (
      select greatest(
        0::real,
        least(1::real, (1 - (le.text_embedding <=> v_embedding))::real)
      ) as score
    ) similarity
    where similarity.score > v_threshold
    on conflict (lost_id, found_id) do update
      set score = excluded.score, created_at = now();
  elsif p_type = 'lost' then
    select text_embedding into v_embedding
    from lost_embeddings
    where lost_id = p_item_id;

    if v_embedding is null then
      raise exception 'Lost item has no text embedding';
    end if;

    insert into score_comparison (lost_id, found_id, score)
    select p_item_id, fe.found_id, similarity.score
    from found_embeddings fe
    join found_items fi on fi.id = fe.found_id and fi.status = 'open'
    join lost_items li on li.id = p_item_id and li.status = 'open'
    cross join lateral (
      select greatest(
        0::real,
        least(1::real, (1 - (v_embedding <=> fe.image_embedding))::real)
      ) as score
    ) similarity
    where similarity.score > v_threshold
    on conflict (lost_id, found_id) do update
      set score = excluded.score, created_at = now();
  else
    raise exception 'Unsupported item type: %', p_type;
  end if;
end;
$$;

revoke all on function refresh_item_matches(text, uuid) from public, anon, authenticated;
grant execute on function refresh_item_matches(text, uuid) to service_role;
