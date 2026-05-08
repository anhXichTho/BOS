# Build Guide — Ứng dụng Quản lý Project & Team
> Tài liệu này dùng để hướng dẫn AI Agent (Claude Code) build từng phase.
> Paste từng section vào Claude Code theo thứ tự phase.

---

## 🗂️ Tổng quan kiến trúc

**Stack:**
- Frontend: React 18 + TypeScript + Vite (web app thuần, chạy trên browser)
- Styling: Tailwind CSS (utility-first, no CSS modules)
- Icons: lucide-react
- Backend: Supabase Local (PostgreSQL + Auth + Storage) chạy qua Docker khi dev, Supabase Cloud khi production
- Deploy: Vercel (cả main app lẫn Customer Portal)
- Auth: Supabase Auth (email/password)

> **Lưu ý:** App là web app thuần — không cần cài đặt, truy cập qua browser. Customer Portal `/portal/[token]` là route riêng trong cùng codebase hoặc subdomain riêng.

**4 Module chính:**
1. Module Team Chat (async — channel + project thread, có Form submission nhúng trong chat)
2. Module Form (template builder + submission viewer)
3. Module Quản lý dự án / vụ việc
4. Module Workflow (template + run per user)

**User roles:** `admin`, `editor`, `user`
**Vị trí tổ chức (tách khỏi role):** Bảng `leader_members` — ai có subordinates là leader, không cần role riêng. Leader và editor có thể là cùng 1 người.
**Quyền tạo form template:** admin, editor, và user có subordinates trong `leader_members`.

---

## ⚙️ PHASE 0 — Setup & Khởi tạo dự án

### Mục tiêu
Tạo project React + Vite (web app thuần), kết nối Supabase Local, cấu hình design system và layout 3-panel.

### Bước chuẩn bị — Supabase Local (chạy 1 lần)
```bash
# Cài Supabase CLI
npm install -g supabase

# Trong thư mục project sau khi scaffold xong
supabase init
supabase start   # lần đầu tải Docker images ~500MB, chờ 3–5 phút
```
Sau khi `supabase start` xong, copy các giá trị in ra vào file `.env`:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<anon key in ra>
VITE_SUPABASE_SERVICE_KEY=<service_role key in ra>
```
Supabase Studio (quản lý DB trực quan): mở `http://localhost:54323` trên browser.

### Prompt cho Claude Code
```
Hãy khởi tạo một web app với stack: React 18 + TypeScript + Vite.
Dùng lệnh: npm create vite@latest -- --template react-ts

Cài đặt các dependencies sau:
- @supabase/supabase-js
- tailwindcss, postcss, autoprefixer
- lucide-react
- @tanstack/react-query
- react-hook-form + zod
- date-fns
- react-router-dom (BrowserRouter, không cần HashRouter)

Cấu hình Tailwind extend colors theo design system (xem section Design System trong guide).

Tạo cấu trúc thư mục trong src/:
  pages/
    LoginPage.tsx
    ChatPage.tsx
    FormsPage.tsx
    ProjectsPage.tsx
    ProjectDetailPage.tsx
    WorkflowsPage.tsx
    WorkflowRunPage.tsx
    SettingsPage.tsx
    portal/
      PortalPage.tsx      ← Customer Portal (public, không cần login)
  components/
    ui/                   ← Button, Input, Modal, Badge, Toast, Skeleton
    layout/
      AppShell.tsx        ← layout 3-panel chính
      NavTabs.tsx         ← icon strip bên trái (48px)
      Sidebar.tsx         ← w-[320px] panel
    chat/
    forms/
    projects/
    workflow/
  lib/
    supabase.ts
    utils.ts
  types/
    index.ts

Tạo file .env với:
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_SERVICE_KEY=

Cấu hình react-router-dom với BrowserRouter.
Route /portal/:token là public — không cần auth, xử lý trong PortalPage.tsx.
```

---

## 🔐 PHASE 1 — Auth & Hệ thống phân quyền

### Schema Supabase

