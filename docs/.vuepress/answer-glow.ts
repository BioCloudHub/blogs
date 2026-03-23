import { onMounted } from "vue";
import { defineClientConfig } from "vuepress/client";

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
    let suppressSidebarNavigation = false;
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
      const logoUrl = new URL("logo.png", baseUrl);
      const response = await fetch(logoUrl.toString());

      if (!response.ok) {
        throw new Error("Logo fetch failed");
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      cachedLogoDataUrl = dataUrl;
      return dataUrl;
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
        errorCorrectionLevel: "H",
        width: 240,
        margin: 1,
        color: {
          dark: "#0b2436",
          light: "#ffffff",
        },
      });

      cachedQrDataUrl = dataUrl;
      cachedQrValue = value;
      return dataUrl;
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
      const width = 980;
      const padding = 42;
      const panelInset = 20;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const qrSize = qrDataUrl ? 80 : 0;
      const maxTextWidth = width - padding * 2 - panelInset * 2;

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
      const headerHeight = Math.max(qrSize, chipHeight + headerGap + metaLineHeight);
      const headerToQuestionGap = 12;
      const topGap = headerToQuestionGap;
      const dividerGap = 4;
      const footerGap = 28;

      let height =
        panelInset * 2 +
        padding * 2 +
        headerHeight +
        topGap +
        questionLines.length * questionLineHeight +
        dividerGap +
        answerLines.length * answerLineHeight +
        footerGap;

      height = Math.max(height, 380);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);

      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#f1f8fd");
      bg.addColorStop(0.5, "#f8fbff");
      bg.addColorStop(1, "#ffffff");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const glowLeft = ctx.createRadialGradient(60, 40, 0, 180, 140, 520);
      glowLeft.addColorStop(0, "rgba(47, 164, 122, 0.2)");
      glowLeft.addColorStop(1, "rgba(47, 164, 122, 0)");
      ctx.fillStyle = glowLeft;
      ctx.fillRect(0, 0, width, height);

      const glowRight = ctx.createRadialGradient(width - 60, 40, 0, width - 220, 180, 520);
      glowRight.addColorStop(0, "rgba(15, 111, 134, 0.22)");
      glowRight.addColorStop(1, "rgba(15, 111, 134, 0)");
      ctx.fillStyle = glowRight;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(15, 155, 215, 0.1)";
      ctx.beginPath();
      ctx.arc(width - 120, 90, 120, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(60, 165, 109, 0.08)";
      ctx.beginPath();
      ctx.arc(120, height - 100, 140, 0, Math.PI * 2);
      ctx.fill();

      const panelX = panelInset;
      const panelY = panelInset;
      const panelWidth = width - panelInset * 2;
      const panelHeight = height - panelInset * 2;

      ctx.save();
      ctx.shadowColor = "rgba(11, 21, 38, 0.12)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      const cardFill = ctx.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + panelHeight);
      cardFill.addColorStop(0, "rgba(247, 253, 255, 0.98)");
      cardFill.addColorStop(0.6, "rgba(242, 250, 248, 0.98)");
      cardFill.addColorStop(1, "rgba(255, 255, 255, 0.98)");
      ctx.fillStyle = cardFill;
      drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 20);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(13, 27, 42, 0.08)";
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 20);
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 20);
      ctx.clip();
      const topWash = ctx.createLinearGradient(panelX, panelY, panelX, panelY + 90);
      topWash.addColorStop(0, "rgba(15, 111, 134, 0.12)");
      topWash.addColorStop(1, "rgba(15, 111, 134, 0)");
      ctx.fillStyle = topWash;
      ctx.fillRect(panelX, panelY, panelWidth, 90);

      const topDividerY = panelY + 84;
      const topDividerX = panelX + 24;
      const topDividerWidth = panelWidth - 48;
      const topDividerGradient = ctx.createLinearGradient(topDividerX, topDividerY, topDividerX + topDividerWidth, topDividerY);
      topDividerGradient.addColorStop(0, "rgba(15, 111, 134, 0.6)");
      topDividerGradient.addColorStop(0.6, "rgba(47, 164, 122, 0.35)");
      topDividerGradient.addColorStop(1, "rgba(47, 164, 122, 0)");
      ctx.strokeStyle = topDividerGradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(topDividerX, topDividerY);
      ctx.lineTo(topDividerX + topDividerWidth, topDividerY);
      ctx.stroke();

      const bottomWash = ctx.createLinearGradient(panelX, panelY + panelHeight - 80, panelX, panelY + panelHeight);
      bottomWash.addColorStop(0, "rgba(15, 111, 134, 0)");
      bottomWash.addColorStop(1, "rgba(15, 111, 134, 0.08)");
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
      let y = headerTop;

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
      ctx.fillText("专业问答分享卡片", x, y + chipHeight + headerGap);
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

        const qrX = panelX + panelWidth - padding - qrSize;
        const qrY = headerTop + (headerHeight - qrSize) / 2;

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

          const logoSize = 22;
          const logoX = qrX + (qrSize - logoSize) / 2;
          const logoY = qrY + (qrSize - logoSize) / 2;
          ctx.save();
          ctx.fillStyle = "#ffffff";
          drawRoundedRect(ctx, logoX - 4, logoY - 4, logoSize + 8, logoSize + 8, 6);
          ctx.fill();
          ctx.strokeStyle = "rgba(13, 27, 42, 0.12)";
          ctx.lineWidth = 1;
          drawRoundedRect(ctx, logoX - 4, logoY - 4, logoSize + 8, logoSize + 8, 6);
          ctx.stroke();
          ctx.restore();
          ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
        }
      }

      y = headerTop + headerHeight + headerToQuestionGap;

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

      ctx.fillStyle = "rgba(13, 27, 42, 0.45)";
      ctx.font = "600 12px \"IBM Plex Sans\", \"PingFang SC\", sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("BioCloudHub · 分享", x, panelY + panelHeight - 24);

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
      const css = `
        .bc-share-root {
          position: relative;
          width: 100%;
          box-sizing: border-box;
          padding: 26px;
          background:
            radial-gradient(1200px 600px at -10% -10%, rgba(47, 164, 122, 0.18), transparent 60%),
            radial-gradient(900px 520px at 110% 0%, rgba(15, 111, 134, 0.22), transparent 60%),
            linear-gradient(180deg, #f1f8fd 0%, #f8fbff 45%, #ffffff 100%);
          font-family: "IBM Plex Sans", "PingFang SC", "Segoe UI", sans-serif;
          color: #0b2436;
          overflow: hidden;
        }
        .bc-share-blob {
          position: absolute;
          border-radius: 999px;
          filter: blur(2px);
          opacity: 0.6;
          z-index: 0;
        }
        .bc-share-blob.one {
          width: 240px;
          height: 240px;
          right: -60px;
          top: -80px;
          background: radial-gradient(circle, rgba(15, 155, 215, 0.22), rgba(15, 155, 215, 0));
        }
        .bc-share-blob.two {
          width: 260px;
          height: 260px;
          left: -80px;
          bottom: -100px;
          background: radial-gradient(circle, rgba(58, 165, 115, 0.2), rgba(58, 165, 115, 0));
        }
        .bc-share-card {
          position: relative;
          z-index: 1;
          background: linear-gradient(160deg, rgba(247, 253, 255, 0.98) 0%, rgba(242, 250, 248, 0.98) 60%, rgba(255, 255, 255, 0.98) 100%);
          border-radius: 20px;
          padding: 30px;
          border: 1px solid rgba(13, 27, 42, 0.06);
          overflow: hidden;
          box-shadow:
            0 18px 40px rgba(11, 21, 38, 0.08),
            0 0 0 1px rgba(15, 111, 134, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }
        .bc-share-card::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 84px;
          background: linear-gradient(120deg, rgba(15, 111, 134, 0.18), rgba(47, 164, 122, 0.1), transparent);
          opacity: 0.6;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-top-divider {
          position: absolute;
          left: 24px;
          right: 24px;
          top: 84px;
          height: 2px;
          background: linear-gradient(90deg, rgba(15, 111, 134, 0.6), rgba(47, 164, 122, 0.35), rgba(47, 164, 122, 0));
          opacity: 0.7;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-card::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 64px;
          background: linear-gradient(180deg, rgba(15, 111, 134, 0), rgba(15, 111, 134, 0.08));
          opacity: 0.6;
          z-index: 1;
          pointer-events: none;
        }
        .bc-share-content {
          position: relative;
          z-index: 2;
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
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 0;
        }
        .bc-share-brand {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bc-share-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: linear-gradient(135deg, #0f6f86, #2fa47a);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.25),
            0 8px 18px rgba(15, 111, 134, 0.18);
        }
        .bc-share-meta {
          font-size: 12px;
          color: rgba(13, 27, 42, 0.55);
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .bc-share-label {
          font-size: 12px;
          color: #0f6f86;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .bc-share-question {
          font-size: 24px;
          font-weight: 650;
          line-height: 1.35;
          color: #0b2436;
          margin-bottom: 10px;
        }
        .bc-share-answer {
          font-size: 16px;
          line-height: 1.7;
          color: #1b2c44;
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
        .bc-share-answer code {
          font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
          font-size: 0.95em;
          background: rgba(13, 27, 42, 0.06);
          padding: 2px 6px;
          border-radius: 6px;
        }
        .bc-share-answer pre {
          background: rgba(13, 27, 42, 0.05);
          padding: 10px 12px;
          border-radius: 10px;
          overflow: hidden;
          margin: 8px 0 12px;
        }
        .bc-share-answer pre code {
          background: none;
          padding: 0;
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
        .bc-share-footer {
          margin-top: 16px;
          text-align: right;
          font-size: 12px;
          color: rgba(13, 27, 42, 0.45);
          font-weight: 600;
        }
        .bc-share-qr-wrap {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .bc-share-qr {
          position: relative;
          width: 80px;
          height: 80px;
          padding: 4px;
          border-radius: 11px;
          background: #ffffff;
          border: 1px solid rgba(13, 27, 42, 0.12);
          box-shadow: 0 8px 18px rgba(11, 21, 38, 0.08);
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
          width: 20px;
          height: 20px;
          border-radius: 6px;
          background: #ffffff;
          padding: 3px;
          box-shadow: 0 0 0 1px rgba(13, 27, 42, 0.12);
          box-sizing: border-box;
        }
      `;
      const qrBlock = hasQr
        ? `
          <div class="bc-share-qr-wrap">
            <div class="bc-share-qr">
              <img class="bc-share-qr-img" src="${qrDataUrl}" alt="QR code" />
              ${logoDataUrl ? `<img class="bc-share-qr-logo" src="${logoDataUrl}" alt="" />` : ""}
            </div>
          </div>
        `
        : "";
      const html = `
        <div class="bc-share-root">
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
                  <div class="bc-share-chip">BioCloudHub</div>
                  <div class="bc-share-meta">专业问答分享卡片</div>
                </div>
                ${qrBlock}
              </div>
              <div class="bc-share-label">问题</div>
              <div class="bc-share-question">${escapeHtml(question)}</div>
            <div class="bc-share-label">回答</div>
              <div class="bc-share-answer">${answerHtml}</div>
              <div class="bc-share-footer">BioCloudHub · 分享</div>
            </div>
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
      const height = Math.ceil(container.scrollHeight);
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
            <div xmlns="http://www.w3.org/1999/xhtml">
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

      try {
        const shareUrl = window.location.href;
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

        const width = 980;
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
          const shareUrl = window.location.href;
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

      attempt(4);
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

        if (titleLink) {
          const targetPath = toSidebarRoutePath(titleLink.getAttribute("href") ?? "");
          const currentPath = normalizeSidebarPath(router.currentRoute.value.path);
          const isCollapsibleHeader = header?.querySelector(".vp-arrow") !== null;

          event.preventDefault();
          event.stopPropagation();

          if (header && isCollapsibleHeader && !isHeaderExpanded(header)) {
            withSuppressedSidebarNavigation(() => {
              header.click();
            });
          }

          if (!targetPath || targetPath === currentPath) return;

          void router.push(targetPath).catch(() => {
            // Ignore duplicated navigations and cancelled transitions.
          });

          return;
        }

        if (header) {
          const headerLink = header.querySelector<HTMLAnchorElement>(
            ".vp-sidebar-title[href]",
          );

          if (!headerLink) return;

          const targetPath = toSidebarRoutePath(headerLink.getAttribute("href") ?? "");
          const currentPath = normalizeSidebarPath(router.currentRoute.value.path);
          const isCollapsibleHeader = header.querySelector(".vp-arrow") !== null;

          event.preventDefault();
          event.stopPropagation();

          if (isCollapsibleHeader && !isHeaderExpanded(header)) {
            withSuppressedSidebarNavigation(() => {
              header.click();
            });
          }

          if (!targetPath || targetPath === currentPath) return;

          void router.push(targetPath).catch(() => {
            // Ignore duplicated navigations and cancelled transitions.
          });
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


    const runSidebarRefresh = (): void => {
      scheduleHierarchyFormatting();
      afterNextPaint(() => {
        autoExpandSidebarHeaders();
        afterNextPaint(autoExpandSidebarHeaders);
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
      afterNextPaint(runSidebarRefresh);
    });
  },
});
