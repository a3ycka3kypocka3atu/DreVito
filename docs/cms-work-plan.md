# Drevito CMS work plan

This document is the handoff map for building the client-editable CMS across separate Codex chats.

Use it at the start of every new chat so the agent understands what is already done, what must stay consistent, and what the next step should be.

## Current direction

Drevito is a static website served by a small Node.js server. The client needs an admin area where they can log in and manage photos, text, products, product categories, blog posts, and blog categories.

Admin authentication is handled by Google OAuth in `server.js`.

Supabase should be used for:

- database content
- image/file storage
- media metadata
- products and product categories
- blog posts and blog categories
- editable public site content

Supabase should not be used for admin login unless the plan changes later.

## Already completed

### Step 1: Admin login

Status: done in code.

Files:

- `server.js`
- `package.json`
- `.env.example`
- `README.md`

Current behavior:

- `/admin` is protected.
- `/admin/login` shows Google sign-in.
- Google OAuth redirect/callback exists.
- Login is restricted by `GOOGLE_ALLOWED_EMAIL`.
- Admin session uses signed HTTP-only cookies.
- Logout uses `POST`.

Still needed outside code:

- Create Google OAuth Web Application credentials.
- Add local redirect URI:
  - `http://localhost:8000/admin/oauth/google/callback`
- Add production redirect URI later:
  - `https://your-domain.example/admin/oauth/google/callback`
- Fill real `.env` values.

### Step 2: Supabase content schema

Status: schema file done and applied to the real Supabase project on 2026-07-11.

Files:

- `supabase/migrations/20260708153000_create_content_model.sql`
- `supabase/config.toml`
- `docs/database-content-model.md`
- `.env.example`

Schema covers:

- `users`
- `site_content`
- `media`
- `products`
- `product_categories`
- `product_category_links`
- `blog_posts`
- `blog_categories`
- `blog_category_links`

Remote setup:

- Tables and RLS were verified on project `uaaszmcfancqxrhkoamc`.
- Public Storage buckets were created/verified:
  - `site-media`
  - `product-images`
  - `blog-images`
- See the 2026-07-11 Supabase setup record under Step 10 for exact migration and access-control details.

### Step 3: Media uploads

Status: done in code with Supabase Storage as the production path and local storage preserved as the no-Supabase fallback.

Files:

- `server.js`
- `index.html`
- `.gitignore`
- `README.md`

Current behavior:

- Protected admin media manager exists at `/admin/media`.
- Admin can upload, preview, replace, and delete photos.
- Supports `site_sections`, `products`, and `blog_posts` targets.
- Supports multiple product/blog images.
- Supports replacement-style site section images.
- Public `/api/media-targets` lets `index.html` apply managed image URLs.
- When Supabase is configured, uploaded files are stored in `site-media`, `product-images`, or `blog-images`, metadata is saved in `media`, and target assignments are stored in `media.metadata`.
- When Supabase is not configured, uploaded files are stored in `/uploads/...`, and image URLs, metadata, and target assignments are stored in `.data/media-db.json`.

Verification reported:

- `node --check server.js` passes.
- `/api/media-targets` returns seeded site/product image data.
- `/admin/media` redirects to login when unauthenticated.
- Headless Chrome loaded the homepage and rendered product cards with managed image URLs applied.

Important requirement:

The local `/uploads` folder and `.data/media-db.json` database remain the fallback for local development without Supabase credentials. Production should use Supabase Storage and the `media` table.

Production behavior:

- Admin can upload images.
- Admin can preview uploaded images.
- Admin can replace images.
- Admin can delete images.
- Uploaded files go to the correct Supabase Storage bucket:
  - `site-media`
  - `product-images`
  - `blog-images`
- Image metadata is saved in the `media` table.
- `/api/media-targets` reconstructs the existing target JSON from `media.metadata`.
- Server-side code uses `SUPABASE_SERVICE_ROLE_KEY`.
- Browser/public frontend never receives `SUPABASE_SERVICE_ROLE_KEY`.

### Step 4: Product categories admin

