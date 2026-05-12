import { defineAsyncComponent } from "vue";
import { defineClientConfig } from "vuepress/client";
import SearchPageButton from "./components/SearchPageButton.vue";
import {
  SEARCH_HIGHLIGHT_QUERY_KEY,
  SEARCH_LAUNCH_EVENT,
  SEARCH_PATH,
  SEARCH_PREVIEW_QUERY_KEY,
  SEARCH_PREVIEW_SYNC_MESSAGE,
  SEARCH_TARGET_HEADING_QUERY_KEY,
  SEARCH_TARGET_SNIPPET_QUERY_KEY,
} from "./search-constants";

const SEARCH_PREVIEW_HIGHLIGHT_CLASS = "bc-search-preview-highlight";
const SEARCH_PREVIEW_HIGHLIGHT_ATTR = "data-bc-search-highlight";
const SEARCH_PREVIEW_TARGET_CLASS = "bc-search-preview-target";
const SEARCH_PREVIEW_ROOT = "#markdown-content";
const SEARCH_PREVIEW_SKIP_SELECTOR =
  "mark, pre, code, kbd, samp, script, style, noscript, textarea, svg";
const SEARCH_PREVIEW_BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt, td, th";

interface PreviewRuntimeState {
  highlightTerms: string[];
  targetHeading: string;
  targetSnippet: string;
}

interface PreviewSyncMessagePayload {
  type: typeof SEARCH_PREVIEW_SYNC_MESSAGE;
  hash?: string;
  highlightTerms?: unknown;
  targetHeading?: unknown;
  targetSnippet?: unknown;
}

let previewRefreshTimer = 0;
let previewRuntimeState: PreviewRuntimeState | null = null;

const dispatchSearchLaunchEvent = (targetWindow: Window = window): void => {
  targetWindow.dispatchEvent(new CustomEvent(SEARCH_LAUNCH_EVENT));
};

const relaySearchLaunchToParent = (): boolean => {
  if (!isPreviewMode()) return false;
  if (typeof window === "undefined") return false;
  if (!window.parent || window.parent === window) return false;

  try {
    dispatchSearchLaunchEvent(window.parent);
    return true;
  } catch {
    return false;
  }
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;

  if (target.isContentEditable) return true;

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const clearPreviewTargetClass = (): void => {
  if (typeof document === "undefined") return;

  document.querySelectorAll<HTMLElement>(`.${SEARCH_PREVIEW_TARGET_CLASS}`).forEach((node) => {
    node.classList.remove(SEARCH_PREVIEW_TARGET_CLASS);
  });
};

const clearPreviewHighlights = (): void => {
  if (typeof document === "undefined") return;

  clearPreviewTargetClass();

  document
    .querySelectorAll<HTMLElement>(
      `mark.${SEARCH_PREVIEW_HIGHLIGHT_CLASS}[${SEARCH_PREVIEW_HIGHLIGHT_ATTR}="1"]`,
    )
    .forEach((mark) => {
      const parent = mark.parentNode;

      if (!parent) return;

      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
};

const getPreviewSearchParams = (): URLSearchParams => new URL(window.location.href).searchParams;
const isPreviewMode = (): boolean =>
  getPreviewSearchParams().get(SEARCH_PREVIEW_QUERY_KEY) === "1";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTargetText = (value: string): string =>
  value
    .replace(/\s+/gu, " ")
    .replace(/(?:\.{3,}|…)+/gu, " ")
    .replace(/^[\s\-–—,，。:：;；、.]+|[\s\-–—,，。:：;；、.]+$/gu, "")
    .trim();

const normalizeHighlightTerms = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
  }

  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    }
  } catch {
    // ignore malformed highlight payloads and fall back to whitespace splitting
  }

  return value
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
};

const normalizePreviewHash = (value: unknown): string => {
  if (typeof value !== "string") return "";

  const normalizedValue = value.trim();

  if (!normalizedValue) return "";

  return normalizedValue.startsWith("#") ? normalizedValue : `#${normalizedValue}`;
};

const readPreviewRuntimeStateFromUrl = (): PreviewRuntimeState => {
  const searchParams = getPreviewSearchParams();

  return {
    highlightTerms: normalizeHighlightTerms(searchParams.get(SEARCH_HIGHLIGHT_QUERY_KEY)),
    targetHeading: normalizeTargetText(searchParams.get(SEARCH_TARGET_HEADING_QUERY_KEY) ?? ""),
    targetSnippet: normalizeTargetText(searchParams.get(SEARCH_TARGET_SNIPPET_QUERY_KEY) ?? ""),
  };
};

