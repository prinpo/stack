const escaped: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

/** Each page maps its available locales (and optional x-default) to public URLs. */
export function createLocalizedSitemap(
  origin: string,
  pages: readonly Readonly<Record<string, string>>[],
) {
  const entries = pages.flatMap((page) => {
    const urls = Object.entries(page).map(([locale, path]) => {
      const url = new URL(path, origin);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error(`Expected an HTTP URL in the sitemap: ${path}`);
      return { locale, href: xml(url.href) };
    });
    const alternates = urls
      .map(
        ({ locale, href }) =>
          `    <xhtml:link rel="alternate" hreflang="${xml(locale)}" href="${href}" />`,
      )
      .join("\n");
    return urls
      .filter(({ locale }) => locale !== "x-default")
      .map(({ href }) => `  <url>\n    <loc>${href}</loc>\n${alternates}\n  </url>`);
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}
