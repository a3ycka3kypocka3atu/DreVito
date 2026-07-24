alter table public.products
add column if not exists price numeric(12, 2),
add column if not exists wood_types text[] not null default '{}'::text[],
add column if not exists availability text,
add column if not exists use_context text[] not null default '{}'::text[];

alter table public.products
drop constraint if exists products_price_non_negative,
add constraint products_price_non_negative check (price is null or price >= 0),
drop constraint if exists products_availability_valid,
add constraint products_availability_valid check (
  availability is null or availability in ('in_stock', 'made_to_order')
),
drop constraint if exists products_use_context_valid,
add constraint products_use_context_valid check (
  use_context <@ array['interior', 'exterior']::text[]
);

comment on column public.products.price is 'Public price in CZK. Null means price on request.';
comment on column public.products.wood_types is 'Filter values for wood species, stored as normalized Czech labels.';
comment on column public.products.availability is 'Public availability filter: in_stock or made_to_order.';
comment on column public.products.use_context is 'Public placement filter containing interior and/or exterior.';

-- Reuse the existing categories so current product links remain valid.
update public.product_categories
set
  title = 'Rustikální nábytek',
  slug = 'rustikalni-nabytek',
  description = 'Originální stoly, lavice, stoličky a další solitérní kusy z masivního dřeva.',
  sort_order = 10,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now()
where slug in ('engraved-furniture', 'rustikalni-nabytek');

update public.product_categories
set
  title = 'Dárky a drobné výrobky',
  slug = 'darky-a-drobne-vyrobky',
  description = 'Menší dřevěné radosti, dárky a praktické výrobky pro každý den.',
  sort_order = 30,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now()
where slug in ('small-wood', 'darky-a-drobne-vyrobky');

update public.product_categories
set
  title = 'Dekorace, světla a stínohry',
  slug = 'dekorace-svetla-a-stinohry',
  description = 'Dřevěné dekorace a objekty, které pracují se světlem, stínem a atmosférou prostoru.',
  sort_order = 20,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now()
where slug in ('shadow-light', 'dekorace-svetla-a-stinohry');

update public.product_categories
set
  title = 'Informační a propagační materiály',
  slug = 'informacni-a-propagacni-materialy',
  description = 'Loga, vizitky, informační cedule a orientační prvky zpracované osobitě ve dřevě.',
  sort_order = 40,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now()
where slug in ('promotion', 'informacni-a-propagacni-materialy');

update public.product_categories
set
  title = 'Zakázková výroba a gravírování na míru',
  slug = 'zakazkova-vyroba-a-gravirovani-na-miru',
  description = 'Výroba podle vaší představy i gravírování vlastních předmětů, fotografií, motivů a log.',
  sort_order = 50,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now()
where slug in ('custom-graphics', 'zakazkova-vyroba-a-gravirovani-na-miru');

