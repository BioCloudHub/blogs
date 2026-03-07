<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { createSearchWorker, useSearchOptions } from "@vuepress/plugin-slimsearch/client";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouteLocale, useRouter, withBase } from "vuepress/client";
import ROOT_SEARCH_INDEX from "@temp/slimsearch/root.js";
import { store } from "@temp/slimsearch/store.js";
import {
  SEARCH_FOCUS_EVENT,
  SEARCH_HIGHLIGHT_QUERY_KEY,
  SEARCH_PATH,
  SEARCH_PREVIEW_QUERY_KEY,
  SEARCH_TARGET_HEADING_QUERY_KEY,
  SEARCH_TARGET_SNIPPET_QUERY_KEY,
} from "../search-constants";

type SearchResult = Awaited<ReturnType<ReturnType<typeof createSearchWorker>["search"]>>[number];
type MatchedItem = SearchResult["contents"][number];
type Word = string | [tag: string, content: string];

interface SearchHit {
  key: string;
  type: MatchedItem["type"];
  badges: string[];
  pageTitle: string;
  pageTitleHtml: string;
  sectionLabel: string;
  snippetHtml: string;
  href: string;
  previewHref: string;
  wholeQueryRank: number;
  pageRank: number;
  contentRank: number;
  pagePosition: number;
}

interface SearchHitGroup {
  key: string;
  anchor: string | null;
  items: MatchedItem[];
  order: number;
}

interface SlimSearchStoredField {
  h?: string;
  t?: string[];
  c?: string[];
}

interface SlimSearchRootIndex {
  documentIds: Record<string, string>;
  storedFields: Record<string, SlimSearchStoredField>;
}

const HIT_BADGE: Record<MatchedItem["type"], string> = {
  title: "标题",
  heading: "小节",
  text: "正文",
  customField: "字段",
};

const SEARCH_DELAY = 180;
const CJK_QUERY_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
const FALLBACK_PAGE_POSITION = Number.MAX_SAFE_INTEGER;
const MIN_SCROLLBAR_THUMB_HEIGHT = 18;

const route = useRoute();
const router = useRouter();
const routeLocale = useRouteLocale();
const searchOptions = useSearchOptions();

const inputRef = ref<HTMLInputElement | null>(null);
const hitListRef = ref<HTMLOListElement | null>(null);
const hitButtonRefs = ref<HTMLElement[]>([]);
const draftQuery = ref("");
const isSearching = ref(false);
const searchError = ref("");
const activeIndex = ref(-1);
const results = shallowRef<SearchResult[]>([]);
const isRouteSyncing = ref(false);
const hitListMetrics = ref({
  viewportHeight: 0,
  thumbHeight: 0,
});
const markerTooltip = ref({
  visible: false,
  x: 0,
  y: 0,
});

let searchRequestId = 0;
let searchWorker: ReturnType<typeof createSearchWorker> | null = null;
let hitListResizeObserver: ResizeObserver | null = null;
let hitListMeasureFrame = 0;
const searchSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;
const pageMetaMap = (() => {
  const normalizeContentValue = (value: string): string =>
    value.replace(/\s+/gu, " ").trim();
  const rootSearchData = JSON.parse(ROOT_SEARCH_INDEX) as SlimSearchRootIndex;
  const metaMap = new Map<
    string,
    {
      anchorOrder: Map<string, number>;
      anchorTitle: Map<string, string>;
      orderedAnchors: Array<{ anchor: string; title: string; position: number }>;
      content: string;
    }
  >();

  const appendContent = (
    pageMeta: {
      anchorOrder: Map<string, number>;
      anchorTitle: Map<string, string>;
      orderedAnchors: Array<{ anchor: string; title: string; position: number }>;
      content: string;
    },
    value: string | undefined,
  ): number => {
    const normalizedValue = normalizeContentValue(value ?? "");

    if (!normalizedValue) return -1;

    const position = pageMeta.content.length;

    pageMeta.content = pageMeta.content ? `${pageMeta.content} ${normalizedValue}` : normalizedValue;

    return position;
  };

  for (const [shortId, documentId] of Object.entries(rootSearchData.documentIds).sort(
    (left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10),
  )) {
    const storedField = rootSearchData.storedFields[shortId];

    if (!storedField || documentId.includes("@")) continue;

    const [pageId, anchor = ""] = documentId.split("#");
    const pagePath = store[Number.parseInt(pageId, 10)];

    if (!pagePath) continue;

    const pageMeta =
      metaMap.get(pagePath) ??
      (() => {
        const nextMeta = {
          anchorOrder: new Map<string, number>(),
          anchorTitle: new Map<string, string>(),
          orderedAnchors: [] as Array<{ anchor: string; title: string; position: number }>,
          content: "",
        };

        metaMap.set(pagePath, nextMeta);

        return nextMeta;
      })();

    if (!anchor) {
      for (const text of storedField.t ?? []) {
        appendContent(pageMeta, text);
      }

      continue;
    }

    const headingTitle = normalizeContentValue(storedField.h ?? "");
    const headingPosition = appendContent(pageMeta, headingTitle);

    if (!pageMeta.anchorOrder.has(anchor)) {
      pageMeta.anchorOrder.set(anchor, pageMeta.anchorOrder.size + 1);
      pageMeta.anchorTitle.set(anchor, headingTitle);
      pageMeta.orderedAnchors.push({
        anchor,
        title: headingTitle,
        position: headingPosition >= 0 ? headingPosition : Number.MAX_SAFE_INTEGER,
      });
    }

    for (const text of storedField.t ?? []) {
      appendContent(pageMeta, text);
    }
  }

  return metaMap;
})();