Status: done in code. Remote migration applied and verified on 2026-07-11.

Files:

- `server.js`
- `README.md`
- `docs/database-content-model.md`
- `supabase/migrations/20260708170000_add_product_category_admin_fields.sql`

Current behavior:

- Protected admin page exists at `/admin/product-categories`.
- Admin can list, create, edit, show/hide, sort, archive, and restore product categories.
- Category fields include title, slug, description, optional image metadata, sort order, and visibility.
- Slug validation is server-side and duplicate slugs return a clear error.
- Category records are read/written through server-side Supabase REST helpers using `SUPABASE_SERVICE_ROLE_KEY`.
- Service role key is not exposed to browser code.
- Category archiving uses `archived_at` and sets `is_visible` false, so product links can remain intact.
- Optional category images temporarily save `{ url, alt, media_id }` JSON while media selection is still local.

Verification reported:

- `node --check server.js` passes.
- Admin category page redirects to login when unauthenticated.
- Admin category API redirects to login when unauthenticated.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm category CRUD against the real Supabase project after credentials are configured.
- Replace the temporary image URL/media-id fields with Supabase media selection after the media upload conversion.

Implemented required admin features:

- Protected admin page for product categories.
- List product categories.
- Create product category.
- Edit product category.
- Delete/archive product category safely.
- Fields:
  - title
  - slug
  - description
  - image/media optional
  - sort order
  - visibility
- Manual sorting by `sort_order`.
- Validation:
  - title is required
  - slug is required and unique
  - duplicate slugs should show a clear error
- Use Supabase through server-side admin API routes/helpers.
- Do not expose service role key to frontend code.
- If category image selection is needed before Supabase media conversion, use the existing local media manager shape temporarily and leave a clear TODO for Supabase-backed media selection.

### Step 5: Product admin

Status: done in code. Remote migration applied and verified on 2026-07-11.

Files:

- `server.js`
- `README.md`
- `docs/database-content-model.md`
- `supabase/migrations/20260708183000_add_product_admin_archive.sql`

Current behavior:

- Protected admin page exists at `/admin/products`.
- Admin can list, create, edit, show/hide, publish/unpublish, sort, archive, and restore products.
- Product fields include title, slug, short description, full description, ordered photos JSON, sort order, visibility, publish state, and published date.
- Products can be assigned to one or more product categories through `product_category_links`.
- Product records and category links are read/written through server-side Supabase REST helpers using `SUPABASE_SERVICE_ROLE_KEY`.
- Service role key is not exposed to browser code.
- Product archiving uses `archived_at`, sets `is_visible` false, sets `is_published` false, and preserves category links/photos.
- Product photos can be added by URL/media reference or uploaded. With Supabase configured, uploads go to `product-images` and `media`; without Supabase, they fall back to `.data/media-db.json` and `/uploads/products/...`. Uploaded photos are saved into `products.photos` as ordered JSON.

Verification reported:

- `node --check server.js` passes.
- Admin product page redirects to login when unauthenticated.
- Admin product API redirects to login when unauthenticated.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm product CRUD and category link writes against the real Supabase project after credentials are configured.
- Confirm product photo uploads against the real Supabase project and public `product-images` bucket after credentials are configured.

Implemented required admin features:

- List products.
- Create product.
- Edit product.
- Delete/archive product safely.
- Upload/choose product images.
- Assign one or more product categories.
- Set short description and full description.
- Set slug.
- Set sort order.
- Toggle visible/published.
- Save photos as ordered JSON using existing `products.photos` shape.
- Public site can later read published/visible products.

### Step 6: Blog categories admin

Status: done in code. Remote migration applied and verified on 2026-07-11.

Files:

- `server.js`
- `README.md`
- `docs/database-content-model.md`
- `supabase/migrations/20260708190000_add_blog_category_admin_fields.sql`

Current behavior:

