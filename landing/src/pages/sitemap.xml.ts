import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const homepageUrl = new URL("/", site);

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${homepageUrl}</loc></url>\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
