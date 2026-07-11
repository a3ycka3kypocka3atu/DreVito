create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  role text not null default 'editor',
  is_active boolean not null default true,
  last_signed_in_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_shape check (position('@' in email) > 1),
  constraint users_role_valid check (role in ('owner', 'admin', 'editor'))
);

create table public.site_content (
  id uuid primary key default gen_random_uuid(),
  content_key text not null,
  locale text not null default 'cs',
  section text not null,
  label text not null,
  content_type text not null default 'text',
  value jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  sort_order integer not null default 0,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_content_key_format check (content_key ~ '^[a-z0-9][a-z0-9_.-]*$'),
  constraint site_content_type_valid check (content_type in ('text', 'rich_text', 'image', 'gallery', 'link', 'json')),
  constraint site_content_status_valid check (status in ('draft', 'published', 'archived')),
  constraint site_content_locale_key_unique unique (locale, content_key)
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media',
  storage_path text not null,
  public_url text,
  alt_text text,
  caption text,
  mime_type text,
  size_bytes integer,
  width integer,
  height integer,
  dominant_color text,
  is_public boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_size_positive check (size_bytes is null or size_bytes >= 0),
  constraint media_width_positive check (width is null or width > 0),
  constraint media_height_positive check (height is null or height > 0),
  constraint media_bucket_path_unique unique (bucket, storage_path)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  short_description text,
  description text,
  photos jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint products_photos_array check (jsonb_typeof(photos) = 'array')
);

create table public.product_category_links (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create table public.blog_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_categories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  main_content text,
  content_format text not null default 'html',
  photos jsonb not null default '[]'::jsonb,
  author_user_id uuid references public.users(id) on delete set null,
  author_name text,
  status text not null default 'draft',
  published_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_posts_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint blog_posts_content_format_valid check (content_format in ('html', 'markdown', 'portable_text')),
  constraint blog_posts_photos_array check (jsonb_typeof(photos) = 'array'),
  constraint blog_posts_status_valid check (status in ('draft', 'published', 'archived'))
);

create table public.blog_category_links (
  blog_post_id uuid not null references public.blog_posts(id) on delete cascade,
  category_id uuid not null references public.blog_categories(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (blog_post_id, category_id)
);

create index users_auth_user_id_idx on public.users (auth_user_id);
create index site_content_section_sort_idx on public.site_content (section, sort_order);
create index site_content_public_idx on public.site_content (locale, content_key) where status = 'published';
create index media_public_idx on public.media (is_public, created_at desc);
create index product_categories_visible_sort_idx on public.product_categories (is_visible, sort_order, title);
create index products_public_sort_idx on public.products (is_visible, is_published, sort_order, title);
create index products_photos_gin_idx on public.products using gin (photos);
create index product_category_links_category_idx on public.product_category_links (category_id, sort_order);
create index blog_categories_visible_sort_idx on public.blog_categories (is_visible, sort_order, title);
create index blog_posts_public_sort_idx on public.blog_posts (status, published_at desc, sort_order);
create index blog_posts_author_idx on public.blog_posts (author_user_id);
create index blog_posts_photos_gin_idx on public.blog_posts using gin (photos);
create index blog_category_links_category_idx on public.blog_category_links (category_id, sort_order);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger site_content_set_updated_at
before update on public.site_content
for each row execute function public.set_updated_at();

create trigger media_set_updated_at
before update on public.media
for each row execute function public.set_updated_at();

create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger blog_categories_set_updated_at
before update on public.blog_categories
for each row execute function public.set_updated_at();

create trigger blog_posts_set_updated_at
before update on public.blog_posts
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.site_content enable row level security;
alter table public.media enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_category_links enable row level security;
alter table public.blog_categories enable row level security;
alter table public.blog_posts enable row level security;
alter table public.blog_category_links enable row level security;

grant select (
  id,
  content_key,
  locale,
  section,
  label,
  content_type,
  value,
  status,
  sort_order,
  published_at,
  created_at,
  updated_at
) on table public.site_content to anon, authenticated;

grant select (
  id,
  bucket,
  storage_path,
  public_url,
  alt_text,
  caption,
  mime_type,
  size_bytes,
  width,
  height,
  dominant_color,
  is_public,
  metadata,
  created_at,
  updated_at
) on table public.media to anon, authenticated;

grant select on table public.product_categories to anon, authenticated;

grant select (
  id,
  title,
  slug,
  short_description,
  description,
  photos,
  sort_order,
  is_visible,
  is_published,
  published_at,
  created_at,
  updated_at
) on table public.products to anon, authenticated;

grant select on table public.product_category_links to anon, authenticated;
grant select on table public.blog_categories to anon, authenticated;

grant select (
  id,
  title,
  slug,
  excerpt,
  main_content,
  content_format,
  photos,
  author_name,
  status,
  published_at,
  sort_order,
  created_at,
  updated_at
) on table public.blog_posts to anon, authenticated;

grant select on table public.blog_category_links to anon, authenticated;

grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.site_content to service_role;
grant select, insert, update, delete on table public.media to service_role;
grant select, insert, update, delete on table public.product_categories to service_role;
grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update, delete on table public.product_category_links to service_role;
grant select, insert, update, delete on table public.blog_categories to service_role;
grant select, insert, update, delete on table public.blog_posts to service_role;
grant select, insert, update, delete on table public.blog_category_links to service_role;

create policy "Published site content is publicly readable"
on public.site_content
for select
to anon, authenticated
using (status = 'published' and (published_at is null or published_at <= now()));

create policy "Public media is publicly readable"
on public.media
for select
to anon, authenticated
using (is_public);

create policy "Visible product categories are publicly readable"
on public.product_categories
for select
to anon, authenticated
using (is_visible);

create policy "Published products are publicly readable"
on public.products
for select
to anon, authenticated
using (is_visible and is_published and (published_at is null or published_at <= now()));

create policy "Published product category links are publicly readable"
on public.product_category_links
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_category_links.product_id
      and products.is_visible
      and products.is_published
      and (products.published_at is null or products.published_at <= now())
  )
  and exists (
    select 1
    from public.product_categories
    where product_categories.id = product_category_links.category_id
      and product_categories.is_visible
  )
);

create policy "Visible blog categories are publicly readable"
on public.blog_categories
for select
to anon, authenticated
using (is_visible);

create policy "Published blog posts are publicly readable"
on public.blog_posts
for select
to anon, authenticated
using (status = 'published' and (published_at is null or published_at <= now()));

create policy "Published blog category links are publicly readable"
on public.blog_category_links
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.blog_posts
    where blog_posts.id = blog_category_links.blog_post_id
      and blog_posts.status = 'published'
      and (blog_posts.published_at is null or blog_posts.published_at <= now())
  )
  and exists (
    select 1
    from public.blog_categories
    where blog_categories.id = blog_category_links.category_id
      and blog_categories.is_visible
  )
);

comment on table public.users is 'Admin/editor identities managed by the application. Not publicly exposed.';
comment on table public.site_content is 'Editable page copy, links, images, galleries, and structured blocks keyed by locale and content_key.';
comment on table public.media is 'Image/file metadata for Supabase Storage objects or externally hosted media.';
comment on column public.products.photos is 'JSON array of photo objects: [{ "media_id": "...", "url": "...", "alt": "...", "sort_order": 0, "is_featured": true }].';
comment on column public.blog_posts.photos is 'JSON array of photo objects: [{ "media_id": "...", "url": "...", "alt": "...", "sort_order": 0, "is_featured": true }].';