```sql
create extension if not exists "uuid-ossp";

-- Profiles
-- role = quyền chức năng (tạo/sửa/xem)
-- vị trí tổ chức (leader/member) quản lý riêng qua bảng leader_members
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  avatar_url text,
  role text not null default 'user' check (role in ('admin', 'editor', 'user')),
  created_at timestamptz default now()
);

-- Cây phân cấp leader–member (tự tham chiếu)
-- leader_id là người quản lý trực tiếp của member_id
-- Một user có thể là leader của nhiều người
-- và đồng thời là member của một leader khác
create table public.leader_members (
  id uuid default uuid_generate_v4() primary key,
  leader_id uuid references public.profiles(id) on delete cascade,
  member_id uuid references public.profiles(id) on delete cascade,
  unique(leader_id, member_id)
);

-- Helper function: lấy tất cả member_id trực thuộc (đệ quy xuống cây)
create or replace function public.get_all_subordinates(p_leader_id uuid)
returns setof uuid as $$
  with recursive subordinates as (
    select member_id from public.leader_members where leader_id = p_leader_id
    union
    select lm.member_id from public.leader_members lm
    inner join subordinates s on lm.leader_id = s.member_id
  )
  select member_id from subordinates;
$$ language sql security definer;

-- Trigger tự tạo profile khi user đăng ký
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.leader_members enable row level security;

create policy "Users can view all profiles" on public.profiles
  for select using (auth.uid() is not null);

create policy "Admin can manage profiles" on public.profiles
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can manage leader_members" on public.leader_members
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
```

### Prompt cho Claude Code
```
Dựa vào schema trên đã tạo trong Supabase Local, hãy build:

1. LoginPage.tsx:
   - Form email + password, font Source Serif 4, màu primary-600
   - Supabase Auth signInWithPassword
   - Lưu session, redirect vào app
   - Center card trên nền neutral-50

2. AppShell layout (3-panel):
   - Titlebar: h-10, drag region (-webkit-app-region: drag), bg-neutral-100
   - NavTabs (w-12, bg-neutral-800): icon-only
     * MessageSquare → Chat
     * FolderKanban → Dự án
     * GitBranch → Workflow
     * Settings → Cài đặt
     Active: bg-primary-50 text-primary-600
   - Sidebar (w-[320px], bg-neutral-25, border-r border-neutral-100)
   - Content: flex-1 bg-white p-6

3. Settings > Team:
   - Danh sách tất cả user, role badge (admin/editor/user)
   - Admin có thể đổi role (admin/editor/user)
   - Tab "Phân cấp": giao diện gán quan hệ leader–member
     * Chọn 1 user làm leader → gán các member trực thuộc
     * Hiển thị dạng tree: tên leader, indent các member bên dưới
     * 1 user có thể vừa là leader của nhóm mình vừa là member của người khác
     * Helper: is_leader(user_id) = có ít nhất 1 row trong leader_members với leader_id = user_id
```

---

## 💬 PHASE 2 — Module Team Chat (Async)

### Thiết kế

Chat dùng **Supabase Realtime chỉ để trigger refetch** — không stream data qua socket.
Cơ chế: khi có INSERT mới vào `chat_messages` → Supabase báo client → client gọi lại query bình thường.
Kết quả: tin nhắn hiện gần ngay lập tức, code vẫn đơn giản như polling.

- User post → INSERT vào DB → Supabase Realtime push event → tất cả client trong channel đó refetch
- Fallback polling 60 giây phòng khi Realtime mất kết nối
- Có thể paste ảnh trực tiếp vào input (clipboard paste → upload Supabase Storage)
- Mention @user bằng cách gõ @ → dropdown gợi ý

### Schema Supabase

```sql
-- Channels (phòng chat chung)
create table public.chat_channels (
  id uuid default uuid_generate_v4() primary key,
  name text not null,           -- "general", "announcements"...
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- Messages (dùng chung cho cả channel và project thread)
-- message_type: "text" = tin thường, "form_submission" = tin chứa form đã điền
create table public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  context_type text not null check (context_type in ('channel', 'project')),
  context_id uuid not null,
  parent_id uuid references public.chat_messages(id),
  author_id uuid references public.profiles(id),
  message_type text not null default 'text'
    check (message_type in ('text', 'form_submission')),
  content text,                                        -- null nếu là form_submission
  form_submission_id uuid,                             -- FK thêm sau khi tạo bảng form_submissions
  mentions uuid[] default '{}',
  edited_at timestamptz,
  created_at timestamptz default now()
);

-- Attachments tách ra bảng riêng để query được
-- (tìm file theo channel/project, gallery ảnh, tổng dung lượng...)
create table public.chat_attachments (
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references public.chat_messages(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text,                -- "image/png", "application/pdf"...
  file_size bigint,              -- bytes
  extracted_text text,           -- để AI tổng hợp sau này (OCR hoặc parse PDF)
  uploaded_at timestamptz default now()
);

-- Index để query nhanh
create index on public.chat_messages (context_type, context_id, created_at desc);
create index on public.chat_messages (parent_id);
create index on public.chat_attachments (message_id);

-- RLS
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;

create policy "All users can view channels" on public.chat_channels
  for select using (auth.uid() is not null);

create policy "Admin/Editor can manage channels" on public.chat_channels
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

create policy "All users can view messages" on public.chat_messages
  for select using (auth.uid() is not null);

create policy "Users can post messages" on public.chat_messages
  for insert with check (author_id = auth.uid());

create policy "Users can edit own messages" on public.chat_messages
  for update using (author_id = auth.uid());
```

