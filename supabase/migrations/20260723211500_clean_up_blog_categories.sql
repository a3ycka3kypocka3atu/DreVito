delete from public.blog_categories
where slug in ('place', 'news');

update public.blog_categories
set
  title = case slug
    when 'craft' then 'Z dílny'
    when 'author' then 'O autorovi'
    when 'philosophy' then 'Filozofie značky'
    when 'products' then 'Výrobky'
    else title
  end,
  updated_at = now()
where
  (slug = 'craft' and title = 'Craft')
  or (slug = 'author' and title = 'Author')
  or (slug = 'philosophy' and title = 'Philosophy')
  or (slug = 'products' and title = 'Products');
