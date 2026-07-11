drop policy if exists "Published product category links are publicly readable" on public.product_category_links;

create policy "Published product category links are publicly readable"
on public.product_category_links
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_category_links.product_id
      and products.archived_at is null
      and products.is_visible
      and products.is_published
      and (products.published_at is null or products.published_at <= now())
  )
  and exists (
    select 1
    from public.product_categories
    where product_categories.id = product_category_links.category_id
      and product_categories.is_visible
      and product_categories.archived_at is null
  )
);
