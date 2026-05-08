-- migration_phase_document_nodes_sort_seed.sql
-- Round-10 follow-up. Adds sort_order to document_nodes (so the file
-- explorer can support drag-drop reorder) and seeds a tiny starter
-- structure (couple of folders + a note) when the table is empty.
--
-- Run AFTER migration_phase_document_nodes.sql (which creates the table
-- and the doc_node_role_for() helper).
--
-- Idempotent — safe to re-run.

alter table public.document_nodes
  add column if not exists sort_order int not null default 0;

create index if not exists idx_doc_nodes_parent_sort
  on public.document_nodes (parent_id, sort_order);

-- Backfill existing rows with a stable per-folder order. row_number()
-- partitions by parent_id so siblings get 10, 20, 30… leaving headroom
-- between values for future inserts.
update public.document_nodes
   set sort_order = sub.rn * 10
  from (
    select id, row_number() over (partition by parent_id order by created_at) as rn
      from public.document_nodes
  ) sub
 where document_nodes.id = sub.id and document_nodes.sort_order = 0;

-- Sample seed — only when the table is genuinely empty AND we can find
-- an admin profile to credit. Runs the whole block atomically inside a
-- DO so we don't litter the DB with half-seeded rows on retry.
do $$
declare
  root_count int;
  admin_id   uuid;
  folder1_id uuid;
begin
  select count(*) into root_count from public.document_nodes;
  if root_count > 0 then return; end if;

  select id into admin_id
    from public.profiles
   where role = 'admin'
   order by created_at
   limit 1;
  if admin_id is null then return; end if;

  -- Folder 1: "Sổ tay nội bộ"
  insert into public.document_nodes (parent_id, type, name, slug, content_html, created_by, visibility, sort_order)
  values (null, 'folder', 'Sổ tay nội bộ', 'so-tay-noi-bo', null, admin_id, 'public', 10)
  returning id into folder1_id;

  -- Two notes inside folder 1
  insert into public.document_nodes (parent_id, type, name, slug, content_html, created_by, visibility, sort_order)
  values
    (folder1_id, 'note', 'Quy trình tiếp nhận yêu cầu', 'quy-trinh-tiep-nhan-yeu-cau',
     '<p>Quy trình thu thập + phân loại yêu cầu khách hàng. Cập nhật khi có thay đổi.</p>',
     admin_id, 'public', 10),
    (folder1_id, 'note', 'Checklist trước khi bàn giao', 'checklist-truoc-khi-ban-giao',
     '<p>Tài liệu kèm: source, hướng dẫn sử dụng, biên bản nghiệm thu.</p>',
     admin_id, 'public', 20);

  -- Folder 2: "Mẫu hợp đồng"
  insert into public.document_nodes (parent_id, type, name, slug, content_html, created_by, visibility, sort_order)
  values (null, 'folder', 'Mẫu hợp đồng', 'mau-hop-dong', null, admin_id, 'public', 20);

  -- Standalone note at root
  insert into public.document_nodes (parent_id, type, name, slug, content_html, created_by, visibility, sort_order)
  values (null, 'note', 'Ghi chú nháp', 'ghi-chu-nhap',
          '<p>Khu vực ghi chú tự do. Có thể kéo thả để sắp xếp lại.</p>',
          admin_id, 'public', 30);
end;
$$;

notify pgrst, 'reload schema';
