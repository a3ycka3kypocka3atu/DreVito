alter table public.product_categories
add column if not exists parent_id uuid references public.product_categories(id) on delete set null,
add constraint product_categories_parent_not_self check (parent_id is null or parent_id <> id);

create index if not exists product_categories_parent_sort_idx
on public.product_categories (parent_id, sort_order, title);

comment on column public.product_categories.parent_id is 'Optional parent category for product subcategory grouping.';
