-- Supabase only (needs auth.users): every new user gets their own org.
-- Run once in the Supabase SQL editor, after migrations/002_orgs_members.sql.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org text;
begin
  insert into orgs (name) values (coalesce(new.email, 'new org')) returning id into new_org;
  insert into members (user_id, org_id, role) values (new.id, new_org, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- To give yourself the existing demo data instead, after your first login:
--   update members set org_id = 'acme'
--   where user_id = (select id from auth.users where email = 'you@gmail.com');