const syncPreviewRuntimeStateFromUrl = (): void => {
  previewRuntimeState = isPreviewMode() ? readPreviewRuntimeStateFromUrl() : null;
};

const getPreviewRuntimeState = (): PreviewRuntimeState => {
  if (!previewRuntimeState) {
    syncPreviewRuntimeStateFromUrl();
  }

  return previewRuntimeState ?? {
    highlightTerms: [],
    targetHeading: "",
    targetSnippet: "",
  };
};

const getHighlightTerms = (): string[] => getPreviewRuntimeState().highlightTerms;

const getTargetHeading = (): string => getPreviewRuntimeState().targetHeading;

const getTargetSnippet = (): string => getPreviewRuntimeState().targetSnippet;

const buildTargetTextCandidates = (value: string): string[] => {
  const normalizedValue = normalizeTargetText(value);

  if (!normalizedValue) return [];

  const candidates = new Set<string>([
    normalizedValue,
    normalizedValue.slice(0, 180),
    normalizedValue.slice(0, 140),
    normalizedValue.slice(0, 100),
    normalizedValue.slice(-180),
    normalizedValue.slice(-140),
    normalizedValue.slice(-100),
    ...normalizedValue
      .split(/[。！？；;：:]/u)
      .map((item) => normalizeTargetText(item))
      .filter((item) => item.length >= 8),
  ]);

  return [...candidates].filter((item) => item.length >= 8).sort((left, right) => right.length - left.length);
};

const getBlockCandidates = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(SEARCH_PREVIEW_BLOCK_SELECTOR)].filter((element) => {
    const text = normalizeTargetText(element.textContent ?? "");

    return Boolean(text) && !element.closest(SEARCH_PREVIEW_SKIP_SELECTOR);
  });

const findHeadingTarget = (root: HTMLElement, headingText: string): HTMLElement | null => {
  if (!headingText) return null;

  const normalizedHeading = normalizeTargetText(headingText);

  return (
    [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].find((element) => {
      const text = normalizeTargetText(element.textContent ?? "");

      return text === normalizedHeading || text.includes(normalizedHeading);
    }) ?? null
  );
};

const getScopedBlocks = (root: HTMLElement, headingTarget: HTMLElement | null): HTMLElement[] => {
  const blocks = getBlockCandidates(root);

  if (!headingTarget) return blocks;

  const startIndex = blocks.indexOf(headingTarget);

  if (startIndex < 0) return blocks;

  const headingLevel = Number.parseInt(headingTarget.tagName.slice(1), 10) || 6;
  let endIndex = blocks.length;

  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const candidate = blocks[index];

    if (!/^H[1-6]$/u.test(candidate.tagName)) continue;

    const candidateLevel = Number.parseInt(candidate.tagName.slice(1), 10) || 6;

    if (candidateLevel <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  return blocks.slice(startIndex, endIndex);
};

const findSnippetTarget = (
  root: HTMLElement,
  snippetText: string,
  headingTarget: HTMLElement | null,
): HTMLElement | null => {
  if (!snippetText) return null;

  const textCandidates = buildTargetTextCandidates(snippetText);
  const scopedBlocks = getScopedBlocks(root, headingTarget);
  const allBlocks = getBlockCandidates(root);

  for (const candidateText of textCandidates) {
    const scopedMatch = scopedBlocks.find((element) =>
      normalizeTargetText(element.textContent ?? "").includes(candidateText),
    );

    if (scopedMatch) return scopedMatch;

    const fallbackMatch = allBlocks.find((element) =>
      normalizeTargetText(element.textContent ?? "").includes(candidateText),
    );

    if (fallbackMatch) return fallbackMatch;
  }

  return null;
};

const highlightTextNode = (node: Text, regex: RegExp): void => {
  const content = node.nodeValue;

  if (!content) return;

  regex.lastIndex = 0;

  if (!regex.test(content)) return;

  regex.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(content);

  while (match) {
    const matchText = match[0];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      fragment.append(content.slice(lastIndex, matchIndex));
    }

    const mark = document.createElement("mark");
    mark.className = SEARCH_PREVIEW_HIGHLIGHT_CLASS;
    mark.setAttribute(SEARCH_PREVIEW_HIGHLIGHT_ATTR, "1");
    mark.textContent = matchText;
    fragment.append(mark);

    lastIndex = matchIndex + matchText.length;
    match = regex.exec(content);
  }

  if (lastIndex < content.length) {
    fragment.append(content.slice(lastIndex));
  }

  node.parentNode?.replaceChild(fragment, node);
};

