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

  base: "/",

  bundler: viteBundler(),

  plugins: [
    {
      name: "answer-glow",
      clientConfigFile: resolve(__dirname, "./answer-glow.ts"),
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
    hostname: "https://example.com",

    author: {
      name: "BioCloudHub",
    },

    logo: "/logo.png",

    favicon: "/logo.png",

    navbar: [
      { text: "首页", link: "/", icon: "home" },
      { text: "技术博客", link: "/posts/", icon: "blog" },
      { text: "CMC 知识库", link: "/posts/cmc-knowledge/", icon: "note" },
      { text: "药物研发", link: "/posts/drug-discovery/", icon: "pill" },
      { text: "生物分析", link: "/posts/bioanalytics/", icon: "dna" },
      { text: "计算工程", link: "/posts/computational-infrastructure/", icon: "cloud" },
      { text: "关于", link: "/about/", icon: "user" },
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
        Email: "mailto:contact@biocloudhub.com",
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
