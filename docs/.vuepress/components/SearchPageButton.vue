<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vuepress/client";
import {
  SEARCH_LAUNCH_EVENT,
  SEARCH_PATH,
  SEARCH_PREVIEW_QUERY_KEY,
} from "../search-constants";

const route = useRoute();
const router = useRouter();
const isDialogOpen = ref(false);
const draftQuery = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const normalizeQuery = (value: string): string => value.trim().replace(/\s+/gu, " ");
const isPreviewMode = (): boolean =>
  typeof window !== "undefined" &&
  new URL(window.location.href).searchParams.get(SEARCH_PREVIEW_QUERY_KEY) === "1";

const relaySearchLaunchToParent = (): boolean => {
  if (!isPreviewMode() || typeof window === "undefined") return false;
  if (!window.parent || window.parent === window) return false;

  try {
    window.parent.dispatchEvent(new CustomEvent(SEARCH_LAUNCH_EVENT));
    return true;
  } catch {
    return false;
  }
};

const shortcutLabel = computed(() =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "Cmd K"
    : "Ctrl K",
);

const canSubmit = computed(() => Boolean(normalizeQuery(draftQuery.value)));

const focusDialogInput = (): void => {
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
};

const openSearchDialog = (): void => {
  if (relaySearchLaunchToParent()) return;
  if (isPreviewMode()) return;

  if (isDialogOpen.value) {
    focusDialogInput();
    return;
  }

  draftQuery.value = typeof route.query.q === "string" ? route.query.q : "";
  isDialogOpen.value = true;
  focusDialogInput();
};

const closeSearchDialog = (): void => {
  isDialogOpen.value = false;
};

const submitSearch = async (): Promise<void> => {
  const query = normalizeQuery(draftQuery.value);

  if (!query) {
    focusDialogInput();
    return;
  }

  isDialogOpen.value = false;

  const target = {
    path: SEARCH_PATH,
    query: {
      q: query,
      hit: "1",
    },
  };

  if (route.path === SEARCH_PATH) {
    await router.replace(target);
    return;
  }

  await router.push(target);
};

const handleLaunchEvent = (): void => {
  if (relaySearchLaunchToParent()) return;
  if (isPreviewMode()) return;

  openSearchDialog();
};

const handleEscape = (event: KeyboardEvent): void => {
  if (event.key !== "Escape" || !isDialogOpen.value) return;

  event.preventDefault();
  closeSearchDialog();
};

watch(isDialogOpen, (open) => {
  if (typeof document === "undefined") return;

  document.documentElement.classList.toggle("bc-search-dialog-open", open);
});

onMounted(() => {
  window.addEventListener(SEARCH_LAUNCH_EVENT, handleLaunchEvent);
  window.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  window.removeEventListener(SEARCH_LAUNCH_EVENT, handleLaunchEvent);
  window.removeEventListener("keydown", handleEscape);
  document.documentElement.classList.remove("bc-search-dialog-open");
});
</script>

<template>
  <button
    class="bc-search-launch"
    type="button"
    aria-label="打开搜索工作台"
    @click="openSearchDialog"
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

  <Teleport to="body">
    <div
      v-if="isDialogOpen"
      class="bc-search-launch-dialog-backdrop"
      role="presentation"
      @click.self="closeSearchDialog"
    >
      <form
        class="bc-search-launch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bc-search-launch-title"
        @submit.prevent="submitSearch"
      >
        <div class="bc-search-launch-dialog-head">
          <div class="bc-search-launch-dialog-copy">
            <p class="bc-search-launch-dialog-eyebrow">站内搜索</p>
            <h2 id="bc-search-launch-title">输入关键词后进入搜索页</h2>
          </div>
          <button
            class="bc-search-launch-dialog-close"
            type="button"
            aria-label="关闭搜索弹窗"
            @click="closeSearchDialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <label class="bc-search-input-shell bc-search-launch-dialog-input">
          <span class="bc-search-input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M10.5 4a6.5 6.5 0 1 0 4.07 11.57l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <input
            ref="inputRef"
            v-model="draftQuery"
            type="search"
            inputmode="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="例如：层析、Q40、病毒清除"
          >
        </label>

        <div class="bc-search-launch-dialog-foot">
          <p>确认后进入搜索页，并直接展示结果列表和原文预览。</p>
          <button
            class="bc-search-toolbar-button bc-search-launch-dialog-submit"
            type="submit"
            :disabled="!canSubmit"
          >
            开始搜索
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
