# Database content model

This schema is the baseline for admin-editable Drevito content in Supabase.

## Tables

| Table | Purpose |
| --- | --- |
| `users` | Internal admins/editors and optional link to `auth.users`. Public clients do not read this table. |
| `site_content` | General editable page content, keyed by `locale` and `content_key`. Supports text, rich text, image, gallery, link, and JSON values. |
| `media` | Metadata for images/files stored in Supabase Storage or another public URL. |
| `products` | Product records with title, slug, long/short descriptions, photo list, sort order, visibility, publish state, and timestamps. |
| `product_categories` | Product category records with slug, title, optional image metadata, visibility, archive state, and sort order. |
| `product_category_links` | Many-to-many product/category links. |
| `blog_posts` | Blog records with title, slug, excerpt, main content, photos, author fields, status, publish date, sort order, and timestamps. |
| `blog_categories` | Blog category records with slug, title, optional image metadata, visibility, archive state, and sort order. |
| `blog_category_links` | Many-to-many blog/category links. |

## Publication model

Products use two booleans plus archive state:

- `is_visible`: hide/show in public lists without changing publish intent.
- `is_published`: draft versus published content.
- `archived_at`: safe retirement without deleting product/category links or photo JSON.

Blog posts and site content use `status` with `draft`, `published`, or `archived`.

Product categories use `is_visible` for public show/hide and `archived_at` for safe retirement without deleting product links.

Blog categories use `is_visible` for public show/hide and `archived_at` for safe retirement without deleting blog post links.

For all public content, `published_at` can be null. If it is set in the future, public RLS policies hide that row until the timestamp passes.

## Media and photos

`media` stores canonical file metadata. Product and blog `photos` are JSON arrays so the admin can preserve per-entry ordering and captions without adding extra link tables yet.

Storage buckets:

- `site-media` for homepage/site-content and site section images
- `product-images` for product images
- `blog-images` for blog post images

The buckets should be public, or have equivalent public read policies, because public pages render `media.public_url` values directly.

Admin uploads store target assignment details in `media.metadata` so `/api/media-targets` can keep its existing JSON shape:

```json
{
  "target_type": "products",
  "target_key": "krabicka",
  "target_label": "Krabička",
  "sort_order": 0,
  "is_featured": true,
  "storage": "supabase"
}
```

Suggested shape:

```json
[
  {
    "media_id": "00000000-0000-0000-0000-000000000000",
    "url": "/prod/krabicka.JPG",
    "alt": "Wooden box",
    "caption": "Handmade box",
    "sort_order": 0,
    "is_featured": true
  }
]
```

Use `media_id` when the asset exists in `media`. Public rendering resolves that ID to `media.public_url` when available. Use `url` for legacy/static assets and local fallback uploads during migration or development without Supabase credentials.

## Access model

The migration uses explicit grants because new Supabase projects may not expose public tables to the Data API automatically.

Public/browser clients (`anon`, `authenticated`) can only `select`:

- published `site_content`
- public `media`
- visible categories
- published/visible products
- published blog posts
- links where both sides are public

Admin writes should go through server-side code using `SUPABASE_SERVICE_ROLE_KEY`. Do not expose the service role key in frontend code.

## Applying

With the Supabase CLI installed and the project linked:

```sh
supabase db push
```

After applying to a real project, run the database advisors in the Supabase dashboard or CLI and confirm RLS policies in the dashboard policy tester.