### Prompt cho Claude Code
```
Dựa vào schema chat đã tạo, hãy build Module Team Chat:

1. Layout ChatPage:
   - Sidebar trái (trong panel sidebar chính): danh sách channels + danh sách projects có thread
     Section "Channels": list channel, click để mở
     Section "Project Threads": list project đang active
   - Content area: message feed + input box ở dưới

2. Message Feed:
   - Load messages theo context (channel hoặc project), sort created_at ASC
   - Hiển thị: avatar initials, tên, timestamp (relative: "2 giờ trước"), content
   - Nếu có attachments: preview ảnh inline, file khác hiện icon + tên + size
   - Nút reply → mở thread panel bên phải (hoặc indent dưới post gốc)
   - Supabase Realtime trigger refetch:
     ```ts
     supabase.channel('chat-' + contextId)
       .on('postgres_changes', {
         event: 'INSERT',
         schema: 'public',
         table: 'chat_messages',
         filter: `context_id=eq.${contextId}`
       }, () => queryClient.invalidateQueries(['messages', contextId]))
       .subscribe()
     ```
     Subscribe khi mở context, unsubscribe khi rời (useEffect cleanup)
   - Fallback: polling 60 giây bằng `refetchInterval: 60000` trong useQuery
   - Nút refresh manual ở header (dùng khi Realtime báo lỗi kết nối)

3. Input Box:
   - Textarea tự expand (max 6 dòng)
   - Paste ảnh: onPaste event → detect image in clipboard → upload Supabase Storage
     bucket: "chat-attachments", path: messages/{date}/{uuid}.{ext}
   - Nút attach file: input[type=file], upload vào Supabase Storage
     bucket: "chat-attachments", path: {context_id}/{date}/{uuid}.{ext}
     Sau khi upload xong: insert message trước, rồi insert chat_attachments với message_id
   - Nút "Form" (icon FileText): mở modal chọn form template → điền → gửi
     (xem Phase 2b bên dưới cho flow chi tiết)
   - Mention @user: gõ @ → dropdown search tên → insert @{full_name}
     Lưu mentions[] là array uuid
   - Gửi: Enter (không Shift), nút Send
   - Submit text: insert chat_messages (message_type='text')
   - Submit form: tạo form_submission trước → rồi insert chat_messages
     với message_type='form_submission', form_submission_id = submission vừa tạo

4. Render message theo type:
   - message_type = 'text': hiển thị bình thường, kèm attachments nếu có
     * Ảnh: preview inline (max-height 200px)
     * File khác: icon + tên + size, click download
   - message_type = 'form_submission': render FormSubmissionCard
     * Card có border-l-4 border-primary-400, bg-primary-50
     * Header: icon ClipboardList + tên template form
     * Body: render từng field label + value theo template_snapshot
     * Footer: tên người gửi, thời gian
     * Click "Xem chi tiết" → mở modal full submission

5. Mention notification badge:
   - Check mentions array có auth.uid() không
   - Nếu có và chưa đọc → badge đỏ trên NavTab Chat
   - Lưu "last_read" per context vào localStorage

Dùng Supabase Realtime chỉ để trigger refetch (không stream data).
Kết hợp fallback polling 60s để đảm bảo không bỏ sót tin khi Realtime mất kết nối.
```


---

## 📋 PHASE 2b — Module Form (Template Builder + Submissions)

### Thiết kế

Form là modal popup đơn giản, nhúng vào luồng chat. Không multi-step, không phức tạp.
Field types hỗ trợ: `text`, `textarea`, `number`, `date`, `select`, `checkbox`.
Conditional field: 1 field có thể ẩn/hiện dựa trên giá trị của field khác.

### Schema Supabase

