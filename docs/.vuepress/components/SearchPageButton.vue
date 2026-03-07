<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vuepress/client";
import { SEARCH_FOCUS_EVENT, SEARCH_PATH } from "../search-constants";

const route = useRoute();
const router = useRouter();

const shortcutLabel = computed(() =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "Cmd K"
    : "Ctrl K",
);

const openSearch = (): void => {
  if (route.path === SEARCH_PATH) {
    window.dispatchEvent(new CustomEvent(SEARCH_FOCUS_EVENT));
    return;
  }

  void router.push(`${SEARCH_PATH}?focus=1`);
};
</script>

<template>
  <button
    class="bc-search-launch"
    type="button"
    aria-label="打开搜索工作台"
    @click="openSearch"
  >
    <span class="bc-search-launch-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M10.5 4a6.5 6.5 0 1 0 4.07 11.57l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"
          fill="currentColor"
        />
      </svg>
    </span>
    <span class="bc-search-launch-label">搜索工作台</span>
    <span class="bc-search-launch-shortcut">{{ shortcutLabel }}</span>
  </button>
</template>
