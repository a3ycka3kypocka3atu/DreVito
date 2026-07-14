insert into public.blog_categories (title, slug, description, sort_order, is_visible)
values
  (
    'Výrobky',
    'products',
    'Příběhy konkrétních výrobků, novinky a detaily jejich vzniku.',
    10,
    true
  ),
  (
    'Filozofie značky',
    'philosophy',
    'Hodnoty Dřevito, vztah ke dřevu a přístup k tvorbě.',
    20,
    true
  ),
  (
    'O autorovi',
    'author',
    'Osobní příběhy autora, inspirace a cesta k řemeslu.',
    30,
    true
  ),
  (
    'Z dílny',
    'craft',
    'Řemeslné postupy, materiály a pohled do zákulisí dílny.',
    40,
    true
  )
on conflict (slug) do update
set
  title = excluded.title,
  description = excluded.description,
  is_visible = true,
  archived_at = null,
  updated_at = now();
