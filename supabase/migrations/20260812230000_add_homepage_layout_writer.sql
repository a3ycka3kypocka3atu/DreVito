create or replace function public.write_homepage_layout(
  p_locale text,
  p_layout jsonb,
  p_expected_draft_updated_at timestamptz,
  p_operation text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.site_content%rowtype;
  v_published public.site_content%rowtype;
  v_layout jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_locale is null or pg_catalog.btrim(p_locale) = '' then
    raise exception using errcode = '22023', message = 'homepage_locale_required';
  end if;

  if p_operation is null or p_operation not in ('draft', 'publish', 'reset') then
    raise exception using errcode = '22023', message = 'homepage_operation_invalid';
  end if;

  if pg_catalog.jsonb_typeof(p_layout) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'homepage_layout_invalid';
  end if;

  -- Serialize every homepage write for one locale, including creation of the
  -- first draft where no row exists yet and therefore cannot be row-locked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('homepage-layout:' || p_locale, 0)
  );
  perform pg_catalog.set_config('drevito.homepage_layout_write', 'on', true);

  select *
  into v_draft
  from public.site_content
  where locale = p_locale
    and content_key = 'homepage.layout.draft';

  if p_expected_draft_updated_at is null then
    if v_draft.id is not null then
      raise exception using errcode = '40001', message = 'homepage_revision_conflict';
    end if;
  elsif v_draft.id is null or v_draft.updated_at is distinct from p_expected_draft_updated_at then
    raise exception using errcode = '40001', message = 'homepage_revision_conflict';
  end if;

  select *
  into v_published
  from public.site_content
  where locale = p_locale
    and content_key = 'homepage.layout';

  v_layout := p_layout;

  insert into public.site_content (
    content_key,
    locale,
    section,
    label,
    content_type,
    value,
    status,
    sort_order,
    published_at
  ) values (
    'homepage.layout.draft',
    p_locale,
    'homepage',
    'Koncept domovské stránky',
    'json',
    v_layout,
    'draft',
    1,
    null
  )
  on conflict (locale, content_key) do update set
    section = excluded.section,
    label = excluded.label,
    content_type = excluded.content_type,
    value = excluded.value,
    status = excluded.status,
    sort_order = excluded.sort_order,
    published_at = excluded.published_at
  returning * into v_draft;

  if p_operation = 'publish' then
    insert into public.site_content (
      content_key,
      locale,
      section,
      label,
      content_type,
      value,
      status,
      sort_order,
      published_at
    ) values (
      'homepage.layout',
      p_locale,
      'homepage',
      'Publikovaná domovská stránka',
      'json',
      v_layout,
      'published',
      0,
      v_now
    )
    on conflict (locale, content_key) do update set
      section = excluded.section,
      label = excluded.label,
      content_type = excluded.content_type,
      value = excluded.value,
      status = excluded.status,
      sort_order = excluded.sort_order,
      published_at = excluded.published_at
    returning * into v_published;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'locale', p_locale,
    'has_draft', true,
    'has_published_layout', v_published.id is not null,
    'draft_revision', v_draft.updated_at,
    'draft_updated_at', v_draft.updated_at,
    'published_revision', v_published.updated_at,
    'published_at', v_published.published_at,
    'is_dirty', v_published.id is null or v_draft.value is distinct from v_published.value,
    'layout', v_draft.value,
    'published_layout', case when v_published.id is null then null else v_published.value end
  );
end;
$$;

revoke execute on function public.write_homepage_layout(text, jsonb, timestamptz, text)
from public, anon, authenticated;

grant execute on function public.write_homepage_layout(text, jsonb, timestamptz, text)
to service_role;

create or replace function public.protect_homepage_layout_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_key text := case when tg_op in ('UPDATE', 'DELETE') then old.content_key else null end;
  v_new_key text := case when tg_op in ('INSERT', 'UPDATE') then new.content_key else null end;
begin
  if (v_old_key in ('homepage.layout', 'homepage.layout.draft')
      or v_new_key in ('homepage.layout', 'homepage.layout.draft'))
    and pg_catalog.current_setting('drevito.homepage_layout_write', true) is distinct from 'on'
  then
    raise exception using
      errcode = '42501',
      message = 'homepage_layout_requires_writer_rpc';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.protect_homepage_layout_content()
from public, anon, authenticated;

drop trigger if exists protect_homepage_layout_content on public.site_content;
create trigger protect_homepage_layout_content
before insert or update or delete on public.site_content
for each row execute function public.protect_homepage_layout_content();

comment on function public.write_homepage_layout(text, jsonb, timestamptz, text)
is 'Only supported write path for the reserved homepage.layout and homepage.layout.draft rows.';

drop policy if exists "Published site content is publicly readable" on public.site_content;
create policy "Published site content is publicly readable"
on public.site_content
for select
to anon, authenticated
using (
  content_key <> 'homepage.layout.draft'
  and status = 'published'
  and (published_at is null or published_at <= pg_catalog.now())
);