```sql
-- Form Templates
create table public.form_templates (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  fields jsonb not null default '[]',
  -- fields schema:
  -- [
  --   {
  --     "id": "f1",
  --     "label": "Tên dự án",
  --     "type": "text",          -- text|textarea|number|date|select|checkbox
  --     "required": true,
  --     "placeholder": "...",
  --     "options": ["A","B","C"], -- chỉ dùng khi type=select
  --     "validation": {
  --       "min": 0, "max": 100,   -- cho number
  --       "minLength": 3          -- cho text
  --     },
  --     "condition": {            -- null = luôn hiện
  --       "field_id": "f2",       -- ẩn/hiện dựa theo field f2
  --       "operator": "eq",       -- eq | neq | gt | lt
  --       "value": "Có"
  --     }
  --   }
  -- ]
  is_active boolean default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Form Submissions
create table public.form_submissions (
  id uuid default uuid_generate_v4() primary key,
  template_id uuid references public.form_templates(id),
  template_name text not null,        -- snapshot tên
  template_snapshot jsonb not null,   -- snapshot toàn bộ fields tại thời điểm submit
                                      -- đảm bảo đọc đúng kể cả khi template thay đổi sau
  submitted_by uuid references public.profiles(id),
  context_type text check (context_type in ('channel', 'project', 'standalone')),
  context_id uuid,
  data jsonb not null,                -- {"f1": "Dự án A", "f2": 75, "f3": "On track"}
  submitted_at timestamptz default now()
);

-- Thêm FK từ chat_messages về form_submissions
alter table public.chat_messages
  add constraint fk_form_submission
  foreign key (form_submission_id) references public.form_submissions(id);

-- Indexes
create index on public.form_submissions (template_id, submitted_at desc);
create index on public.form_submissions (submitted_by);
create index on public.form_submissions (context_type, context_id);

-- RLS
alter table public.form_templates enable row level security;
alter table public.form_submissions enable row level security;

-- Xem template: tất cả user đã login
create policy "All users view templates" on public.form_templates
  for select using (auth.uid() is not null and is_active = true);

-- Tạo/sửa template: admin, editor, hoặc leader (có subordinates)
create policy "Admin/Editor/Leader manage templates" on public.form_templates
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
    or exists (
      select 1 from public.leader_members where leader_id = auth.uid()
    )
  );

-- Xem submissions: admin/editor thấy tất cả,
-- leader thấy submissions của subordinates, user thấy của mình
create policy "View submissions by role" on public.form_submissions
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
    or submitted_by in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Users can submit forms" on public.form_submissions
  for insert with check (submitted_by = auth.uid());
```

### Prompt cho Claude Code
```
Dựa vào schema form_templates và form_submissions đã tạo, hãy build:

1. FormsPage (/forms) — quản lý templates:
   - Chỉ admin/editor/leader thấy trang này trong NavTabs
   - List templates: tên, mô tả, số fields, số submissions, ngày cập nhật
   - Nút tạo mới, sửa, ẩn (is_active=false), duplicate

2. Form Template Editor (modal hoặc trang /forms/:id/edit):
   - Field: tên form, mô tả
   - Danh sách fields, drag để reorder
   - Mỗi field có:
     * Label (text input)
     * Type (dropdown): Text / Textarea / Number / Ngày / Lựa chọn / Checkbox
     * Required toggle
     * Placeholder (nếu text/textarea)
     * Options (nếu type=select): input comma-separated hoặc add/remove từng option
     * Validation: min/max (number), minLength (text)
     * Điều kiện hiển thị (optional): chọn field khác + operator + value
       → field này chỉ hiện khi điều kiện đúng
   - Nút thêm field, xóa field
   - Preview live bên phải (hoặc tab Preview)

3. Form Fill Modal (mở từ chat input, nút "Form"):
   - Dropdown chọn template (search được)
   - Render các fields theo template.fields
   - Xử lý conditional: watch field có condition, ẩn/hiện field phụ thuộc real-time
   - Validation khi submit (react-hook-form + zod schema sinh động từ field definitions)
   - Submit: POST form_submissions → rồi gửi chat_messages type='form_submission'
   - UI: modal max-w-lg, clean, giống popup form thu thập thông tin

4. FormSubmissionCard (hiển thị trong chat feed):
   - Card border-l-4 border-primary-400 bg-primary-50 rounded-lg p-3
   - Header: icon ClipboardList + tên template (font-medium)
   - Body: render label + value từng field theo template_snapshot
     * Ẩn field có value null/empty
     * Select/checkbox hiển thị label đẹp, không phải raw value
   - Footer: submitted_by avatar + tên, timestamp relative
   - Nút "Xem chi tiết" → modal full với tất cả fields

5. Submissions Viewer (tab trong FormsPage):
   - Table: người gửi, template, context (channel/project), thời gian
   - Filter theo template, người gửi, khoảng thời gian
   - Click row → modal xem full submission
   - Export CSV (tất cả submissions của 1 template)
   - Leader chỉ thấy submissions của team mình

Lưu ý quan trọng về template_snapshot:
Khi render FormSubmissionCard, LUÔN dùng submission.template_snapshot để biết
label và options của từng field — không dùng template hiện tại vì có thể đã thay đổi.
```

