/**
 * /sitemap.xml — generated sitemap: static pages + published blog posts.
 *
 * The old sitemap.xml was a static file, so posts Bethany publishes from
 * the dashboard never appeared in it and each one needed a manual
 * "Request Indexing" in Search Console. This function pulls the published
 * slugs from Firestore (same public REST query the site itself uses) and
 * appends a /blog/<slug> entry per post, so new posts are picked up by
 * Google's next sitemap check automatically.
 *
 * Wired by the vercel.json rewrite:  /sitemap.xml → /api/sitemap
 * (the static sitemap.xml file is deleted — a static file would win over
 * the rewrite).
 *
 * The Firebase web API key below is PUBLIC by design (same one the site
 * ships to every browser); Firestore rules are the security boundary.
 */

const PROJECT = 'houseoffigs-16f71';
const API_KEY = 'AIzaSyAvh76aewVVl9PCrlBC74uRotkMutrK1cA';
const SITE = 'https://houseoffigs.org';

// Mirrors the retired static sitemap.xml (admin/intake/going-deeper stay out).
const STATIC_PAGES = [
  { path: '/', changefreq: 'monthly', priority: '1.0' },
  { path: '/about.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/services.html', changefreq: 'monthly', priority: '0.9' },
  { path: '/testimonials.html', changefreq: 'weekly', priority: '0.7' },
  { path: '/ripening.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/podcast.html', changefreq: 'weekly', priority: '0.9' },
  { path: '/blog.html', changefreq: 'weekly', priority: '0.9' },
  { path: '/quiz.html', changefreq: 'monthly', priority: '0.9' },
  { path: '/contact.html', changefreq: 'monthly', priority: '0.6' }
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchPublishedPosts() {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'posts' }],
          where: {
            fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } }
          },
          limit: 1000
        }
      })
    }
  );
  if (!res.ok) throw new Error('firestore query failed: ' + res.status);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      return {
        slug: f.slug?.stringValue || '',
        lastmod: f.updatedAt?.stringValue || f.publishedAt?.stringValue || ''
      };
    })
    .filter((p) => /^[a-z0-9-]{1,200}$/.test(p.slug));
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${esc(loc)}</loc>`,
    lastmod ? `    <lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>'
  ].filter(Boolean).join('\n');
}

export default async function handler(req, res) {
  let posts = [];
  try {
    posts = await fetchPublishedPosts();
  } catch (err) {
    // Static pages still ship if Firestore is unreachable.
    console.error('sitemap post lookup failed:', err);
  }

  const entries = [
    ...STATIC_PAGES.map((p) => urlEntry({ loc: SITE + p.path, changefreq: p.changefreq, priority: p.priority })),
    ...posts.map((p) => urlEntry({
      loc: `${SITE}/blog/${encodeURIComponent(p.slug)}`,
      lastmod: p.lastmod,
      changefreq: 'monthly',
      priority: '0.8'
    }))
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries.join('\n'),
    '</urlset>',
    ''
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // CDN-cache for an hour; a newly published post appears within the hour.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.statusCode = 200;
  res.end(xml);
}

// For the local test harness.
export const _internals = { fetchPublishedPosts, urlEntry };
