alter table public.products
add column if not exists archived_at timestamptz;

drop policy if exists "Published products are publicly readable" on public.products;

create policy "Published products are publicly readable"
on public.products
for select
to anon, authenticated
using (
  archived_at is null
  and is_visible
  and is_published
  and (published_at is null or published_at <= now())
);

drop index if exists products_public_sort_idx;
create index products_public_sort_idx
on public.products (is_visible, is_published, archived_at, sort_order, title);

comment on column public.products.archived_at is 'Set when a product is retired without deleting category links or photo metadata.';