---

## 📁 PHASE 3 — Module Quản lý Dự án

### Schema Supabase

```sql
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'review', 'completed', 'cancelled')),
  assigned_to uuid references public.profiles(id),
  due_date date,
  -- Customer portal
  public_token text unique default encode(gen_random_bytes(16), 'hex'),
  portal_password_hash text,
  portal_enabled boolean default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: user thấy project được gán cho mình hoặc subordinates của leader
alter table public.projects enable row level security;

create policy "Access own and subordinate projects" on public.projects
  for select using (
    assigned_to = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
    or assigned_to in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Admin/Editor can manage projects" on public.projects
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );
```

### Prompt cho Claude Code
```
Dựa vào schema projects đã tạo, hãy build Module Quản lý Dự án:

1. ProjectsPage — 2 view toggle:
   - Kanban: cột theo status, drag card để đổi status
   - Table: cột Tên, Phụ trách, Status badge, Deadline, % workflow hoàn thành
   - Filter theo status, assigned_to

2. Modal tạo dự án:
   - Fields: Tên*, Mô tả, Giao cho (chọn user), Deadline

3. ProjectDetailPage (/projects/:id):
   Cột trái (65%): Tabs
   - Tab "Workflow": danh sách workflow runs gắn với project này
     Nút "Chạy workflow mới" → chọn template → tạo run mới
   - Tab "Thread": chat thread của project này
     Dùng context_type="project", context_id=project.id
     Load từ chat_messages, hiển thị và input giống Module Chat
   Cột phải (35%):
   - Card thông tin, đổi status
   - Card Customer Portal: toggle, password, copy link

4. Gắn workflow vào project:
   - Khi tạo workflow run, có field project_id optional
   - Trong project detail hiện danh sách các run thuộc project đó
```

---

## 🔀 PHASE 4 — Module Workflow (Template + Run)

### Thiết kế

- **Template** = bản thiết kế workflow, admin/editor tạo và chỉnh sửa
- **Run** = mỗi lần một user thực thi workflow đó
  - Lưu toàn bộ: ai chạy, lúc nào, tick gì, chọn nhánh nào, ghi chú từng bước
  - Có thể gắn vào project hoặc standalone
  - Sau khi hoàn thành → status = "completed", dữ liệu được lưu vĩnh viễn
- **Leader** xem được tất cả runs của member trực thuộc

### Schema Supabase

```sql
-- Workflow Templates
create table public.workflow_templates (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  is_active boolean default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Template Steps (cây có nhánh điều kiện)
create table public.workflow_steps (
  id uuid default uuid_generate_v4() primary key,
  template_id uuid references public.workflow_templates(id) on delete cascade,
  parent_step_id uuid references public.workflow_steps(id),  -- null = root step
  branch_condition text,  -- giá trị điều kiện từ step cha (vd: "Có", "Không")
  title text not null,
  description text,
  step_type text not null default 'simple'
    check (step_type in ('simple', 'branch')),  -- branch = có lựa chọn điều kiện
  branch_options text[],   -- ví dụ: ['Có', 'Không', 'Cần xem xét']
  order_index integer not null default 0,
  created_at timestamptz default now()
);

-- Workflow Runs (mỗi lần user chạy)
create table public.workflow_runs (
  id uuid default uuid_generate_v4() primary key,
  template_id uuid references public.workflow_templates(id),
  template_name text not null,   -- snapshot tên tại thời điểm chạy
  project_id uuid references public.projects(id),  -- null = standalone
  run_by uuid references public.profiles(id),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  started_at timestamptz default now(),
  completed_at timestamptz
);

-- Step Results (kết quả từng bước trong run)
create table public.workflow_step_results (
  id uuid default uuid_generate_v4() primary key,
  run_id uuid references public.workflow_runs(id) on delete cascade,
  step_id uuid references public.workflow_steps(id),
  is_done boolean default false,
  branch_selected text,   -- giá trị nhánh đã chọn nếu step_type = branch
  note text,
  done_at timestamptz
);

-- Indexes
create index on public.workflow_runs (run_by, status);
create index on public.workflow_runs (project_id);
create index on public.workflow_step_results (run_id);

-- RLS
alter table public.workflow_templates enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_step_results enable row level security;

create policy "All can view templates" on public.workflow_templates
  for select using (auth.uid() is not null);

create policy "Admin/Editor manage templates" on public.workflow_templates
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

-- User thấy run của mình + run của subordinates nếu là leader
create policy "View own and subordinate runs" on public.workflow_runs
  for select using (
    run_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
    or run_by in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Users can create and update own runs" on public.workflow_runs
  for all using (run_by = auth.uid());
```

