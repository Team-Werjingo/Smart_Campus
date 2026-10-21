-- Run once in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- Run it AFTER your main schema.

-- 1) Your signup trigger did not insert email, but profiles.email is NOT NULL, so every signup failed.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)));
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
