create table public.product_filters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_filters_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create table public.product_filter_options (
  id uuid primary key default gen_random_uuid(),
  filter_id uuid not null references public.product_filters(id) on delete cascade,
  title text not null,
  slug text not null,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (filter_id, slug),
  constraint product_filter_options_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create table public.product_filter_value_links (
  product_id uuid not null references public.products(id) on delete cascade,
  option_id uuid not null references public.product_filter_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, option_id)
);

create index product_filters_public_sort_idx on public.product_filters (is_visible, archived_at, sort_order, title);
create index product_filter_options_filter_sort_idx on public.product_filter_options (filter_id, is_visible, archived_at, sort_order, title);
create index product_filter_value_links_option_idx on public.product_filter_value_links (option_id, product_id);

create trigger product_filters_set_updated_at
before update on public.product_filters
for each row execute function public.set_updated_at();

create trigger product_filter_options_set_updated_at
before update on public.product_filter_options
for each row execute function public.set_updated_at();

alter table public.product_filters enable row level security;
alter table public.product_filter_options enable row level security;
alter table public.product_filter_value_links enable row level security;

revoke all on table public.product_filters from anon, authenticated;
revoke all on table public.product_filter_options from anon, authenticated;
revoke all on table public.product_filter_value_links from anon, authenticated;

grant select, insert, update, delete on table public.product_filters to service_role;
grant select, insert, update, delete on table public.product_filter_options to service_role;
grant select, insert, update, delete on table public.product_filter_value_links to service_role;

comment on table public.product_filters is 'Admin-defined public product filter groups such as style or occasion.';
comment on table public.product_filter_options is 'Selectable values belonging to an admin-defined product filter.';
comment on table public.product_filter_value_links is 'Many-to-many assignments of custom filter options to products.';
