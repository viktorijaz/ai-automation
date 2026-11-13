-- Supabase only: the private bucket for invoice files. Run once in the Supabase SQL editor.
-- Not a migration: local Docker Postgres has no storage schema.
-- No storage policies on purpose: only the server (service role key) reads and writes it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 4194304, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Check:   select id, public, file_size_limit from storage.buckets;
