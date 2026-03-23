import { defineClientConfig } from "vuepress/client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const HOME_ROOT_SELECTOR = "main.vp-project-home";
const REVEAL_SELECTOR = [
  "header.vp-hero-info-wrapper",
  ".vp-feature-item",
  ".home-intro",
  ".home-hero-extensions",
  ".bio-3d-stage",
  ".bio-3d-container",
  ".metric-card",
  ".track-card",
  "#markdown-content h2",
  "#markdown-content ul",
].join(", ");
const HOVER_CARD_SELECTOR = ".metric-card, .track-card, .vp-feature-item";
const METRIC_VALUE_SELECTOR = ".metric-card h3";
const HERO_SELECTOR = "header.vp-hero-info-wrapper";

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const prefersFinePointer = (): boolean =>
  window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? false;

const afterNextPaint = (task: () => void): void => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(task);
  });
};

export default defineClientConfig({
  enhance({ router }) {
    if (typeof document === "undefined") return;
    gsap.registerPlugin(ScrollTrigger);

    let metricObserver: IntersectionObserver | null = null;
    const revealTriggers: ScrollTrigger[] = [];
    const animatedMetrics = new WeakSet<HTMLElement>();
    const boundHoverCards = new WeakSet<HTMLElement>();
    const boundHero = new WeakSet<HTMLElement>();

    const setupReveal = (root: Element): void => {
      const items = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
      if (!items.length) return;
      revealTriggers.forEach((trigger) => trigger.kill());
      revealTriggers.length = 0;

      items.forEach((item, index) => {
        item.classList.add("bc-reveal");
        const delay = Math.min(index * 70, 420);
        item.style.setProperty("--bc-reveal-delay", `${delay}ms`);
      });

      if (prefersReducedMotion()) {
        items.forEach((item) => {
          item.classList.add("bc-reveal-visible");
          item.style.removeProperty("opacity");
          item.style.removeProperty("transform");
        });
        return;
      }

      gsap.set(items, {
        opacity: 0,
        y: 28,
        scale: 0.98,
        transformOrigin: "50% 50%",
        willChange: "transform, opacity",
      });

      items.forEach((item, index) => {
        const trigger = ScrollTrigger.create({
          trigger: item,
          start: "top 88%",
          once: true,
          onEnter: () => {
            item.classList.add("bc-reveal-visible");
            gsap.to(item, {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.72,
              delay: Math.min(index * 0.04, 0.2),
              ease: "power3.out",
              clearProps: "willChange",
            });
          },
        });
        revealTriggers.push(trigger);
      });
    };

    const setupHoverGlow = (root: Element): void => {
      if (!prefersFinePointer() || prefersReducedMotion()) return;

      const cards = root.querySelectorAll<HTMLElement>(HOVER_CARD_SELECTOR);
      cards.forEach((card) => {
        if (boundHoverCards.has(card)) return;
        boundHoverCards.add(card);

        const updatePosition = (event: PointerEvent): void => {
          const rect = card.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          card.style.setProperty("--bc-hover-x", `${x}px`);
          card.style.setProperty("--bc-hover-y", `${y}px`);
        };

        const clearPosition = (): void => {
          card.style.removeProperty("--bc-hover-x");
          card.style.removeProperty("--bc-hover-y");
        };

        card.addEventListener("pointermove", updatePosition, { passive: true });
        card.addEventListener("pointerleave", clearPosition, { passive: true });
      });
    };

    const parseMetricValue = (value: string): { prefix: string; suffix: string; number: number } | null => {
      const match = value.match(/(-?\\d[\\d,]*)/u);
      if (!match || match.index === undefined) return null;
      const number = Number.parseInt(match[1].replace(/,/gu, ""), 10);
      if (!Number.isFinite(number)) return null;
      const prefix = value.slice(0, match.index);
      const suffix = value.slice(match.index + match[1].length);
      return { prefix, suffix, number };
    };

    const formatMetric = (value: number): string =>
      Math.round(value).toLocaleString("zh-Hans-CN");

    const animateMetric = (node: HTMLElement, data: { prefix: string; suffix: string; number: number }): void => {
      if (animatedMetrics.has(node)) return;
      animatedMetrics.add(node);

      if (prefersReducedMotion()) {
        node.textContent = `${data.prefix}${formatMetric(data.number)}${data.suffix}`;
        return;
      }

      const metricState = { value: 0 };
      gsap.to(metricState, {
        value: data.number,
        duration: 0.95,
        ease: "power3.out",
        onUpdate: () => {
          node.textContent = `${data.prefix}${formatMetric(metricState.value)}${data.suffix}`;
        },
      });
    };

    const setupMetricCounters = (root: Element): void => {
      const metrics = Array.from(root.querySelectorAll<HTMLElement>(METRIC_VALUE_SELECTOR));
      if (!metrics.length) return;

      metrics.forEach((metric) => {
        const parsed = parseMetricValue(metric.textContent ?? "");
        if (!parsed) return;
        metric.dataset.bcMetricValue = String(parsed.number);
        metric.dataset.bcMetricPrefix = parsed.prefix;
        metric.dataset.bcMetricSuffix = parsed.suffix;
      });

      if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
        metrics.forEach((metric) => {
          const parsed = parseMetricValue(metric.textContent ?? "");
          if (parsed) {
            metric.textContent = `${parsed.prefix}${formatMetric(parsed.number)}${parsed.suffix}`;
          }
        });
        return;
      }

      if (metricObserver) {
        metricObserver.disconnect();
      }

      metricObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const node = entry.target as HTMLElement;
            const parsed = parseMetricValue(node.textContent ?? "");
            if (parsed) animateMetric(node, parsed);
            metricObserver?.unobserve(node);
          });
        },
        { threshold: 0.5 },
      );

      metrics.forEach((metric) => metricObserver?.observe(metric));
    };

    const setupHeroSpotlight = (root: Element): void => {
      if (!prefersFinePointer() || prefersReducedMotion()) return;
      const hero = root.querySelector<HTMLElement>(HERO_SELECTOR);
      if (!hero || boundHero.has(hero)) return;
      boundHero.add(hero);

      let rafId = 0;
      let targetX = 0;
      let targetY = 0;

      const apply = () => {
        rafId = 0;
        hero.style.setProperty("--bc-hero-spot-x", `${targetX}px`);
        hero.style.setProperty("--bc-hero-spot-y", `${targetY}px`);
      };

      const handleMove = (event: PointerEvent) => {
        const rect = hero.getBoundingClientRect();
        targetX = event.clientX - rect.left;
        targetY = event.clientY - rect.top;
        if (!rafId) rafId = window.requestAnimationFrame(apply);
      };

      const reset = () => {
        hero.style.setProperty("--bc-hero-spot-x", "50%");
        hero.style.setProperty("--bc-hero-spot-y", "30%");
      };

      hero.addEventListener("pointermove", handleMove, { passive: true });
      hero.addEventListener("pointerleave", reset, { passive: true });
    };

    const initHomeEffects = (): void => {
      const root = document.querySelector(HOME_ROOT_SELECTOR);
      if (!root) return;
      setupReveal(root);
      setupHoverGlow(root);
      setupMetricCounters(root);
      setupHeroSpotlight(root);
    };

    const scheduleInit = (): void => {
      afterNextPaint(initHomeEffects);
    };

    scheduleInit();
    router.afterEach(() => {
      scheduleInit();
    });
  },
});