const normalizeString = (value: unknown): string => {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";

  return typeof value === "string" ? value : "";
};

const normalizeQuery = (value: unknown): string =>
  normalizeString(value).trim().replace(/\s+/g, " ");

const buildWorkerQuery = (query: string): string => {
  if (!query || !CJK_QUERY_RE.test(query)) return query;

  const terms = query
    .split(/\s+/u)
    .flatMap((chunk) => {
      if (!chunk) return [];
      if (!CJK_QUERY_RE.test(chunk)) return [chunk];
      if (!searchSegmenter) return chunk.split("");

      return Array.from(searchSegmenter.segment(chunk))
        .map(({ segment }) => segment.trim())
        .filter(Boolean);
    })
    .filter(Boolean);

  return terms.length ? terms.join(" ") : query;
};

const normalizeHit = (value: unknown): number => {
  const parsed = Number.parseInt(normalizeString(value), 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const getWordText = (word: Word): string => (typeof word === "string" ? word : word[1]);

const getLineText = (line: Word[]): string => line.map(getWordText).join("");

const getMarkRangesFromLine = (line: Word[]): Array<[start: number, end: number]> => {
  const markRanges: Array<[start: number, end: number]> = [];
  let cursor = 0;

  for (const word of line) {
    const content = getWordText(word);

    if (!content) continue;

    const start = cursor;

    cursor += content.length;

    if (Array.isArray(word) && word[0].toLowerCase() === "mark") {
      markRanges.push([start, cursor]);
    }
  }

  return markRanges;
};

const mergeMarkRanges = (
  ranges: Array<readonly [start: number, end: number]>,
): Array<[start: number, end: number]> => {
  if (!ranges.length) return [];

  const sortedRanges = [...ranges].sort((left, right) =>
    left[0] === right[0] ? left[1] - right[1] : left[0] - right[0],
  );
  const mergedRanges: Array<[start: number, end: number]> = [];

  for (const [start, end] of sortedRanges) {
    const previousRange = mergedRanges.at(-1);

    if (!previousRange || start > previousRange[1]) {
      mergedRanges.push([start, end]);
      continue;
    }

    previousRange[1] = Math.max(previousRange[1], end);
  }

  return mergedRanges;
};

const buildMarkedLine = (
  plainText: string,
  markRanges: Array<readonly [start: number, end: number]>,
): Word[] => {
  if (!plainText) return [];

  const normalizedRanges = mergeMarkRanges(markRanges);
  const line: Word[] = [];
  let cursor = 0;

  for (const [start, end] of normalizedRanges) {
    if (start > cursor) {
      line.push(plainText.slice(cursor, start));
    }

    if (end > start) {
      line.push(["mark", plainText.slice(start, end)]);
    }

    cursor = end;
  }

  if (cursor < plainText.length) {
    line.push(plainText.slice(cursor));
  }

  return line.filter((word) => getWordText(word).length > 0);
};

const normalizeDisplay = (display: Word[][]): Word[][] => {
  const lineMap = new Map<
    string,
    {
      order: number;
      marks: Array<[start: number, end: number]>;
    }
  >();

  display.forEach((line, index) => {
    let cursor = 0;
    let plainText = "";
    const markRanges: Array<[start: number, end: number]> = [];

    for (const word of line) {
      const content = getWordText(word);

      if (!content) continue;

      const start = cursor;

      plainText += content;
      cursor += content.length;

      if (Array.isArray(word) && word[0].toLowerCase() === "mark") {
        markRanges.push([start, cursor]);
      }
    }

    if (!plainText.trim()) return;

    const existingLine = lineMap.get(plainText);

    if (existingLine) {
      existingLine.marks.push(...markRanges);
      return;
    }

    lineMap.set(plainText, {
      order: index,
      marks: markRanges,
    });
  });

  return [...lineMap.entries()]
    .sort((left, right) => left[1].order - right[1].order)
    .map(([plainText, { marks }]) => buildMarkedLine(plainText, marks));
};

const renderWord = (word: Word): string => {
  if (typeof word === "string") return escapeHtml(word);

  const [tag, content] = word;
  const safeTag = /^[a-z][a-z0-9-]*$/i.test(tag) ? tag : "span";

  return `<${safeTag}>${escapeHtml(content)}</${safeTag}>`;
};

const renderDisplay = (display: Word[][]): string =>
  normalizeDisplay(display)
    .map((line) => line.map(renderWord).join(""))
    .join('<span class="bc-search-snippet-sep"> ... </span>');

const toPlainText = (display: Word[][], separator = ""): string =>
  normalizeDisplay(display)
    .map((line) => getLineText(line))
    .join(separator)
    .trim();

const getFirstPlainLine = (display: Word[][]): string =>
  normalizeDisplay(display)
    .map((line) => getLineText(line).trim())
    .find(Boolean) ?? "";

const normalizeComparableText = (value: string): string =>
  value.toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ").trim();

const normalizeLookupText = (value: string): string =>
  value.replace(/\s+/gu, " ").replace(/…/gu, "").trim();

const collectQueryTerms = (query: string): string[] =>
  Array.from(
    new Set(
      normalizeQuery(query)
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);

const applyQueryHighlight = (display: Word[][], query: string): Word[][] => {
  const normalizedDisplay = normalizeDisplay(display);
  const queryTerms = collectQueryTerms(query);

  if (!queryTerms.length) return normalizedDisplay;

  return normalizedDisplay.map((line) => {
    const plainText = getLineText(line);
    const plainTextLookup = plainText.toLocaleLowerCase("zh-CN");
    const markRanges = getMarkRangesFromLine(line);

    for (const queryTerm of queryTerms) {
      const normalizedTerm = queryTerm.toLocaleLowerCase("zh-CN");

      if (!normalizedTerm) continue;

      let searchIndex = 0;

      while (searchIndex < plainTextLookup.length) {
        const matchedIndex = plainTextLookup.indexOf(normalizedTerm, searchIndex);

        if (matchedIndex < 0) break;

        markRanges.push([matchedIndex, matchedIndex + normalizedTerm.length]);
        searchIndex = matchedIndex + Math.max(normalizedTerm.length, 1);
      }
    }

    return buildMarkedLine(plainText, markRanges);
  });
};

const buildPlainPreviewDisplay = (value: string): Word[][] | null => {
  const normalized = value.replace(/\s+/gu, " ").trim();

  if (!normalized) return null;

  const truncated = normalized.slice(0, 160).trim();

  return [[truncated.length < normalized.length ? `${truncated}...` : truncated]];
};

const buildTargetSnippet = (display: Word[][]): string => {
  const candidates = normalizeDisplay(display)
    .map((line) => normalizeLookupText(getLineText(line)))
    .filter((line) => line.length >= 8)
    .sort((left, right) => right.length - left.length);

  return candidates[0]?.slice(0, 180) ?? "";
};

const buildHref = (item: MatchedItem): string => {
  const path = store[item.id];

  if (!path) return "/";

  return "anchor" in item && item.anchor ? `${path}#${item.anchor}` : path;
};

const collectHighlightTerms = (display: Word[][], fallbackQuery: string): string[] => {
  const matchedTerms = normalizeDisplay(display).flatMap((line) =>
    line.flatMap((word) =>
      Array.isArray(word) && word[0].toLowerCase() === "mark" && word[1].trim()
        ? [word[1].trim()]
        : [],
    ),
  );
  const fallbackTerms = fallbackQuery
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean);

  return Array.from(new Set([...matchedTerms, ...fallbackTerms])).sort(
    (left, right) => right.length - left.length,
  );
};

const buildPreviewHref = (
  href: string,
  highlightTerms: string[],
  targetHeading = "",
  targetSnippet = "",
): string => {
  const [pathWithQuery, hash = ""] = href.split("#");
  const [path, queryString = ""] = pathWithQuery.split("?");
  const query = new URLSearchParams(queryString);

  query.set(SEARCH_PREVIEW_QUERY_KEY, "1");

  if (highlightTerms.length) {
    query.set(SEARCH_HIGHLIGHT_QUERY_KEY, JSON.stringify(highlightTerms));
  } else {
    query.delete(SEARCH_HIGHLIGHT_QUERY_KEY);
  }

  if (targetHeading) {
    query.set(SEARCH_TARGET_HEADING_QUERY_KEY, targetHeading);
  } else {
    query.delete(SEARCH_TARGET_HEADING_QUERY_KEY);
  }

  if (targetSnippet) {
    query.set(SEARCH_TARGET_SNIPPET_QUERY_KEY, targetSnippet);
  } else {
    query.delete(SEARCH_TARGET_SNIPPET_QUERY_KEY);
  }

  const nextQuery = query.toString();
  const nextHash = hash ? `#${hash}` : "";

  return `${withBase(path)}${nextQuery ? `?${nextQuery}` : ""}${nextHash}`;
};

const mergeHighlightTerms = (...highlightGroups: string[][]): string[] =>
  Array.from(new Set(highlightGroups.flat().filter(Boolean))).sort(
    (left, right) => right.length - left.length,
  );

const resolveWholeQueryRank = (
  query: string,
  pageTitle: string,
  sectionLabel: string,
  bodyText: string,
): number => {
  const normalizedQuery = normalizeComparableText(query);

  if (!normalizedQuery) return 0;

  const titleText = normalizeComparableText(`${pageTitle} ${sectionLabel}`);

  if (titleText.includes(normalizedQuery)) return 2;
  if (normalizeComparableText(bodyText).includes(normalizedQuery)) return 1;

  return 0;
};

const resolvePagePosition = (
  path: string,
  anchor: string | null,
  hasHeading: boolean,
  hasTitleOnly: boolean,
): number => {
  if (hasTitleOnly) return 0;
  if (!anchor) return FALLBACK_PAGE_POSITION;

  const anchorOrder = pageMetaMap.get(path)?.anchorOrder.get(anchor);

  if (typeof anchorOrder !== "number") return FALLBACK_PAGE_POSITION;

  return anchorOrder * 2 + (hasHeading ? 0 : 1);
};

const getGroupAnchor = (group: SearchHitGroup): string | null => group.anchor;

const getGroupHeadingItem = (group: SearchHitGroup): Extract<MatchedItem, { type: "heading" }> | null =>
  (group.items.find((item) => item.type === "heading") as Extract<MatchedItem, { type: "heading" }>) ??
  null;

const getGroupTextItems = (group: SearchHitGroup): Array<Extract<MatchedItem, { type: "text" }>> =>
  group.items.filter((item) => item.type === "text") as Array<Extract<MatchedItem, { type: "text" }>>;

const getGroupCustomFieldItems = (
  group: SearchHitGroup,
): Array<Extract<MatchedItem, { type: "customField" }>> =>
  group.items.filter((item) => item.type === "customField") as Array<
    Extract<MatchedItem, { type: "customField" }>
  >;

const getPrimaryGroupType = (group: SearchHitGroup): MatchedItem["type"] => {
  if (getGroupTextItems(group).length) return "text";
  if (getGroupHeadingItem(group)) return "heading";
  if (getGroupCustomFieldItems(group).length) return "customField";

  return "title";
};

const buildGroupBadges = (group: SearchHitGroup): string[] => {
  const matchedTypes: MatchedItem["type"][] = [];

  if (getGroupHeadingItem(group)) matchedTypes.push("heading");
  if (getGroupTextItems(group).length) matchedTypes.push("text");
  if (getGroupCustomFieldItems(group).length) matchedTypes.push("customField");

  if (!matchedTypes.length) matchedTypes.push("title");

  return matchedTypes.map((type) => HIT_BADGE[type]);
};

const mergeDisplayGroups = (displays: Word[][][], maxLines = 3): Word[][] => {
  const mergedLines: Word[][] = [];
  const seenLines = new Set<string>();

  for (const display of displays) {
    for (const line of normalizeDisplay(display)) {
      const plainLine = getLineText(line).replace(/\s+/gu, " ").trim();

      if (!plainLine || seenLines.has(plainLine)) continue;

      seenLines.add(plainLine);
      mergedLines.push(line);

      if (mergedLines.length >= maxLines) {
        return mergedLines;
      }
    }
  }

  return mergedLines;
};

const resolveMatchedBodyDisplay = (group: SearchHitGroup): Word[][] | null => {
  const textItems = getGroupTextItems(group);
  const customFieldItems = getGroupCustomFieldItems(group);

  if (!textItems.length && !customFieldItems.length) {
    return null;
  }

  return mergeDisplayGroups(
    [...textItems, ...customFieldItems].map((item) => item.display),
    4,
  );
};

const groupResultItems = (items: MatchedItem[]): SearchHitGroup[] => {
  const groupMap = new Map<string, SearchHitGroup>();

  items.forEach((item, index) => {
    const anchor = "anchor" in item && item.anchor ? item.anchor : null;
    const key =
      item.type === "customField"
        ? `${item.type}:${item.index}:${index}`
        : anchor
          ? `anchor:${anchor}`
          : `${item.type}:${index}`;
    const existingGroup = groupMap.get(key);

    if (existingGroup) {
      existingGroup.items.push(item);
      return;
    }

    groupMap.set(key, {
      key,
      anchor,
      items: [item],
      order: index,
    });
  });

  return [...groupMap.values()].sort((left, right) => left.order - right.order);
};

const buildLookupCandidates = (bodyDisplay: Word[][]): string[] => {
  const lookupCandidates = new Set<string>();
  const bodyLines = normalizeDisplay(bodyDisplay)
    .map((line) => normalizeLookupText(getLineText(line)))
    .filter(Boolean);
  const pushCandidate = (candidate: string): void => {
    const normalizedCandidate = normalizeLookupText(candidate);

    if (normalizedCandidate.length >= 8) {
      lookupCandidates.add(normalizedCandidate);
    }
  };

  for (const line of bodyLines) {
    pushCandidate(line);
    pushCandidate(line.slice(0, 128));
    pushCandidate(line.slice(0, 96));
    pushCandidate(line.slice(0, 64));
    pushCandidate(line.slice(-128));
    pushCandidate(line.slice(-96));
    pushCandidate(line.slice(-64));
  }

  const combinedBody = normalizeLookupText(bodyLines.join(" "));

  if (combinedBody) {
    pushCandidate(combinedBody);
    pushCandidate(combinedBody.slice(0, 160));
    pushCandidate(combinedBody.slice(0, 120));
    pushCandidate(combinedBody.slice(0, 96));
  }

  return [...lookupCandidates].sort((left, right) => right.length - left.length);
};

const resolveNearestSectionTitle = (path: string, bodyDisplay: Word[][] | null): string => {
  if (!bodyDisplay?.length) return "";

  const pageMeta = pageMetaMap.get(path);

  if (!pageMeta?.orderedAnchors.length) return "";

  const lookupCandidates = buildLookupCandidates(bodyDisplay);

  let contentPosition = -1;

  for (const candidate of lookupCandidates) {
    contentPosition = pageMeta.content.indexOf(candidate);

    if (contentPosition >= 0) break;
  }

  if (contentPosition < 0) {
    return pageMeta.orderedAnchors[0]?.title || "";
  }

  let previousHeader = pageMeta.orderedAnchors[0] ?? null;

  for (const header of pageMeta.orderedAnchors) {
    if (header.position > contentPosition) {
      return previousHeader?.position === Number.MAX_SAFE_INTEGER
        ? header.title
        : previousHeader?.title || header.title;
    }

    previousHeader = header;
  }

  return previousHeader?.title || pageMeta.orderedAnchors[0]?.title || "";
};

const resolveSectionLabel = (
  result: SearchResult,
  group: SearchHitGroup,
  path: string,
  matchedBodyDisplay: Word[][] | null,
): string => {
  const headingItem = getGroupHeadingItem(group);

  if (headingItem) {
    return (
      getFirstPlainLine(headingItem.display) ||
      pageMetaMap.get(path)?.anchorTitle.get(group.anchor ?? "") ||
      resolveNearestSectionTitle(path, matchedBodyDisplay)
    );
  }

  if (group.anchor) {
    return (
      pageMetaMap.get(path)?.anchorTitle.get(group.anchor) ||
      resolveNearestSectionTitle(path, matchedBodyDisplay)
    );
  }

  if (matchedBodyDisplay?.length) {
    const nearestSectionTitle = resolveNearestSectionTitle(path, matchedBodyDisplay);

    if (nearestSectionTitle) return nearestSectionTitle;
  }

  const titleItem = group.items.find((item) => item.type === "title");

  if (titleItem) {
    return getFirstPlainLine(titleItem.display) || result.title || "";
  }

  return "";
};

const resolveTitlePreviewDisplay = (path: string, titleText: string): Word[][] | null => {
  const pageContent = pageMetaMap.get(path)?.content;
  const normalizedTitle = titleText.replace(/\s+/gu, " ").trim();

  if (!pageContent) return null;

  if (!normalizedTitle) return buildPlainPreviewDisplay(pageContent);

  const titleIndex = pageContent.indexOf(normalizedTitle);
  const previewSource =
    titleIndex >= 0
      ? pageContent.slice(titleIndex + normalizedTitle.length).replace(/^[：:、，。,.\-\s]+/u, "")
      : pageContent;

  return buildPlainPreviewDisplay(previewSource);
};

const resolveSnippetDisplay = (
  result: SearchResult,
  group: SearchHitGroup,
  path: string,
  sectionLabel: string,
  matchedBodyDisplay: Word[][] | null,
): Word[][] => {
  if (matchedBodyDisplay?.length) return matchedBodyDisplay;

  const previewDisplay = resolveTitlePreviewDisplay(path, sectionLabel || result.title || "");

  if (previewDisplay) return previewDisplay;

  const representativeItem = group.items[0];

  return representativeItem ? normalizeDisplay(representativeItem.display) : [];
};

const compareSearchHits = (left: SearchHit, right: SearchHit): number => {
  if (right.wholeQueryRank !== left.wholeQueryRank) {
    return right.wholeQueryRank - left.wholeQueryRank;
  }

  if (left.pageRank !== right.pageRank) {
    return left.pageRank - right.pageRank;
  }

  if (left.pagePosition !== right.pagePosition) {
    return left.pagePosition - right.pagePosition;
  }

  return left.contentRank - right.contentRank;
};

const flattenResults = (searchResults: SearchResult[], fallbackQuery: string): SearchHit[] =>
  searchResults.flatMap((result, resultIndex) => {
    const titleItems = result.contents.filter((item) => item.type === "title");
    const nonTitleItems = result.contents.filter((item) => item.type !== "title");
    const sourceGroups =
      nonTitleItems.length > 0
        ? groupResultItems(nonTitleItems)
        : groupResultItems(titleItems.length ? titleItems : result.contents);
    const titleItem = titleItems[0];
    const pageTitle = result.title || "未命名页面";
    const highlightedTitleDisplay = titleItem ? applyQueryHighlight(titleItem.display, fallbackQuery) : null;
    const titleHighlightTerms = highlightedTitleDisplay
      ? collectHighlightTerms(highlightedTitleDisplay, fallbackQuery)
      : [];
    const pageTitleHtml =
      highlightedTitleDisplay ? renderDisplay(highlightedTitleDisplay) : escapeHtml(pageTitle);

    return sourceGroups.map((group, contentIndex) => {
      const representativeItem = group.items[0];
      const rawHref = representativeItem
        ? group.anchor
          ? `${store[representativeItem.id]}#${group.anchor}`
          : buildHref(representativeItem)
        : "/";
      const [rawPath] = rawHref.split("#");
      const matchedBodyDisplay = resolveMatchedBodyDisplay(group);
      const sectionLabel = resolveSectionLabel(result, group, rawPath, matchedBodyDisplay);
      const snippetDisplay = resolveSnippetDisplay(
        result,
        group,
        rawPath,
        sectionLabel,
        matchedBodyDisplay,
      );
      const highlightedSnippetDisplay = applyQueryHighlight(snippetDisplay, fallbackQuery);
      const snippetPlainText = toPlainText(highlightedSnippetDisplay, " ");
      const itemHighlightTerms = collectHighlightTerms(highlightedSnippetDisplay, fallbackQuery);
      const highlightTerms = mergeHighlightTerms(titleHighlightTerms, itemHighlightTerms);
      const targetSnippet = buildTargetSnippet(snippetDisplay);
      const badges = buildGroupBadges(group);
      const wholeQueryRank = resolveWholeQueryRank(
        fallbackQuery,
        pageTitle,
        sectionLabel,
        `${titleItem ? toPlainText(titleItem.display, " ") : ""} ${sectionLabel} ${snippetPlainText}`,
      );
      const hasHeading = Boolean(getGroupHeadingItem(group));
      const hasTitleOnly = badges.length === 1 && badges[0] === HIT_BADGE.title;

      return {
        key: `${resultIndex}-${contentIndex}-${group.key}-${rawHref}`,
        type: getPrimaryGroupType(group),
        badges,
        pageTitle,
        pageTitleHtml,
        sectionLabel,
        snippetHtml: renderDisplay(highlightedSnippetDisplay),
        href: withBase(rawHref),
        previewHref: buildPreviewHref(rawHref, highlightTerms, sectionLabel, targetSnippet),
        wholeQueryRank,
        pageRank: resultIndex,
        contentRank: contentIndex,
        pagePosition: resolvePagePosition(rawPath, getGroupAnchor(group), hasHeading, hasTitleOnly),
      };
    });
  });

const flatHits = computed<SearchHit[]>(() =>
  flattenResults(results.value, routeQuery.value).sort(compareSearchHits),
);
const routeQuery = computed(() => normalizeQuery(route.query.q));
const routeHit = computed(() => normalizeHit(route.query.hit));
const selectedHit = computed<SearchHit | null>(() => flatHits.value[activeIndex.value] ?? null);
const selectedHitOrder = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < flatHits.value.length ? activeIndex.value + 1 : 0,
);
const resultCountText = computed(() =>
  flatHits.value.length ? `${selectedHitOrder.value || 1}/${flatHits.value.length}` : "",
);
const activeScrollMarkerRatio = computed(() => {
  if (!flatHits.value.length || activeIndex.value < 0) return 0;
  if (flatHits.value.length === 1) return 0;

  return activeIndex.value / Math.max(flatHits.value.length - 1, 1);
});
const activeScrollMarkerTop = computed(() => {
  const viewportHeight = hitListMetrics.value.viewportHeight;
  const thumbHeight = Math.min(hitListMetrics.value.thumbHeight, viewportHeight);

  if (!viewportHeight) return "0px";

  const travelRange = Math.max(viewportHeight - thumbHeight, 0);
  const offset = thumbHeight / 2 + travelRange * activeScrollMarkerRatio.value;

  return `${offset}px`;
});
const showSidebarScrollMarker = computed(() =>
  flatHits.value.length > 0 && activeIndex.value >= 0,
);
const activeScrollMarkerStyle = computed(() => ({
  "--bc-search-scrollmark-top": activeScrollMarkerTop.value,
}));
const activeScrollMarkerLabel = computed(() =>
  flatHits.value.length && selectedHitOrder.value ? `${selectedHitOrder.value}/${flatHits.value.length}` : "",
);
const activeScrollMarkerTooltip = computed(() =>
  activeScrollMarkerLabel.value
    ? `${activeScrollMarkerLabel.value}，点击回到当前结果`
    : "点击回到当前结果",
);
const activeScrollMarkerTooltipStyle = computed(() => ({
  left: `${markerTooltip.value.x}px`,
  top: `${markerTooltip.value.y}px`,
}));

const buildRouteQuery = (query: string, hit?: number, focus = false): Record<string, string> => {
  const nextQuery: Record<string, string> = {};

  if (query) nextQuery.q = query;
  if (query && typeof hit === "number" && hit >= 0) nextQuery.hit = `${hit}`;
  if (focus) nextQuery.focus = "1";

  return nextQuery;
};

const syncRouteState = async (query: string, hit?: number, focus = false): Promise<void> => {
  const currentQuery = normalizeString(route.query.q);
  const currentHit = normalizeString(route.query.hit);
  const currentFocus = normalizeString(route.query.focus);
  const nextQuery = buildRouteQuery(query, hit, focus);

  if (
    currentQuery === (nextQuery.q ?? "") &&
    currentHit === (nextQuery.hit ?? "") &&
    currentFocus === (nextQuery.focus ?? "")
  ) {
    return;
  }

  await router.replace({
    path: SEARCH_PATH,
    query: nextQuery,
  });
};

const runSearch = async (query: string, requestedHit: number): Promise<void> => {
  const searchId = ++searchRequestId;

  searchError.value = "";

  if (!query) {
    results.value = [];
    activeIndex.value = -1;
    isSearching.value = false;
    return;
  }

  if (!searchWorker) {
    isSearching.value = false;
    return;
  }

  isSearching.value = true;

  try {
    const nextResults = await searchWorker.search(
      buildWorkerQuery(query),
      routeLocale.value,
      searchOptions.value,
    );

    if (searchId !== searchRequestId) return;

    results.value = nextResults;
    isSearching.value = false;

    const nextHits = flattenResults(nextResults, query);

    if (!nextHits.length) {
      activeIndex.value = -1;
      await syncRouteState(query);
      return;
    }

    const nextIndex = Math.min(requestedHit, nextHits.length - 1);

    activeIndex.value = nextIndex;
    await syncRouteState(query, nextIndex);
  } catch (error) {
    if (searchId !== searchRequestId) return;

    results.value = [];
    activeIndex.value = -1;
    isSearching.value = false;
    searchError.value = error instanceof Error ? error.message : "搜索失败，请稍后重试。";
  }
};

const focusInput = (): void => {
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
};

const commitDraftQuery = useDebounceFn((value: string) => {
  const normalized = normalizeQuery(value);

  void syncRouteState(normalized, normalized ? 0 : undefined);
}, SEARCH_DELAY);

const selectHit = (index: number): void => {
  activeIndex.value = index;
  void syncRouteState(routeQuery.value, index);
};

const setHitButtonRef = (element: Element | null, index: number): void => {
  if (element instanceof HTMLElement) {
    hitButtonRefs.value[index] = element;
    return;
  }

  delete hitButtonRefs.value[index];
};

const scrollActiveHitIntoView = (): void => {
  const activeButton = hitButtonRefs.value[activeIndex.value];
  const hitList = hitListRef.value;

  if (!hitList) {
    if (!activeButton) return;

    activeButton.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    activeButton.focus({ preventScroll: true });
    return;
  }

  const maxScrollTop = Math.max(hitList.scrollHeight - hitList.clientHeight, 0);
  const targetScrollTop = maxScrollTop * activeScrollMarkerRatio.value;

  hitList.scrollTo({
    top: targetScrollTop,
    behavior: "smooth",
  });

  if (activeButton) {
    activeButton.focus({ preventScroll: true });
  }
};

const measureHitListMetrics = (): void => {
  const hitList = hitListRef.value;

  if (!hitList) {
    hitListMetrics.value = {
      viewportHeight: 0,
      thumbHeight: 0,
    };

    return;
  }

  const viewportHeight = hitList.clientHeight;
  const scrollHeight = hitList.scrollHeight;
  const rawThumbHeight =
    viewportHeight > 0 && scrollHeight > 0 ? (viewportHeight * viewportHeight) / scrollHeight : 0;
  const thumbHeight = Math.min(
    viewportHeight,
    Math.max(rawThumbHeight, Math.min(viewportHeight, MIN_SCROLLBAR_THUMB_HEIGHT)),
  );

  hitListMetrics.value = {
    viewportHeight,
    thumbHeight,
  };
};

const scheduleMeasureHitListMetrics = (): void => {
  if (typeof window === "undefined") return;

  if (hitListMeasureFrame) {
    window.cancelAnimationFrame(hitListMeasureFrame);
  }

  hitListMeasureFrame = window.requestAnimationFrame(() => {
    hitListMeasureFrame = 0;
    measureHitListMetrics();
  });
};

const handleWindowResize = (): void => {
  scheduleMeasureHitListMetrics();
};

const showMarkerTooltip = (clientX: number, clientY: number): void => {
  if (typeof window === "undefined") return;

  markerTooltip.value = {
    visible: true,
    x: Math.min(clientX + 14, window.innerWidth - 220),
    y: Math.min(Math.max(clientY, 16), window.innerHeight - 16),
  };
};

const hideMarkerTooltip = (): void => {
  markerTooltip.value.visible = false;
};

const handleMarkerPointerMove = (event: MouseEvent): void => {
  showMarkerTooltip(event.clientX, event.clientY);
};

const handleMarkerFocus = (event: FocusEvent): void => {
  const target = event.currentTarget;

  if (!(target instanceof HTMLElement)) return;

  const rect = target.getBoundingClientRect();

  showMarkerTooltip(rect.right, rect.top + rect.height / 2);
};

watch(
  () => [routeQuery.value, routeHit.value] as const,
  ([query, hit], previousState) => {
    if (draftQuery.value !== query) {
      isRouteSyncing.value = true;
      draftQuery.value = query;
      nextTick(() => {
        isRouteSyncing.value = false;
      });
    }

    const previousQuery = previousState?.[0] ?? "";

    if (query && query === previousQuery && flatHits.value.length) {
      const nextIndex = Math.min(hit, flatHits.value.length - 1);

      activeIndex.value = nextIndex;

      if (nextIndex !== hit) {
        void syncRouteState(query, nextIndex);
      }

      return;
    }

    void runSearch(query, hit);
  },
  { immediate: true },
);

watch(draftQuery, (value) => {
  if (isRouteSyncing.value) return;

  commitDraftQuery(value);
});

watch(
  () => flatHits.value.length,
  (length) => {
    hitButtonRefs.value.length = length;
  },
);

watch(
  flatHits,
  () => {
    nextTick(() => {
      scheduleMeasureHitListMetrics();
    });
  },
);

watch(hitListRef, (hitList, previousHitList) => {
  if (hitListResizeObserver && previousHitList) {
    hitListResizeObserver.unobserve(previousHitList);
  }

  if (typeof ResizeObserver === "undefined" || !hitList) {
    scheduleMeasureHitListMetrics();
    return;
  }

  if (!hitListResizeObserver) {
    hitListResizeObserver = new ResizeObserver(() => {
      scheduleMeasureHitListMetrics();
    });
  }

  hitListResizeObserver.observe(hitList);
  scheduleMeasureHitListMetrics();
});

watch(
  () => normalizeString(route.query.focus),
  (focusFlag) => {
    if (focusFlag !== "1") return;

    focusInput();
    void syncRouteState(routeQuery.value, selectedHit.value ? activeIndex.value : undefined);
  },
  { immediate: true },
);

const handleFocusEvent = (): void => {
  focusInput();
};

onMounted(() => {
  searchWorker = createSearchWorker();
  window.addEventListener(SEARCH_FOCUS_EVENT, handleFocusEvent);
  window.addEventListener("resize", handleWindowResize);
  scheduleMeasureHitListMetrics();
  void runSearch(routeQuery.value, routeHit.value);
});

onUnmounted(() => {
  window.removeEventListener(SEARCH_FOCUS_EVENT, handleFocusEvent);
  window.removeEventListener("resize", handleWindowResize);
  hitListResizeObserver?.disconnect();
  if (hitListMeasureFrame && typeof window !== "undefined") {
    window.cancelAnimationFrame(hitListMeasureFrame);
  }
  searchWorker?.terminate();
});
</script>

<template>
  <section class="bc-search-page">
    <aside class="bc-search-sidebar">
      <div class="bc-search-sidebar-search">
        <label class="bc-search-input-shell">
          <span class="bc-search-input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M10.5 4a6.5 6.5 0 1 0 4.07 11.57l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <input
            ref="inputRef"
            v-model="draftQuery"
            type="search"
            inputmode="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入关键词、问题编号、主题词"
          >
        </label>
      </div>

      <div class="bc-search-sidebar-results">
        <div class="bc-search-panel-head">
          <h2>命中结果</h2>
          <span v-if="routeQuery && flatHits.length" class="bc-search-result-count">
            {{ resultCountText }}
          </span>
        </div>

        <div v-if="searchError" class="bc-search-empty error">
          {{ searchError }}
        </div>

        <div v-else-if="isSearching" class="bc-search-empty">
          搜索中...
        </div>

        <div v-else-if="!routeQuery" class="bc-search-empty">
          输入关键词开始搜索
        </div>

        <div v-else-if="!flatHits.length" class="bc-search-empty">
          没有匹配结果
        </div>

        <div v-else class="bc-search-hit-list-wrap">
          <ol ref="hitListRef" class="bc-search-hit-list">
            <li v-for="(hit, index) in flatHits" :key="hit.key">
              <button
                :ref="(element) => setHitButtonRef(element, index)"
                class="bc-search-hit-card"
                :class="{ active: index === activeIndex }"
                type="button"
                @click="selectHit(index)"
              >
                <div class="bc-search-hit-meta">
                  <div class="bc-search-hit-badges">
                    <span
                      v-for="badge in hit.badges"
                      :key="`${hit.key}-${badge}`"
                      class="bc-search-hit-badge"
                    >
                      {{ badge }}
                    </span>
                  </div>
                  <span class="bc-search-hit-page" :title="hit.pageTitle" v-html="hit.pageTitleHtml"></span>
                </div>
                <p v-if="hit.sectionLabel" class="bc-search-hit-section">{{ hit.sectionLabel }}</p>
                <p class="bc-search-hit-snippet" v-html="hit.snippetHtml"></p>
              </button>
            </li>
          </ol>

          <button
            v-if="showSidebarScrollMarker"
            class="bc-search-hit-scrollmark"
            type="button"
            :style="activeScrollMarkerStyle"
            :aria-label="activeScrollMarkerTooltip"
            @click="scrollActiveHitIntoView"
            @mouseenter="handleMarkerPointerMove"
            @mousemove="handleMarkerPointerMove"
            @mouseleave="hideMarkerTooltip"
            @focus="handleMarkerFocus"
            @blur="hideMarkerTooltip"
          >
            <span class="bc-search-hit-scrollmark-dot" aria-hidden="true">🦠</span>
          </button>

          <div
            v-if="markerTooltip.visible"
            class="bc-search-hit-scrollmark-tooltip"
            :style="activeScrollMarkerTooltipStyle"
            role="tooltip"
          >
            {{ activeScrollMarkerTooltip }}
          </div>
        </div>
      </div>
    </aside>

    <section class="bc-search-preview">
      <div v-if="selectedHit" class="bc-search-preview-head">
        <div class="bc-search-preview-copy">
          <h2>{{ selectedHit.sectionLabel || selectedHit.pageTitle }}</h2>
          <p>{{ selectedHit.pageTitle }}</p>
        </div>
        <a
          class="bc-search-toolbar-button bc-search-preview-open"
          :href="selectedHit.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开原文
        </a>
      </div>

      <div v-if="!routeQuery" class="bc-search-preview-empty">
        选择结果后在这里预览原文
      </div>

      <div v-else-if="!selectedHit && !isSearching" class="bc-search-preview-empty">
        暂无可预览内容
      </div>

      <iframe
        v-else-if="selectedHit"
        class="bc-search-preview-frame"
        :src="selectedHit.previewHref"
        title="搜索结果原文预览"
        loading="lazy"
      />
    </section>
  </section>
</template>
