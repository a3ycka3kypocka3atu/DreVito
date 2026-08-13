import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'drevito-smoke-'));
const dataDir = path.join(tempRoot, 'data');
const uploadDir = path.join(tempRoot, 'uploads');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
let serverOutput = '';
let sessionCookie = '';
let child;

function check(condition, message) {
  assert.ok(condition, message);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/admin/login`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start.\n${serverOutput}`);
}

async function request(pathname, {
  method = 'GET',
  body,
  json,
  authenticated = true,
  expectedStatus
} = {}) {
  const headers = new Headers({ Accept: 'application/json' });
  if (authenticated && sessionCookie) headers.set('Cookie', sessionCookie);
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
    redirect: 'manual'
  });
  if (expectedStatus !== undefined) {
    const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    check(expectedStatuses.includes(response.status), `${method} ${pathname} returned ${response.status}; expected ${expectedStatuses.join(' or ')}`);
  }
  return response;
}

async function jsonRequest(pathname, options = {}) {
  const response = await request(pathname, options);
  const data = await response.json();
  check(response.ok, `${options.method || 'GET'} ${pathname} failed: ${data.error || response.status}`);
  check(data.ok !== false, `${options.method || 'GET'} ${pathname} returned ok:false`);
  return data;
}

try {
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: baseUrl,
      SESSION_SECRET: 'drevito-isolated-smoke-test-secret',
      DREVITO_DATA_DIR: dataDir,
      DREVITO_UPLOAD_DIR: uploadDir,
      NODE_ENV: 'test',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });
  await waitForServer();

  const protectedResponse = await request('/admin', {
    authenticated: false,
    expectedStatus: [302, 303]
  });
  check((protectedResponse.headers.get('location') || '').startsWith('/admin/login'), 'Admin did not redirect to login.');

  const unauthenticatedHomepageApi = await request('/admin/api/homepage', {
    authenticated: false,
    expectedStatus: 401
  });
  check((unauthenticatedHomepageApi.headers.get('content-type') || '').includes('application/json'), 'Unauthenticated homepage API response was not JSON.');
  const unauthenticatedHomepageData = await unauthenticatedHomepageApi.json();
  check(unauthenticatedHomepageData.ok === false, 'Unauthenticated homepage API response did not return ok:false.');

  const loginResponse = await request('/admin/dev-login?next=/admin', {
    method: 'POST',
    authenticated: false,
    expectedStatus: [302, 303]
  });
  const setCookie = loginResponse.headers.get('set-cookie') || '';
  check(setCookie.includes('drevito_admin_session='), 'Login did not issue the admin session cookie.');
  sessionCookie = setCookie.split(';')[0];

  const dashboardResponse = await request('/admin', { expectedStatus: 200 });
  check((await dashboardResponse.text()).includes('Administrace obsahu'), 'Authenticated dashboard did not render.');

  const homepageEditorResponse = await request('/admin/homepage', { expectedStatus: 200 });
  const homepageEditorHtml = await homepageEditorResponse.text();
  check(homepageEditorHtml.includes('id="homepage-editor"') && homepageEditorHtml.includes('Domovská stránka'), 'Authenticated homepage editor did not render.');
  check(homepageEditorHtml.includes('id="homepage-publish" type="button" disabled'), 'Homepage publish control was enabled before initial state loading.');
  check(homepageEditorHtml.includes('data-open-library disabled'), 'Homepage add-block control was enabled before initial state loading.');

  const reservedHomepageCreate = await request('/admin/api/site-content', {
    method: 'POST',
    json: {
      content_key: 'homepage.layout.draft',
      locale: 'cs',
      section: 'homepage',
      label: 'Unsafe generic draft',
      content_type: 'json',
      value: { version: 1, blocks: [] },
      status: 'published',
      sort_order: 0
    },
    expectedStatus: 400
  });
  check((await reservedHomepageCreate.json()).ok === false, 'Generic site-content API accepted a reserved homepage key.');

  const fixedHomepageBlockIds = ['hero', 'about', 'products', 'blog', 'author', 'custom'];
  let homepageState = await jsonRequest('/admin/api/homepage');
  check(homepageState.has_draft === false, 'Fresh homepage state unexpectedly contained a draft.');
  check(homepageState.has_published_layout === false, 'Fresh homepage state unexpectedly contained a published layout.');
  check(homepageState.draft_revision === null, 'Fresh homepage state unexpectedly had a draft revision.');
  check(homepageState.layout?.blocks?.length === fixedHomepageBlockIds.length, 'Default homepage did not contain exactly six fixed blocks.');
  check(fixedHomepageBlockIds.every((id) => homepageState.layout.blocks.some((block) => block.id === id)), 'Default homepage was missing a fixed block.');

  let publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(publicContent.homepage_layout === null, 'Public content unexpectedly exposed a homepage layout before publication.');

  await request('/vyrobky', { authenticated: false, expectedStatus: 200 });
  await request('/vyrobky/rustikalni-nabytek', { authenticated: false, expectedStatus: 200 });
  await request('/vyrobky/rustikalni-nabytek/stoly', { authenticated: false, expectedStatus: 200 });
  await request('/vyrobky/rustikalni-nabytek/stoly/neplatna-uroven', { authenticated: false, expectedStatus: 404 });

  const defaultHomepageBlocks = new Map(homepageState.layout.blocks.map((block) => [block.id, cloneJson(block)]));
  const homepageStory = {
    id: 'story-smoke-homepage',
    kind: 'story',
    label: 'Smoke příběh',
    visible: true,
    content: {
      eyebrow: 'Ze zákulisí',
      title: 'Smoke blok domovské stránky',
      body: 'První publikovaný text vlastního bloku.',
      image: { url: '', alt: '', caption: '', media_id: '' },
      layout: 'image-left',
      theme: 'cream',
      cta_label: 'Napište nám',
      cta_url: '#contact'
    }
  };
  const homepageDraftLayout = {
    version: 1,
    blocks: [
      defaultHomepageBlocks.get('blog'),
      defaultHomepageBlocks.get('about'),
      homepageStory,
      defaultHomepageBlocks.get('author'),
      defaultHomepageBlocks.get('custom'),
      defaultHomepageBlocks.get('hero')
    ]
  };

  homepageState = await jsonRequest('/admin/api/homepage/draft', {
    method: 'PUT',
    json: {
      layout: homepageDraftLayout,
      expected_revision: homepageState.draft_revision
    }
  });
  check(homepageState.has_draft === true && homepageState.draft_revision, 'Saving the homepage draft did not create a revision.');
  check(homepageState.layout.blocks.length === fixedHomepageBlockIds.length + 1, 'Saved homepage draft did not contain six fixed blocks and one story.');
  check(homepageState.layout.blocks[0]?.id === 'hero', 'Homepage normalization did not keep the hero first.');
  check(homepageState.layout.blocks.some((block) => block.id === 'products'), 'Homepage normalization did not restore an omitted fixed block.');
  check(homepageState.layout.blocks.some((block) => block.id === homepageStory.id), 'Saved homepage draft was missing its story block.');
  check(homepageState.layout.blocks.map((block) => block.id).join(',') === 'hero,blog,about,story-smoke-homepage,author,custom,products', 'Homepage fixed-block reorder was not preserved after normalization.');

  const firstHomepageRevision = homepageState.draft_revision;
  const reloadedHomepageState = await jsonRequest('/admin/api/homepage');
  check(reloadedHomepageState.draft_revision === firstHomepageRevision, 'Reloaded homepage draft had a different revision.');
  assert.deepEqual(reloadedHomepageState.layout, homepageState.layout, 'Reloaded homepage draft did not match the saved draft.');

  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(publicContent.homepage_layout === null, 'Saving a draft changed the public homepage layout.');

  const publishableHomepageLayout = cloneJson(homepageState.layout);
  publishableHomepageLayout.blocks.find((block) => block.id === homepageStory.id).content.body = 'Publikovaná verze vlastního bloku.';
  await new Promise((resolve) => setTimeout(resolve, 10));
  homepageState = await jsonRequest('/admin/api/homepage/draft', {
    method: 'PUT',
    json: {
      layout: publishableHomepageLayout,
      expected_revision: firstHomepageRevision
    }
  });
  const latestHomepageRevision = homepageState.draft_revision;
  check(latestHomepageRevision && latestHomepageRevision !== firstHomepageRevision, 'Updating the homepage draft did not advance its revision.');

  const staleHomepageResponse = await request('/admin/api/homepage/draft', {
    method: 'PUT',
    json: {
      layout: homepageState.layout,
      expected_revision: firstHomepageRevision
    },
    expectedStatus: 409
  });
  const staleHomepageData = await staleHomepageResponse.json();
  check(staleHomepageData.ok === false, 'Stale homepage save did not return ok:false.');

  homepageState = await jsonRequest('/admin/api/homepage/publish', {
    method: 'POST',
    json: {
      layout: homepageState.layout,
      expected_revision: latestHomepageRevision
    }
  });
  check(homepageState.has_published_layout === true && homepageState.published_layout, 'Publishing did not create a public homepage layout.');
  check(homepageState.is_dirty === false, 'Homepage remained dirty immediately after publishing.');

  const genericSiteContent = await jsonRequest('/admin/api/site-content');
  check(!genericSiteContent.contents.some((item) => item.content_key === 'homepage.layout' || item.content_key === 'homepage.layout.draft'), 'Generic site-content list exposed reserved homepage rows.');

  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(publicContent.homepage_layout?.blocks?.some((block) => block.id === homepageStory.id), 'Published homepage layout was missing the story block.');
  check(publicContent.homepage_layout.blocks.map((block) => block.id).join(',') === 'hero,blog,about,story-smoke-homepage,author,custom,products', 'Published homepage block order did not match the draft.');
  check(publicContent.homepage_layout.blocks.find((block) => block.id === homepageStory.id)?.content.body === 'Publikovaná verze vlastního bloku.', 'Published homepage story content was incorrect.');
  const publishedHomepageLayout = cloneJson(publicContent.homepage_layout);

  const changedDraftLayout = cloneJson(homepageState.layout);
  changedDraftLayout.blocks.find((block) => block.id === homepageStory.id).content.body = 'Tato změna musí zůstat jen v konceptu.';
  await new Promise((resolve) => setTimeout(resolve, 10));
  homepageState = await jsonRequest('/admin/api/homepage/draft', {
    method: 'PUT',
    json: {
      layout: changedDraftLayout,
      expected_revision: homepageState.draft_revision
    }
  });
  check(homepageState.is_dirty === true, 'Changed homepage draft was not marked dirty.');
  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  assert.deepEqual(publicContent.homepage_layout, publishedHomepageLayout, 'A subsequent draft edit changed the published homepage layout.');

  const unsafeHomepageLayout = cloneJson(homepageState.layout);
  unsafeHomepageLayout.blocks.find((block) => block.id === homepageStory.id).content.cta_url = '//unsafe.example.test';
  const unsafeHomepageResponse = await request('/admin/api/homepage/draft', {
    method: 'PUT',
    json: {
      layout: unsafeHomepageLayout,
      expected_revision: homepageState.draft_revision
    },
    expectedStatus: 400
  });
  const unsafeHomepageData = await unsafeHomepageResponse.json();
  check(unsafeHomepageData.ok === false, 'Unsafe protocol-relative homepage link did not return ok:false.');

  const productCategory = (await jsonRequest('/admin/api/product-categories', {
    method: 'POST',
    json: {
      title: 'Smoke výrobky',
      slug: 'smoke-vyrobky',
      description: 'Isolated product category test.',
      sort_order: 990,
      is_visible: true
    }
  })).category;

  const filter = (await jsonRequest('/admin/api/product-filters', {
    method: 'POST',
    json: {
      title: 'Smoke styl',
      slug: 'smoke-styl',
      description: 'Isolated filter test.',
      sort_order: 990,
      is_visible: true
    }
  })).filter;

  const filterOption = (await jsonRequest(`/admin/api/product-filters/${filter.id}/options`, {
    method: 'POST',
    json: {
      title: 'Smoke možnost',
      slug: 'smoke-moznost',
      sort_order: 10,
      is_visible: true
    }
  })).option;

  const imageForm = new FormData();
  imageForm.append('image', new Blob([await readFile(path.join(projectRoot, 'drevito-logo-transparent.png'))], { type: 'image/png' }), 'smoke-product.png');
  imageForm.append('targetLabel', 'Smoke výrobek');
  imageForm.append('targetKey', 'smoke-vyrobek');
  imageForm.append('alt', 'Smoke výrobek');
  const photoUpload = await jsonRequest('/admin/api/products/photo-upload', {
    method: 'POST',
    body: imageForm
  });
  check(photoUpload.photo?.url?.startsWith('/uploads/'), 'Product photo was not stored in isolated uploads.');

  const productPayload = {
    title: 'Smoke výrobek',
    slug: 'smoke-vyrobek',
    short_description: 'Publikační test výrobku.',
    description: 'Celý popis testovacího výrobku.',
    photos: [photoUpload.photo],
    price: 1234,
    wood_types: ['dub'],
    availability: 'made_to_order',
    use_context: ['interior'],
    category_ids: [productCategory.id],
    filter_option_ids: [filterOption.id],
    sort_order: 990,
    is_visible: true,
    is_published: true,
    published_at: ''
  };
  const product = (await jsonRequest('/admin/api/products', {
    method: 'POST',
    json: productPayload
  })).product;
  check(product.is_published && product.is_visible, 'Product was not published.');
  check(product.category_ids.includes(productCategory.id), 'Product category link was not saved.');
  check(product.filter_option_ids.includes(filterOption.id), 'Product filter link was not saved.');

  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  let publicProduct = publicContent.products.find((item) => item.slug === productPayload.slug);
  check(publicProduct, 'Published product was missing from public content.');
  check(publicProduct.categories.some((item) => item.id === productCategory.id), 'Public product category was missing.');
  check(publicProduct.filter_options.some((item) => item.id === filterOption.id), 'Public product filter was missing.');
  check(!Object.prototype.hasOwnProperty.call(publicProduct, 'url'), 'Public product unexpectedly exposed a shop URL.');
  check(publicContent.product_filters.some((item) => item.id === filter.id), 'Visible product filter was missing from public content.');

  const productPage = await request(`/vyrobek/${productPayload.slug}`, {
    authenticated: false,
    expectedStatus: 200
  });
  const productHtml = await productPage.text();
  check(productHtml.includes(productPayload.title), 'Product detail page did not contain the product title.');
  check(productHtml.includes('1&nbsp;234') || productHtml.includes('1 234') || productHtml.includes('1 234'), 'Product detail page did not contain the product price.');
  check(productHtml.includes('mailto:info@drevito.cz') && productHtml.includes('Poptat výrobek'), 'Product detail page did not contain the direct enquiry action.');
  check(!/<a[^>]+href=["']https?:\/\//i.test(productHtml), 'Product detail page unexpectedly linked away from Dřevito.');

  await jsonRequest(`/admin/api/products/${product.id}/archive`, { method: 'POST', json: {} });
  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(!publicContent.products.some((item) => item.id === product.id), 'Archived product remained public.');
  await request(`/vyrobek/${productPayload.slug}`, { authenticated: false, expectedStatus: 404 });

  await jsonRequest(`/admin/api/products/${product.id}/restore`, { method: 'POST', json: {} });
  await jsonRequest(`/admin/api/products/${product.id}`, {
    method: 'PATCH',
    json: productPayload
  });
  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(publicContent.products.some((item) => item.id === product.id), 'Republished product did not return to public content.');

  const blogCategory = (await jsonRequest('/admin/api/blog-categories', {
    method: 'POST',
    json: {
      title: 'Smoke blog',
      slug: 'smoke-blog',
      description: 'Isolated blog category test.',
      sort_order: 990,
      is_visible: true
    }
  })).category;

  const blogPayload = {
    title: 'Smoke článek',
    slug: 'smoke-clanek',
    excerpt: 'Publikační test článku.',
    main_content: 'Celý obsah testovacího článku.',
    content_format: 'html',
    photos: [],
    author_name: 'Dřevito',
    category_ids: [blogCategory.id],
    status: 'published',
    published_at: '',
    sort_order: 990
  };
  const blogPost = (await jsonRequest('/admin/api/blog-posts', {
    method: 'POST',
    json: blogPayload
  })).post;
  check(blogPost.status === 'published', 'Blog post was not published.');
  check(blogPost.category_ids.includes(blogCategory.id), 'Blog category link was not saved.');

  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  const publicPost = publicContent.blog_posts.find((item) => item.slug === blogPayload.slug);
  check(publicPost, 'Published blog post was missing from public content.');
  check(publicPost.categories.some((item) => item.id === blogCategory.id), 'Public blog category was missing.');

  const blogPage = await request(`/blog/${blogPayload.slug}`, {
    authenticated: false,
    expectedStatus: 200
  });
  check((await blogPage.text()).includes(blogPayload.title), 'Blog detail page did not contain the article title.');

  await jsonRequest(`/admin/api/blog-posts/${blogPost.id}/archive`, { method: 'POST', json: {} });
  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(!publicContent.blog_posts.some((item) => item.id === blogPost.id), 'Archived blog post remained public.');
  await request(`/blog/${blogPayload.slug}`, { authenticated: false, expectedStatus: 404 });

  await jsonRequest(`/admin/api/blog-posts/${blogPost.id}/restore`, { method: 'POST', json: {} });
  await jsonRequest(`/admin/api/blog-posts/${blogPost.id}`, {
    method: 'PATCH',
    json: blogPayload
  });
  publicContent = await jsonRequest('/api/public-content?locale=cs', { authenticated: false });
  check(publicContent.blog_posts.some((item) => item.id === blogPost.id), 'Republished blog post did not return to public content.');

  await jsonRequest(`/admin/api/product-filters/${filter.id}`, {
    method: 'PATCH',
    json: {
      title: 'Smoke styl upravený',
      slug: 'smoke-styl',
      description: 'Updated isolated filter test.',
      sort_order: 990,
      is_visible: true
    }
  });
  await jsonRequest(`/admin/api/product-filters/${filter.id}/options/${filterOption.id}`, {
    method: 'PATCH',
    json: {
      title: 'Smoke možnost upravená',
      slug: 'smoke-moznost',
      sort_order: 10,
      is_visible: true
    }
  });
  const updatedFilters = await jsonRequest('/admin/api/product-filters');
  const updatedFilter = updatedFilters.filters.find((item) => item.id === filter.id);
  check(updatedFilter?.title === 'Smoke styl upravený', 'Product filter update was not saved.');
  check(updatedFilter.options.some((item) => item.id === filterOption.id && item.title === 'Smoke možnost upravená'), 'Product filter option update was not saved.');

  await jsonRequest(`/admin/api/product-categories/${productCategory.id}/archive`, { method: 'POST', json: {} });
  await jsonRequest(`/admin/api/product-categories/${productCategory.id}/restore`, { method: 'POST', json: {} });
  await jsonRequest(`/admin/api/blog-categories/${blogCategory.id}/archive`, { method: 'POST', json: {} });
  await jsonRequest(`/admin/api/blog-categories/${blogCategory.id}/restore`, { method: 'POST', json: {} });

  const logoutResponse = await request('/admin/logout', { method: 'POST', expectedStatus: [302, 303] });
  check((logoutResponse.headers.get('set-cookie') || '').includes('Max-Age=0'), 'Logout did not clear the session cookie.');
  sessionCookie = '';
  await request('/admin', { expectedStatus: [302, 303] });

  console.log('Dřevito smoke test passed.');
  console.log('Verified: login/logout, homepage draft/publish/revisions, catalog routes, products, photos, categories, filters, blog posts, archive/restore, public API, and detail routes.');
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(tempRoot, { recursive: true, force: true });
}
