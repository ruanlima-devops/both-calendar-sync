alter table public.oauth_states
  add column if not exists used_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'private' and table_name = 'oauth_states'
  ) then
    alter table private.oauth_states
      add column if not exists used_at timestamptz;
  end if;
end $$;
