alter table public.product_categories
add column if not exists image jsonb,
add column if not exists archived_at timestamptz,
add constraint product_categories_image_object check (image is null or jsonb_typeof(image) = 'object');

drop policy if exists "Visible product categories are publicly readable" on public.product_categories;

create policy "Visible product categories are publicly readable"
on public.product_categories
for select
to anon, authenticated
using (is_visible and archived_at is null);

drop index if exists product_categories_visible_sort_idx;
create index product_categories_visible_sort_idx
on public.product_categories (is_visible, archived_at, sort_order, title);

comment on column public.product_categories.image is 'Optional category image metadata. Temporary shape: { "url": "...", "alt": "...", "media_id": "..." } until media selection uses Supabase Storage.';
comment on column public.product_categories.archived_at is 'Set when a category is retired without deleting product links.';
