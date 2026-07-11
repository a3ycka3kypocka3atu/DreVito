alter table public.blog_categories
add column image jsonb,
add column archived_at timestamptz,
add constraint blog_categories_image_object check (image is null or jsonb_typeof(image) = 'object');

drop policy if exists "Visible blog categories are publicly readable" on public.blog_categories;
create policy "Visible blog categories are publicly readable"
on public.blog_categories
for select
to anon, authenticated
using (is_visible and archived_at is null);

drop policy if exists "Published blog category links are publicly readable" on public.blog_category_links;
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
      and blog_categories.archived_at is null
  )
);

drop index if exists blog_categories_visible_sort_idx;
create index blog_categories_visible_sort_idx
on public.blog_categories (is_visible, archived_at, sort_order, title);

insert into public.blog_categories (title, slug, description, sort_order, is_visible)
values
  ('Craft', 'craft', 'Řemeslné postupy, materiály a dílenské poznámky.', 10, true),
  ('Place', 'place', 'Místa, odkud výrobky a inspirace vyrůstají.', 20, true),
  ('Author', 'author', 'Příběhy a poznámky autora.', 30, true),
  ('Philosophy', 'philosophy', 'Hodnoty, přístup k tvorbě a vztah ke dřevu.', 40, true),
  ('Products', 'products', 'Novinky a zákulisí konkrétních výrobků.', 50, true),
  ('News', 'news', 'Aktuality, oznámení a krátké zprávy.', 60, true)
on conflict (slug) do nothing;

comment on column public.blog_categories.image is 'Optional blog category image metadata. Temporary shape: { "url": "...", "alt": "...", "media_id": "..." } until media selection uses Supabase Storage.';
comment on column public.blog_categories.archived_at is 'Set when a blog category is retired without deleting blog post links.';
