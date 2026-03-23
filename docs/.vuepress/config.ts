import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineUserConfig } from "vuepress";
import { viteBundler } from "@vuepress/bundler-vite";
import { container } from "@mdit/plugin-container";
import { hopeTheme } from "vuepress-theme-hope";
import { cmcSidebar } from "./cmc-sidebar";
import { SEARCH_PATH, SEARCH_ROUTE_PREFIX } from "./search-constants";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineUserConfig({
  lang: "zh-CN",
  title: "BioCloudHub",
  description: "生物制药行业技术博客：CMC、药物研发、生物分析与计算工程",

  base: "/blogs/",

  head: [
    ["link", { rel: "icon", href: "/blogs/logo-animated.svg" }],
    ["meta", { name: "keywords", content: "生物制药, CMC, 药物研发, 生物分析, 计算工程, 数字化实验室, BioCloudHub" }],
    ["meta", { name: "theme-color", content: "#3b82f6" }],
    ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
    ["meta", { name: "apple-mobile-web-app-status-bar-style", content: "black" }],
  ],

  bundler: viteBundler({
    viteOptions: {
      build: {
        chunkSizeWarningLimit: 1000,
      },
    },
  }),

  plugins: [
    {
      name: "register-components",
      clientConfigFile: resolve(__dirname, "./register-components.ts"),
    },
    {
      name: "answer-glow",
      clientConfigFile: resolve(__dirname, "./answer-glow.ts"),
    },
    {
      name: "home-animations",
      clientConfigFile: resolve(__dirname, "./home-animations.ts"),
    },
    {
      name: "search-ui",
      clientConfigFile: resolve(__dirname, "./search-ui.ts"),
    },
  ],

  extendsMarkdown: (md) => {
    md.use(container, {
      name: "answer",
      openRender: (tokens, index) => {
        const info = md.utils.escapeHtml(
          tokens[index].info.trim().slice(6).trim(),
        );

        return `<div class="hint-container answer">\n<p class="hint-container-title"><span class="answer-icon" aria-hidden="true"></span><span class="answer-title-text">${info || "回答"}</span><span class="answer-chip">BioCloudHub</span></p>\n`;
      },
      closeRender: () => "</div>\n",
    });
  },

  theme: hopeTheme({
    hostname: "https://biocloudhub.github.io",

    author: {
      name: "BioCloudHub",
    },

    logo: "/logo-animated.svg",

    favicon: "/logo-animated.svg",

    navbar: [
      { text: "首页", link: "/", icon: "home", activeMatch: "^/$" },
      { text: "CMC 知识库", link: "/posts/cmc-knowledge/", icon: "note", activeMatch: "^/posts/cmc-knowledge/" },
      { text: "药物研发", link: "/posts/drug-discovery/", icon: "pill", activeMatch: "^/posts/drug-discovery/" },
      { text: "生物分析", link: "/posts/bioanalytics/", icon: "dna", activeMatch: "^/posts/bioanalytics/" },
      { text: "计算工程", link: "/posts/computational-infrastructure/", icon: "cloud", activeMatch: "^/posts/computational-infrastructure/" },
      { text: "内容索引", link: "/article/", icon: "list", activeMatch: "^/article/" },
      { text: "关于", link: "/about/", icon: "user", activeMatch: "^/about/" },
    ],

    navbarLayout: {
      start: ["Brand"],
      center: ["Links"],
      end: ["Repo", "Outlook", "SearchPageButton"],
    },

    sidebar: {
      "/posts/": "structure",
      "/posts/cmc-knowledge/": cmcSidebar,
      "/posts/drug-discovery/": "structure",
      "/posts/bioanalytics/": "structure",
      "/posts/computational-infrastructure/": "structure",
      "/about/": "structure",
      "/category/": false,
      "/tag/": false,
      "/article/": false,
      "/star/": false,
      "/timeline/": false,
    },

    blog: {
      description: "生物制药技术实践与工程化落地",
      intro: "/about/",
      timeline: true,
      articleInfo: ["Author", "ReadingTime", "Date", "Category", "Tag"],
      excerptLength: 180,
      medias: {
        GitHub: "https://github.com/",
        Email: "mailto:biocloudhub@outlook.com",
      },
    },

    markdown: {
      attrs: true,
      align: true,
      tasklist: true,
    },

    plugins: {
      slimsearch: {
        indexContent: true,
        queryHistoryCount: 0,
        resultHistoryCount: 0,
        filter: (page) =>
          ![
            "/category/",
            "/tag/",
            "/article/",
            "/star/",
            "/timeline/",
            SEARCH_PATH,
            `${SEARCH_ROUTE_PREFIX}/`,
          ].some((prefix) => page.path.startsWith(prefix)),
      },
      blog: true,
      git: {
        createdTime: false,
        updatedTime: false,
        contributors: false,
        changelog: false,
      },
    },
  }),
});
