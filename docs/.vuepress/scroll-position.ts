import { defineClientConfig } from "vuepress/client";

const STORAGE_PREFIX = "bc-scroll:";
const MAX_ENTRIES = 60;
const SAVE_DELAY = 400;
const SCROLL_SYNC_EVENT = "bc:scroll-sync";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let currentPath = "";
let ticking = false;
let vpPageWithListener: HTMLElement | null = null;
let windowListenerOn = false;

const resolveScrollEl = (): Element | Window => {
  const page = document.querySelector<HTMLElement>(".vp-page");
  if (page) {
    const { overflowY } = window.getComputedStyle(page);
    if (/(auto|scroll|overlay)/u.test(overflowY) && page.scrollHeight > page.clientHeight) {
      return page;
    }
  }
  return window;
};

const getScrollY = (): number => {
  const el = resolveScrollEl();
  return el instanceof Window ? el.scrollY : (el as HTMLElement).scrollTop;
};

const getScrollMax = (): number => {
  const el = resolveScrollEl();
  return el instanceof Window
    ? Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)
    : Math.max(
        (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
        0,
      );
};

const getScrollState = (): { y: number; max: number } => {
  const el = resolveScrollEl();
  const y = el instanceof Window ? el.scrollY : (el as HTMLElement).scrollTop;
  const max = el instanceof Window
    ? Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)
    : Math.max((el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight, 0);
  return { y, max };
};

const getScrollPct = (): number => {
  const { y, max } = getScrollState();
  if (max <= 0) return 0;
  return Math.round(Math.min((y / max) * 100, 100));
};

const getScrollSnapshot = (): { y: number; pct: number } => ({
  y: getScrollY(),
  pct: getScrollPct(),
});

const scrollToY = (y: number, behavior: ScrollBehavior = "instant"): void => {
  resolveScrollEl().scrollTo({ top: y, behavior });
};

const emitScrollSync = (path: string): void => {
  if (!path || currentPath !== path) return;

  const { y, pct } = getScrollSnapshot();
  const { max } = getScrollState();

  window.dispatchEvent(
    new CustomEvent(SCROLL_SYNC_EVENT, {
      detail: { path, y, max, pct },
    }),
  );
};

const scheduleScrollSync = (path: string, delay = 0): void => {
  window.setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => emitScrollSync(path));
    });
  }, delay);
};

const getStorageKey = (path: string): string => `${STORAGE_PREFIX}${path}`;

const trimEntries = (): void => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  if (keys.length <= MAX_ENTRIES) return;

  keys
    .sort((a, b) => {
      const va = localStorage.getItem(a);
      const vb = localStorage.getItem(b);
      if (!va || !vb) return 0;
      const ta = JSON.parse(va).t || 0;
      const tb = JSON.parse(vb).t || 0;
      return ta - tb;
    })
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((k) => localStorage.removeItem(k));
};

const savePosition = (
  path: string,
  snapshot: { y: number; pct: number } = getScrollSnapshot(),
): void => {
  if (!path || path === "/search.html") return;
  try {
    localStorage.setItem(
      getStorageKey(path),
      JSON.stringify({
        y: Math.round(snapshot.y),
        pct: snapshot.pct,
        t: Date.now(),
      }),
    );
    trimEntries();
  } catch {
    // localStorage full or unavailable
  }
};

const readPosition = (path: string): number | null => {
  if (!path) return null;
  try {
    const raw = localStorage.getItem(getStorageKey(path));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return typeof data.y === "number" && Number.isFinite(data.y) ? data.y : null;
  } catch {
    return null;
  }
};

const persistNow = (): void => {
  if (!currentPath) return;
  savePosition(currentPath, getScrollSnapshot());
};

const scheduleSave = (): void => {
  if (!currentPath) return;
  const path = currentPath;
  const snapshot = getScrollSnapshot();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePosition(path, snapshot);
  }, SAVE_DELAY);
};

const onScroll = (): void => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    scheduleSave();
  });
};

const reattachScrollListener = (): void => {
  if (!windowListenerOn) {
    window.addEventListener("scroll", onScroll, { passive: true });
    windowListenerOn = true;
  }

  if (vpPageWithListener) {
    vpPageWithListener.removeEventListener("scroll", onScroll);
    vpPageWithListener = null;
  }
  const page = document.querySelector<HTMLElement>(".vp-page");
  if (page) {
    page.addEventListener("scroll", onScroll, { passive: true });
    vpPageWithListener = page;
  }
};

const restorePosition = (path: string): void => {
  if (!path) return;

  const savedY = readPosition(path);
  if (savedY === null || savedY <= 0) {
    scrollToY(0);
    scheduleScrollSync(path, 0);
    scheduleScrollSync(path, 220);
    return;
  }

  const tryScroll = (attempt: number): void => {
    const maxY = getScrollMax();
    if (maxY > 0) {
      scrollToY(Math.min(savedY, maxY));
      scheduleScrollSync(path, 220);
      return;
    }
    if (attempt < 50) {
      requestAnimationFrame(() => tryScroll(attempt + 1));
      return;
    }
    scheduleScrollSync(path, 220);
  };

  // Defer past the theme's fade-in-up "out-in" transition (~0.4s content gap)
  // so the new page content is in the DOM before we start scrolling.
  setTimeout(() => tryScroll(0), 100);
};

export default defineClientConfig({
  enhance({ router }) {
    if (typeof window === "undefined") return;

    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    // Override VuePress default scrollBehavior which returns {top:0} for
    // every pushState navigation, undoing our scroll restoration in afterEach.
    // We handle all scroll restoration ourselves in restorePosition().
    const originalScrollBehavior = router.options.scrollBehavior;
    router.options.scrollBehavior = (to, from, savedPosition) => {
      if (savedPosition) return savedPosition;
      if (to.hash) return { el: to.hash };
      return false;
    };

    reattachScrollListener();

    window.addEventListener("beforeunload", persistNow);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistNow();
    });

    router.beforeEach((to, from) => {
      if (to.path === from.path) return;

      const fromPath = from?.path ?? "";
      if (fromPath) {
        savePosition(fromPath, getScrollSnapshot());
      }
    });

    router.afterEach((to, from) => {
      if (to.path === from.path) return;

      currentPath = to.path;
      reattachScrollListener();
      restorePosition(to.path);
    });

    void router.isReady().then(() => {
      const initialPath = router.currentRoute.value.path;
      currentPath = initialPath;
      reattachScrollListener();
      restorePosition(initialPath);
    });
  },
});