const resolvePreviewTarget = (): HTMLElement | null => {
  const root = document.querySelector<HTMLElement>(SEARCH_PREVIEW_ROOT);

  if (!root) return null;

  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const targetByHash = hash ? document.getElementById(hash) : null;

  if (targetByHash) return targetByHash;

  const headingTarget = findHeadingTarget(root, getTargetHeading());
  const snippetTarget = findSnippetTarget(root, getTargetSnippet(), headingTarget);

  if (snippetTarget) return snippetTarget;
  if (headingTarget) return headingTarget;

  const firstHighlight = root.querySelector<HTMLElement>(`mark.${SEARCH_PREVIEW_HIGHLIGHT_CLASS}`);

  return firstHighlight?.closest<HTMLElement>(SEARCH_PREVIEW_BLOCK_SELECTOR) ?? firstHighlight ?? null;
};

const markPreviewTarget = (): void => {
  const target = resolvePreviewTarget();

  if (target) {
    target.classList.add(SEARCH_PREVIEW_TARGET_CLASS);
  }
};

const syncPreviewTocTitles = (): void => {
  if (typeof document === "undefined" || !isPreviewMode()) return;

  document.querySelectorAll<HTMLAnchorElement>("#toc .vp-toc-link").forEach((link) => {
    const label = (link.textContent ?? "").trim();

    if (!label) {
      link.removeAttribute("title");
      return;
    }

    link.setAttribute("title", label);
    link.setAttribute("aria-label", label);
  });
};

