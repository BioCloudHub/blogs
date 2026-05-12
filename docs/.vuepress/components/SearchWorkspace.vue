<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { createSearchWorker, useSearchOptions } from "@vuepress/plugin-slimsearch/client";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { ClientOnly, useRoute, useRouteLocale, useRouter, withBase } from "vuepress/client";
import ROOT_SEARCH_INDEX from "@temp/slimsearch/root.js";
import { store } from "@temp/slimsearch/store.js";
import {
  SEARCH_FOCUS_EVENT,
  SEARCH_HIGHLIGHT_QUERY_KEY,
  SEARCH_PATH,
  SEARCH_PREVIEW_SYNC_MESSAGE,
  SEARCH_PREVIEW_QUERY_KEY,
  SEARCH_TARGET_HEADING_QUERY_KEY,
  SEARCH_TARGET_SNIPPET_QUERY_KEY,
} from "../search-constants";

type SearchResult = Awaited<ReturnType<ReturnType<typeof createSearchWorker>["search"]>>[number];
type MatchedItem = SearchResult["contents"][number];
type Word = string | [tag: string, content: string];
type PreviewFrameKey = "primary" | "secondary";

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

interface PreviewFrameSyncPayload {
  type: typeof SEARCH_PREVIEW_SYNC_MESSAGE;
  hash: string;
  highlightTerms: string[];
  targetHeading: string;
  targetSnippet: string;
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

interface PageSearchMeta {
  anchorOrder: Map<string, number>;
  anchorTitle: Map<string, string>;
  orderedAnchors: Array<{ anchor: string; title: string; position: number }>;
  content: string;
  pageTitle: string;
}

const HIT_BADGE: Record<MatchedItem["type"], string> = {
  title: "标题",
  heading: "小节",
  text: "正文",
  customField: "字段",
};

const SEARCH_DELAY = 180;
const PREVIEW_LOADING_DELAY = 120;
const FALLBACK_PAGE_POSITION = Number.MAX_SAFE_INTEGER;
const MIN_SCROLLBAR_THUMB_HEIGHT = 18;
const HIERARCHY_SEPARATOR_RE = /\s*[：:]\s*/gu;
const SEARCH_HINT_TEXT = "搜索提示：支持关键词搜索，多关键词用空格隔开。";

const route = useRoute();
const router = useRouter();
const routeLocale = useRouteLocale();
const searchOptions = useSearchOptions();

const inputRef = ref<HTMLInputElement | null>(null);
const previewFramePrimaryRef = ref<HTMLIFrameElement | null>(null);
const previewFrameSecondaryRef = ref<HTMLIFrameElement | null>(null);
const hitListRef = ref<HTMLOListElement | null>(null);
const hitButtonRefs = ref<HTMLElement[]>([]);
const draftQuery = ref("");
const previewFrameSrc = reactive<Record<PreviewFrameKey, string>>({
  primary: "",
  secondary: "",
});
const previewFrameLoaded = reactive<Record<PreviewFrameKey, boolean>>({
  primary: false,
  secondary: false,
});
const activePreviewFrame = ref<PreviewFrameKey>("primary");
const pendingPreviewFrame = ref<PreviewFrameKey | null>(null);
const previewLoadingVisible = ref(false);
const isSearching = ref(false);
const searchError = ref("");
const activeIndex = ref(-1);
const results = shallowRef<SearchResult[]>([]);
const isRouteSyncing = ref(false);
const hitListMetrics = ref({
  viewportHeight: 0,
  thumbHeight: 0,
  maxScrollTop: 0,
  activeTargetScrollTop: 0,
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
let previewLoadingTimer = 0;
const previewPrefetchedPathnames = new Set<string>();
const pageMetaMap = (() => {
  const normalizeContentValue = (value: string): string =>
    value.replace(/\s+/gu, " ").trim();
  const rootSearchData = JSON.parse(ROOT_SEARCH_INDEX) as SlimSearchRootIndex;
  const metaMap = new Map<string, PageSearchMeta>();

  const appendContent = (
    pageMeta: PageSearchMeta,
    value: string | undefined,
  ): number => {
    const normalizedValue = normalizeContentValue(value ?? "");

    if (!normalizedValue) return -1;

    const position = pageMeta.content.length;

    pageMeta.content = pageMeta.content ? `${pageMeta.content} ${normalizedValue}` : normalizedValue;

    return position;
  };
  const appendStoredFieldList = (pageMeta: PageSearchMeta, values: string[] | undefined): void => {
    for (const value of values ?? []) {
      appendContent(pageMeta, value);
    }
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
        const nextMeta: PageSearchMeta = {
          anchorOrder: new Map<string, number>(),
          anchorTitle: new Map<string, string>(),
          orderedAnchors: [] as Array<{ anchor: string; title: string; position: number }>,
          content: "",
          pageTitle: "",
        };

        metaMap.set(pagePath, nextMeta);

        return nextMeta;
      })();

    if (!anchor) {
      const pageTitle = normalizeContentValue(storedField.h ?? "");

      if (pageTitle && !pageMeta.pageTitle) {
        pageMeta.pageTitle = pageTitle;
      }

      appendStoredFieldList(pageMeta, storedField.t);
      appendStoredFieldList(pageMeta, storedField.c);

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

    appendStoredFieldList(pageMeta, storedField.t);
    appendStoredFieldList(pageMeta, storedField.c);
  }

  return metaMap;
})();

const pagePathToIdMap = new Map<string, number>(
  store.map((pagePath, pageId) => [pagePath, pageId]),
);

const normalizeString = (value: unknown): string => {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";

  return typeof value === "string" ? value : "";
};

const normalizeQuery = (value: unknown): string =>
  normalizeString(value).trim().replace(/\s+/g, " ");

const dedupeTerms = (terms: string[]): string[] => Array.from(new Set(terms.filter(Boolean)));

const collectQueryTerms = (query: string): string[] =>
  dedupeTerms(
    normalizeQuery(query)
      .split(/\s+/u)
      .map((term) => term.trim())
      .filter(Boolean),
  ).sort((left, right) => right.length - left.length);

const buildSearchQueries = (query: string): string[] => {
  const normalized = normalizeQuery(query);

  if (!normalized) return [];

  const queryTerms = collectQueryTerms(normalized);

  if (queryTerms.length <= 1) return [normalized];

  return dedupeTerms([normalized, ...queryTerms.slice(0, 8)]);
};

const getMatchedItemMergeKey = (item: MatchedItem): string => {
  const itemAnchor =
    "anchor" in item && typeof item.anchor === "string" && item.anchor
      ? item.anchor
      : "";
  const itemIndex =
    "index" in item && typeof item.index === "number"
      ? `${item.index}`
      : "";

  return `${item.type}:${item.id}:${itemAnchor}:${itemIndex}`;
};

const mergeSearchResultContents = (left: MatchedItem[], right: MatchedItem[]): MatchedItem[] => {
  const mergedContents: MatchedItem[] = [];
  const seen = new Set<string>();

  [...left, ...right].forEach((item) => {
    const mergeKey = getMatchedItemMergeKey(item);

    if (seen.has(mergeKey)) return;

    seen.add(mergeKey);
    mergedContents.push(item);
  });

  return mergedContents;
};

const getSearchResultPageKey = (result: SearchResult): string => {
  const firstContent = result.contents[0];

  if (firstContent) return `${firstContent.id}`;

  return `title:${result.title}`;
};

const normalizeHit = (value: unknown): number => {
  const parsed = Number.parseInt(normalizeString(value), 10);

  if (!Number.isFinite(parsed)) return 0;
  if (parsed <= 0) return 0;

  return parsed - 1;
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

const formatHierarchyText = (value: string): string =>
  value.replace(HIERARCHY_SEPARATOR_RE, " > ").replace(/\s{2,}/gu, " ").trim();

const formatHierarchyHtml = (value: string): string =>
  value.replace(HIERARCHY_SEPARATOR_RE, " &gt; ");

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
  value
    .replace(/\s+/gu, " ")
    .replace(/(?:\.{3,}|…)+/gu, " ")
    .replace(/^[\s\-–—,，。:：;；、.]+|[\s\-–—,，。:：;；、.]+$/gu, "")
    .trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasWordLikeChars = (value: string): boolean => /[\p{L}\p{N}_-]/u.test(value);

const isBoundaryChar = (value: string): boolean => !/[\p{L}\p{N}_-]/u.test(value);

const hasWholeWordMatch = (sourceText: string, term: string): boolean => {
  const source = normalizeComparableText(sourceText);
  const normalizedTerm = normalizeComparableText(term);

  if (!source || !normalizedTerm) return false;
  if (!hasWordLikeChars(normalizedTerm)) return source.includes(normalizedTerm);

  const escapedTerm = escapeRegExp(normalizedTerm);
  const matcher = new RegExp(escapedTerm, "gu");
  let matched = matcher.exec(source);

  while (matched) {
    const start = matched.index;
    const end = start + matched[0].length;
    const previousChar = start > 0 ? source[start - 1] : "";
    const nextChar = end < source.length ? source[end] : "";
    const leftBoundary = !previousChar || isBoundaryChar(previousChar);
    const rightBoundary = !nextChar || isBoundaryChar(nextChar);

    if (leftBoundary && rightBoundary) return true;
    matched = matcher.exec(source);
  }

  return false;
};

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

const normalizePreviewHash = (value: string): string => {
  const normalizedValue = value.trim();

  if (!normalizedValue) return "";

  return normalizedValue.startsWith("#") ? normalizedValue : `#${normalizedValue}`;
};

const parsePreviewHighlightTerms = (value: string | null): string[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .map((term) => (typeof term === "string" ? term.trim() : ""))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    }
  } catch {
    // fallback to whitespace parsing when payload is not JSON
  }

  return value
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
};

const resolvePreviewUrl = (value: string): URL | null => {
  if (typeof window === "undefined") return null;

  try {
    return new URL(value, window.location.origin);
  } catch {
    return null;
  }
};

const resolvePreviewPathname = (value: string): string => resolvePreviewUrl(value)?.pathname ?? "";

const buildPreviewSyncPayload = (previewHref: string): PreviewFrameSyncPayload | null => {
  const previewUrl = resolvePreviewUrl(previewHref);

  if (!previewUrl) return null;

  return {
    type: SEARCH_PREVIEW_SYNC_MESSAGE,
    hash: normalizePreviewHash(previewUrl.hash),
    highlightTerms: parsePreviewHighlightTerms(previewUrl.searchParams.get(SEARCH_HIGHLIGHT_QUERY_KEY)),
    targetHeading: normalizeLookupText(previewUrl.searchParams.get(SEARCH_TARGET_HEADING_QUERY_KEY) ?? ""),
    targetSnippet: normalizeLookupText(previewUrl.searchParams.get(SEARCH_TARGET_SNIPPET_QUERY_KEY) ?? ""),
  };
};

const getInactivePreviewFrameKey = (frameKey: PreviewFrameKey): PreviewFrameKey =>
  frameKey === "primary" ? "secondary" : "primary";

const getPreviewFrameElement = (frameKey: PreviewFrameKey): HTMLIFrameElement | null =>
  frameKey === "primary" ? previewFramePrimaryRef.value : previewFrameSecondaryRef.value;

const setPreviewFrameSrc = (frameKey: PreviewFrameKey, value: string): void => {
  previewFrameSrc[frameKey] = value;
  previewFrameLoaded[frameKey] = false;
};

const prefetchPreviewPath = (previewHref: string): void => {
  if (typeof document === "undefined") return;

  const previewUrl = resolvePreviewUrl(previewHref);
  const pathname = previewUrl?.pathname;

  if (!pathname || previewPrefetchedPathnames.has(pathname)) return;

  previewPrefetchedPathnames.add(pathname);

  const prefetchLink = document.createElement("link");
  prefetchLink.rel = "prefetch";
  prefetchLink.as = "document";
  prefetchLink.href = pathname;
  document.head.appendChild(prefetchLink);
};

const resetPreviewFrames = (): void => {
  previewFrameSrc.primary = "";
  previewFrameSrc.secondary = "";
  previewFrameLoaded.primary = false;
  previewFrameLoaded.secondary = false;
  activePreviewFrame.value = "primary";
  pendingPreviewFrame.value = null;
};

const postPreviewSyncMessage = (
  payload: PreviewFrameSyncPayload,
  frameKey: PreviewFrameKey = activePreviewFrame.value,
): boolean => {
  if (typeof window === "undefined") return false;

  const previewWindow = getPreviewFrameElement(frameKey)?.contentWindow;

  if (!previewWindow) return false;

  previewWindow.postMessage(payload, window.location.origin);

  return true;
};

const tryActivateLoadedPreviewFrame = (
  frameKey: PreviewFrameKey,
  nextPreviewHref: string,
): boolean => {
  const frameHref = previewFrameSrc[frameKey];

  if (!frameHref) return false;
  if (!previewFrameLoaded[frameKey]) return false;
  if (resolvePreviewPathname(frameHref) !== resolvePreviewPathname(nextPreviewHref)) return false;

  const payload = buildPreviewSyncPayload(nextPreviewHref);

  if (!payload || !postPreviewSyncMessage(payload, frameKey)) return false;

  activePreviewFrame.value = frameKey;
  if (pendingPreviewFrame.value === frameKey) {
    pendingPreviewFrame.value = null;
  }

  return true;
};

const syncPreviewFrame = (nextPreviewHref: string): void => {
  if (!nextPreviewHref) {
    resetPreviewFrames();
    return;
  }

  const currentFrameKey = activePreviewFrame.value;
  const currentPreviewHref = previewFrameSrc[currentFrameKey];

  if (!currentPreviewHref) {
    setPreviewFrameSrc(currentFrameKey, nextPreviewHref);
    pendingPreviewFrame.value = null;
    return;
  }

  if (resolvePreviewPathname(currentPreviewHref) === resolvePreviewPathname(nextPreviewHref)) {
    if (!previewFrameLoaded[currentFrameKey]) {
      setPreviewFrameSrc(currentFrameKey, nextPreviewHref);
      pendingPreviewFrame.value = null;
      return;
    }

    const payload = buildPreviewSyncPayload(nextPreviewHref);

    if (payload && postPreviewSyncMessage(payload, currentFrameKey)) {
      return;
    }

    setPreviewFrameSrc(currentFrameKey, nextPreviewHref);
    pendingPreviewFrame.value = null;
    return;
  }

  const nextFrameKey = getInactivePreviewFrameKey(currentFrameKey);

  if (tryActivateLoadedPreviewFrame(nextFrameKey, nextPreviewHref)) {
    return;
  }

  if (previewFrameSrc[nextFrameKey] === nextPreviewHref && pendingPreviewFrame.value === nextFrameKey) {
    return;
  }

  setPreviewFrameSrc(nextFrameKey, nextPreviewHref);
  pendingPreviewFrame.value = nextFrameKey;
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
  const bodyLookup = normalizeComparableText(bodyText);
  const normalizedTerms = collectQueryTerms(query)
    .map((term) => normalizeComparableText(term))
    .filter(Boolean);
  const isMultiTerms = normalizedTerms.length > 1;

  const titleHasWholeQueryWord = hasWholeWordMatch(titleText, normalizedQuery);
  const bodyHasWholeQueryWord = hasWholeWordMatch(bodyLookup, normalizedQuery);
  const titleHasWholeQuery = titleText.includes(normalizedQuery);
  const bodyHasWholeQuery = bodyLookup.includes(normalizedQuery);

  if (titleHasWholeQueryWord) return 10;
  if (bodyHasWholeQueryWord) return 9;
  if (titleHasWholeQuery) return 8;
  if (bodyHasWholeQuery) return 7;

  if (isMultiTerms) {
    const titleWholeMatchedCount = normalizedTerms.filter((term) => hasWholeWordMatch(titleText, term)).length;
    const bodyWholeMatchedCount = normalizedTerms.filter((term) => hasWholeWordMatch(bodyLookup, term)).length;
    const titleMatchedCount = normalizedTerms.filter((term) => titleText.includes(term)).length;
    const bodyMatchedCount = normalizedTerms.filter((term) => bodyLookup.includes(term)).length;
    const allTermsCount = normalizedTerms.length;

    if (titleWholeMatchedCount === allTermsCount) return 6;
    if (bodyWholeMatchedCount === allTermsCount) return 5;
    if (titleMatchedCount === allTermsCount) return 4;
    if (bodyMatchedCount === allTermsCount) return 3;

    if (Math.max(titleWholeMatchedCount, bodyWholeMatchedCount) >= 2) return 2;
    if (Math.max(titleMatchedCount, bodyMatchedCount) >= 2) return 1;
  }

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
    const normalizedDisplay = normalizeLookupText(toPlainText(item.display, " ")).slice(0, 160);
    const customFieldIndex =
      item.type === "customField" && typeof item.index === "number" ? item.index : index;
    const key =
      item.type === "heading"
        ? anchor
          ? `heading:${anchor}`
          : `heading:${index}`
        : item.type === "title"
          ? `title:${index}`
          : item.type === "customField"
            ? anchor
              ? `custom:${anchor}:${customFieldIndex}`
              : `custom:${customFieldIndex}`
            : anchor
              ? `text:${anchor}:${normalizedDisplay || index}`
              : `text:${normalizedDisplay || index}`;
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

  const groups = [...groupMap.values()].sort((left, right) => left.order - right.order);
  const anchorsWithBody = new Set(
    groups
      .filter(
        (group) =>
          Boolean(group.anchor) &&
          group.items.some((item) => item.type === "text" || item.type === "customField"),
      )
      .map((group) => group.anchor as string),
  );

  return groups.filter((group) => {
    if (!group.anchor) return true;
    if (!anchorsWithBody.has(group.anchor)) return true;

    return group.items.some((item) => item.type !== "heading");
  });
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

const buildFallbackSnippetDisplayFromWindow = (
  sourceText: string,
  start: number,
  end: number,
): Word[][] => {
  const normalizedSource = sourceText.replace(/\s+/gu, " ").trim();

  if (!normalizedSource) return [];

  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(normalizedSource.length, end);
  const snippetCore = normalizedSource.slice(clampedStart, clampedEnd).trim();

  if (!snippetCore) return [];

  const prefix = clampedStart > 0 ? "... " : "";
  const suffix = clampedEnd < normalizedSource.length ? " ..." : "";

  return [[`${prefix}${snippetCore}${suffix}`]];
};

const resolveFallbackSnippetWindow = (
  sourceLength: number,
  matchIndex: number,
  matchLength: number,
): { start: number; end: number } => ({
  start: Math.max(0, matchIndex - 44),
  end: Math.min(sourceLength, matchIndex + Math.max(matchLength, 1) + 88),
});

const mergeFallbackSnippetWindows = (
  sourceLength: number,
  matches: Array<{ index: number; length: number; isWholeQuery: boolean }>,
  maxWindows = 3,
): Array<{ start: number; end: number; primaryIndex: number; isWholeQuery: boolean }> => {
  if (!matches.length || sourceLength <= 0 || maxWindows <= 0) return [];

  const windows = matches
    .map(({ index, length, isWholeQuery }) => {
      const { start, end } = resolveFallbackSnippetWindow(sourceLength, index, length);

      return {
        start,
        end,
        primaryIndex: index,
        isWholeQuery,
      };
    })
    .sort((left, right) => left.start - right.start || left.primaryIndex - right.primaryIndex);
  const merged: Array<{ start: number; end: number; primaryIndex: number; isWholeQuery: boolean }> = [];
  const mergeGap = 18;

  windows.forEach((windowItem) => {
    const previous = merged.at(-1);

    if (!previous || windowItem.start > previous.end + mergeGap) {
      merged.push({ ...windowItem });
      return;
    }

    previous.end = Math.max(previous.end, windowItem.end);
    previous.primaryIndex = Math.min(previous.primaryIndex, windowItem.primaryIndex);
    previous.isWholeQuery = previous.isWholeQuery || windowItem.isWholeQuery;
  });

  return merged
    .sort((left, right) => {
      if (left.isWholeQuery !== right.isWholeQuery) {
        return Number(right.isWholeQuery) - Number(left.isWholeQuery);
      }

      return left.start - right.start;
    })
    .slice(0, maxWindows);
};

const collectMatchPositions = (source: string, term: string, maxMatches = 2): number[] => {
  if (!source || !term || maxMatches <= 0) return [];

  const positions: number[] = [];
  let fromIndex = 0;

  while (fromIndex < source.length && positions.length < maxMatches) {
    const index = source.indexOf(term, fromIndex);

    if (index < 0) break;

    positions.push(index);
    fromIndex = index + Math.max(term.length, 1);
  }

  return positions;
};

const resolveFallbackAnchorInfo = (
  pageMeta: PageSearchMeta,
  matchIndex: number,
): { anchor: string; title: string } | null => {
  const candidate = [...pageMeta.orderedAnchors]
    .filter(({ anchor, position }) => Boolean(anchor) && Number.isFinite(position) && position <= matchIndex)
    .sort((left, right) => right.position - left.position)[0];

  if (!candidate || !candidate.anchor) return null;

  return {
    anchor: candidate.anchor,
    title: candidate.title,
  };
};

const buildFallbackSearchResults = (
  query: string,
  existingPageIds: Set<number> = new Set<number>(),
): SearchResult[] => {
  const normalizedQuery = normalizeComparableText(query);
  const normalizedTerms = collectQueryTerms(query)
    .map((term) => normalizeComparableText(term))
    .filter(Boolean);

  if (!normalizedQuery || !normalizedTerms.length) return [];

  const fallbackCandidates: Array<{
    result: SearchResult;
    wholeQueryMatched: boolean;
    matchedTermCount: number;
    firstMatchIndex: number;
  }> = [];

  pageMetaMap.forEach((pageMeta, pagePath) => {
    const pageId = pagePathToIdMap.get(pagePath);

    if (typeof pageId !== "number" || existingPageIds.has(pageId)) return;

    const normalizedContent = normalizeComparableText(pageMeta.content);

    if (!normalizedContent) return;

    const wholeQueryMatched = normalizedContent.includes(normalizedQuery);
    const matchedTermCount = normalizedTerms.reduce(
      (count, term) => (normalizedContent.includes(term) ? count + 1 : count),
      0,
    );

    if (!wholeQueryMatched && matchedTermCount === 0) return;

    const contents: MatchedItem[] = [];
    const addedHeadingAnchors = new Set<string>();
    const rawMatches: Array<{ index: number; length: number; isWholeQuery: boolean }> = [];

    if (wholeQueryMatched) {
      collectMatchPositions(normalizedContent, normalizedQuery, 2).forEach((index) => {
        rawMatches.push({
          index,
          length: normalizedQuery.length,
          isWholeQuery: true,
        });
      });
    }

    normalizedTerms.forEach((term) => {
      collectMatchPositions(normalizedContent, term, 2).forEach((index) => {
        rawMatches.push({
          index,
          length: term.length,
          isWholeQuery: false,
        });
      });
    });

    const matchMap = new Map<number, { length: number; isWholeQuery: boolean }>();

    rawMatches.forEach(({ index, length, isWholeQuery }) => {
      const existingMatch = matchMap.get(index);

      if (!existingMatch) {
        matchMap.set(index, { length, isWholeQuery });
        return;
      }

      matchMap.set(index, {
        length: Math.max(existingMatch.length, length),
        isWholeQuery: existingMatch.isWholeQuery || isWholeQuery,
      });
    });

    const resolvedMatches = [...matchMap.entries()]
      .map(([index, value]) => ({
        index,
        length: value.length,
        isWholeQuery: value.isWholeQuery,
      }))
      .sort((left, right) => {
        if (left.isWholeQuery !== right.isWholeQuery) {
          return Number(right.isWholeQuery) - Number(left.isWholeQuery);
        }

        return left.index - right.index;
      })
      .slice(0, 4);

    if (!resolvedMatches.length) return;

    const mergedWindows = mergeFallbackSnippetWindows(normalizedContent.length, resolvedMatches, 3);

    mergedWindows.forEach(({ start, end, primaryIndex }) => {
      const snippetDisplay = buildFallbackSnippetDisplayFromWindow(pageMeta.content, start, end);

      if (!snippetDisplay.length) return;

      const anchorInfo = resolveFallbackAnchorInfo(pageMeta, primaryIndex);

      if (anchorInfo?.title && !addedHeadingAnchors.has(anchorInfo.anchor)) {
        contents.push({
          type: "heading",
          id: pageId,
          anchor: anchorInfo.anchor,
          display: [[anchorInfo.title]],
        });
        addedHeadingAnchors.add(anchorInfo.anchor);
      }

      contents.push({
        type: "text",
        id: pageId,
        ...(anchorInfo ? { anchor: anchorInfo.anchor } : {}),
        display: snippetDisplay,
      });
    });

    if (!contents.length) return;
    const firstMatchIndex = mergedWindows[0]?.primaryIndex ?? Number.MAX_SAFE_INTEGER;

    fallbackCandidates.push({
      result: {
        title: pageMeta.pageTitle || pagePath,
        contents,
      },
      wholeQueryMatched,
      matchedTermCount,
      firstMatchIndex,
    });
  });

  return fallbackCandidates
    .sort((left, right) => {
      if (left.wholeQueryMatched !== right.wholeQueryMatched) {
        return Number(right.wholeQueryMatched) - Number(left.wholeQueryMatched);
      }

      if (left.matchedTermCount !== right.matchedTermCount) {
        return right.matchedTermCount - left.matchedTermCount;
      }

      if (left.firstMatchIndex !== right.firstMatchIndex) {
        return left.firstMatchIndex - right.firstMatchIndex;
      }

      return left.result.title.localeCompare(right.result.title, "zh-CN");
    })
    .slice(0, 220)
    .map((candidate) => candidate.result);
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

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gu, " ")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&")
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, "\"");

const toSnippetLookupText = (snippetHtml: string): string =>
  normalizeLookupText(decodeHtmlEntities(snippetHtml.replace(/<[^>]*>/gu, " ")));

const resolveHitPagePath = (href: string): string => href.split("#")[0]?.split("?")[0] ?? href;
const toTitleLookupText = (value: string): string => normalizeLookupText(value);

const isBodyLikeHit = (hit: SearchHit): boolean =>
  hit.type === "text" || hit.type === "customField";

const commonPrefixLength = (left: string, right: string): number => {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
};

const commonSuffixLength = (left: string, right: string): number => {
  const maxLength = Math.min(left.length, right.length);
  let offset = 0;

  while (offset < maxLength && left[left.length - 1 - offset] === right[right.length - 1 - offset]) {
    offset += 1;
  }

  return offset;
};

const isLikelySameHitTitle = (leftTitle: string, rightTitle: string): boolean => {
  if (!leftTitle || !rightTitle) return false;
  if (leftTitle === rightTitle) return true;

  const [longer, shorter] =
    leftTitle.length >= rightTitle.length
      ? [leftTitle, rightTitle]
      : [rightTitle, leftTitle];

  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const prefixLength = commonPrefixLength(leftTitle, rightTitle);
  const suffixLength = commonSuffixLength(leftTitle, rightTitle);

  if (prefixLength >= 12) return true;

  return prefixLength >= 8 && suffixLength >= 8;
};

const isLikelySameParagraphSnippet = (leftSnippet: string, rightSnippet: string): boolean => {
  if (!leftSnippet || !rightSnippet) return false;

  const [longer, shorter] =
    leftSnippet.length >= rightSnippet.length
      ? [leftSnippet, rightSnippet]
      : [rightSnippet, leftSnippet];

  if (shorter.length >= 16 && longer.includes(shorter)) return true;
  if (shorter.length < 24) return false;

  const prefix = shorter.slice(0, 16);
  const suffix = shorter.slice(-16);

  return longer.includes(prefix) && longer.includes(suffix);
};

const mergeHitsByParagraph = (sortedHits: SearchHit[]): SearchHit[] => {
  const mergedHits: Array<
    SearchHit & { snippetLookup: string; pagePath: string; sectionKey: string; pageTitleKey: string }
  > = [];

  sortedHits.forEach((hit) => {
    const snippetLookup = toSnippetLookupText(hit.snippetHtml);
    const pagePath = resolveHitPagePath(hit.href);
    const sectionKey = toTitleLookupText(hit.sectionLabel || "");
    const pageTitleKey = toTitleLookupText(hit.pageTitle);
    const existingIndex = mergedHits.findIndex(
      (existingHit) => {
        if (!isBodyLikeHit(existingHit) || !isBodyLikeHit(hit)) return false;
        const snippetMatched = isLikelySameParagraphSnippet(existingHit.snippetLookup, snippetLookup);

        if (existingHit.pagePath === pagePath) {
          if (
            sectionKey &&
            existingHit.sectionKey &&
            isLikelySameHitTitle(existingHit.sectionKey, sectionKey)
          ) {
            return true;
          }

          if (snippetMatched) return true;
        }

        if (!snippetMatched) return false;

        if (
          sectionKey &&
          existingHit.sectionKey &&
          isLikelySameHitTitle(existingHit.sectionKey, sectionKey)
        ) {
          return true;
        }

        return isLikelySameHitTitle(existingHit.pageTitleKey, pageTitleKey);
      },
    );

    if (existingIndex < 0) {
      mergedHits.push({
        ...hit,
        snippetLookup,
        pagePath,
        sectionKey,
        pageTitleKey,
      });
      return;
    }

    const existingHit = mergedHits[existingIndex];
    const badges = Array.from(new Set([...existingHit.badges, ...hit.badges]));
    const preferredHit = compareSearchHits(hit, existingHit) < 0 ? hit : existingHit;
    const richerSnippetHit = snippetLookup.length > existingHit.snippetLookup.length ? hit : existingHit;

    mergedHits[existingIndex] = {
      ...preferredHit,
      badges,
      snippetHtml: richerSnippetHit.snippetHtml,
      href: richerSnippetHit.href,
      previewHref: richerSnippetHit.previewHref,
      sectionLabel: richerSnippetHit.sectionLabel || preferredHit.sectionLabel,
      snippetLookup: snippetLookup.length > existingHit.snippetLookup.length
        ? snippetLookup
        : existingHit.snippetLookup,
      pagePath: resolveHitPagePath(preferredHit.href),
      sectionKey: sectionKey || existingHit.sectionKey,
      pageTitleKey: pageTitleKey || existingHit.pageTitleKey,
    };
  });

  return mergedHits.map(
    ({ snippetLookup: _snippetLookup, pagePath: _pagePath, sectionKey: _sectionKey, pageTitleKey: _pageTitleKey, ...hit }) => hit,
  );
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
    const rawPageTitle = result.title || "未命名页面";
    const highlightedTitleDisplay = titleItem ? applyQueryHighlight(titleItem.display, fallbackQuery) : null;
    const titleHighlightTerms = highlightedTitleDisplay
      ? collectHighlightTerms(highlightedTitleDisplay, fallbackQuery)
      : [];
    const pageTitle = formatHierarchyText(rawPageTitle);
    const pageTitleHtml =
      highlightedTitleDisplay
        ? formatHierarchyHtml(renderDisplay(highlightedTitleDisplay))
        : escapeHtml(pageTitle);

    return sourceGroups.map((group, contentIndex) => {
      const representativeItem = group.items[0];
      const rawHref = representativeItem
        ? group.anchor
          ? `${store[representativeItem.id]}#${group.anchor}`
          : buildHref(representativeItem)
        : "/";
      const [rawPath] = rawHref.split("#");
      const matchedBodyDisplay = resolveMatchedBodyDisplay(group);
      const rawSectionLabel = resolveSectionLabel(result, group, rawPath, matchedBodyDisplay);
      const snippetDisplay = resolveSnippetDisplay(
        result,
        group,
        rawPath,
        rawSectionLabel,
        matchedBodyDisplay,
      );
      const highlightedSnippetDisplay = applyQueryHighlight(snippetDisplay, fallbackQuery);
      const snippetPlainText = toPlainText(highlightedSnippetDisplay, " ");
      const itemHighlightTerms = collectHighlightTerms(highlightedSnippetDisplay, fallbackQuery);
      const highlightTerms = mergeHighlightTerms(titleHighlightTerms, itemHighlightTerms);
      const targetSnippet = buildTargetSnippet(snippetDisplay);
      const badges = buildGroupBadges(group);
      const sectionLabel = formatHierarchyText(rawSectionLabel);
      const wholeQueryRank = resolveWholeQueryRank(
        fallbackQuery,
        rawPageTitle,
        rawSectionLabel,
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
        previewHref: buildPreviewHref(rawHref, highlightTerms, rawSectionLabel, targetSnippet),
        wholeQueryRank,
        pageRank: resultIndex,
        contentRank: contentIndex,
        pagePosition: resolvePagePosition(rawPath, getGroupAnchor(group), hasHeading, hasTitleOnly),
      };
    });
  });

