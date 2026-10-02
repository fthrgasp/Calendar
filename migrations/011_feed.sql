-- Run once in Supabase > SQL Editor (existing projects). Fresh installs get this from schema.sql.
-- Private calendar-feed link: Google/Apple Calendar can subscribe to it. The link's token is the only credential,
-- so it can be regenerated from Settings at any time (the old link stops working immediately).
create table if not exists public.feed_tokens (
  family_id  uuid primary key references public.families on delete cascade,   -- one feed per family
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.feed_tokens enable row level security;
create policy "family reads feed token" on public.feed_tokens for select
  using (family_id in (select public.my_family_ids()));                       -- members can see it; only the function below can change it

create or replace function public.rotate_feed_token() returns text
language plpgsql security definer set search_path = public as $$
declare fid uuid; t text;
begin
  select family_id into fid from members where user_id = auth.uid() limit 1;
  if fid is null then raise exception 'not in a family'; end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');   -- 64 hex characters
  insert into feed_tokens (family_id, token) values (fid, t)
    on conflict (family_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;
revoke all on function public.rotate_feed_token() from public, anon;
grant execute on function public.rotate_feed_token() to authenticated;
