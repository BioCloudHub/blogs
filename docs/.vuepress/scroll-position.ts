import { defineClientConfig } from "vuepress/client";

const STORAGE_PREFIX = "bc-scroll:";
const MAX_ENTRIES = 60;
const SAVE_DELAY = 400;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let currentPath = "";
let ticking = false;
let scrollEl: Element | Window;

const resolveScrollEl = (): Element | Window => {
  const page = document.querySelector<HTMLElement>(".vp-page");
  if (page && page.clientHeight < page.scrollHeight) return page;
  return window;
};

const getScrollMax = (): number => {
  return scrollEl instanceof Window
    ? Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)
    : Math.max(
        (scrollEl as HTMLElement).scrollHeight - (scrollEl as HTMLElement).clientHeight,
        0,
      );
};

const scrollToY = (y: number, behavior: ScrollBehavior = "instant"): void => {
  scrollEl.scrollTo({ top: y, behavior });
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

const savePosition = (path: string, y: number): void => {
  if (!path || path === "/search.html") return;
  try {
    localStorage.setItem(
      getStorageKey(path),
      JSON.stringify({ y: Math.round(y), t: Date.now() }),
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
  const y = scrollEl instanceof Window ? scrollEl.scrollY : (scrollEl as HTMLElement).scrollTop;
  savePosition(currentPath, y);
};

const scheduleSave = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
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

const restorePosition = (path: string): void => {
  if (!path) return;

  const savedY = readPosition(path);
  if (savedY === null || savedY <= 0) return;

  const scrollToSaved = (): void => {
    const maxY = getScrollMax();
    if (maxY <= 0) {
      requestAnimationFrame(() => {
        const retryMaxY = getScrollMax();
        if (retryMaxY > 0) {
          scrollToY(Math.min(savedY, retryMaxY), "instant" as ScrollBehavior);
        }
      });
      return;
    }
    scrollToY(Math.min(savedY, maxY), "instant" as ScrollBehavior);
  };

  scrollToSaved();
};

export default defineClientConfig({
  enhance({ router }) {
    if (typeof window === "undefined") return;

    scrollEl = resolveScrollEl();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    if (scrollEl !== window) {
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    window.addEventListener("beforeunload", persistNow);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistNow();
    });

    router.afterEach((to, from) => {
      const fromPath = from?.path ?? "";
      const toPath = to.path;

      if (fromPath) {
        const y = scrollEl instanceof Window ? scrollEl.scrollY : (scrollEl as HTMLElement).scrollTop;
        savePosition(fromPath, y);
      }

      currentPath = toPath;
      requestAnimationFrame(() => {
        restorePosition(toPath);
      });
    });

    void router.isReady().then(() => {
      const initialPath = router.currentRoute.value.path;
      currentPath = initialPath;
      requestAnimationFrame(() => {
        restorePosition(initialPath);
      });
    });
  },
});