- Protected admin page exists at `/admin/blog-categories`.
- Admin can list, create, edit, show/hide, sort, archive, and restore blog categories.
- Category fields include title, slug, description, optional image metadata, sort order, and visibility.
- Suggested starter categories are inserted by migration: Craft, Place, Author, Philosophy, Products, and News.
- Slug validation is server-side and duplicate slugs return a clear error.
- Category records are read/written through server-side Supabase REST helpers using `SUPABASE_SERVICE_ROLE_KEY`.
- Service role key is not exposed to browser code.
- Category archiving uses `archived_at` and sets `is_visible` false, so blog post links can remain intact.
- Optional category images temporarily save `{ url, alt, media_id }` JSON while media selection is still local.

Verification reported:

- `node --check server.js` passes.
- Admin blog category page redirects to login when unauthenticated.
- Admin blog category API redirects to login when unauthenticated.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm blog category CRUD against the real Supabase project after credentials are configured.
- Replace the temporary image URL/media-id fields with Supabase media selection after the media upload conversion.

Implemented required admin features:

- List blog categories.
- Create blog category.
- Edit blog category.
- Delete/archive blog category safely.
- Fields:
  - title
  - slug
  - description
  - image/media optional
  - sort order
  - visibility
- Manual sorting by `sort_order`.
- Validation:
  - title is required
  - slug is required and unique
  - duplicate slugs should show a clear error
- Use Supabase through server-side admin API routes/helpers.
- Do not expose service role key to frontend code.
- If category image selection is needed before Supabase media conversion, use the existing local media manager shape temporarily and leave a clear TODO for Supabase-backed media selection.

### Step 7: Blog posts admin

Status: done in code. Remote schema and buckets verified on 2026-07-11.

Files:

- `server.js`
- `README.md`
- `docs/cms-work-plan.md`

Current behavior:

- Protected admin page exists at `/admin/blog-posts`.
- Admin can list, create, edit, publish/unpublish, sort, archive, and restore blog posts.
- Blog post fields include title, slug, excerpt, main content, content format, author name, ordered photos JSON, status, publish date, and sort order.
- Blog posts can be assigned to one or more blog categories through `blog_category_links`.
- Blog post records and category links are read/written through server-side Supabase REST helpers using `SUPABASE_SERVICE_ROLE_KEY`.
- Service role key is not exposed to browser code.
- Blog post archiving uses `status = 'archived'`, clears `published_at`, and preserves category links/photos.
- Blog post photos can be added by URL/media reference or uploaded. With Supabase configured, uploads go to `blog-images` and `media`; without Supabase, they fall back to `.data/media-db.json` and `/uploads/blog_posts/...`. Uploaded photos are saved into `blog_posts.photos` as ordered JSON.

Verification reported:

- `node --check server.js` passes.
- Admin blog post page redirects to login when unauthenticated.
- Admin blog post API redirects to login when unauthenticated.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm blog post CRUD and category link writes against the real Supabase project after credentials are configured.
- Confirm blog photo uploads against the real Supabase project and public `blog-images` bucket after credentials are configured.

Implemented required admin features:

- List blog posts.
- Create blog post.
- Edit blog post.
- Delete/archive blog post safely.
- Draft/published/archived status.
- Title, slug, excerpt, body/content.
- Author fields.
- Publish date.
- Upload/choose images.
- Assign one or more blog categories.
- Sort posts with `sort_order`.

### Step 8: Editable site content

Status: done in code. Remote schema and buckets verified on 2026-07-11.

Files:

- `server.js`
- `README.md`
- `docs/cms-work-plan.md`

Current behavior:

- Protected admin page exists at `/admin/site-content`.
- Admin can list, create, edit, publish/unpublish, archive, and restore general website content.
- Content records are read/written through server-side Supabase REST helpers using `SUPABASE_SERVICE_ROLE_KEY`.
- Service role key is not exposed to browser code.
- Content fields include locale, section, label, content key, content type, JSON value, status, sort order, and publish date.
- Supported content types are `text`, `rich_text`, `image`, `gallery`, `link`, and `json`.
- Quick presets exist for homepage hero text/image, about text, craft/philosophy text, contact text, gallery images, products intro text, and blog intro text.
- Site content photos can be added by URL/media reference or uploaded. With Supabase configured, uploads go to `site-media` and `media`; without Supabase, they fall back to `.data/media-db.json` and `/uploads/site_sections/...`. Uploaded photos are saved into `site_content.value` as image/gallery JSON.
- Archiving uses `status = 'archived'`, clears `published_at`, and preserves content values.

