-- Run once in Supabase SQL Editor after the main schema and fixes.sql.
-- This migration adds role-gated admin reads, one-time superadmin bootstrap support,
-- per-auth-session email OTP verification, and superadmin-only settings RPCs.

alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin', 'superadmin'));

-- Only one superadmin can exist. The bootstrap Edge Function is the only code path
-- that can promote the configured ADMIN_EMAIL account to this role.
create unique index if not exists profiles_single_superadmin
  on public.profiles ((role))
  where role = 'superadmin';

create table if not exists public.admin_mfa_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id)
);

alter table public.admin_mfa_sessions enable row level security;
revoke all on public.admin_mfa_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.admin_mfa_sessions to service_role;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.has_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_mfa_sessions m
    where m.user_id = auth.uid()
      and m.session_id::text = auth.jwt() ->> 'session_id'
      and m.expires_at > now()
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_profile_role() in ('admin', 'superadmin'), false)
$$;

create or replace function public.is_superadmin_with_mfa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_profile_role() = 'superadmin', false)
    and public.has_admin_mfa()
$$;

create or replace function public.can_access_admin_dashboard()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case public.current_profile_role()
    when 'admin' then true
    when 'superadmin' then public.has_admin_mfa()
    else false
  end
$$;

revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.has_admin_mfa() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_superadmin_with_mfa() from public, anon;
revoke all on function public.can_access_admin_dashboard() from public, anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.has_admin_mfa() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_superadmin_with_mfa() to authenticated;
grant execute on function public.can_access_admin_dashboard() to authenticated;

-- Client users may only read their own profile and edit their display name.
-- Role changes are only possible through set_user_role() below.
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_access_admin_dashboard());

drop policy if exists profiles_update_self_name on public.profiles;
create policy profiles_update_self_name on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins can read the complete moderation/report/matching data set only after
-- authenticating as an authorized role; superadmins must also complete email OTP.
alter table public.lost_items enable row level security;
alter table public.found_items enable row level security;
alter table public.score_comparison enable row level security;
revoke select on public.lost_items, public.found_items, public.score_comparison from anon;
grant select on public.lost_items, public.found_items, public.score_comparison to authenticated;

create or replace function public.can_read_own_match(p_lost_id uuid, p_found_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.lost_items l
    where l.id = p_lost_id and l.user_id = auth.uid()
  ) or exists (
    select 1 from public.found_items f
    where f.id = p_found_id and f.user_id = auth.uid()
  )
$$;
revoke all on function public.can_read_own_match(uuid, uuid) from public, anon;
grant execute on function public.can_read_own_match(uuid, uuid) to authenticated;

drop policy if exists score_comparison_owner_read on public.score_comparison;
create policy score_comparison_owner_read on public.score_comparison
  for select to authenticated
  using (public.can_read_own_match(lost_id, found_id));

drop policy if exists lost_items_admin_read on public.lost_items;
create policy lost_items_admin_read on public.lost_items
  for select to authenticated
  using (public.can_access_admin_dashboard());

drop policy if exists found_items_admin_read on public.found_items;
create policy found_items_admin_read on public.found_items
  for select to authenticated
  using (public.can_access_admin_dashboard());

drop policy if exists score_comparison_admin_read on public.score_comparison;
create policy score_comparison_admin_read on public.score_comparison
  for select to authenticated
  using (public.can_access_admin_dashboard());

-- Keep threshold reads available to authorized admin dashboards, but never let
-- the browser update the table directly.
alter table public.matching_settings enable row level security;
revoke all on public.matching_settings from anon, authenticated;
grant select on public.matching_settings to authenticated;
drop policy if exists matching_settings_admin_read on public.matching_settings;
create policy matching_settings_admin_read on public.matching_settings
  for select to authenticated
  using (public.can_access_admin_dashboard());

create or replace function public.get_admin_dashboard_analytics(p_from timestamptz default null)
returns table (report_kind text, location text, report_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_access_admin_dashboard() then
    raise exception 'Admin access is required';
  end if;

  return query
    with reports as (
      select 'Lost'::text as kind,
        coalesce(nullif(btrim(l.lost_location), ''), 'Unknown')::text as place,
        l.created_at as submitted_at
      from public.lost_items l
      union all
      select 'Found'::text as kind,
        coalesce(nullif(btrim(f.found_location), ''), 'Unknown')::text as place,
        f.created_at as submitted_at
      from public.found_items f
    )
    select reports.kind, reports.place, count(*)::bigint
    from reports
    where p_from is null or reports.submitted_at >= p_from
    group by reports.kind, reports.place
    order by reports.kind, count(*) desc;
end
$$;

revoke all on function public.get_admin_dashboard_analytics(timestamptz) from public, anon;
grant execute on function public.get_admin_dashboard_analytics(timestamptz) to authenticated;

create or replace function public.list_admin_users()
returns table (user_id uuid, full_name text, email text, role text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_superadmin_with_mfa() then
    raise exception 'Superadmin email verification is required';
  end if;

  return query
    select p.id, p.full_name, u.email::text, p.role
    from public.profiles p
    join auth.users u on u.id = p.id
    order by lower(coalesce(p.full_name, u.email)), p.id;
end
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_superadmin_with_mfa() then
    raise exception 'Superadmin email verification is required';
  end if;
  if p_role not in ('user', 'admin') then
    raise exception 'Role must be user or admin';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  update public.profiles set role = p_role where id = p_user_id and role <> 'superadmin';
  if not found then
    raise exception 'User not found or protected superadmin account';
  end if;
end
$$;

create or replace function public.set_matching_threshold(p_threshold real)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_superadmin_with_mfa() then
    raise exception 'Superadmin email verification is required';
  end if;
  if p_threshold is null or p_threshold < 0 or p_threshold > 1 then
    raise exception 'Threshold must be between 0 and 1';
  end if;

  update public.matching_settings
    set cosine_threshold = p_threshold
    where singleton = true;
  if not found then
    raise exception 'Matching settings are not configured';
  end if;
end
$$;

revoke all on function public.set_user_role(uuid, text) from public, anon;
revoke all on function public.set_matching_threshold(real) from public, anon;
revoke all on function public.list_admin_users() from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.set_matching_threshold(real) to authenticated;
grant execute on function public.list_admin_users() to authenticated;
