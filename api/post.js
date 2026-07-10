/**
 * /blog/<slug> — serve blog-post.html with per-post SEO meta.
 *
 * The blog renders client-side from Firestore, which is fine for Google
 * (it runs JS) but invisible to social scrapers (Facebook/Instagram/
 * iMessage/Twitter don't). This function fetches the published post via
 * the Firestore REST API and serves the same blog-post.html shell with
 * the post's real <title>, description, canonical, Open Graph tags, and
 * BlogPosting JSON-LD injected — plus the post JSON itself embedded as
 * window.__POST__ so the page renders without a second Firestore fetch.
 *
 * Wired by the vercel.json rewrite:  /blog/:slug → /api/post?slug=:slug
 * The template is fetched once per instance from the deployment itself
 * (no filesystem bundling), then held in memory.
 *
 * The Firebase web API key below is PUBLIC by design (same one the site
 * ships to every browser); Firestore rules are the security boundary.
 */

const PROJECT = 'houseoffigs-16f71';
const API_KEY = 'AIzaSyAvh76aewVVl9PCrlBC74uRotkMutrK1cA';
const SITE = 'https://houseoffigs.org';

const PILLAR_NAMES = {
  trellis: 'The Trellis',
  fallow: 'The Fallow',
  vine: 'Off the Vine',
  grove: 'The Grove'
};

let templateCache = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Unwrap Firestore's typed field values into a plain object.
function fromFirestore(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.nullValue ?? null;
  }
  return out;
}

async function fetchTemplate(host) {
  if (templateCache) return templateCache;
  const res = await fetch(`https://${host}/blog-post.html`);
  if (!res.ok) throw new Error('template fetch failed: ' + res.status);
  templateCache = await res.text();
  return templateCache;
}

async function fetchPost(slug) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'posts' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
                { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } }
              ]
            }
          },
          limit: 1
        }
      })
    }
  );
  if (!res.ok) throw new Error('firestore query failed: ' + res.status);
  const rows = await res.json();
  const doc = rows.find((r) => r.document);
  return doc ? fromFirestore(doc.document.fields) : null;
}

function renderHead(post, slug) {
  const url = `${SITE}/blog/${encodeURIComponent(post.slug || slug)}`;
  const title = `${post.title} | From the Orchard · House of Figs`;
  const desc = post.excerpt || 'From the Orchard — the written branch of The Ripening. Where roots become fruit.';
  const image = post.coverImage
    ? (String(post.coverImage).startsWith('http') ? post.coverImage : SITE + '/' + String(post.coverImage).replace(/^\//, ''))
    : SITE + '/images/og-default.jpg';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: desc,
    url,
    image,
    datePublished: post.publishedAt || post.createdAt || undefined,
    dateModified: post.updatedAt || undefined,
    articleSection: PILLAR_NAMES[post.pillar] || undefined,
    author: { '@type': 'Person', name: post.author || 'Bethany Grissum' },
    publisher: { '@type': 'Organization', name: 'House of Figs Functional Nutrition', url: SITE + '/' }
  };

  return {
    title,
    desc,
    extra: [
      `<link rel="canonical" href="${esc(url)}">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:site_name" content="House of Figs Functional Nutrition">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(image)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(desc)}">`,
      `<meta name="twitter:image" content="${esc(image)}">`,
      `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
      // The page script renders this directly — no second Firestore fetch.
      `<script>window.__POST__ = ${JSON.stringify(post).replace(/</g, '\\u003c')};</script>`
    ].join('\n  ')
  };
}

export default async function handler(req, res) {
  const slug = String((req.query && req.query.slug) || '').toLowerCase();

  let template;
  try {
    template = await fetchTemplate(req.headers.host || 'houseoffigs.org');
  } catch (err) {
    console.error(err);
    res.statusCode = 302;
    res.setHeader('Location', '/blog-post.html?slug=' + encodeURIComponent(slug));
    res.end();
    return;
  }

  let post = null;
  if (/^[a-z0-9-]{1,200}$/.test(slug)) {
    try {
      post = await fetchPost(slug);
    } catch (err) {
      console.error('post lookup failed:', err);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // CDN-cache for 5 minutes; serve stale while refreshing. Editing a post
  // shows on the live URL within minutes without any manual purge.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');

  if (!post) {
    res.statusCode = 404;
    res.end(template);
    return;
  }

  const head = renderHead(post, slug);
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(head.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, `$1${esc(head.desc)}$2`)
    .replace('</head>', `  ${head.extra}\n</head>`);

  res.statusCode = 200;
  res.end(html);
}

// For the local test harness.
export const _internals = { renderHead, fromFirestore, setTemplate: (t) => { templateCache = t; } };
