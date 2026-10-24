-- Run once after the existing schema when switching from SigLIP (768) to CLIP (512).
create table if not exists matching_settings (
  singleton boolean primary key default true check (singleton),
  cosine_threshold real not null default 0.30
    check (cosine_threshold >= 0 and cosine_threshold <= 1)
);

insert into matching_settings (singleton, cosine_threshold)
values (true, 0.30)
on conflict (singleton) do nothing;

alter table lost_embeddings
  alter column image_embedding type extensions.vector(512) using null,
  alter column text_embedding type extensions.vector(512) using null;

alter table found_embeddings
  alter column image_embedding type extensions.vector(512) using null,
  alter column text_embedding type extensions.vector(512) using null;

create or replace function refresh_item_matches(p_type text, p_item_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_threshold real;
  v_embedding extensions.vector(512);
begin
  select cosine_threshold into v_threshold
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
      select greatest(0::real, least(1::real,
        (1 - (le.text_embedding <=> v_embedding))::real)) as score
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
      select greatest(0::real, least(1::real,
        (1 - (v_embedding <=> fe.image_embedding))::real)) as score
    ) similarity
    where similarity.score > v_threshold
    on conflict (lost_id, found_id) do update
      set score = excluded.score, created_at = now();
  else
    raise exception 'Unsupported item type: %', p_type;
  end if;
end;
$$;