Verification reported:

- `node --check server.js` passes.
- Admin site content page redirects to login when unauthenticated.
- Admin site content API redirects to login when unauthenticated.
- Public homepage still returns `200 OK`.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm site content CRUD against the real Supabase project after credentials are configured.
- Confirm site-content photo uploads against the real Supabase project and public `site-media` bucket after credentials are configured.

Implemented required admin features:

- Admin editor for general website sections.
- Content stored in `site_content`.
- Editable homepage hero title/text/image.
- Editable about text.
- Editable craft/philosophy text.
- Editable contact text.
- Editable gallery images.
- Editable products intro text.
- Editable blog intro text.

## Completed current step

### Step 9: Public website integration

Status: done in code. Remote schema/storage are applied; real public content still must be added and verified after credentials are configured.

Files:

- `server.js`
- `index.html`
- `README.md`
- `docs/cms-work-plan.md`

Current behavior:

- Public read-only CMS endpoint exists at `/api/public-content?locale=cs`.
- Public endpoint uses server-side Supabase REST helpers and never exposes `SUPABASE_SERVICE_ROLE_KEY`.
- Public endpoint returns only published/visible content:
  - `site_content.status = published`
  - products with `is_visible`, `is_published`, no `archived_at`, and no future `published_at`
  - visible/non-archived product categories
  - blog posts with `status = published` and no future `published_at`
  - visible/non-archived blog categories
- Public endpoint resolves image `media_id` references through public `media.public_url` when available, while still accepting legacy/local `url` values during migration.
- Homepage keeps the static product fallback when Supabase is not configured.
- When Supabase is configured, homepage replaces public products, product categories, blog posts, blog categories, and editable site text/images from `/api/public-content`.
- Product category filtering is generated from public product categories.
- Blog category filtering is generated from public blog categories.
- Product detail content opens in an in-page detail section.
- Blog post content opens in an in-page article section.
- `/api/media-targets` image replacements work from Supabase `media.metadata` when configured and from local `.data/media-db.json` when Supabase is absent.

Verification reported:

- `node --check server.js` passes.
- Inline homepage script parses successfully.
- `/api/public-content?locale=cs` returns `configured:false` with empty public collections when Supabase credentials are absent.
- Homepage returns `200 OK`.
- Headless Chrome loaded the homepage and rendered populated DOM content.

Still needed outside code:

- Fill real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Add real published products, product categories, blog posts, blog categories, and site content in Supabase.
- Confirm `/api/public-content?locale=cs` returns real published content against the production Supabase project.
- Confirm Supabase Storage uploads and public image URLs against the production Supabase project.

Implemented required features:

- Public products list.
- Public product detail sections.
- Product category filtering.
- Public blog list.
- Public blog post sections.
- Blog category filtering.
- Public site content pulled from `site_content`.
- Public images read from Supabase media URLs when `media_id` references exist.
- Only show published/visible content.

## Next recommended step

### Step 10: Polish and testing

Status: in progress. Media upload production conversion is done in code; real Supabase upload/delete verification still requires project credentials in the app environment.

Real Supabase setup status as of 2026-07-11:

- Supabase connector access is fixed.
- The real Drevito project is `uaaszmcfancqxrhkoamc`, in `eu-central-1`, running Postgres `17.6.1.141`.
- Local `supabase/config.toml` still says `project_id = "drevito"`; use the real remote ref `uaaszmcfancqxrhkoamc` for connector actions.
- Remote setup was applied directly to project `uaaszmcfancqxrhkoamc`.

Remote migrations applied:

- `20260708153000_create_content_model.sql`
- `20260708170000_add_product_category_admin_fields.sql`
- `20260708183000_add_product_admin_archive.sql`
- `20260708190000_add_blog_category_admin_fields.sql`
- `20260711141000_tighten_public_cms_grants.sql`
- `20260711142000_tighten_product_link_public_policy.sql`

