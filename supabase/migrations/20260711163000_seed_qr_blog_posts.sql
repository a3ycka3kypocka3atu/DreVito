insert into public.blog_posts (
  title,
  slug,
  excerpt,
  main_content,
  content_format,
  photos,
  author_name,
  status,
  published_at,
  sort_order
)
values
  (
    'O tvůrci',
    'o-tvurci',
    'Příběh tvůrce Dřevito připravujeme.',
    'Příběh tvůrce Dřevito připravujeme. Brzy tu najdete osobnější pohled na řemeslo, dřevo a cestu k výrobkům, které vznikají v dílně.',
    'html',
    '[]'::jsonb,
    'Dřevito',
    'published',
    now(),
    5
  ),
  (
    'Příběh této lavice a stolu',
    'pribeh-teto-lavice-a-stolu',
    'Příběh lavice a stolu připravujeme.',
    'Příběh této lavice a stolu připravujeme. Tady bude místo pro původ dřeva, návrh, ruční práci a detaily konkrétního kusu.',
    'html',
    '[]'::jsonb,
    'Dřevito',
    'published',
    now(),
    10
  )
on conflict (slug) do nothing;

insert into public.blog_category_links (blog_post_id, category_id, sort_order)
select post.id, category.id, link.sort_order
from (
  values
    ('o-tvurci', 'author', 0),
    ('pribeh-teto-lavice-a-stolu', 'craft', 0),
    ('pribeh-teto-lavice-a-stolu', 'products', 1)
) as link(post_slug, category_slug, sort_order)
join public.blog_posts post on post.slug = link.post_slug
join public.blog_categories category on category.slug = link.category_slug
on conflict (blog_post_id, category_id) do nothing;
