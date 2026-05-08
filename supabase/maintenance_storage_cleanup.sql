-- ============================================================
-- Maintenance: Storage cleanup
-- Find orphaned blobs in 'chat-attachments' and 'documents' buckets
-- (i.e. files whose owning row in chat_attachments / documents is gone).
--
-- USAGE:
--   1. Run the diagnostic block below first to see what would be deleted.
--   2. If happy, run the DELETE block.
--
-- Why not auto-cron?
--   Deletion is destructive — accidental cascade could lose user data.
--   Run this manually after major migrations or once a quarter for cost control.
--
-- Why this approach?
--   Supabase Storage stores blobs in `storage.objects` (queryable via SQL).
--   We compare against application tables to find orphans.
-- ============================================================

-- ─── STEP 1 — DIAGNOSTIC (read-only) ─────────────────────────

-- chat-attachments orphans:
-- A storage object whose path doesn't appear in any chat_attachments.file_url.
-- Note: file_url is a public URL like:
--   https://{ref}.supabase.co/storage/v1/object/public/chat-attachments/<path>
-- so we extract the trailing path to compare.

with referenced_paths as (
  select substring(file_url from '/chat-attachments/(.*)$') as path
  from public.chat_attachments
  where file_url like '%/chat-attachments/%'
)
select o.id, o.name, o.created_at, o.metadata->>'size' as bytes
from storage.objects o
where o.bucket_id = 'chat-attachments'
  and o.name not in (select path from referenced_paths)
order by o.created_at
limit 200;

-- documents orphans:
with referenced_doc_paths as (
  select substring(file_url from '/documents/(.*)$') as path
  from public.documents
  where file_url like '%/documents/%'
)
select o.id, o.name, o.created_at, o.metadata->>'size' as bytes
from storage.objects o
where o.bucket_id = 'documents'
  and o.name not in (select path from referenced_doc_paths)
order by o.created_at
limit 200;

-- ─── STEP 2 — DELETE (uncomment to execute) ─────────────────

-- Delete orphaned chat-attachments blobs
-- (after reviewing the diagnostic output above)
/*
with referenced_paths as (
  select substring(file_url from '/chat-attachments/(.*)$') as path
  from public.chat_attachments
  where file_url like '%/chat-attachments/%'
)
delete from storage.objects
where bucket_id = 'chat-attachments'
  and name not in (select path from referenced_paths);
*/

-- Delete orphaned documents blobs
/*
with referenced_doc_paths as (
  select substring(file_url from '/documents/(.*)$') as path
  from public.documents
  where file_url like '%/documents/%'
)
delete from storage.objects
where bucket_id = 'documents'
  and name not in (select path from referenced_doc_paths);
*/