### Prompt cho Claude Code
```
Dựa vào schema workflow đã tạo, hãy build Module Workflow:

1. WorkflowsPage — danh sách templates:
   - List templates: tên, mô tả, số bước, ngày cập nhật
   - Nút tạo mới, duplicate, xóa (admin/editor only)
   - Nút "Chạy" → tạo run mới từ template này
   - Tab "Runs của tôi": list runs của current user, status badge, % hoàn thành
   - Tab "Runs của team" (chỉ hiện với leader/admin): list runs của tất cả subordinates
     Group theo tên user, filter theo template, status

2. Template Editor (/workflows/:id/edit):
   - Form tên + mô tả
   - Danh sách steps dạng tree có indent
   - Mỗi step:
     * Input tên bước
     * Dropdown type: "Đơn giản" / "Có nhánh điều kiện"
     * Nếu type = branch: input danh sách options (comma-separated)
     * Các step con của branch có indent + label điều kiện màu amber
     * Drag handle reorder (@dnd-kit/sortable)
     * Nút thêm step con, nút xóa

3. WorkflowRunPage (/workflows/runs/:runId):
   - Header: tên template, tên user chạy, thời gian bắt đầu, status
   - Danh sách steps theo thứ tự:
     * Checkbox tick done
     * Nếu step_type = branch và đã tick: hiện dropdown chọn nhánh
       → sau khi chọn, chỉ hiển thị các step con thuộc nhánh đó
     * Textarea ghi chú per step (optional)
     * Timestamp khi tick
   - Progress bar % hoàn thành ở header
   - Nút "Hoàn thành workflow" khi tất cả bước done → set status = completed, completed_at = now()
   - Sau khi completed: read-only, hiển thị summary đẹp

4. Run History (trong WorkflowsPage tab "Runs của team"):
   - Leader xem được runs của subordinates
   - Click vào run → mở WorkflowRunPage ở chế độ read-only
   - Hiện đầy đủ ai làm gì, chọn nhánh nào, ghi chú gì
```

---

## 🌐 PHASE 5 — Customer Portal (Web riêng)

### Logic
Portal không cần Electron, là web app riêng deploy Vercel.
Dùng `public_token` từ bảng projects để identify, không cần Supabase Auth.

### Prompt cho Claude Code
```
Tạo một Vite + React app riêng trong subfolder /portal của monorepo.
App này deploy Vercel, không liên quan đến Electron.

1. Route /portal/:token:
   - Fetch project bằng public_token dùng Supabase anon key
   - Nếu không tìm thấy hoặc portal_enabled = false → 404 page

2. Password gate:
   - Nếu project có portal_password_hash → hiện form nhập mật khẩu
   - Verify bằng bcryptjs trên client (hoặc Supabase Edge Function)
   - Lưu verified state vào sessionStorage

3. Portal page:
   - Header: tên dự án, logo công ty
   - Progress bar: % workflow runs đã completed / tổng
   - Danh sách workflow runs gắn với project: tên template, status, % hoàn thành
   - Project thread: hiện messages có context_type="project" và context_id=project.id
     * Ẩn messages có is_internal=true
     * Form gửi message: nhập tên + nội dung (không cần đăng nhập)
     * author_type = "customer", lưu customer_name
   - Design clean, mobile-friendly, không có sidebar/nav

4. Realtime optional (chỉ cho portal):
   - Subscribe Supabase Realtime để cập nhật progress khi team tick workflow
   - Đây là nơi duy nhất dùng realtime — nhẹ, chỉ 1 channel per session
```

---

## 🚀 PHASE 6 — Deploy & Polish

### Prompt cho Claude Code
```
Thực hiện các bước hoàn thiện:

1. Loading & Error states:
   - Skeleton (bg-neutral-100 animate-pulse) cho tất cả lists
   - Toast system: góc dưới phải, timeout 3s
     success: bg-green-50 border-green-200
     error: bg-red-50 border-red-200

2. Electron build:
   - Cấu hình electron-builder: mac (dmg), win (nsis), linux (AppImage)
   - Command: npm run build → electron-builder

3. Portal deploy Vercel:
   - Subfolder /portal build riêng
   - Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (production Supabase)

4. Chuyển Supabase Local → Supabase Cloud (khi ready):
   - Tạo project trên supabase.com
   - Export schema local: supabase db dump > schema.sql
   - Import lên cloud qua Supabase SQL Editor
   - Đổi env variables trỏ về cloud URL + keys

5. Database indexes (chạy trong Supabase):
   create index on public.workflow_runs (run_by, status);
   create index on public.workflow_runs (project_id);
   create index on public.chat_messages (context_type, context_id, created_at desc);
   create index on public.projects (assigned_to);
   create index on public.projects (public_token);
```

