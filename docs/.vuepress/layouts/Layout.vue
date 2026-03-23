<template>
  <ThemeLayout v-slots="layoutSlots" />
</template>

<script setup lang="ts">
import { computed, h, useSlots } from "vue";
import { useRoute } from "vuepress/client";
import ThemeLayout from "@theme-hope/layouts/Layout";
import ArticleType from "@theme-hope/components/blog/ArticleType";
import BloggerInfo from "@theme-hope/components/blog/BloggerInfo";

const slots = useSlots();
const route = useRoute();

const isArticleIndex = computed(() => {
  const normalized = route.path.replace(__VUEPRESS_BASE__, "/").replace(/\/+$/u, "") || "/";
  return normalized === "/article" || normalized.startsWith("/article/");
});

const layoutSlots = {
  ...slots,
  sidebarTop: () => [
    h(BloggerInfo, { class: "bc-sidebar-blogger" }),
    isArticleIndex.value
      ? h("section", { class: "bc-sidebar-tools" }, [
          h("p", { class: "bc-sidebar-tools-title" }, "筛选工具"),
          h(ArticleType),
        ])
      : null,
    slots.sidebarTop?.(),
  ],
};
</script>