const flatHits = computed<SearchHit[]>(() =>
  mergeHitsByParagraph(flattenResults(results.value, routeQuery.value).sort(compareSearchHits)),
);
const routeQuery = computed(() => normalizeQuery(route.query.q));
const routeHit = computed(() => normalizeHit(route.query.hit));
const selectedHit = computed<SearchHit | null>(() => flatHits.value[activeIndex.value] ?? null);
const isPreviewLoading = computed(() => {
  if (!selectedHit.value) return false;

  const pendingFrameKey = pendingPreviewFrame.value;

  if (pendingFrameKey) return !previewFrameLoaded[pendingFrameKey];

  return !previewFrameLoaded[activePreviewFrame.value];
});
const isPreviewLoadingVisible = computed(() => isPreviewLoading.value && previewLoadingVisible.value);
const selectedHitOrder = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < flatHits.value.length ? activeIndex.value + 1 : 0,
);
const resultCountText = computed(() =>
  flatHits.value.length ? `${selectedHitOrder.value}/${flatHits.value.length}` : "",
);
const activeScrollMarkerRatio = computed(() => {
  if (!flatHits.value.length || activeIndex.value < 0) return 0;
  if (!hitListMetrics.value.maxScrollTop) return 0;

  return hitListMetrics.value.activeTargetScrollTop / hitListMetrics.value.maxScrollTop;
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

const handlePreviewFrameLoad = (frameKey: PreviewFrameKey): void => {
  previewFrameLoaded[frameKey] = true;

  const hit = selectedHit.value;

  if (!hit) return;

  const currentPreviewHref = previewFrameSrc[frameKey];

  if (!currentPreviewHref) return;
  if (resolvePreviewPathname(currentPreviewHref) !== resolvePreviewPathname(hit.previewHref)) return;

  const payload = buildPreviewSyncPayload(hit.previewHref);

  if (!payload) return;

  window.requestAnimationFrame(() => {
    postPreviewSyncMessage(payload, frameKey);
    activePreviewFrame.value = frameKey;
    if (pendingPreviewFrame.value === frameKey) {
      pendingPreviewFrame.value = null;
    }
  });
};

const buildRouteQuery = (query: string, hit?: number, focus = false): Record<string, string> => {
  const nextQuery: Record<string, string> = {};

  if (query) nextQuery.q = query;
  if (query && typeof hit === "number" && hit >= 0) nextQuery.hit = `${hit + 1}`;
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
    const normalizedQuery = normalizeQuery(query);

    if (!normalizedQuery) {
      results.value = [];
      activeIndex.value = -1;
      isSearching.value = false;
      await syncRouteState("");
      return;
    }

    const queryVariants = buildSearchQueries(normalizedQuery).filter(Boolean);
    const mergedByPage = new Map<string, SearchResult>();

    const variantResultsGroups = await Promise.all(
      queryVariants.map((queryVariant) =>
        searchWorker.search(queryVariant, routeLocale.value, searchOptions.value),
      ),
    );

    if (searchId !== searchRequestId) return;

    variantResultsGroups.flat().forEach((result) => {
      const pageKey = getSearchResultPageKey(result);
      const existing = mergedByPage.get(pageKey);

      if (!existing) {
        mergedByPage.set(pageKey, result);
        return;
      }

      mergedByPage.set(pageKey, {
        ...existing,
        contents: mergeSearchResultContents(existing.contents, result.contents),
      });
    });

    const fallbackResults = buildFallbackSearchResults(normalizedQuery);

    fallbackResults.forEach((result) => {
      const pageKey = getSearchResultPageKey(result);
      const existing = mergedByPage.get(pageKey);

      if (!existing) {
        mergedByPage.set(pageKey, result);
        return;
      }

      mergedByPage.set(pageKey, {
        ...existing,
        contents: mergeSearchResultContents(existing.contents, result.contents),
      });
    });

    const combinedResults = [...mergedByPage.values()];

    if (searchId !== searchRequestId) return;

    results.value = combinedResults;
    isSearching.value = false;

    const nextHits = flattenResults(combinedResults, normalizedQuery);

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
  if (index < 0 || index >= flatHits.value.length) return;
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

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const resolveActiveTargetScrollTop = (
  hitList: HTMLOListElement | null,
  activeButton: HTMLElement | null,
): number => {
  if (!hitList || !activeButton) return 0;

  const maxScrollTop = Math.max(hitList.scrollHeight - hitList.clientHeight, 0);

  if (!maxScrollTop) return 0;

  const hitListRect = hitList.getBoundingClientRect();
  const activeButtonRect = activeButton.getBoundingClientRect();
  const activeButtonTop = activeButtonRect.top - hitListRect.top + hitList.scrollTop;
  const activeButtonCenter = activeButtonTop + activeButtonRect.height / 2;

  return clampNumber(activeButtonCenter - hitList.clientHeight / 2, 0, maxScrollTop);
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

  const targetScrollTop =
    hitListMetrics.value.activeTargetScrollTop ||
    resolveActiveTargetScrollTop(hitList, activeButton);

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
      maxScrollTop: 0,
      activeTargetScrollTop: 0,
    };

    return;
  }

  const viewportHeight = hitList.clientHeight;
  const scrollHeight = hitList.scrollHeight;
  const maxScrollTop = Math.max(scrollHeight - viewportHeight, 0);
  const rawThumbHeight =
    viewportHeight > 0 && scrollHeight > 0 ? (viewportHeight * viewportHeight) / scrollHeight : 0;
  const thumbHeight = Math.min(
    viewportHeight,
    Math.max(rawThumbHeight, Math.min(viewportHeight, MIN_SCROLLBAR_THUMB_HEIGHT)),
  );
  const activeTargetScrollTop = resolveActiveTargetScrollTop(
    hitList,
    hitButtonRefs.value[activeIndex.value] ?? null,
  );

  hitListMetrics.value = {
    viewportHeight,
    thumbHeight,
    maxScrollTop,
    activeTargetScrollTop,
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
  selectedHit,
  (hit) => {
    syncPreviewFrame(hit?.previewHref ?? "");
  },
  { immediate: true },
);

watch(
  isPreviewLoading,
  (loading) => {
    if (typeof window === "undefined") {
      previewLoadingVisible.value = loading;
      return;
    }

    if (previewLoadingTimer) {
      window.clearTimeout(previewLoadingTimer);
      previewLoadingTimer = 0;
    }

    if (!loading) {
      previewLoadingVisible.value = false;
      return;
    }

    previewLoadingTimer = window.setTimeout(() => {
      previewLoadingVisible.value = true;
      previewLoadingTimer = 0;
    }, PREVIEW_LOADING_DELAY);
  },
  { immediate: true },
);

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
    const hitCandidates = flatHits.value.slice(0, 8);

    if (activeIndex.value >= 0) {
      const activeHit = flatHits.value[activeIndex.value];
      const previousHit = flatHits.value[activeIndex.value - 1];
      const nextHit = flatHits.value[activeIndex.value + 1];

      if (activeHit) hitCandidates.unshift(activeHit);
      if (previousHit) hitCandidates.unshift(previousHit);
      if (nextHit) hitCandidates.unshift(nextHit);
    }

    hitCandidates.forEach((hit) => {
      prefetchPreviewPath(hit.previewHref);
    });

    nextTick(() => {
      scheduleMeasureHitListMetrics();
    });
  },
);

