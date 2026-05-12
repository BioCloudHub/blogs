import { onMounted } from "vue";
import { defineClientConfig } from "vuepress/client";
import katexCssText from "katex/dist/katex.min.css?raw";

const CARD_SELECTOR = ".hint-container.answer";
const CARD_TITLE_SELECTOR = ".hint-container-title";
const COPY_CHIP_SELECTOR = ".hint-container.answer .answer-chip";
const SIDEBAR_SELECTOR = ".vp-sidebar";
const SIDEBAR_ACCENT_SELECTOR = ".bc-sidebar-bioaccent";
const SIDEBAR_CLICKABLE_HEADER_SELECTOR = ".vp-sidebar-header.clickable";
const SIDEBAR_TITLE_LINK_SELECTOR = ".vp-sidebar-header.clickable > .vp-sidebar-title[href]";
const HIERARCHY_READY_EVENT = "bc:hierarchy-ready";
const HIERARCHY_TEXT_SELECTOR = [
  ".vp-page-title h1",
  "#main-content .vp-page-title h1",
  ".vp-sidebar-link",
  ".vp-sidebar-heading",
  ".vp-sidebar-header",
  "#toc .vp-toc-link",
].join(", ");
const NAV_TOOLTIP_SELECTOR = [
  ".vp-sidebar-link",
  ".vp-sidebar-title",
  ".vp-sidebar-heading",
  "#toc .vp-toc-link",
  ".vp-page-nav .link",
].join(", ");
const HIERARCHY_SEPARATOR_RE = /\s*[：:]\s*/gu;
const hasHierarchySeparator = (value: string): boolean => value.includes("：") || value.includes(":");
const QUESTION_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

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

const stripPageExtension = (value: string): string =>
  value.replace(/\.(?:html|md)$/u, "");

const toSidebarRoutePath = (value: string): string => {
  const normalizedPath = normalizeSidebarPath(value);
  const normalizedBase = normalizeSidebarPath(__VUEPRESS_BASE__);

  if (!normalizedPath || !normalizedBase || normalizedBase === "/") {
    return normalizedPath;
  }

  if (normalizedPath === normalizedBase) return "/";

  return normalizedPath.startsWith(`${normalizedBase}/`)
    ? normalizedPath.slice(normalizedBase.length) || "/"
    : normalizedPath;
};

const afterNextPaint = (task: () => void): void => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      task();
    });
  });
};