---

## 📐 Database Schema tổng thể (ERD tóm tắt)

```
auth.users
  └── profiles (id, full_name, role: admin|editor|user)
        └── leader_members (leader_id → profiles, member_id → profiles)
              [bất kỳ user nào có row ở đây với leader_id = mình → là leader]

projects (assigned_to → profiles)
  ├── workflow_runs
  └── chat_messages (context=project)
        └── chat_attachments
        └── form_submissions (qua form_submission_id)

chat_channels
  └── chat_messages (context=channel)
        └── chat_attachments
        └── form_submissions (qua form_submission_id)

form_templates (created_by → profiles)
  └── form_submissions (template_id → form_templates)
        [template_snapshot lưu definitions tại thời điểm submit]

workflow_templates
  └── workflow_steps (self-ref tree, branch_condition)
        └── workflow_runs (run_by → profiles, project_id optional)
              └── workflow_step_results
```

---

## 🔑 Lưu ý khi làm việc với Claude Code

1. **Build từng phase, test trước khi qua phase tiếp**
2. **Phase 2 và 2b liên quan chặt** — build chat feed trước, form card sau
3. **Phase 2b và Phase 3 có thể song song** — không phụ thuộc nhau
4. **Phase 4 phụ thuộc Phase 3** (workflow run cần project_id)
5. **Luôn chạy `supabase start` trước khi dev** — Docker phải đang chạy
6. **Test portal trên incognito** để không lẫn Supabase session
7. **Khi migrate lên Supabase Cloud**: chỉ đổi env variables, không đổi code
8. **Leader check trong UI**: dùng `is_leader = await supabase.from('leader_members').select().eq('leader_id', user.id).limit(1)` — có row = là leader
9. **template_snapshot là bất biến** — không bao giờ update sau khi submit, chỉ dùng để render lại submission cũ

---

## 🎨 DESIGN SYSTEM — AIFA Wiki Reference

> Section này là nguồn sự thật duy nhất về UI. Paste vào Claude Code khi bắt đầu build bất kỳ component nào.

### Stack & Font

- **React 18 + TypeScript + Vite + Electron**, Tailwind CSS (utility-first, no CSS modules)
- **Icons**: `lucide-react` — size 12–14px trong sidebar, 16px trong content
- **UI font**: `Source Serif 4` (serif) — fallback: Georgia
- **Mono**: `JetBrains Mono` — fallback: Consolas
- Root font-size: `17px` (chrome UI), content area: `18px`
- `font-smoothing: antialiased` trên `<body>`

Load fonts qua Google Fonts trong `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

### Tailwind Config — extend colors

Thêm vào `tailwind.config.ts`:

```ts
extend: {
  colors: {
    primary: {
      50:  '#eef1f8',
      100: '#d9e0f0',
      200: '#b3c1e1',
      300: '#8da2d2',
      400: '#6783c3',
      500: '#4964A3',  // main brand
      600: '#3d559a',
      700: '#324690',
      800: '#263880',
      900: '#1a2a70',
    },
    neutral: {
      25:  '#faf9f7',
      50:  '#f5f4f1',
      100: '#eceae6',
      200: '#d8d5cf',
      300: '#b8b4ac',
      400: '#8a8680',
      500: '#635f59',
      600: '#4a4640',
      700: '#333028',
      800: '#1f1d18',  // body text
      900: '#141210',
    },
  },
  fontFamily: {
    serif: ['"Source Serif 4"', 'Georgia', 'serif'],
    mono:  ['"JetBrains Mono"', 'Consolas', 'monospace'],
  },
}
```

---

### Layout — 3-Panel App Shell

```
┌────────────────────────────────────────────────────┐
│  Titlebar  (h-10, drag region, bg-neutral-100)     │
├──────┬──────────────────────┬──────────────────────┤
│ Nav  │  Sidebar             │  Content             │
│ w-12 │  w-[320px]           │  flex-1              │
│      │  bg-neutral-25       │  bg-white            │
│      │  border-r            │  p-6 hoặc p-8        │
└──────┴──────────────────────┴──────────────────────┘
```

**NavTabs** (`w-12`, `bg-neutral-800`):
- Icon-only, mỗi tab `h-12 flex items-center justify-center`
- Inactive: `text-neutral-400 hover:text-neutral-200`
- Active: `bg-primary-50 text-primary-600` (dải highlight)

**Sidebar** (`w-[320px]`, `bg-neutral-25` = `#faf9f7`):
- `border-r border-neutral-100`
- Overflow-y scroll, custom scrollbar 5px
- Section heading: `text-[10px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-200 pb-1.5 mb-1`
- Item row: `py-1.5 px-2 rounded-lg text-[13px]`
  - Hover: `hover:bg-neutral-50`
  - Active: `bg-primary-50 text-primary-700`
  - Meta text: `text-[11px] text-neutral-400`
  - Actions on hover: `opacity-0 group-hover:opacity-100 transition-opacity`

