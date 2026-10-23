import { load } from "cheerio";
import type { App, Page } from "vuepress";
import { SEARCH_PATH, SEARCH_ROUTE_PREFIX } from "./search-constants";

const HEADING_SELECTOR = "h2, h3, h4, h5, h6";

const EXCLUDED_PATH_PREFIXES = [
  "/category/",
  "/tag/",
  "/article/",
  "/star/",
  "/timeline/",
  SEARCH_PATH,
  `${SEARCH_ROUTE_PREFIX}/`,
];

interface SearchAnchorMeta {
  anchor: string;
  title: string;
  position: number;
}

interface SearchPageMeta {
  title: string;
  content: string;
  anchors: SearchAnchorMeta[];
}

const normalizeText = (value: string): string => value.replace(/\s+/gu, " ").trim();

const isIndexablePage = (page: Page): boolean =>
  page.frontmatter.search !== false &&
  !EXCLUDED_PATH_PREFIXES.some((prefix) => page.path.startsWith(prefix));

const extractPageMeta = (page: Page): SearchPageMeta => {
  const $ = load(page.contentRendered);
  const title = normalizeText(page.title ?? "");
  const content = normalizeText(`${title} ${$.root().text()}`);
  const anchors: SearchAnchorMeta[] = [];
  let searchFrom = 0;

  $(HEADING_SELECTOR).each((_, element) => {
    const anchor = element.attribs?.id;

    if (!anchor) return;

    const headingTitle = normalizeText($(element).text());

    if (!headingTitle) return;

    const position = content.indexOf(headingTitle, searchFrom);

    anchors.push({
      anchor,
      title: headingTitle,
      position: position >= 0 ? position : content.length,
    });

    if (position >= 0) {
      searchFrom = position + headingTitle.length;
    }
  });

  return { title, content, anchors };
};

/**
 * Writes page metadata used by the custom search workspace.
 *
 * The slimsearch plugin only emits its raw `slimsearch/root.js` in dev mode,
 * so a clean production build cannot import it. This plugin generates equivalent
 * metadata (page title, plain text and heading anchors) for both dev and build.
 */
export const searchPageMetaPlugin = () => ({
  name: "search-page-meta",

  onPrepared: async (app: App): Promise<void> => {
    const pageMeta: Record<string, SearchPageMeta> = {};

    for (const page of app.pages) {
      if (!isIndexablePage(page)) continue;

      pageMeta[page.path] = extractPageMeta(page);
    }

    await app.writeTemp(
      "search-page-meta.js",
      `export default ${JSON.stringify(JSON.stringify(pageMeta))}\n`,
    );
  },
});
