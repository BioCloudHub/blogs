import { defineClientConfig } from "vuepress/client";

const CARD_SELECTOR = ".hint-container.answer";

export default defineClientConfig({
  enhance() {
    if (typeof document === "undefined") return;

    let activeCard: HTMLElement | null = null;

    const clearActiveCard = (): void => {
      if (!activeCard) return;

      activeCard.classList.remove("answer-glow-active");
      activeCard = null;
    };

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
  },
});