Remote objects verified:

- Tables exist with RLS enabled:
  - `users`
  - `site_content`
  - `media`
  - `products`
  - `product_categories`
  - `product_category_links`
  - `blog_posts`
  - `blog_categories`
  - `blog_category_links`
- Public Storage buckets exist and are public:
  - `site-media`
  - `product-images`
  - `blog-images`
- No broad public `storage.objects` SELECT policy was added, so public buckets serve known public URLs without exposing bucket listing through Storage policies.
- `media` has `bucket`, `storage_path`, `public_url`, and `metadata`; `metadata` is `jsonb` and can store `/api/media-targets` target assignments such as `target_type`, `target_key`, `target_label`, `sort_order`, and `is_featured`.

Remote data status:

- Existing content tables were empty before setup.
- The blog category migration inserted the six starter categories (`craft`, `place`, `author`, `philosophy`, `products`, `news`) with `ON CONFLICT DO NOTHING`.
- No products, product categories, blog posts, site content, media rows, or link rows were added.

Remote access model verified:

- Public roles (`anon`, `authenticated`) have read-only column privileges on public content/media tables and no insert/update/delete privileges.
- `users` has no public column select and no public write privileges.
- Public RLS policies only allow:
  - published site content with no future `published_at`
  - public media (`is_public`)
  - published, visible, non-archived products with no future `published_at`
  - visible, non-archived product categories
  - product category links whose product and category are both public/non-archived
  - published blog posts with no future `published_at`
  - visible, non-archived blog categories
  - blog category links whose post and category are both public/non-archived
- Admin writes are intended to happen only from `server.js` with `SUPABASE_SERVICE_ROLE_KEY`; service role has select/insert/update/delete on CMS tables.

Supabase advisor notes:

- Security advisor reports `public.users` has RLS enabled with no policies. This is expected because the table is intentionally service-role-only.
- Performance advisor reports unindexed foreign keys on `created_by`, `updated_by`, and `uploaded_by`, plus unused indexes. Leave these alone until real usage patterns or performance work justify changes.

Still needed outside schema/storage setup:

- Fill real production `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm `/api/public-content?locale=cs` against real published content after content is entered.
- Confirm real Supabase upload/replace/delete flows from `/admin/media`, `/admin/products`, and `/admin/blog-posts` after production credentials are configured.
- Add real products, product categories, blog posts, site content, and media through the admin UI or a future approved content-import step.

Implemented in this pass:

- `/admin/media` keeps the existing target UI and now writes to Supabase Storage plus `media` when Supabase is configured.
- Site section uploads use `site-media`.
- Product uploads use `product-images`.
- Blog uploads use `blog-images`.
- `/api/media-targets` remains compatible with the public site and reads Supabase target assignments from `media.metadata`.
- Local `/uploads` and `.data/media-db.json` fallback remains active when Supabase is not configured.

Required features:

- Form validation.
- Save success/error messages.
- Confirm before delete/archive.
- Friendly empty states.
- Mobile-friendly admin screens.
- Admin route protection tests.
- Upload tests.
- Product/category/blog CRUD tests.
- Simple client instructions.
- Deployment checklist.

## Environment variables

Expected local `.env` values:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_ALLOWED_EMAIL=
SESSION_SECRET=
PUBLIC_URL=http://localhost:8000

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Rules:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript.
- Never commit real `.env` secrets.
- Use the publishable key only where public/browser access is intentionally needed.

## Implementation rules for future chats

- Read this file first.
- Read `docs/database-content-model.md` before changing Supabase tables.
- Keep admin writes server-side.
- Keep changes focused on the current step.
- Do not redesign unrelated public pages during admin/CMS steps.
- Prefer Supabase Storage and the `media` table for real image handling.
- If a local upload system exists, treat it as temporary unless explicitly converted to Supabase.
- After each step, update this document with status, files changed, and the next recommended prompt.
