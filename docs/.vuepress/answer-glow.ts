import { defineClientConfig } from "vuepress/client";

const CARD_SELECTOR = ".hint-container.answer";
const SIDEBAR_SELECTOR = ".vp-sidebar";
const SIDEBAR_ACCENT_SELECTOR = ".bc-sidebar-bioaccent";
const SIDEBAR_CLICKABLE_HEADER_SELECTOR = ".vp-sidebar-header.clickable";
const SIDEBAR_TITLE_LINK_SELECTOR = ".vp-sidebar-header.clickable > .vp-sidebar-title[href]";
const HIERARCHY_TEXT_SELECTOR = [
  ".vp-page-title h1",
  "#main-content .vp-page-title h1",
  ".vp-sidebar-link",
  ".vp-sidebar-heading",
  ".vp-sidebar-header",
  "#toc .vp-toc-link",
].join(", ");
const HIERARCHY_SEPARATOR_RE = /\s*[：:]\s*/gu;
const hasHierarchySeparator = (value: string): boolean => value.includes("：") || value.includes(":");

const formatHierarchyText = (value: string): string =>
  value.replace(HIERARCHY_SEPARATOR_RE, " > ").replace(/\s{2,}/gu, " ").trim();

const normalizeSidebarPath = (value: string): string => {
  if (!value) return "";

  try {
    const url = new URL(value, window.location.origin);

    return url.pathname.replace(/\/+$/u, "") || "/";
  } catch {
    return value.split(/[?#]/u)[0]?.replace(/\/+$/u, "") || "";
  }
};

export default defineClientConfig({
  enhance({ router }) {
    if (typeof document === "undefined") return;

    let activeCard: HTMLElement | null = null;
    let hierarchyFormatFrame = 0;
    let hierarchyFormatTimer = 0;

    const isHeaderExpanded = (header: Element | null): boolean =>
      header?.querySelector(".vp-arrow.down") !== null;

    const clearActiveCard = (): void => {
      if (!activeCard) return;

      activeCard.classList.remove("answer-glow-active");
      activeCard = null;
    };

    const ensureSidebarAccent = (): void => {
      document.querySelectorAll<HTMLElement>(SIDEBAR_SELECTOR).forEach((sidebar) => {
        if (sidebar.querySelector(SIDEBAR_ACCENT_SELECTOR)) return;

        const accent = document.createElement("div");
        accent.className = "bc-sidebar-bioaccent";
        accent.innerHTML = [
          '<span class="bc-sidebar-bioaccent-chip">BioPharma</span>',
          '<strong class="bc-sidebar-bioaccent-title">Knowledge Atlas</strong>',
          '<span class="bc-sidebar-bioaccent-meta">Cell line · Process · Quality</span>',
        ].join("");
        sidebar.prepend(accent);
      });
    };

    const formatHierarchyLabels = (): void => {
      document.querySelectorAll<HTMLElement>(HIERARCHY_TEXT_SELECTOR).forEach((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const value = node.nodeValue ?? "";

            return hasHierarchySeparator(value)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        });
        const textNodes: Text[] = [];
        let current = walker.nextNode();

        while (current) {
          textNodes.push(current as Text);
          current = walker.nextNode();
        }

        textNodes.forEach((node) => {
          const value = node.nodeValue ?? "";
          const formattedValue = formatHierarchyText(value);

          if (formattedValue && formattedValue !== value) {
            node.nodeValue = formattedValue;
          }
        });

        const title = element.getAttribute("title");

        if (title && hasHierarchySeparator(title)) {
          element.setAttribute("title", formatHierarchyText(title));
        }

        const ariaLabel = element.getAttribute("aria-label");

        if (ariaLabel && hasHierarchySeparator(ariaLabel)) {
          element.setAttribute("aria-label", formatHierarchyText(ariaLabel));
        }
      });
    };

    const runHierarchyFormatting = (): void => {
      ensureSidebarAccent();
      formatHierarchyLabels();
    };

    const scheduleHierarchyFormatting = (): void => {
      if (hierarchyFormatFrame) {
        window.cancelAnimationFrame(hierarchyFormatFrame);
      }

      if (hierarchyFormatTimer) {
        window.clearTimeout(hierarchyFormatTimer);
      }

      hierarchyFormatFrame = window.requestAnimationFrame(() => {
        hierarchyFormatFrame = 0;
        runHierarchyFormatting();
        hierarchyFormatTimer = window.setTimeout(() => {
          hierarchyFormatTimer = 0;
          runHierarchyFormatting();
        }, 24);
      });
    };

    document.addEventListener(
      "click",
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (!(event instanceof MouseEvent)) return;
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const titleLink = event.target.closest<HTMLAnchorElement>(SIDEBAR_TITLE_LINK_SELECTOR);

        if (!titleLink) return;

        const header = titleLink.closest<HTMLElement>(SIDEBAR_CLICKABLE_HEADER_SELECTOR);
        const targetPath = normalizeSidebarPath(titleLink.getAttribute("href") ?? "");
        const currentPath = normalizeSidebarPath(window.location.pathname);

        event.stopPropagation();

        if (header && targetPath === currentPath) {
          event.preventDefault();

          if (!isHeaderExpanded(header)) {
            header.click();
          }

          return;
        }
      },
      true,
    );

    document.addEventListener(
      "pointermove",
      (event) => {
        const target = event.target;
        const card =
          target instanceof Element
            ? target.closest<HTMLElement>(CARD_SELECTOR)
            : null;

        if (!card) {
          clearActiveCard();
          return;
        }

        if (activeCard && activeCard !== card) {
          activeCard.classList.remove("answer-glow-active");
        }

        activeCard = card;
        activeCard.classList.add("answer-glow-active");

        const rect = activeCard.getBoundingClientRect();
        activeCard.style.setProperty("--answer-glow-x", `${event.clientX - rect.left}px`);
        activeCard.style.setProperty("--answer-glow-y", `${event.clientY - rect.top}px`);
      },
      { passive: true },
    );

    document.addEventListener("pointerleave", clearActiveCard, {
      passive: true,
    });

    void router.isReady().then(() => {
      scheduleHierarchyFormatting();
    });

    router.afterEach(() => {
      scheduleHierarchyFormatting();
    });
  },
});
