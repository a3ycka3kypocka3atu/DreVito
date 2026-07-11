revoke all on table public.users from anon, authenticated;
revoke all on table public.site_content from anon, authenticated;
revoke all on table public.media from anon, authenticated;
revoke all on table public.product_categories from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.product_category_links from anon, authenticated;
revoke all on table public.blog_categories from anon, authenticated;
revoke all on table public.blog_posts from anon, authenticated;
revoke all on table public.blog_category_links from anon, authenticated;

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

grant select (
  id,
  title,
  slug,
  description,
  image,
  sort_order,
  is_visible,
  created_at,
  updated_at
) on table public.product_categories to anon, authenticated;

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

grant select (
  id,
  title,
  slug,
  description,
  image,
  sort_order,
  is_visible,
  created_at,
  updated_at
) on table public.blog_categories to anon, authenticated;

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
