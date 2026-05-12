import { defineClientConfig } from "vuepress/client";

const HOME_ROOT = "main.vp-project-home";
const REVEAL =
  ".home-stat, .home-module, .home-about li, .home-section-title, .home-section-desc, .home-lead";
const HOVER_CARDS = ".home-stat, .home-module";
const HERO = "header.vp-hero-info-wrapper";

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const prefersFinePointer = (): boolean =>
  window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? false;

type GSAP = typeof import("gsap").default;
type ST = typeof import("gsap/ScrollTrigger").ScrollTrigger;

export default defineClientConfig({
  enhance({ router }) {
    if (typeof document === "undefined") return;

    let gsap: GSAP | null = null;
    let ScrollTrigger: ST | null = null;
    let triggers: globalThis.ScrollTrigger[] = [];
    let loading = false;
    let loaded = false;

    const loadGSAP = async (): Promise<boolean> => {
      if (loaded) return true;
      if (loading) return false;
      loading = true;
      try {
        const [gsapMod, stMod] = await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        gsap = gsapMod.default;
        ScrollTrigger = stMod.ScrollTrigger;
        gsap.registerPlugin(ScrollTrigger);
        loaded = true;
        return true;
      } catch {
        return false;
      } finally {
        loading = false;
      }
    };

    /* ---- Staggered scroll reveals ---- */
    function setupReveals(root: Element): void {
      if (!gsap || !ScrollTrigger) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(REVEAL));
      if (!items.length) return;

      triggers.forEach((t) => t.kill());
      triggers.length = 0;

      if (prefersReducedMotion()) {
        items.forEach((el) => {
          el.style.opacity = "1";
          el.style.transform = "none";
        });
        return;
      }

      gsap.set(items, { opacity: 0, y: 32, scale: 0.97 });

      items.forEach((el, i) => {
        const t = ScrollTrigger!.create({
          trigger: el,
          start: "top 90%",
          once: true,
          onEnter: () => {
            gsap!.to(el, {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.65,
              delay: Math.min(i * 0.03, 0.16),
              ease: "power3.out",
            });
          },
        });
        triggers.push(t);
      });
    }

    /* ---- Hover glow on stat/module cards ---- */
    function setupHoverGlow(root: Element): void {
      if (!prefersFinePointer() || prefersReducedMotion()) return;

      const cards = root.querySelectorAll<HTMLElement>(HOVER_CARDS);
      cards.forEach((card) => {
        card.addEventListener(
          "pointermove",
          (e: Event) => {
            const ev = e as PointerEvent;
            card.style.setProperty("--bc-hover-x", `${ev.offsetX}px`);
            card.style.setProperty("--bc-hover-y", `${ev.offsetY}px`);
          },
          { passive: true },
        );
        card.addEventListener(
          "pointerleave",
          () => {
            card.style.removeProperty("--bc-hover-x");
            card.style.removeProperty("--bc-hover-y");
          },
          { passive: true },
        );
      });
    }

    /* ---- Stat counter animations ---- */
    function setupCounters(root: Element): void {
      if (!gsap) return;
      const stats = Array.from(
        root.querySelectorAll<HTMLElement>(".home-stat-num"),
      );
      const animated = new WeakSet<HTMLElement>();

      const parseNum = (text: string) => {
        const m = text.match(/(-?\d[\d,]*)/);
        if (!m || m.index === undefined) return null;
        const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
        if (!Number.isFinite(n)) return null;
        return {
          prefix: text.slice(0, m.index),
          suffix: text.slice(m.index + m[1].length),
          num: n,
        };
      };

      stats.forEach((el) => {
        const parsed = parseNum(el.textContent ?? "");
        if (!parsed) return;

        if (prefersReducedMotion()) {
          el.textContent = `${parsed.prefix}${parsed.num.toLocaleString("zh-Hans-CN")}${parsed.suffix}`;
          return;
        }

        const obs = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting || animated.has(el)) return;
              animated.add(el);
              const state = { v: 0 };
              gsap!.to(state, {
                v: parsed.num,
                duration: 1,
                ease: "power3.out",
                onUpdate: () => {
                  el.textContent = `${parsed.prefix}${Math.round(state.v).toLocaleString("zh-Hans-CN")}${parsed.suffix}`;
                },
              });
              obs.unobserve(el);
            });
          },
          { threshold: 0.6 },
        );
        obs.observe(el);
      });
    }

    /* ---- Hero spotlight ---- */
    function setupHeroSpotlight(root: Element): void {
      if (!prefersFinePointer() || prefersReducedMotion()) return;
      const hero = root.querySelector<HTMLElement>(HERO);
      if (!hero) return;

      let raf = 0,
        tx = 0,
        ty = 0;
      let heroRect: DOMRect = hero.getBoundingClientRect();

      const updateHeroRect = () => {
        heroRect = hero.getBoundingClientRect();
      };
      window.addEventListener("scroll", updateHeroRect, { passive: true });
      window.addEventListener("resize", updateHeroRect, { passive: true });

      hero.addEventListener(
        "pointermove",
        (e: Event) => {
          const ev = e as PointerEvent;
          tx = ev.clientX - heroRect.left;
          ty = ev.clientY - heroRect.top;
          if (!raf)
            raf = requestAnimationFrame(() => {
              raf = 0;
              hero.style.setProperty("--bc-hero-spot-x", `${tx}px`);
              hero.style.setProperty("--bc-hero-spot-y", `${ty}px`);
            });
        },
        { passive: true },
      );

      hero.addEventListener(
        "pointerleave",
        () => {
          hero.style.setProperty("--bc-hero-spot-x", "50%");
          hero.style.setProperty("--bc-hero-spot-y", "30%");
        },
        { passive: true },
      );
    }

    /* ---- Hero scroll effects ---- */
    function setupHeroScroll(): void {
      if (!gsap || !ScrollTrigger || prefersReducedMotion()) return;
      const hero = document.querySelector<HTMLElement>(HERO);
      const img = document.querySelector<HTMLElement>(".vp-hero-image");
      const desc = document.querySelector<HTMLElement>("#main-description");
      if (!hero) return;

      let tick = 0;
      ScrollTrigger.create({
        trigger: hero,
        start: "top top",
        end: "bottom top",
        scrub: 0.8,
        onUpdate(self) {
          tick = (tick + 1) & 1;
          if (tick) return;
          const p = self.progress;
          if (img) {
            img.style.transform = `scale(${1 - p * 0.12}) translateY(${p * 8}px)`;
            img.style.opacity = String(1 - p * 0.45);
          }
          if (desc) {
            desc.style.opacity = String(1 - p * 0.5);
            desc.style.transform = `translateY(${p * 4}px)`;
          }
        },
      });
    }

    /* ---- Init ---- */
    async function init(): Promise<void> {
      const root = document.querySelector(HOME_ROOT);
      if (!root) return;

      const ok = await loadGSAP();
      if (!ok) return;

      setupReveals(root);
      setupHoverGlow(root);
      setupCounters(root);
      setupHeroSpotlight(root);
      setupHeroScroll();
    }

    requestAnimationFrame(() => void init());
    router.afterEach(
      () => requestAnimationFrame(() => void init()),
    );
  },
});
