# BOS — Setup Guide

## Prerequisites
- Node.js 18+
- Supabase Cloud account (supabase.com)
- Vercel account (vercel.com)

---

## Step 1 — Supabase Cloud

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Once ready, go to **Settings → API** and copy:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`

3. Go to **SQL Editor** → paste and run the entire contents of `supabase/schema.sql`

4. Go to **Storage** → create a bucket named `chat-attachments`:
   - **Public bucket**: ✅ Yes
   - Add policy: authenticated users can INSERT

5. Go to **Authentication → Email** → make sure email/password is enabled

6. Go to **Database → Realtime** → enable `chat_messages` table for Realtime

---

## Step 2 — Local development

```bash
# Clone and install
cd bos-project
npm install

# Fill in your Supabase keys
# Edit .env:
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Start dev server
npm run dev
# → http://localhost:5173
```

Create your first user:
- Go to Supabase → **Authentication → Users** → invite or add user manually
- The `profiles` row is auto-created via trigger on first login

---

## Step 3 — Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import repo
3. Set environment variables:
   ```
   VITE_SUPABASE_URL     = https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJ...
   ```
4. Deploy — `vercel.json` handles SPA routing automatically

---

## Supabase Storage bucket policy (SQL)

Run this in SQL Editor after creating the `chat-attachments` bucket:

```sql
-- Allow authenticated users to upload
create policy "Authenticated users can upload"
  on storage.objects for insert
  with check (bucket_id = 'chat-attachments' and auth.uid() is not null);

-- Allow public read
create policy "Public read"
  on storage.objects for select
  using (bucket_id = 'chat-attachments');
```

---

## Module build order (SQL dependency)

The schema.sql runs all phases in order. For reference:
- **Phase 1**: `profiles`, `leader_members` — run first
- **Phase 2**: `chat_channels`, `chat_messages`, `chat_attachments`
- **Phase 2b**: `form_templates`, `form_submissions` + ALTER chat_messages FK
- **Phase 3**: `projects`
- **Phase 4**: `workflow_templates`, `workflow_steps`, `workflow_runs`, `workflow_step_results`

---

## Customer Portal

The portal lives at `/portal/:token`. To test:
1. Create a project → enable Portal in the right panel
2. Copy the portal link
3. Open in an incognito window (no Supabase session required)
