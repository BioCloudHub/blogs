<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ClientOnly, useRoute, useRouter } from "vuepress/client";
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

const shortcutLabel = ref("Ctrl K");
const SEARCH_HINT_TEXT = "搜索提示：支持关键词搜索，多关键词用空格隔开。";

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
  shortcutLabel.value =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Cmd K" : "Ctrl K";
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
  <ClientOnly>
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
      <Transition name="bc-dialog">
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
                <h2 id="bc-search-launch-title">{{ SEARCH_HINT_TEXT }}</h2>
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
                placeholder="例如：病毒清除 Q40"
              >
            </label>

            <div class="bc-search-launch-dialog-foot">
              <p>{{ SEARCH_HINT_TEXT }}</p>
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
      </Transition>
    </Teleport>
  </ClientOnly>
</template>

<style scoped>
/* ── Launch button ── */
.bc-search-launch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2, #6b7280);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bc-search-launch:hover {
  background: var(--vp-c-bg-soft, #f3f4f6);
}

.bc-search-launch-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.bc-search-launch-label {
  white-space: nowrap;
}

.bc-search-launch-shortcut {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 0.68rem;
  font-family: inherit;
  border: 1px solid var(--vp-c-divider, #e5e7eb);
  border-radius: 3px;
  opacity: 0.5;
  letter-spacing: 0.02em;
}

/* ── Dialog backdrop ── */
.bc-search-launch-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  background: rgba(0, 0, 0, 0.35);
}

/* ── Dialog panel: clean, matches theme card style ── */
.bc-search-launch-dialog {
  width: 100%;
  max-width: 520px;
  margin: 0 20px;
  padding: 24px;
  border-radius: 8px;
  background: var(--vp-c-bg, #fff);
  border: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

/* ── Dialog transitions ── */
.bc-dialog-enter-active {
  transition: opacity 0.15s ease;
}
.bc-dialog-enter-active .bc-search-launch-dialog {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.bc-dialog-leave-active {
  transition: opacity 0.12s ease;
}
.bc-dialog-leave-active .bc-search-launch-dialog {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.bc-dialog-enter-from {
  opacity: 0;
}
.bc-dialog-enter-from .bc-search-launch-dialog {
  opacity: 0;
  transform: translateY(-8px);
}

.bc-dialog-leave-to {
  opacity: 0;
}
.bc-dialog-leave-to .bc-search-launch-dialog {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Dialog header ── */
.bc-search-launch-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.bc-search-launch-dialog-copy {
  min-width: 0;
}

.bc-search-launch-dialog-eyebrow {
  margin: 0 0 2px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--vp-c-text-2, #6b7280);
}

.bc-search-launch-dialog-head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--vp-c-text-1, #1f2937);
}

/* ── Close button ── */
.bc-search-launch-dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: -2px -2px 0 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-2, #6b7280);
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.bc-search-launch-dialog-close:hover {
  background: var(--vp-c-bg-soft, #f3f4f6);
}

/* ── Search input ── */
.bc-search-launch-dialog-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-border, var(--vp-c-divider, #e5e7eb));
  border-radius: 6px;
  background: var(--vp-c-bg, #fff);
  transition: border-color 0.15s ease;
  cursor: text;
}

.bc-search-launch-dialog-input:focus-within {
  border-color: var(--vp-c-brand, #3b82f6);
}

.bc-search-input-icon {
  display: flex;
  align-items: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--vp-c-text-3, #9ca3af);
}

.bc-search-launch-dialog-input input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 1rem;
  color: var(--vp-c-text-1, #1f2937);
  outline: none;
}

.bc-search-launch-dialog-input input::placeholder {
  color: var(--vp-c-text-3, #9ca3af);
}

/* ── Dialog footer ── */
.bc-search-launch-dialog-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider, #f3f4f6);
}

.bc-search-launch-dialog-foot p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--vp-c-text-3, #9ca3af);
  line-height: 1.5;
}

.bc-search-launch-dialog-submit {
  display: inline-flex;
  align-items: center;
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: var(--vp-c-brand, #3b82f6);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}

.bc-search-launch-dialog-submit:hover:not(:disabled) {
  opacity: 0.85;
}

.bc-search-launch-dialog-submit:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
