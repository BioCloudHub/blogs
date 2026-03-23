<template>
  <div v-if="showEnhanced" ref="rootRef" class="category-page">
    <div class="tag-page-header">
      <div class="tag-header-text">
        <p class="tag-kicker">内容索引</p>
        <h1 class="tag-title">分类</h1>
        <p class="tag-subtitle">按领域快速定位核心内容</p>
        <nav class="category-menu" aria-label="分类页面菜单">
          <RouteLink
            v-for="item in menuItems"
            :key="item.to"
            class="category-menu-link"
            :class="{ active: isMenuActive(item.to) }"
            :to="item.to"
          >
            {{ item.label }}
          </RouteLink>
        </nav>
      </div>
      <div class="tag-header-actions">
        <label class="tag-search" :for="inputId">
          <span class="tag-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.65" y1="16.65" x2="21" y2="21" />
            </svg>
          </span>
          <input
            :id="inputId"
            v-model="query"
            type="search"
            inputmode="search"
            autocomplete="off"
            placeholder="搜索分类…"
            aria-label="搜索分类"
          />
          <button
            v-if="query"
            class="tag-search-clear"
            type="button"
            aria-label="清空搜索"
            @click="clearSearch"
          >
            清空
          </button>
          <span class="tag-search-count">{{ filteredCount }} / {{ totalCount }}</span>
        </label>
      </div>
    </div>

    <div class="tag-toolbar" role="toolbar" aria-label="分类筛选工具">
      <div class="tag-toolbar-group">
        <span class="tag-toolbar-label">排序</span>
        <button
          type="button"
          class="tag-toolbar-button"
          :class="{ active: sortMode === 'count' }"
          @click="sortMode = 'count'"
        >
          按热度
        </button>
        <button
          type="button"
          class="tag-toolbar-button"
          :class="{ active: sortMode === 'name' }"
          @click="sortMode = 'name'"
        >
          按名称
        </button>
      </div>
      <div class="tag-toolbar-group">
        <span class="tag-toolbar-label">显示</span>
        <button
          type="button"
          class="tag-toolbar-button"
          :class="{ active: viewMode === 'all' }"
          @click="viewMode = 'all'"
        >
          全部
        </button>
        <button
          type="button"
          class="tag-toolbar-button"
          :class="{ active: viewMode === 'top' }"
          @click="viewMode = 'top'"
        >
          热门
        </button>
      </div>
      <div class="tag-toolbar-meta">当前 {{ displayCount }} / {{ totalCount }}</div>
    </div>

    <ul class="vp-category-list category-grid">
      <li v-for="[category, data] in filteredCategories" :key="category" class="vp-category-item">
        <RouteLink
          class="vp-category category-card"
          :class="[colorClass(category), { active: isActive(category) }]"
          :to="data.path"
        >
          <span class="tag-name">{{ category }}</span>
          <span class="vp-category-count tag-count">{{ data.items.length }}</span>
        </RouteLink>
      </li>
    </ul>

    <p v-if="filteredCount === 0" class="tag-empty">未找到匹配分类，请尝试其他关键词。</p>
  </div>

  <ul v-else ref="rootRef" class="vp-category-list">
    <li v-for="[category, data] in sortedCategories" :key="category" class="vp-category-item">
      <RouteLink
        class="vp-category"
        :class="[colorClass(category), { active: isActive(category) }]"
        :to="data.path"
      >
        {{ category }}
        <span class="vp-category-count">{{ data.items.length }}</span>
      </RouteLink>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouteLink, useFrontmatter, useRoute } from "vuepress/client";
import { entries } from "@vuepress/helper/client";
import { generateIndexFromHash } from "vuepress-shared/client";
import { useBlogCategory } from "@vuepress/plugin-blog/client";
import cssVariables from "vuepress-theme-hope/styles/variables.module.scss";

type SortMode = "count" | "name";
type ViewMode = "all" | "top";

const frontmatter = useFrontmatter();
const categoryMap = useBlogCategory("category");
const route = useRoute();
const query = ref("");
const inputId = "category-search";
const rootRef = ref<HTMLElement | null>(null);
const isMainArea = ref(true);
const sortMode = ref<SortMode>("count");
const viewMode = ref<ViewMode>("all");
const TOP_LIMIT = 16;
const menuItems = [
  { label: "全部分类", to: "/category/" },
  { label: "标签", to: "/tag/" },
  { label: "时间线", to: "/timeline/" },
  { label: "文章", to: "/article/" },
];

const sortByCount = (left: string, right: string, a: number, b: number) => {
  if (a !== b) return b - a;
  return left.localeCompare(right, "zh-Hans-CN", { sensitivity: "base", numeric: true });
};

const sortByName = (left: string, right: string) =>
  left.localeCompare(right, "zh-Hans-CN", { sensitivity: "base", numeric: true });

const sortedCategories = computed(() =>
  entries(categoryMap.value.map).sort(([left, a], [right, b]) =>
    sortMode.value === "name"
      ? sortByName(left, right)
      : sortByCount(left, right, a.items.length, b.items.length)
  )
);

const filteredCategories = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  let list = sortedCategories.value;

  if (keyword) {
    list = list.filter(([category]) => category.toLowerCase().includes(keyword));
  } else if (viewMode.value === "top") {
    list = list.slice(0, TOP_LIMIT);
  }

  return list;
});

const totalCount = computed(() => sortedCategories.value.length);
const filteredCount = computed(() => filteredCategories.value.length);
const displayCount = computed(() => filteredCategories.value.length);

const normalizePath = (value: string): string => value.replace(__VUEPRESS_BASE__, "/");
const showEnhanced = computed(() => {
  const normalized = normalizePath(route.path).replace(/\/+$/u, "");
  return (
    isMainArea.value &&
    (normalized === "/category" || normalized.startsWith("/category/"))
  );
});

const isActive = (name: string): boolean => name === frontmatter.value.blog?.name;

const colorClass = (category: string): string =>
  `color${generateIndexFromHash(category, Number(cssVariables.colorNumber))}`;

const normalizeMenuPath = (value: string): string =>
  normalizePath(value).replace(/\/+$/u, "") || "/";

const isMenuActive = (target: string): boolean =>
  normalizeMenuPath(route.path) === normalizeMenuPath(target);

const clearSearch = () => {
  query.value = "";
};

onMounted(() => {
  const root = rootRef.value;

  if (!root) return;

  const inMain = Boolean(root.closest(".vp-blog-main"));
  const inInfo =
    Boolean(root.closest(".vp-blog-info-wrapper")) || Boolean(root.closest(".vp-sidebar"));

  isMainArea.value = inMain && !inInfo;
});
</script>