const resolveHashTarget = (hash: string): HTMLElement | null => {
  const normalizedHash = decodeURIComponent(hash.replace(/^#/, ""));

  if (!normalizedHash) return null;

  return (
    document.getElementById(normalizedHash) ??
    document.getElementById(hash.replace(/^#/, "")) ??
    null
  );
};

const scrollPreviewToHash = (hash: string): void => {
  const target = resolveHashTarget(hash);

  if (!target) return;

  if (window.location.hash !== hash) {
    window.location.hash = hash;
    return;
  }

  clearPreviewTargetClass();
  markPreviewTarget();
  target.scrollIntoView({
    behavior: "auto",
    block: "start",
    inline: "nearest",
  });
};

const replacePreviewLocationState = (state: PreviewRuntimeState, hash = ""): void => {
  if (!isPreviewMode()) return;

  const url = new URL(window.location.href);

  if (state.highlightTerms.length) {
    url.searchParams.set(SEARCH_HIGHLIGHT_QUERY_KEY, JSON.stringify(state.highlightTerms));
  } else {
    url.searchParams.delete(SEARCH_HIGHLIGHT_QUERY_KEY);
  }

  if (state.targetHeading) {
    url.searchParams.set(SEARCH_TARGET_HEADING_QUERY_KEY, state.targetHeading);
  } else {
    url.searchParams.delete(SEARCH_TARGET_HEADING_QUERY_KEY);
  }

  if (state.targetSnippet) {
    url.searchParams.set(SEARCH_TARGET_SNIPPET_QUERY_KEY, state.targetSnippet);
  } else {
    url.searchParams.delete(SEARCH_TARGET_SNIPPET_QUERY_KEY);
  }

  const normalizedHash = normalizePreviewHash(hash);
  const nextUrl = `${url.pathname}${url.search}${normalizedHash}`;

  window.history.replaceState(window.history.state, "", nextUrl);
};

const scrollPreviewToCurrentTarget = (): void => {
  const target = resolvePreviewTarget();

  if (!target) return;

  target.scrollIntoView({
    behavior: "auto",
    block: "start",
    inline: "nearest",
  });
};

const isSameStringArray = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const handlePreviewSyncMessage = (event: MessageEvent): void => {
  if (!isPreviewMode()) return;
  if (event.origin !== window.location.origin) return;

  const payload = event.data as PreviewSyncMessagePayload | null;

  if (!payload || payload.type !== SEARCH_PREVIEW_SYNC_MESSAGE) return;

  const nextState: PreviewRuntimeState = {
    highlightTerms: normalizeHighlightTerms(payload.highlightTerms),
    targetHeading: normalizeTargetText(typeof payload.targetHeading === "string" ? payload.targetHeading : ""),
    targetSnippet: normalizeTargetText(typeof payload.targetSnippet === "string" ? payload.targetSnippet : ""),
  };
  const currentState = getPreviewRuntimeState();
  const highlightTermsChanged = !isSameStringArray(currentState.highlightTerms, nextState.highlightTerms);
  const nextHash = normalizePreviewHash(payload.hash);

  previewRuntimeState = nextState;
  replacePreviewLocationState(nextState, nextHash);

  if (highlightTermsChanged) {
    clearPreviewHighlights();
    applyPreviewHighlights();
  } else {
    clearPreviewTargetClass();
    markPreviewTarget();
  }

  syncPreviewTocTitles();

  if (nextHash) {
    scrollPreviewToHash(nextHash);
    return;
  }

  scrollPreviewToCurrentTarget();
};

const handlePreviewAnchorClick = (event: MouseEvent): void => {
  if (!isPreviewMode()) return;
  if (event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = event.target;

  if (!(target instanceof Element)) return;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");

  if (!anchor) return;

  const url = new URL(anchor.href, window.location.href);

  if (url.origin !== window.location.origin) return;
  if (url.pathname !== window.location.pathname) return;
  if (!url.hash) return;

  event.preventDefault();
  scrollPreviewToHash(url.hash);
};

const applyPreviewHighlights = (): void => {
  clearPreviewHighlights();

  const root = document.querySelector<HTMLElement>(SEARCH_PREVIEW_ROOT);
  const terms = getHighlightTerms();

  if (!root || !terms.length) {
    markPreviewTarget();
    return;
  }

  const regex = new RegExp(
    terms.map((term) => escapeRegExp(term)).join("|"),
    "giu",
  );
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue?.trim();
      const parent = node.parentElement;

      if (!value || !parent || parent.closest(SEARCH_PREVIEW_SKIP_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();

  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  textNodes.forEach((node) => {
    highlightTextNode(node, regex);
  });

  markPreviewTarget();
};

const syncRouteMode = (path: string): void => {
  if (typeof window === "undefined") return;

  const isPreview = isPreviewMode();
  const isSearchRoute = path === SEARCH_PATH;

  syncPreviewRuntimeStateFromUrl();

  document.documentElement.classList.toggle("search-preview-mode", isPreview);
  document.documentElement.classList.toggle("search-route-mode", isSearchRoute);

  window.clearTimeout(previewRefreshTimer);

  if (isPreview) {
    requestAnimationFrame(() => {
      applyPreviewHighlights();
      syncPreviewTocTitles();
      previewRefreshTimer = window.setTimeout(() => {
        applyPreviewHighlights();
        syncPreviewTocTitles();
      }, 120);
    });
  } else {
    previewRuntimeState = null;
    clearPreviewHighlights();
  }
};

export default defineClientConfig({
  enhance({ app, router }) {
    app.component("SearchPageButton", SearchPageButton);
    app.component(
      "SearchWorkspace",
      defineAsyncComponent(() => import("./components/SearchWorkspace.vue")),
    );

    if (typeof window === "undefined") return;

    syncRouteMode(router.currentRoute.value.path);

    void router.isReady().then(() => {
      syncRouteMode(router.currentRoute.value.path);
    });

    router.afterEach((to) => {
      requestAnimationFrame(() => {
        syncRouteMode(to.path);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      if (relaySearchLaunchToParent()) return;

      dispatchSearchLaunchEvent();
    });

    window.addEventListener("bc:sync-preview-mode", () => {
      syncRouteMode(router.currentRoute.value.path);
    });

    document.addEventListener("click", handlePreviewAnchorClick, true);
    window.addEventListener("message", handlePreviewSyncMessage);
    window.addEventListener("hashchange", () => {
      if (!isPreviewMode()) return;

      clearPreviewTargetClass();
      markPreviewTarget();
      syncPreviewTocTitles();
    });
  },
});