export default defineClientConfig({
  setup() {
    if (typeof window === "undefined") return;

    onMounted(() => {
      afterNextPaint(() => {
        window.dispatchEvent(new CustomEvent(HIERARCHY_READY_EVENT));
      });
    });
  },
  enhance({ router }) {
    if (typeof document === "undefined") return;

    let activeCard: HTMLElement | null = null;
    let hierarchyFormatFrame = 0;
    let hierarchyFormatTimer = 0;
    let hierarchyFormatted = false;
    let suppressSidebarNavigation = false;
    let sidebarFirstLoaded = false;
    let toastTimer = 0;

    const ensureToast = (): HTMLElement => {
      const existing = document.querySelector<HTMLElement>(".bc-copy-toast");

      if (existing) return existing;

      const toast = document.createElement("div");
      toast.className = "bc-copy-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
      return toast;
    };

    const showToast = (message: string, tone: "info" | "success" | "error" = "success") => {
      const toast = ensureToast();
      toast.textContent = message;
      toast.dataset.tone = tone;
      toast.classList.add("show");

      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }

      toastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
        toastTimer = 0;
      }, 2400);
    };

    const isHeaderExpanded = (header: Element | null): boolean =>
      header?.querySelector(".vp-arrow.down") !== null;

    // After Vue DOM flush, ensure only the current page's L1 section is open.
    const enforceAccordion = (): void => {
      Promise.resolve().then(() => {
        const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

        if (!sidebar) return;

        const l1Headers = Array.from(
          sidebar.querySelectorAll<HTMLElement>(
            ":scope > .vp-sidebar-links > li > .vp-sidebar-group > .vp-sidebar-header.clickable",
          ),
        );

        if (l1Headers.length <= 1) return;

        // Only the L1 matching the current route stays open
        const currentHeader = l1Headers.find((h) => isHeaderPathActive(h));

        l1Headers.forEach((h) => {
          if (h === currentHeader) {
            if (!isHeaderExpanded(h)) {
              withSuppressedSidebarNavigation(() => h.click());
            }
          } else if (isHeaderExpanded(h)) {
            withSuppressedSidebarNavigation(() => h.click());
          }
        });
      });
    };

    const getSidebarGroupKey = (header: HTMLElement): string | null => {
      const titleLink = header.querySelector<HTMLAnchorElement>(
        ".vp-sidebar-title[href]",
      );
      const href = titleLink?.getAttribute("href") ?? "";

      if (href) {
        const path = toSidebarRoutePath(href);

        if (path) return `sidebar-expand:${path}`;
      }

      const text = (header.querySelector(".vp-sidebar-title")?.textContent ?? "").trim();

      return text ? `sidebar-expand:text:${text}` : null;
    };

    const matchesPrefix = (value: string, prefix: string): boolean =>
      value === prefix.slice(0, -1) || value.startsWith(prefix);

    const updateTaxonomyLayout = (value: string): void => {
      const normalized = toSidebarRoutePath(value);
      const isTag = matchesPrefix(normalized, "/tag/");
      const isCategory = matchesPrefix(normalized, "/category/");
      const isArticle = matchesPrefix(normalized, "/article/");
      const isRightMain = [
        "/tag/",
        "/category/",
        "/article/",
        "/star/",
        "/timeline/",
      ].some((prefix) => matchesPrefix(normalized, prefix));

      document.documentElement.classList.toggle("bc-tag-layout", isTag);
      document.documentElement.classList.toggle("bc-category-layout", isCategory);
      document.documentElement.classList.toggle("bc-article-layout", isArticle);
      document.documentElement.classList.toggle("bc-blog-right-layout", isRightMain);
    };
    const syncTaxonomyLayout = (): void => {
      updateTaxonomyLayout(router.currentRoute.value.path);
    };

    updateTaxonomyLayout(window.location.pathname);
    router.beforeEach((to) => {
      updateTaxonomyLayout(to.path);
      return true;
    });


    const clearActiveCard = (): void => {
      if (!activeCard) return;

      activeCard.classList.remove("answer-glow-active");
      activeCard = null;
    };

    const findClosestHeading = (card: HTMLElement): HTMLElement | null => {
      let current: Element | null = card;

      while (current && current !== document.body) {
        let previous = current.previousElementSibling;

        while (previous) {
          if (previous.matches(QUESTION_HEADING_SELECTOR)) {
            return previous as HTMLElement;
          }

          const nested = previous.querySelector<HTMLElement>(QUESTION_HEADING_SELECTOR);

          if (nested) return nested;

          previous = previous.previousElementSibling;
        }

        current = current.parentElement;
      }

      return null;
    };

    const extractAnswerText = (card: HTMLElement): string => {
      const clone = card.cloneNode(true) as HTMLElement;
      const title = clone.querySelector(CARD_TITLE_SELECTOR);

      if (title) title.remove();

      const text = (clone.innerText || clone.textContent || "").trim();

      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
    };

    const extractAnswerHtml = (card: HTMLElement): string => {
      const clone = card.cloneNode(true) as HTMLElement;
      const title = clone.querySelector(CARD_TITLE_SELECTOR);

      if (title) title.remove();

      const flowSymbolMatcher = /[─│┌┐└┘├┤┬┴┼▼▲◀▶→←↑↓↘↙↗↖⇩⇧⬇⬆⇣⇡]/gu;
      const flowConnectorMatcher = /[─│┌┐└┘├┤┬┴┼▼▲◀▶→←↑↓↘↙↗↖⇩⇧⬇⬆⇣⇡]/u;
      const arrowOnlyLineMatcher = /^[\s\u3000]*[▼▲◀▶→←↑↓↘↙↗↖⇩⇧⬇⬆⇣⇡\-–—=<>|│]+[\s\u3000]*$/u;
      const codeSyntaxMatcher = /[{}();]/u;
      const zeroWidthMatcher = /[\u200b\u200c\u200d\ufeff]/gu;

      clone.querySelectorAll<HTMLElement>('div[class^="language-"], div[class*=" language-"]').forEach((block) => {
        const code = block.querySelector<HTMLElement>("pre code");
        if (!code) return;

        const text = code.textContent ?? "";
        const lines = text.split(/\r?\n/gu).map((line) => line.replace(/[ \t]+$/gu, ""));
        const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
        const symbolCount = (text.match(flowSymbolMatcher) || []).length;
        const connectorLineCount = nonEmptyLines.filter((line) => flowConnectorMatcher.test(line)).length;
        const arrowOnlyLineCount = nonEmptyLines.filter((line) => arrowOnlyLineMatcher.test(line)).length;
        const shortLineCount = nonEmptyLines.filter((line) => line.trim().length <= 36).length;
        const shortLineRatio = nonEmptyLines.length > 0 ? shortLineCount / nonEmptyLines.length : 0;
        const className = block.className;
        const isExplicitFlowLanguage = /\blanguage-(?:flow|mermaid)\b/u.test(className);
        const likelyCodeBlock = codeSyntaxMatcher.test(text);
        const looksLikeFlowChart =
          isExplicitFlowLanguage ||
          (nonEmptyLines.length >= 5 &&
            !likelyCodeBlock &&
            (symbolCount >= 4 ||
              (connectorLineCount >= 3 && arrowOnlyLineCount >= 2) ||
              (arrowOnlyLineCount >= 2 && shortLineRatio >= 0.65)));

        if (!looksLikeFlowChart) return;

        block.classList.add("bc-flow-compact");

        // Remove visual blank rows in highlighted code to avoid overly sparse flowchart blocks.
        code.querySelectorAll<HTMLElement>(".line").forEach((line) => {
          const content = (line.textContent ?? "").replace(zeroWidthMatcher, "").trim();
          if (!content) line.remove();
        });

        Array.from(code.childNodes).forEach((node) => {
          if (node.nodeType !== Node.TEXT_NODE) return;
          const content = (node.textContent ?? "").replace(zeroWidthMatcher, "").trim();
          if (!content) node.remove();
        });

        const compact = lines
          .map((line) => line.replace(zeroWidthMatcher, ""))
          .filter((line) => line.trim().length > 0)
          .join("\n")
          .trimEnd();

        if (!compact) return;

        if (!code.querySelector(".line")) {
          code.textContent = compact;
        }
      });

      return clone.innerHTML.trim();
    };

    const escapeHtml = (value: string): string =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    let cachedQrDataUrl: string | null = null;
    let cachedQrValue: string | null = null;
    let cachedLogoDataUrl: string | null = null;
    const SHARE_CARD_META_TEXT = "解读生物制药，让知识触手可及";
    const SHARE_QR_SIZE = 104;
    const SHARE_QR_CODE_WIDTH = 460;
    const SHARE_QR_CAPTION_TOP = "扫码查看原文";
    const SHARE_CARD_BOTTOM_SAFE_AREA = 42;

    const blobToDataUrl = (blob: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
      });

    const getLogoDataUrl = async (): Promise<string> => {
      if (cachedLogoDataUrl) return cachedLogoDataUrl;

      const baseUrl = new URL(__VUEPRESS_BASE__, window.location.origin);
      const logoUrl = new URL("img/logo.png", baseUrl);
      const response = await fetch(logoUrl.toString());

      if (!response.ok) {
        throw new Error("Logo fetch failed");
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      cachedLogoDataUrl = dataUrl;
      return dataUrl;
    };

    const buildShareQrValue = (): string => {
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.pathname = url.pathname.replace(/\/index\.html$/iu, "/").replace(/\/{2,}/gu, "/");
      return url.toString();
    };

    const getQrDataUrl = async (value: string): Promise<string> => {
      if (cachedQrDataUrl && cachedQrValue === value) return cachedQrDataUrl;

      const qrModule = (await import("qrcode")) as {
        toDataURL?: (text: string, options?: Record<string, unknown>) => Promise<string>;
        default?: { toDataURL?: (text: string, options?: Record<string, unknown>) => Promise<string> };
      };
      const toDataURL = qrModule.toDataURL ?? qrModule.default?.toDataURL;

      if (!toDataURL) {
        throw new Error("QRCode generator unavailable");
      }

      const dataUrl = await toDataURL(value, {
        errorCorrectionLevel: "M",
        width: SHARE_QR_CODE_WIDTH,
        margin: 2,
        color: {
          dark: "#0b2436",
          light: "#ffffff",
        },
      });

      cachedQrDataUrl = dataUrl;
      cachedQrValue = value;
      return dataUrl;
    };

    const waitForDocumentFonts = async (): Promise<void> => {
      const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fontSet?.ready) return;

      try {
        await Promise.race([
          fontSet.ready.then(() => undefined),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 600);
          }),
        ]);
      } catch {
        // ignore font readiness errors
      }
    };

    const tokenizeText = (value: string): string[] => {
      const tokens: string[] = [];
      let buffer = "";

      for (const ch of value) {
        if (/\s/u.test(ch)) {
          if (buffer) {
            tokens.push(buffer);
            buffer = "";
          }
          tokens.push(ch);
          continue;
        }

        const code = ch.charCodeAt(0);
        const isCjk =
          (code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3400 && code <= 0x4dbf) ||
          (code >= 0x3040 && code <= 0x30ff);

        if (isCjk) {
          if (buffer) {
            tokens.push(buffer);
            buffer = "";
          }
          tokens.push(ch);
        } else {
          buffer += ch;
        }
      }

      if (buffer) tokens.push(buffer);

      return tokens;
    };

    const wrapLines = (
      ctx: CanvasRenderingContext2D,
      text: string,
      maxWidth: number,
    ): string[] => {
      if (!text) return [""];

      const lines: string[] = [];
      const paragraphs = text.split(/\n+/u);

      paragraphs.forEach((paragraph, index) => {
        const tokens = tokenizeText(paragraph);
        let line = "";

        tokens.forEach((token) => {
          const next = line + token;
          const width = ctx.measureText(next).width;

          if (width > maxWidth && line.trim()) {
            lines.push(line.trimEnd());
            line = token.trimStart();
          } else {
            line = next;
          }
        });

        if (line.trim()) {
          lines.push(line.trimEnd());
        }

        if (index < paragraphs.length - 1) {
          lines.push("");
        }
      });

      return lines.length ? lines : [""];
    };

    const drawRoundedRect = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ) => {
      const r = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    };

    const buildShareImageCanvas = async (
      question: string,
      answer: string,
      qrDataUrl?: string,
      logoDataUrl?: string,
    ): Promise<Blob> => {
      const width = 860;
      const padding = 28;
      const panelInset = 22;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const qrSize = qrDataUrl ? SHARE_QR_SIZE : 0;
      const textRightInset = 0;
      const maxTextWidth = width - padding * 2 - panelInset * 2 - textRightInset;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Canvas context unavailable");
      }

      ctx.font = "600 26px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      const questionLines = wrapLines(ctx, question, maxTextWidth);
      const questionLineHeight = 34;

      ctx.font = "400 18px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      const answerLines = wrapLines(ctx, answer, maxTextWidth);
      const answerLineHeight = 28;

      const chipHeight = 22;
      const headerGap = 8;
      const metaLineHeight = 16;
      const headerHeight = chipHeight + headerGap + metaLineHeight;
      const headerVisualHeight = headerHeight;
      const headerToQuestionGap = 0;
      const topGap = headerToQuestionGap;
      const dividerGap = 4;
      const footerGap = 24;
      const footerOutsideSpace = 0;

      let height =
        panelInset * 2 +
        padding * 2 +
        headerVisualHeight +
        topGap +
        questionLines.length * questionLineHeight +
        dividerGap +
        answerLines.length * answerLineHeight +
        footerGap +
        footerOutsideSpace;

      height = Math.max(height + 10, 420);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);

      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#eef5ff");
      bg.addColorStop(0.48, "#f5f9ff");
      bg.addColorStop(1, "#fbfdff");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const glowLeft = ctx.createRadialGradient(80, 48, 0, 200, 150, 520);
      glowLeft.addColorStop(0, "rgba(36, 142, 201, 0.16)");
      glowLeft.addColorStop(1, "rgba(47, 164, 122, 0)");
      ctx.fillStyle = glowLeft;
      ctx.fillRect(0, 0, width, height);

      const glowRight = ctx.createRadialGradient(width - 68, 52, 0, width - 230, 190, 520);
      glowRight.addColorStop(0, "rgba(13, 108, 184, 0.16)");
      glowRight.addColorStop(1, "rgba(15, 111, 134, 0)");
      ctx.fillStyle = glowRight;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(15, 155, 215, 0.08)";
      ctx.beginPath();
      ctx.arc(width - 120, 90, 120, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(41, 143, 192, 0.07)";
      ctx.beginPath();
      ctx.arc(120, height - 100, 140, 0, Math.PI * 2);
      ctx.fill();

      const panelX = panelInset;
      const panelY = panelInset;
      const panelWidth = width - panelInset * 2;
      const panelHeight = height - panelInset * 2 - footerOutsideSpace;

      ctx.save();
      ctx.shadowColor = "rgba(11, 21, 38, 0.14)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 6;
      const cardFill = ctx.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + panelHeight);
      cardFill.addColorStop(0, "rgba(248, 252, 255, 0.99)");
      cardFill.addColorStop(0.58, "rgba(242, 248, 255, 0.99)");
      cardFill.addColorStop(1, "rgba(255, 255, 255, 0.99)");
      ctx.fillStyle = cardFill;
      drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 20);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(22, 53, 89, 0.28)";
      ctx.lineWidth = 1.2;
      drawRoundedRect(ctx, panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1, 20);
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 20);
      ctx.clip();
      const topWash = ctx.createLinearGradient(panelX, panelY, panelX, panelY + 102);
      topWash.addColorStop(0, "rgba(37, 118, 196, 0.1)");
      topWash.addColorStop(1, "rgba(15, 111, 134, 0)");
      ctx.fillStyle = topWash;
      ctx.fillRect(panelX, panelY, panelWidth, 102);

      const topDividerY = panelY + 96;
      const topDividerX = panelX + 24;
      const topDividerWidth = panelWidth - 48;
      const topDividerGradient = ctx.createLinearGradient(topDividerX, topDividerY, topDividerX + topDividerWidth, topDividerY);
      topDividerGradient.addColorStop(0, "rgba(14, 89, 164, 0.52)");
      topDividerGradient.addColorStop(0.6, "rgba(53, 132, 198, 0.26)");
      topDividerGradient.addColorStop(1, "rgba(53, 132, 198, 0)");
      ctx.strokeStyle = topDividerGradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(topDividerX, topDividerY);
      ctx.lineTo(topDividerX + topDividerWidth, topDividerY);
      ctx.stroke();

      const bottomWash = ctx.createLinearGradient(panelX, panelY + panelHeight - 80, panelX, panelY + panelHeight);
      bottomWash.addColorStop(0, "rgba(13, 108, 184, 0)");
      bottomWash.addColorStop(1, "rgba(13, 108, 184, 0.07)");
      ctx.fillStyle = bottomWash;
      ctx.fillRect(panelX, panelY + panelHeight - 80, panelWidth, 80);

      const netX = panelX + panelWidth - 220;
      const netY = panelY + 20;
      ctx.strokeStyle = "rgba(15, 111, 134, 0.25)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(netX + 20, netY + 84);
      ctx.lineTo(netX + 74, netY + 42);
      ctx.lineTo(netX + 140, netY + 62);
      ctx.moveTo(netX + 74, netY + 42);
      ctx.lineTo(netX + 96, netY + 96);
      ctx.moveTo(netX + 140, netY + 62);
      ctx.lineTo(netX + 176, netY + 30);
      ctx.stroke();
      ctx.fillStyle = "rgba(47, 164, 122, 0.45)";
      ctx.beginPath();
      ctx.arc(netX + 20, netY + 84, 4, 0, Math.PI * 2);
      ctx.arc(netX + 74, netY + 42, 4.6, 0, Math.PI * 2);
      ctx.arc(netX + 140, netY + 62, 4, 0, Math.PI * 2);
      ctx.arc(netX + 96, netY + 96, 3.6, 0, Math.PI * 2);
      ctx.arc(netX + 176, netY + 30, 3.2, 0, Math.PI * 2);
      ctx.fill();

      const dnaX = panelX + 28;
      const dnaY = panelY + 8;
      const dnaHeight = 100;
      const dnaWidth = 64;
      const dnaSteps = 6;
      ctx.strokeStyle = "rgba(15, 111, 134, 0.25)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= dnaSteps; i += 1) {
        const t = i / dnaSteps;
        const yPos = dnaY + t * dnaHeight;
        const offset = Math.sin(t * Math.PI * 2) * (dnaWidth / 4);
        const xPos = dnaX + offset;
        if (i === 0) ctx.moveTo(xPos, yPos);
        else ctx.lineTo(xPos, yPos);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= dnaSteps; i += 1) {
        const t = i / dnaSteps;
        const yPos = dnaY + t * dnaHeight;
        const offset = -Math.sin(t * Math.PI * 2) * (dnaWidth / 4);
        const xPos = dnaX + dnaWidth + offset;
        if (i === 0) ctx.moveTo(xPos, yPos);
        else ctx.lineTo(xPos, yPos);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(15, 111, 134, 0.2)";
      for (let i = 0; i <= dnaSteps; i += 1) {
        const t = i / dnaSteps;
        const yPos = dnaY + t * dnaHeight;
        const offset = Math.sin(t * Math.PI * 2) * (dnaWidth / 4);
        const xLeft = dnaX + offset;
        const xRight = dnaX + dnaWidth - offset;
        ctx.beginPath();
        ctx.moveTo(xLeft, yPos);
        ctx.lineTo(xRight, yPos);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(47, 164, 122, 0.35)";
      for (let i = 0; i <= dnaSteps; i += 1) {
        const t = i / dnaSteps;
        const yPos = dnaY + t * dnaHeight;
        const offset = Math.sin(t * Math.PI * 2) * (dnaWidth / 4);
        ctx.beginPath();
        ctx.arc(dnaX + offset, yPos, 3, 0, Math.PI * 2);
        ctx.arc(dnaX + dnaWidth - offset, yPos, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      const abX = panelX + panelWidth - 260;
      const abY = panelY + 20;
      ctx.strokeStyle = "rgba(47, 164, 122, 0.28)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(abX + 40, abY + 10);
      ctx.lineTo(abX + 18, abY + 32);
      ctx.moveTo(abX + 40, abY + 10);
      ctx.lineTo(abX + 62, abY + 32);
      ctx.moveTo(abX + 40, abY + 10);
      ctx.lineTo(abX + 40, abY + 64);
      ctx.stroke();
      ctx.fillStyle = "rgba(15, 111, 134, 0.3)";
      ctx.beginPath();
      ctx.arc(abX + 18, abY + 32, 4, 0, Math.PI * 2);
      ctx.arc(abX + 62, abY + 32, 4, 0, Math.PI * 2);
      ctx.arc(abX + 40, abY + 64, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      let x = panelX + padding;
      const headerTop = panelY + padding;
      const brandOffsetY = 6;
      let y = headerTop + brandOffsetY;

      const chipText = "BioCloudHub";
      ctx.font = "700 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      const chipWidth = ctx.measureText(chipText).width + 24;
      const chipGradient = ctx.createLinearGradient(x, y, x + chipWidth, y);
      chipGradient.addColorStop(0, "#0f6f86");
      chipGradient.addColorStop(1, "#32a578");
      ctx.fillStyle = chipGradient;
      drawRoundedRect(ctx, x, y, chipWidth, chipHeight, 999);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      ctx.textBaseline = "middle";
      ctx.fillText(chipText, x + 12, y + chipHeight / 2);

      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(13, 27, 42, 0.55)";
      ctx.font = "600 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      ctx.fillText(SHARE_CARD_META_TEXT, x, y + chipHeight + headerGap);
      ctx.textBaseline = "alphabetic";

      if (qrDataUrl) {
        const qrImage = new Image();
        qrImage.decoding = "async";
        const qrLoaded = new Promise<void>((resolve, reject) => {
          qrImage.onload = () => resolve();
          qrImage.onerror = () => reject(new Error("QR load failed"));
        });
        qrImage.src = qrDataUrl;
        await qrLoaded;

        const qrMargin = 10;
        const qrX = panelX + panelWidth - qrMargin - qrSize;
        const qrY = panelY + qrMargin;

        ctx.save();
        ctx.fillStyle = "#ffffff";
        drawRoundedRect(ctx, qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 12);
        ctx.fill();
        ctx.strokeStyle = "rgba(13, 27, 42, 0.12)";
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 12);
        ctx.stroke();
        ctx.restore();

        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

        if (logoDataUrl) {
          const logoImage = new Image();
          logoImage.decoding = "async";
          const logoLoaded = new Promise<void>((resolve, reject) => {
            logoImage.onload = () => resolve();
            logoImage.onerror = () => reject(new Error("Logo load failed"));
          });
          logoImage.src = logoDataUrl;
          await logoLoaded;

          const logoSize = 20;
          const logoX = qrX + (qrSize - logoSize) / 2;
          const logoY = qrY + (qrSize - logoSize) / 2;
          ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(13, 31, 54, 0.68)";
        ctx.font = "600 11px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
        ctx.fillText(SHARE_QR_CAPTION_TOP, qrX + qrSize / 2, qrY + qrSize + 4);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }

      const contentStartY = headerTop + brandOffsetY + headerVisualHeight + headerToQuestionGap;
      y = Math.max(contentStartY, topDividerY + 16);

      ctx.fillStyle = "#0f6f86";
      ctx.font = "700 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      ctx.fillText("问题", x, y);
      y += 18;

      ctx.fillStyle = "#0b2436";
      ctx.font = "600 26px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      questionLines.forEach((line) => {
        ctx.fillText(line, x, y);
        y += questionLineHeight;
      });

      y += dividerGap;

      ctx.fillStyle = "#0f6f86";
      ctx.font = "700 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      ctx.fillText("回答", x, y);
      y += 18;

      ctx.fillStyle = "#1b2c44";
      ctx.font = "400 18px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      answerLines.forEach((line) => {
        ctx.fillText(line, x, y);
        y += answerLineHeight;
      });

      ctx.fillStyle = "rgba(13, 31, 54, 0.56)";
      ctx.font = "600 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("BioCloudHub-分享", panelX + panelWidth - 16, panelY + panelHeight - 18);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/png");
      });

      if (!blob) {
        throw new Error("Failed to generate image blob");
      }

      return blob;
    };

    const buildShareCardContent = (
      question: string,
      answerHtml: string,
      qrDataUrl?: string,
      logoDataUrl?: string,
    ) => {
      const hasQr = Boolean(qrDataUrl);
      const shareRootPadding = 24;
      const shareRootBottomPadding = shareRootPadding + 18;
      const css = `
        ${katexCssText}

        .bc-share-root {
          position: relative;
          width: 100%;
          box-sizing: border-box;
          padding: ${shareRootPadding}px ${shareRootPadding}px ${shareRootBottomPadding}px;
          background:
            radial-gradient(1200px 600px at -10% -10%, rgba(36, 142, 201, 0.16), transparent 60%),
            radial-gradient(900px 520px at 110% 0%, rgba(13, 108, 184, 0.16), transparent 60%),
            linear-gradient(180deg, #eef5ff 0%, #f5f9ff 45%, #fbfdff 100%);
          font-family: "IBM Plex Sans", "PingFang SC", "Segoe UI", sans-serif;
          color: #0b2436;
          overflow: hidden;
        }
        .bc-share-blob {
          position: absolute;
          border-radius: 999px;
          filter: blur(1px);
          opacity: 0.46;
          z-index: 0;
        }
        .bc-share-blob.one {
          width: 240px;
          height: 240px;
          right: -60px;
          top: -80px;
          background: radial-gradient(circle, rgba(34, 134, 214, 0.2), rgba(34, 134, 214, 0));
        }
        .bc-share-blob.two {
          width: 260px;
          height: 260px;
          left: -80px;
          bottom: -100px;
          background: radial-gradient(circle, rgba(66, 156, 226, 0.18), rgba(66, 156, 226, 0));
        }
        .bc-share-card {
          position: relative;
          z-index: 1;
          background: linear-gradient(160deg, rgba(248, 254, 255, 0.99) 0%, rgba(242, 250, 248, 0.99) 56%, rgba(255, 255, 255, 0.99) 100%);
          border-radius: 22px;
          padding: 16px 24px 18px;
          border: 1px solid rgba(22, 53, 89, 0.24);
          overflow: hidden;
          margin-bottom: 0;
          box-shadow:
            0 8px 14px rgba(11, 21, 38, 0.13),
            0 2px 6px rgba(11, 21, 38, 0.08),
            0 0 0 1px rgba(16, 70, 124, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
        }
        .bc-share-card::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 92px;
          background: linear-gradient(120deg, rgba(14, 89, 164, 0.14), rgba(53, 132, 198, 0.08), transparent);
          opacity: 0.72;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-top-divider {
          position: absolute;
          left: 24px;
          right: 24px;
          top: 92px;
          height: 2px;
          background: linear-gradient(90deg, rgba(14, 89, 164, 0.5), rgba(53, 132, 198, 0.24), rgba(53, 132, 198, 0));
          opacity: 0.74;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-card::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 74px;
          background: linear-gradient(180deg, rgba(13, 108, 184, 0), rgba(13, 108, 184, 0.06));
          opacity: 0.7;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-content {
          position: relative;
          z-index: 2;
          padding-bottom: 14px;
        }
        .bc-share-root.has-qr .bc-share-content {
          padding-right: 0;
        }
        .bc-share-bio-net {
          position: absolute;
          right: 18px;
          top: 12px;
          width: 180px;
          height: 120px;
          opacity: 0.32;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-dna {
          position: absolute;
          left: 10px;
          top: 6px;
          width: 140px;
          height: 120px;
          opacity: 0.26;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-dna path,
        .bc-share-dna line {
          stroke: rgba(15, 111, 134, 0.45);
          stroke-width: 1.2;
          fill: none;
        }
        .bc-share-dna circle {
          fill: rgba(47, 164, 122, 0.4);
        }
        .bc-share-antibody {
          position: absolute;
          right: 130px;
          top: 6px;
          width: 120px;
          height: 120px;
          opacity: 0.24;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-antibody path {
          stroke: rgba(47, 164, 122, 0.5);
          stroke-width: 1.6;
          fill: none;
          stroke-linecap: round;
        }
        .bc-share-antibody circle {
          fill: rgba(15, 111, 134, 0.4);
        }
        .bc-share-bio-net line {
          stroke: rgba(15, 111, 134, 0.45);
          stroke-width: 1.2;
        }
        .bc-share-bio-net circle {
          fill: rgba(47, 164, 122, 0.55);
          stroke: rgba(15, 111, 134, 0.4);
          stroke-width: 0.8;
        }
        .bc-share-header {
          position: relative;
          display: block;
          margin-bottom: 0;
          padding-top: 6px;
        }
        .bc-share-brand {
          display: block;
        }
        .bc-share-root.has-qr .bc-share-header {
          padding-right: ${SHARE_QR_SIZE + 24}px;
        }
        .bc-share-brand-main {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .bc-share-brand-text {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          min-width: 0;
        }
        .bc-share-brand-logo-wrap {
          position: relative;
          display: inline-flex;
          width: 56px;
          height: 56px;
          border-radius: 12px;
          padding: 6px;
          box-sizing: border-box;
          background: linear-gradient(140deg, rgba(255, 255, 255, 0.99), rgba(237, 247, 251, 0.98));
          border: 1.2px solid rgba(15, 111, 134, 0.34);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.96),
            0 10px 18px rgba(13, 27, 42, 0.12),
            0 0 0 1px rgba(255, 255, 255, 0.64);
        }
        .bc-share-brand-logo {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          border-radius: 0;
          background: transparent;
          border: 0;
          box-sizing: border-box;
        }
        .bc-share-chip {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 6px 11px;
          border-radius: 999px;
          background: linear-gradient(132deg, #0c697f, #23906f 58%, #32b187 100%);
          color: #fff;
          font-size: 12.5px;
          font-weight: 720;
          letter-spacing: 0.015em;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.27),
            0 10px 22px rgba(15, 111, 134, 0.2);
        }
        .bc-share-meta {
          font-size: 12px;
          color: rgba(13, 27, 42, 0.56);
          font-weight: 600;
          letter-spacing: 0.01em;
          margin: 0;
        }
        .bc-share-label {
          font-size: 12px;
          color: #0f6f86;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 1px;
        }
        .bc-share-question-label {
          margin-top: 22px;
        }
        .bc-share-question {
          font-size: 25px;
          font-weight: 650;
          line-height: 1.32;
          color: #0b2436;
          margin-bottom: 6px;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .bc-share-root.has-qr .bc-share-question-label,
        .bc-share-root.has-qr .bc-share-question {
          max-width: calc(100% - ${SHARE_QR_SIZE + 18}px);
        }
        .bc-share-answer {
          font-size: 16px;
          line-height: 1.72;
          color: #1a314a;
          overflow-wrap: anywhere;
        }
        .bc-share-answer h1,
        .bc-share-answer h2,
        .bc-share-answer h3,
        .bc-share-answer h4 {
          margin: 12px 0 8px;
          font-weight: 650;
          color: #0b2436;
        }
        .bc-share-answer p {
          margin: 0 0 10px;
        }
        .bc-share-answer ul,
        .bc-share-answer ol {
          margin: 6px 0 10px;
          padding-left: 1.2em;
        }
        .bc-share-answer li {
          margin: 4px 0;
        }
        .bc-share-answer strong {
          color: #0d4255;
        }
        .bc-share-answer .katex-display,
        .bc-share-answer mjx-container[display="true"] {
          display: block;
          margin: 10px 0 14px;
          overflow-x: auto;
          overflow-y: hidden;
          text-align: center;
        }
        .bc-share-answer .katex,
        .bc-share-answer mjx-container {
          max-width: 100%;
          font-size: 1em;
        }
        .bc-share-answer .katex-display > .katex {
          display: inline-block;
          white-space: nowrap;
        }
        .bc-share-answer .katex .base {
          white-space: nowrap;
        }
        .bc-share-answer code {
          font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
          font-size: 0.9em;
          background: rgba(15, 111, 134, 0.09);
          border: 1px solid rgba(15, 111, 134, 0.18);
          padding: 2px 7px;
          border-radius: 6px;
          color: #12344e;
        }
        .bc-share-answer pre {
          margin: 8px 0 10px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid rgba(15, 111, 134, 0.22);
          background: linear-gradient(180deg, rgba(250, 253, 255, 0.98), rgba(240, 248, 255, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.9),
            0 8px 20px rgba(13, 27, 42, 0.07);
          color: #12344e;
          overflow: auto;
        }
        .bc-share-answer pre code {
          background: none;
          border: 0;
          padding: 0;
          color: inherit;
          font-size: 13px;
          line-height: 1.58;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .bc-share-answer .shiki,
        .bc-share-answer .vp-code {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
        }
        .bc-share-answer .shiki code,
        .bc-share-answer .vp-code code {
          white-space: pre !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }
        .bc-share-answer .shiki .line,
        .bc-share-answer .vp-code .line {
          display: block;
          white-space: pre;
          line-height: 1.58;
        }
        .bc-share-answer .language-mermaid .line,
        .bc-share-answer .language-flow .line {
          display: block;
          white-space: pre;
          line-height: 1.58;
          margin: 0;
          min-height: 0;
        }
        .bc-share-answer div[class^="language-"],
        .bc-share-answer div[class*=" language-"] {
          margin: 8px 0 10px;
          border-radius: 12px;
          border: 1px solid rgba(15, 111, 134, 0.24);
          background: linear-gradient(180deg, rgba(250, 253, 255, 0.99), rgba(240, 248, 255, 0.99));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.92),
            0 8px 20px rgba(13, 27, 42, 0.07);
          overflow: auto;
        }
        .bc-share-answer div[class^="language-"]::before,
        .bc-share-answer div[class*=" language-"]::before,
        .bc-share-answer div[class^="language-"]::after,
        .bc-share-answer div[class*=" language-"]::after {
          content: none !important;
          display: none !important;
        }
        .bc-share-answer div[class^="language-"] pre,
        .bc-share-answer div[class*=" language-"] pre {
          margin: 0;
          border: 0;
          border-radius: 0;
          box-shadow: none;
          background: transparent;
          padding: 10px 12px;
        }
        .bc-share-answer div[class^="language-"] code,
        .bc-share-answer div[class*=" language-"] code {
          border: 0;
          background: transparent;
          color: #12344e;
          padding: 0;
          font-size: 13px;
          line-height: 1.58;
          white-space: pre !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }
        .bc-share-answer div.bc-flow-compact,
        .bc-share-answer div[class^="language-"].bc-flow-compact,
        .bc-share-answer div[class*=" language-"].bc-flow-compact {
          margin: 0 !important;
          border-radius: 10px;
          overflow-x: auto;
          overflow-y: visible;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .bc-share-answer .bc-flow-compact::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }
        .bc-share-answer .bc-flow-compact pre {
          margin: 0 !important;
          padding: 8px 12px !important;
          overflow-x: auto;
          overflow-y: visible;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .bc-share-answer .bc-flow-compact pre::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }
        .bc-share-answer .bc-flow-compact code {
          display: block;
          margin: 0 !important;
          padding: 0 !important;
          font-size: 12px !important;
          line-height: 1.16 !important;
          letter-spacing: 0 !important;
          white-space: pre !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }
        .bc-share-answer .bc-flow-compact p {
          margin: 0 !important;
          padding: 0 !important;
          line-height: 1.16 !important;
        }
        .bc-share-answer .bc-flow-compact span {
          margin: 0 !important;
          padding: 0 !important;
          line-height: inherit !important;
        }
        .bc-share-answer .bc-flow-compact .line {
          display: block;
          line-height: 1.16 !important;
          margin: 0 !important;
          padding: 0 !important;
          min-height: 0 !important;
        }
        .bc-share-answer .bc-flow-compact .line:empty,
        .bc-share-answer .bc-flow-compact .line > span:empty {
          display: none !important;
        }
        .bc-share-answer .bc-flow-compact + * {
          margin-top: 0 !important;
        }
        .bc-share-answer .token.comment,
        .bc-share-answer .token.prolog,
        .bc-share-answer .token.doctype,
        .bc-share-answer .token.cdata {
          color: #6f7f92;
        }
        .bc-share-answer .token.punctuation,
        .bc-share-answer .token.operator {
          color: #4a6078;
        }
        .bc-share-answer .token.keyword,
        .bc-share-answer .token.atrule,
        .bc-share-answer .token.selector {
          color: #0f6f86;
          font-weight: 600;
        }
        .bc-share-answer .token.string,
        .bc-share-answer .token.attr-value {
          color: #2f7e4a;
        }
        .bc-share-answer .token.function,
        .bc-share-answer .token.class-name {
          color: #87550f;
        }
        .bc-share-answer .token.number,
        .bc-share-answer .token.boolean,
        .bc-share-answer .token.constant {
          color: #235db8;
        }
        .bc-share-answer .line-numbers-wrapper,
        .bc-share-answer .copy-code-button,
        .bc-share-answer .vp-copy-code-button,
        .bc-share-answer [class*="copy-code-button"],
        .bc-share-answer .line-numbers,
        .bc-share-answer .line-number,
        .bc-share-answer .code-block-title-bar,
        .bc-share-answer .collapsed-lines,
        .bc-share-answer [class*="line-numbers-mode"] .line-numbers-wrapper,
        .bc-share-answer [class*="line-numbers-mode"]::before,
        .bc-share-answer [class*="line-numbers-mode"]::after {
          display: none !important;
        }
        .bc-share-answer blockquote {
          margin: 10px 0 14px;
          padding: 8px 12px;
          border-left: 3px solid rgba(15, 111, 134, 0.6);
          background: rgba(15, 111, 134, 0.08);
          border-radius: 10px;
          color: #0d4255;
        }
        .bc-share-answer a {
          color: #0f6f86;
          text-decoration: none;
        }
        .bc-share-answer img {
          max-width: 100%;
          border-radius: 12px;
        }
        .bc-share-answer table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          margin: 10px 0 14px;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(13, 27, 42, 0.2);
          border-radius: 12px;
          overflow: hidden;
          font-size: 14px;
          line-height: 1.5;
        }
        .bc-share-answer th,
        .bc-share-answer td {
          border-right: 1px solid rgba(13, 27, 42, 0.16);
          border-bottom: 1px solid rgba(13, 27, 42, 0.16);
          padding: 6px 9px;
          text-align: left;
          vertical-align: top;
        }
        .bc-share-answer table tr > :last-child {
          border-right: 0;
        }
        .bc-share-answer table tr:last-child > :is(th, td) {
          border-bottom: 0;
        }
        .bc-share-answer th {
          background: rgba(15, 111, 134, 0.08);
          color: #0b2436;
          font-weight: 600;
          text-align: center;
          border-radius: 0;
        }
        .bc-share-answer .table-container,
        .bc-share-answer .chart-container,
        .bc-share-answer .echarts-container {
          border: 1px solid rgba(13, 27, 42, 0.16);
          border-radius: 12px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.94);
          margin: 10px 0 14px;
          box-sizing: border-box;
          overflow: hidden;
        }
        .bc-share-answer .table-container table {
          margin: 0;
          border-radius: 10px;
        }
        .bc-share-answer > *:last-child {
          margin-bottom: 0 !important;
        }
        .bc-share-footer {
          position: relative;
          z-index: 2;
          margin-top: 8px;
          text-align: right;
          font-size: 12px;
          color: rgba(13, 31, 54, 0.58);
          font-weight: 600;
          line-height: 1.45;
          letter-spacing: 0.02em;
          pointer-events: none;
        }
        .bc-share-qr-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          position: absolute;
          right: 10px;
          top: 10px;
          z-index: 3;
          width: ${SHARE_QR_SIZE + 8}px;
        }
        .bc-share-qr {
          position: relative;
          width: ${SHARE_QR_SIZE}px;
          height: ${SHARE_QR_SIZE}px;
          padding: 6px;
          border-radius: 16px;
          background: linear-gradient(145deg, #ffffff, #f4fbff);
          border: 1px solid rgba(13, 27, 42, 0.14);
          box-shadow: 0 12px 24px rgba(11, 21, 38, 0.12);
          box-sizing: border-box;
        }
        .bc-share-qr-img {
          width: 100%;
          height: 100%;
          display: block;
          border-radius: 10px;
          object-fit: contain;
        }
        .bc-share-qr-logo {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          border-radius: 0;
          background: transparent;
          padding: 0;
          box-shadow: none;
          box-sizing: border-box;
        }
        .bc-share-qr-caption {
          width: 100%;
          text-align: center;
          font-size: 10px;
          line-height: 1.2;
          color: rgba(13, 31, 54, 0.62);
          letter-spacing: 0.01em;
        }
      `;
      const qrBlock = hasQr
        ? `
          <div class="bc-share-qr-wrap">
            <div class="bc-share-qr">
              <img class="bc-share-qr-img" src="${qrDataUrl}" alt="QR code" />
              ${logoDataUrl ? `<img class="bc-share-qr-logo" src="${logoDataUrl}" alt="" />` : ""}
            </div>
            <div class="bc-share-qr-caption">${SHARE_QR_CAPTION_TOP}</div>
          </div>
        `
        : "";
      const html = `
        <div class="bc-share-root${hasQr ? " has-qr" : ""}">
          <div class="bc-share-blob one"></div>
          <div class="bc-share-blob two"></div>
          <div class="bc-share-card">
            <svg class="bc-share-dna" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <path d="M20 10 C50 25 50 45 20 60 C-10 75 -10 95 20 110"></path>
              <path d="M80 10 C50 25 50 45 80 60 C110 75 110 95 80 110"></path>
              <line x1="28" y1="22" x2="72" y2="22"></line>
              <line x1="18" y1="42" x2="82" y2="42"></line>
              <line x1="20" y1="62" x2="80" y2="62"></line>
              <line x1="18" y1="82" x2="82" y2="82"></line>
              <line x1="28" y1="102" x2="72" y2="102"></line>
              <circle cx="20" cy="10" r="3.2"></circle>
              <circle cx="80" cy="10" r="3.2"></circle>
              <circle cx="20" cy="110" r="3.2"></circle>
              <circle cx="80" cy="110" r="3.2"></circle>
            </svg>
            <svg class="bc-share-antibody" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <path d="M60 18 L35 44"></path>
              <path d="M60 18 L85 44"></path>
              <path d="M60 18 L60 86"></path>
              <circle cx="35" cy="44" r="4"></circle>
              <circle cx="85" cy="44" r="4"></circle>
              <circle cx="60" cy="86" r="4"></circle>
            </svg>
            <div class="bc-share-top-divider"></div>
            <svg class="bc-share-bio-net" viewBox="0 0 200 120" aria-hidden="true" focusable="false">
              <line x1="20" y1="84" x2="74" y2="42"></line>
              <line x1="74" y1="42" x2="140" y2="62"></line>
              <line x1="74" y1="42" x2="96" y2="96"></line>
              <line x1="140" y1="62" x2="176" y2="30"></line>
              <circle cx="20" cy="84" r="4"></circle>
              <circle cx="74" cy="42" r="4.6"></circle>
              <circle cx="140" cy="62" r="4"></circle>
              <circle cx="96" cy="96" r="3.6"></circle>
              <circle cx="176" cy="30" r="3.2"></circle>
            </svg>
            <div class="bc-share-content">
              <div class="bc-share-header">
                <div class="bc-share-brand">
                  <div class="bc-share-brand-main">
                    ${logoDataUrl ? `<span class="bc-share-brand-logo-wrap"><img class="bc-share-brand-logo" src="${logoDataUrl}" alt="BioCloudHub logo" /></span>` : ""}
                    <div class="bc-share-brand-text">
                      <div class="bc-share-chip">BioCloudHub</div>
                      <div class="bc-share-meta">${SHARE_CARD_META_TEXT}</div>
                    </div>
                  </div>
                </div>
                ${qrBlock}
              </div>
              <div class="bc-share-label bc-share-question-label">问题</div>
              <div class="bc-share-question">${escapeHtml(question)}</div>
              <div class="bc-share-label">回答</div>
              <div class="bc-share-answer">${answerHtml}</div>
            </div>
            <div class="bc-share-footer">BioCloudHub-分享</div>
          </div>
        </div>
      `;
      return { css, html };
    };

    const measureShareCardHeight = (markup: { css: string; html: string }, width: number) => {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = `${width}px`;
      container.style.visibility = "hidden";
      container.style.pointerEvents = "none";
      container.innerHTML = `<style>${markup.css}</style>${markup.html}`;
      document.body.append(container);
      // Force layout before measuring to reduce underestimation on complex content blocks.
      void container.offsetHeight;
      const root = container.querySelector<HTMLElement>(".bc-share-root");
      const rootRect = root?.getBoundingClientRect();
      const rootHeight = rootRect ? Math.ceil(rootRect.height) : 0;
      const rootOffsetHeight = root ? Math.ceil(root.offsetHeight) : 0;
      // Keep top/bottom spacing symmetric, while ignoring decorative absolute layers
      // that may inflate scrollHeight and create extra blank area at the bottom.
      const height = Math.max(rootHeight, rootOffsetHeight);
      container.remove();
      return height;
    };

    const renderShareCardImage = async (
      markup: { css: string; html: string },
      width: number,
      height: number,
    ): Promise<Blob> => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;">
              <style>${markup.css}</style>
              ${markup.html}
            </div>
          </foreignObject>
        </svg>
      `;
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const image = new Image();
      image.decoding = "async";

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("SVG render failed"));
        image.src = svgUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Canvas context unavailable");
      }

      ctx.scale(dpr, dpr);
      ctx.drawImage(image, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/png");
      });

      if (!blob) {
        throw new Error("Failed to generate image blob");
      }

      return blob;
    };

    const copyCardAsImage = async (card: HTMLElement): Promise<void> => {
      const heading = findClosestHeading(card);
      const question =
        heading?.textContent?.trim() ||
        document.querySelector(".vp-page-title h1")?.textContent?.trim() ||
        "问题";
      const answerText = extractAnswerText(card) || "（暂无内容）";
      const answerHtml = extractAnswerHtml(card) || escapeHtml(answerText);

      showToast("正在生成分享卡片…", "info");
      await waitForDocumentFonts();

      try {
        const shareUrl = buildShareQrValue();
        let qrDataUrl = "";
        let logoDataUrl = "";

        try {
          qrDataUrl = await getQrDataUrl(shareUrl);
        } catch {
          qrDataUrl = "";
        }

        try {
          logoDataUrl = await getLogoDataUrl();
        } catch {
          logoDataUrl = "";
        }

        const width = 860;
        const markup = buildShareCardContent(question, answerHtml, qrDataUrl, logoDataUrl);
        const height = measureShareCardHeight(markup, width);
        const blob = await renderShareCardImage(markup, width, height);

        if (navigator.clipboard && "write" in navigator.clipboard && "ClipboardItem" in window) {
          const item = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([item]);
          showToast("已复制图片到剪贴板", "success");
          return;
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "biocloudhub-answer.png";
        anchor.click();
        URL.revokeObjectURL(url);
        showToast("已生成图片文件", "success");
      } catch (error) {
        try {
          const shareUrl = buildShareQrValue();
          let qrDataUrl = "";
          let logoDataUrl = "";

          try {
            qrDataUrl = await getQrDataUrl(shareUrl);
          } catch {
            qrDataUrl = "";
          }

          try {
            logoDataUrl = await getLogoDataUrl();
          } catch {
            logoDataUrl = "";
          }

          const blob = await buildShareImageCanvas(question, answerText, qrDataUrl, logoDataUrl);
          if (navigator.clipboard && "write" in navigator.clipboard && "ClipboardItem" in window) {
            const item = new ClipboardItem({ "image/png": blob });
            await navigator.clipboard.write([item]);
            showToast("已复制图片到剪贴板", "success");
            return;
          }
        } catch {
          // ignore fallback errors
        }
        showToast("生成图片失败，请重试", "error");
      }
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

    const syncNavTooltips = (): void => {
      document.querySelectorAll<HTMLElement>(NAV_TOOLTIP_SELECTOR).forEach((element) => {
        const ariaLabel = element.getAttribute("aria-label");
        const text = ariaLabel ?? element.textContent ?? "";
        const normalized = text.replace(/\s+/gu, " ").trim();

        if (!normalized) return;

        if (element.getAttribute("title") !== normalized) {
          element.setAttribute("title", normalized);
        }
      });
    };

    const runHierarchyFormatting = (): void => {
      ensureSidebarAccent();
      formatHierarchyLabels();
      syncNavTooltips();
    };

    const withSuppressedSidebarNavigation = (task: () => void): void => {
      suppressSidebarNavigation = true;
      try {
        task();
      } finally {
        suppressSidebarNavigation = false;
      }
    };

    const isHeaderPathActive = (header: HTMLElement): boolean => {
      const headerLink = header.querySelector<HTMLAnchorElement>(".vp-sidebar-title[href]");

      if (!headerLink) return false;

      const headerPath = toSidebarRoutePath(headerLink.getAttribute("href") ?? "");
      const currentPath = normalizeSidebarPath(router.currentRoute.value.path);

      if (!headerPath || !currentPath) return false;

      const normalizedHeader = stripPageExtension(headerPath);
      const normalizedCurrent = stripPageExtension(currentPath);

      return (
        normalizedCurrent === normalizedHeader ||
        normalizedCurrent.startsWith(`${normalizedHeader}-`)
      );
    };

    const expandActiveSidebarHeadersOnce = (): boolean => {
      let changed = false;

      document
        .querySelectorAll<HTMLElement>(SIDEBAR_CLICKABLE_HEADER_SELECTOR)
        .forEach((header) => {
          if (
            !header.classList.contains("active") &&
            !header.classList.contains("exact") &&
            !isHeaderPathActive(header)
          ) {
            return;
          }

          if (header.querySelector(".vp-arrow") === null) return;
          if (isHeaderExpanded(header)) return;

          withSuppressedSidebarNavigation(() => {
            header.click();
          });
          changed = true;
        });

      return changed;
    };

    const autoExpandSidebarHeaders = (): void => {
      const attempt = (remaining: number): void => {
        const changed = expandActiveSidebarHeadersOnce();

        if (changed && remaining > 0) {
          window.requestAnimationFrame(() => {
            attempt(remaining - 1);
          });
        }
      };

      attempt(2);
    };

    const scheduleHierarchyFormatting = (): void => {
      if (hierarchyFormatted) return;

      if (hierarchyFormatFrame) {
        window.cancelAnimationFrame(hierarchyFormatFrame);
      }

      if (hierarchyFormatTimer) {
        window.clearTimeout(hierarchyFormatTimer);
      }

      hierarchyFormatFrame = window.requestAnimationFrame(() => {
        hierarchyFormatFrame = 0;
        runHierarchyFormatting();
        hierarchyFormatted = true;
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
        if (suppressSidebarNavigation) return;
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const copyChip = event.target.closest<HTMLElement>(COPY_CHIP_SELECTOR);

        if (copyChip) {
          const card = copyChip.closest<HTMLElement>(CARD_SELECTOR);

          if (card) {
            event.preventDefault();
            event.stopPropagation();
            void copyCardAsImage(card);
          }
          return;
        }

        const titleLink = event.target.closest<HTMLAnchorElement>(SIDEBAR_TITLE_LINK_SELECTOR);
        const header = event.target.closest<HTMLElement>(SIDEBAR_CLICKABLE_HEADER_SELECTOR);

        if (!titleLink && !header) return;

        // If the click is on a nested item (L2/L3), closest() may have walked up
        // to the L1 button. Ignore — these clicks should reach the link natively.
        if (header && event.target.closest(".vp-sidebar-group .vp-sidebar-group")) {
          return;
        }

        // Only intercept when we need to expand a collapsed parent before navigating.
        // Otherwise let Vue Router / the theme handle the click natively — much faster.
        if (titleLink) {
          const needsExpand =
            header?.querySelector(".vp-arrow") !== null &&
            !isHeaderExpanded(header);

          if (!needsExpand) return;

          const targetPath = toSidebarRoutePath(titleLink.getAttribute("href") ?? "");

          event.preventDefault();
          event.stopPropagation();

          withSuppressedSidebarNavigation(() => {
            header!.click();
          });
          enforceAccordion();
          header!.classList.add("bc-sidebar-expanding");
          window.setTimeout(() => {
            header!.classList.remove("bc-sidebar-expanding");
          }, 250);

          if (targetPath && targetPath !== normalizeSidebarPath(router.currentRoute.value.path)) {
            window.requestAnimationFrame(() => {
              void router.push(targetPath);
            });
          }

          return;
        }

        if (header) {
          const isCollapsibleHeader = header.querySelector(".vp-arrow") !== null;
          const alreadyExpanded = isHeaderExpanded(header);

          // If already expanded, the theme will handle the collapse — don't intercept
          if (alreadyExpanded) return;

          const headerLink = header.querySelector<HTMLAnchorElement>(
            ".vp-sidebar-title[href]",
          );

          if (!headerLink) return;

          const targetPath = toSidebarRoutePath(headerLink.getAttribute("href") ?? "");

          event.preventDefault();
          event.stopPropagation();

          withSuppressedSidebarNavigation(() => {
            header.click();
          });
          enforceAccordion();
          header.classList.add("bc-sidebar-expanding");
          window.setTimeout(() => {
            header.classList.remove("bc-sidebar-expanding");
          }, 250);

          if (targetPath && targetPath !== normalizeSidebarPath(router.currentRoute.value.path)) {
            window.requestAnimationFrame(() => {
              void router.push(targetPath);
            });
          }
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


    let readingProgressScrollHandler: (() => void) | null = null;

    const installReadingProgressBar = (): void => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

      if (!sidebar) return;

      // Clean old progress bars & percentage
      sidebar
        .querySelectorAll(".bc-sidebar-reading-progress, .bc-sidebar-reading-pct")
        .forEach((el) => el.remove());

      // Remove old scroll handler
      if (readingProgressScrollHandler) {
        window.removeEventListener("scroll", readingProgressScrollHandler);
        document.querySelector(".vp-page")?.removeEventListener("scroll", readingProgressScrollHandler);
        readingProgressScrollHandler = null;
      }

      const activeLink = sidebar.querySelector<HTMLElement>(
        ".vp-sidebar-link.active",
      );

      if (!activeLink) return;

      const progressBar = document.createElement("div");
      const progressPct = document.createElement("span");

      progressBar.className = "bc-sidebar-reading-progress";
      progressBar.style.transition = "none";
      progressPct.className = "bc-sidebar-reading-pct";
      activeLink.appendChild(progressBar);
      activeLink.appendChild(progressPct);

      let progressRaf = 0;

      /* detect the actual scroll container: .vp-page or the document */
      const scrollEl: Element | Window =
        (() => {
          const page = document.querySelector<HTMLElement>(".vp-page");
          if (page && page.clientHeight < page.scrollHeight) return page;
          if (document.documentElement.clientHeight < document.documentElement.scrollHeight)
            return window;
          return page ?? window;
        })();

      const getScrollY = (): number =>
        scrollEl instanceof Window ? scrollEl.scrollY : (scrollEl as HTMLElement).scrollTop;

      const getScrollMax = (): number =>
        scrollEl instanceof Window
          ? document.documentElement.scrollHeight - window.innerHeight
          : (scrollEl as HTMLElement).scrollHeight - (scrollEl as HTMLElement).clientHeight;

      const applyProgress = (): void => {
        const max = getScrollMax();
        if (max <= 0) {
          progressBar.style.width = "0%";
          progressPct.textContent = "";
          return;
        }

        const pct = Math.round(Math.min((getScrollY() / max) * 100, 100));
        progressBar.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
      };

      const scheduleProgress = (): void => {
        if (progressRaf) return;
        progressRaf = window.requestAnimationFrame(() => {
          progressRaf = 0;
          applyProgress();
        });
      };

      readingProgressScrollHandler = scheduleProgress;
      scrollEl.addEventListener("scroll", scheduleProgress, { passive: true });
      applyProgress();
    };

    const scrollToActiveSidebarItem = (retries = 4): void => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

      if (!sidebar) return;

      const activeLink = sidebar.querySelector<HTMLElement>(
        ".vp-sidebar-link.active",
      );

      if (!activeLink) {
        if (retries > 0) {
          window.requestAnimationFrame(() =>
            scrollToActiveSidebarItem(retries - 1),
          );
        }
        return;
      }

      const sidebarRect = sidebar.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const topMargin = 30;
      const bottomMargin = 80;

      // Already visible with comfortable margins — don't scroll
      if (
        linkRect.top >= sidebarRect.top + topMargin &&
        linkRect.bottom <= sidebarRect.bottom - bottomMargin
      ) {
        return;
      }

      // Position the active item at roughly 30% from the top of the sidebar viewport
      const targetScrollTop =
        sidebar.scrollTop +
        linkRect.top -
        sidebarRect.top -
        sidebarRect.height * 0.3;

      sidebar.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: "smooth",
      });
    };

    let scrollToActiveTimer = 0;

    window.addEventListener(
      "resize",
      () => {
        window.clearTimeout(scrollToActiveTimer);
        scrollToActiveTimer = window.setTimeout(scrollToActiveSidebarItem, 200);
      },
      { passive: true },
    );

    const runSidebarRefresh = (): void => {
      scheduleHierarchyFormatting();

      if (!sidebarFirstLoaded) {
        sidebarFirstLoaded = true;
        afterNextPaint(() => {
          document
            .querySelectorAll<HTMLElement>(SIDEBAR_SELECTOR)
            .forEach((s) => s.classList.add("bc-sidebar-loaded"));
        });
      }

      enforceAccordion();
      requestAnimationFrame(() => {
        scrollToActiveSidebarItem();
        installReadingProgressBar();
      });
    };

    window.addEventListener(
      HIERARCHY_READY_EVENT,
      () => {
        runSidebarRefresh();
      },
      { once: true },
    );

    syncTaxonomyLayout();

    router.afterEach((to) => {
      updateTaxonomyLayout(to.path);
      runSidebarRefresh();
    });
  },
});