watch(activeIndex, () => {
  nextTick(() => {
    scheduleMeasureHitListMetrics();
  });
});

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
  if (previewLoadingTimer && typeof window !== "undefined") {
    window.clearTimeout(previewLoadingTimer);
    previewLoadingTimer = 0;
  }
  searchWorker?.terminate();
});
</script>

<template>
  <ClientOnly>
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
              placeholder="输入关键词（多个关键词用空格隔开）"
            >
          </label>
          <p class="bc-search-panel-tip">{{ SEARCH_HINT_TEXT }}</p>
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

          <div v-else-if="!routeQuery" class="bc-search-empty">{{ SEARCH_HINT_TEXT }}</div>

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
            <h2 class="bc-search-preview-title">{{ selectedHit.sectionLabel || selectedHit.pageTitle }}</h2>
            <p class="bc-search-preview-crumb">{{ selectedHit.pageTitle }}</p>
          </div>
          <a
            class="bc-search-toolbar-button bc-search-preview-open bc-search-preview-open-crumb"
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

        <div v-else-if="selectedHit" class="bc-search-preview-frame-stack">
          <div v-if="isPreviewLoadingVisible" class="bc-search-preview-loading" aria-hidden="true">
            <p class="bc-search-preview-loading-label">原文预览加载中</p>
            <span class="bc-search-preview-loading-line"></span>
            <span class="bc-search-preview-loading-line short"></span>
            <span class="bc-search-preview-loading-line tiny"></span>
          </div>
          <iframe
            ref="previewFramePrimaryRef"
            class="bc-search-preview-frame"
            :class="{ active: activePreviewFrame === 'primary' }"
            :src="previewFrameSrc.primary || 'about:blank'"
            title="搜索结果原文预览"
            loading="eager"
            @load="handlePreviewFrameLoad('primary')"
          />
          <iframe
            ref="previewFrameSecondaryRef"
            class="bc-search-preview-frame"
            :class="{ active: activePreviewFrame === 'secondary' }"
            :src="previewFrameSrc.secondary || 'about:blank'"
            title="搜索结果原文预览"
            loading="eager"
            @load="handlePreviewFrameLoad('secondary')"
          />
        </div>
      </section>
    </section>
  </ClientOnly>