-- Production can start with an empty category table. Ensure the five agreed
-- parent categories exist before inserting their children below.
insert into public.product_categories (title, slug, description, sort_order, is_visible, parent_id)
values
  ('Rustikální nábytek', 'rustikalni-nabytek', 'Originální stoly, lavice, stoličky a další solitérní kusy z masivního dřeva.', 10, true, null),
  ('Dekorace, světla a stínohry', 'dekorace-svetla-a-stinohry', 'Dřevěné dekorace a objekty, které pracují se světlem, stínem a atmosférou prostoru.', 20, true, null),
  ('Dárky a drobné výrobky', 'darky-a-drobne-vyrobky', 'Menší dřevěné radosti, dárky a praktické výrobky pro každý den.', 30, true, null),
  ('Informační a propagační materiály', 'informacni-a-propagacni-materialy', 'Loga, vizitky, informační cedule a orientační prvky zpracované osobitě ve dřevě.', 40, true, null),
  ('Zakázková výroba a gravírování na míru', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Výroba podle vaší představy i gravírování vlastních předmětů, fotografií, motivů a log.', 50, true, null)
on conflict (slug) do update
set
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order,
  parent_id = null,
  is_visible = true,
  archived_at = null,
  updated_at = now();

-- Existing broad categories become useful children of the merged groups.
update public.product_categories child
set
  title = 'Ostatní dekorace',
  slug = 'ostatni-dekorace',
  parent_id = parent.id,
  sort_order = 10,
  is_visible = true,
  archived_at = null,
  updated_at = now()
from public.product_categories parent
where child.slug in ('decorations', 'dekorace', 'ostatni-dekorace')
  and parent.slug = 'dekorace-svetla-a-stinohry'
  and child.id <> parent.id;

update public.product_categories child
set
  title = 'Gravírování vašich předmětů',
  slug = 'gravirovani-vasich-predmetu',
  parent_id = parent.id,
  sort_order = 50,
  is_visible = true,
  archived_at = null,
  updated_at = now()
from public.product_categories parent
where child.slug in ('engraving-items', 'gravirovani-vasich-predmetu')
  and parent.slug = 'zakazkova-vyroba-a-gravirovani-na-miru'
  and child.id <> parent.id;

with category_seed(title, slug, parent_slug, description, sort_order) as (
  values
    ('Stoly', 'stoly', 'rustikalni-nabytek', 'Rustikální stoly z masivního dřeva.', 10),
    ('Lavice', 'lavice', 'rustikalni-nabytek', 'Originální lavice do exteriéru i interiéru.', 20),
    ('Čajové stolky a oltářky', 'cajove-stolky-a-oltarky', 'rustikalni-nabytek', 'Menší stolky a osobité oltářní stolky.', 30),
    ('Stoličky', 'stolicky', 'rustikalni-nabytek', 'Dřevěné stoličky a malé sedací solitéry.', 40),
    ('Ostatní rustikální nábytek', 'ostatni-rustikalni-nabytek', 'rustikalni-nabytek', 'Další solitérní kusy rustikálního nábytku.', 50),
    ('Mandaly', 'mandaly', 'dekorace-svetla-a-stinohry', 'Dekorativní dřevěné mandaly.', 20),
    ('Stromy života', 'stromy-zivota', 'dekorace-svetla-a-stinohry', 'Dekorace s motivem stromu života.', 30),
    ('Zvířata a figurální motivy', 'zvirata-a-figuralni-motivy', 'dekorace-svetla-a-stinohry', 'Silová zvířata, postavy a další figurální motivy.', 40),
    ('Sochy a dřevěné objekty', 'sochy-a-drevene-objekty', 'dekorace-svetla-a-stinohry', 'Volné sochy a prostorové dřevěné objekty.', 50),
    ('Svíčelenky a stínoherní objekty', 'svicelenky-a-stinoherni-objekty', 'dekorace-svetla-a-stinohry', 'Objekty vytvářející kresbu světla a stínu.', 60),
    ('Dekorativní osvětlení', 'dekorativni-osvetleni', 'dekorace-svetla-a-stinohry', 'Autorské dekorativní světelné objekty.', 70),
    ('Stojánky na telefon', 'stojanky-na-telefon', 'darky-a-drobne-vyrobky', 'Dřevěné stojánky na mobilní telefony.', 10),
    ('Krabičky', 'krabicky', 'darky-a-drobne-vyrobky', 'Krabičky z masivního dřeva.', 20),
    ('Kuchyňská prkénka', 'kuchynska-prkenka', 'darky-a-drobne-vyrobky', 'Praktická prkénka do kuchyně.', 30),
    ('Dýmky', 'dymky', 'darky-a-drobne-vyrobky', 'Ručně zpracované dřevěné dýmky.', 40),
    ('Hřebeny', 'hrebeny', 'darky-a-drobne-vyrobky', 'Dřevěné hřebeny.', 50),
    ('Dřevěné hračky', 'drevene-hracky', 'darky-a-drobne-vyrobky', 'Drobné hračky ze dřeva.', 60),
    ('Personalizované dárky', 'personalizovane-darky', 'darky-a-drobne-vyrobky', 'Dárky upravené jménem, motivem nebo věnováním.', 70),
    ('Ostatní drobné výrobky', 'ostatni-drobne-vyrobky', 'darky-a-drobne-vyrobky', 'Další malé dřevěné radosti.', 80),
    ('Dřevěná loga', 'drevena-loga', 'informacni-a-propagacni-materialy', 'Loga a značky provedené ve dřevě.', 10),
    ('Vizitky', 'vizitky', 'informacni-a-propagacni-materialy', 'Osobité dřevěné vizitky.', 20),
    ('Informační cedule', 'informacni-cedule', 'informacni-a-propagacni-materialy', 'Informační, provozní a popisné cedule.', 30),
    ('Orientační systémy', 'orientacni-systemy', 'informacni-a-propagacni-materialy', 'Směrovky a ucelené orientační systémy.', 40),
    ('Výroba podle vašeho návrhu', 'vyroba-podle-vaseho-navrhu', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Nový výrobek vytvořený podle vašich podkladů nebo společného návrhu.', 10),
    ('Gravírování fotografie', 'gravirovani-fotografie', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Převod fotografie do gravírovaného motivu.', 20),
    ('Gravírování grafiky nebo loga', 'gravirovani-grafiky-nebo-loga', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Gravírování podle dodané grafiky nebo loga.', 30),
    ('Hudební nástroje', 'hudebni-nastroje', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Gravírování kytar a dalších hudebních nástrojů.', 40),
    ('Individuální návrh výrobku', 'individualni-navrh-vyrobku', 'zakazkova-vyroba-a-gravirovani-na-miru', 'Společné hledání podoby jedinečného výrobku.', 60)
)
insert into public.product_categories (title, slug, parent_id, description, sort_order, is_visible)
select seed.title, seed.slug, parent.id, seed.description, seed.sort_order, true
from category_seed seed
join public.product_categories parent on parent.slug = seed.parent_slug
on conflict (slug) do update
set
  title = excluded.title,
  parent_id = excluded.parent_id,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_visible = true,
  archived_at = null,
  updated_at = now();

-- Move the current examples to their most specific category where possible.
with assignments(product_slug, category_slug) as (
  values
    ('cajne-stolicky', 'cajove-stolky-a-oltarky'),
    ('dekoracni-tabulka', 'svicelenky-a-stinoherni-objekty'),
    ('krabicka', 'krabicky'),
    ('kun', 'zvirata-a-figuralni-motivy'),
    ('dekorace-zena', 'zvirata-a-figuralni-motivy'),
    ('stojan-na-telefon', 'stojanky-na-telefon'),
    ('hracka-auticko', 'drevene-hracky')
)
insert into public.product_category_links (product_id, category_id, sort_order)
select product.id, category.id, 0
from assignments
join public.products product on product.slug = assignments.product_slug
join public.product_categories category on category.slug = assignments.category_slug
on conflict (product_id, category_id) do nothing;

-- Keep every existing blog category and add the newly agreed themes.
insert into public.blog_categories (title, slug, description, sort_order, is_visible)
values
  ('Příběhy výrobků', 'pribehy-vyrobku', 'Příběhy konkrétních výrobků, jejich dřeva, vzniku a místa, pro které byly vytvořeny.', 70, true),
  ('Dřevo a příroda', 'drevo-a-priroda', 'Druhy dřeva, příroda, udržitelnost a vztah materiálu k místu.', 80, true),
  ('Příběh Dřevito', 'pribeh-drevito', 'Příběh dílny, značky, autora a důležité události.', 90, true)
on conflict (slug) do update
set
  title = excluded.title,
  description = excluded.description,
  is_visible = true,
  archived_at = null,
  updated_at = now();