**Content area**: `flex-1 bg-white overflow-y-auto p-6`

---

### Color Usage Rules

| Màu | Dùng cho |
|-----|----------|
| `primary-600` | Buttons chính, active states, links |
| `primary-50 / primary-100` | Background highlight, selected rows |
| `neutral-800` | Body text chính |
| `neutral-500` | Muted text, placeholder |
| `neutral-200` | Borders, dividers |
| `neutral-25` | Sidebar background |
| `amber-500` | Tips, exercises, cảnh báo nhẹ |
| `green-500` | Thành công, hoàn thành |
| `red-500` | Lỗi, xóa, nguy hiểm |
| `violet-500` | Quiz, câu hỏi |

Background trang: luôn `#ffffff` (pure white), **không dùng neutral-50 cho page bg**.
Selection highlight: `bg-[#d9e0f0] text-[#1a1816]`.

---

### Component Patterns

**Button variants:**
```tsx
// primary
className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 text-sm rounded-lg"
// secondary
className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200 px-4 py-2 text-sm rounded-lg"
// ghost
className="text-neutral-600 hover:bg-neutral-100 px-4 py-2 text-sm rounded-lg"
// danger
className="bg-red-500 text-white hover:bg-red-600 px-4 py-2 text-sm rounded-lg"
// size sm
className="... px-3 py-1.5 text-xs rounded"
```

**Input:**
```tsx
className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded px-3 py-1.5 text-sm font-serif bg-white w-full"
```

**Modal:**
- Overlay: `fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center`
- Panel: `bg-white rounded-xl shadow-xl w-full max-w-md`
- Header: `border-b border-neutral-100 px-5 py-4 font-serif text-lg font-medium`
- Footer: `border-t border-neutral-100 px-5 py-4 flex justify-end gap-2`

**Badge / Status chip:**
```tsx
// Project status
const projectStatusColors = {
  open:        'bg-neutral-100 text-neutral-600',
  in_progress: 'bg-amber-50 text-amber-700',
  review:      'bg-primary-50 text-primary-700',
  completed:   'bg-green-50 text-green-700',
  cancelled:   'bg-red-50 text-red-700',
}

// Workflow run status
const workflowRunColors = {
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  cancelled:   'bg-neutral-100 text-neutral-500',
}

// User role badge
const roleColors = {
  admin:  'bg-violet-50 text-violet-700',
  editor: 'bg-primary-50 text-primary-700',
  user:   'bg-neutral-100 text-neutral-600',
}

// Base badge class:
className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
```

**Card / Panel:**
```tsx
className="bg-white border border-neutral-100 rounded-lg p-4 shadow-sm"
```

**Section heading (trong content area):**
```tsx
className="text-lg font-serif font-medium text-neutral-800 mb-4"
```

**Custom scrollbar (global CSS):**
```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d8d5cf; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #b8b4ac; }
```

---

### Typography Scale

| Class | px (root=17px) | Dùng cho |
|-------|---------------|----------|
| `text-[9px]` | 9px | Micro labels, status badges |
| `text-[10px]` | 10px | Section headings sidebar |
| `text-[11px]` | 11px | Meta, timestamps |
| `text-xs` | ~11.9px | Captions, helper text |
| `text-sm` | ~13.6px | Body UI, buttons, list items |
| `text-[13px]` | 13px | Sidebar item titles |
| `text-base` | ~17px | Default body |
| `text-lg` | ~20.4px | Section headings |
| `text-xl`+ | 24px+ | Page titles |

Font weight: dùng `font-normal` (400) và `font-medium` (500) là chủ yếu. `font-semibold` (600) chỉ cho section headings sidebar và labels nhỏ.

---

### Design Language Summary

- **Warm minimal** — nền trắng, neutral có tinge sepia, không dùng pure gray
- Serif font tạo cảm giác editorial / knowledge-base, không phải SaaS thông thường
- Brand color xanh-indigo muted, không saturated
- Spacing dense — thông tin dày, không breezy
- Không dùng heavy shadows hay gradients — flat với subtle borders
- Accent colors (amber, green, red, violet) chỉ dùng cho status indicators, không trang trí