</template>

<style scoped>
/* ── Page layout: flow naturally like content pages, not a fixed-height app ── */
.bc-search-page {
  display: flex;
  gap: 0;
  min-height: calc(100vh - var(--vp-nav-height, 64px));
}

/* ── Results panel: styled like the theme sidebar ── */
.bc-search-sidebar {
  display: flex;
  flex-direction: column;
  width: 500px;
  min-width: 400px;
  max-width: 620px;
  flex-shrink: 0;
  border-right: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  background: var(--vp-sidebar-bg-color, var(--vp-c-bg, #fff));
}

.bc-search-sidebar-search {
  padding: 24px 20px 16px;
}

.bc-search-sidebar-results {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

/* ── Search input: minimal, integrated feel ── */
.bc-search-input-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  border-radius: 6px;
  background: var(--vp-c-bg, #fff);
  transition: border-color 0.2s ease;
  cursor: text;
}

.bc-search-input-shell:focus-within {
  border-color: var(--vp-c-brand, #3b82f6);
}

.bc-search-input-icon {
  display: flex;
  align-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--vp-c-text-3, #9ca3af);
}

.bc-search-input-shell input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 0.9rem;
  color: var(--vp-c-text-1, #1f2937);
  outline: none;
  min-width: 0;
}

.bc-search-input-shell input::placeholder {
  color: var(--vp-c-text-3, #9ca3af);
}

.bc-search-panel-tip {
  margin: 8px 0 0;
  font-size: 0.72rem;
  color: var(--vp-c-text-3, #9ca3af);
  line-height: 1.5;
}

/* ── Results header ── */
.bc-search-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 8px;
  flex-shrink: 0;
}

.bc-search-panel-head h2 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-1, #1f2937);
}

.bc-search-result-count {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--vp-c-text-2, #6b7280);
}

/* ── Empty / loading states ── */
.bc-search-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--vp-c-text-3, #9ca3af);
  font-size: 0.85rem;
  line-height: 1.6;
}

.bc-search-empty.error {
  color: #ef4444;
}

/* ── Hit list ── */
.bc-search-hit-list-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.bc-search-hit-list {
  list-style: none;
  margin: 0;
  padding: 4px 12px 20px;
  overflow-y: auto;
  height: 100%;
  scroll-behavior: smooth;
}

.bc-search-hit-list::-webkit-scrollbar {
  width: 4px;
}

.bc-search-hit-list::-webkit-scrollbar-track {
  background: transparent;
}

.bc-search-hit-list::-webkit-scrollbar-thumb {
  background: var(--vp-c-divider, #e5e7eb);
  border-radius: 2px;
}

/* ── Hit card: subtle, like sidebar links ── */
.bc-search-hit-card {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.bc-search-hit-card:hover {
  background: var(--vp-c-bg-soft, #f3f4f6);
}

.bc-search-hit-card.active {
  background: var(--vp-c-bg-soft, #f3f4f6);
  color: var(--vp-c-brand, #3b82f6);
}

/* ── Hit meta ── */
.bc-search-hit-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

.bc-search-hit-badges {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.bc-search-hit-badge {
  display: inline-block;
  padding: 0 5px;
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-radius: 3px;
  background: var(--vp-c-bg-soft, #f3f4f6);
  color: var(--vp-c-text-2, #6b7280);
  line-height: 1.6;
}

.bc-search-hit-page {
  font-size: 0.7rem;
  color: var(--vp-c-text-3, #9ca3af);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ── Hit section ── */
.bc-search-hit-section {
  margin: 0 0 2px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-text-1, #1f2937);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Hit snippet ── */
.bc-search-hit-snippet {
  margin: 0;
  font-size: 0.78rem;
  color: var(--vp-c-text-2, #6b7280);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bc-search-hit-snippet :deep(mark) {
  background: rgba(251, 191, 36, 0.3);
  color: inherit;
  border-radius: 1px;
  padding: 0 1px;
}

.bc-search-snippet-sep {
  color: var(--vp-c-text-3, #9ca3af);
  font-size: 0.7rem;
  opacity: 0.6;
}

/* ── Scroll marker ── */
.bc-search-hit-scrollmark {
  position: absolute;
  right: 3px;
  top: var(--bc-search-scrollmark-top, 12px);
  width: 24px;
  z-index: 2;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: top 0.15s ease-out;
}

.bc-search-hit-scrollmark-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 0.7rem;
  border-radius: 4px;
  background: transparent;
  border: none;
  opacity: 0.7;
  transition: opacity 0.15s ease;
}

.bc-search-hit-scrollmark:hover .bc-search-hit-scrollmark-dot {
  opacity: 1;
}

/* ── Preview panel ── */
.bc-search-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--vp-c-bg, #fff);
  min-width: 0;
}

.bc-search-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px 8px;
  flex-shrink: 0;
}

.bc-search-preview-copy {
  min-width: 0;
  flex: 1;
}

.bc-search-preview-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1, #1f2937);
  line-height: 1.3;
}

.bc-search-preview-crumb {
  margin: 2px 0 0;
  font-size: 0.72rem;
  color: var(--vp-c-text-3, #9ca3af);
}

.bc-search-preview-open {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-1, #1f2937);
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.bc-search-preview-open:hover {
  background: var(--vp-c-bg-soft, #f3f4f6);
}

/* ── Preview empty ── */
.bc-search-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
  color: var(--vp-c-text-3, #9ca3af);
  font-size: 0.9rem;
}

/* ── Preview frame stack ── */
.bc-search-preview-frame-stack {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.bc-search-preview-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.bc-search-preview-frame.active {
  opacity: 1;
  pointer-events: auto;
}

/* ── Preview loading skeleton ── */
.bc-search-preview-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  padding: 40px 36px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--vp-c-bg, #fff);
}

.bc-search-preview-loading-label {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: var(--vp-c-text-3, #9ca3af);
}

.bc-search-preview-loading-line {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft, #f3f4f6);
  opacity: 0.6;
  animation: bc-search-pulse 1.5s ease-in-out infinite;
}

.bc-search-preview-loading-line.short {
  width: 70%;
}

.bc-search-preview-loading-line.tiny {
  width: 45%;
}

@keyframes bc-search-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

/* ── Scroll marker tooltip ── */
.bc-search-hit-scrollmark-tooltip {
  position: fixed;
  z-index: 10;
  padding: 5px 10px;
  font-size: 0.72rem;
  border-radius: 4px;
  background: var(--vp-c-text-1, #1f2937);
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .bc-search-page {
    flex-direction: column;
  }

  .bc-search-sidebar {
    width: 100%;
    min-width: 0;
    max-width: none;
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider, #e5e7eb);
    max-height: 45vh;
  }

  .bc-search-preview {
    min-height: 45vh;
  }

  .bc-search-preview-head {
    padding: 10px 16px 8px;
  }
}
</style>
