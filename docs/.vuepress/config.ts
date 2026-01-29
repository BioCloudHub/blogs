import { defineUserConfig } from "vuepress";
import { viteBundler } from "@vuepress/bundler-vite";
import { hopeTheme } from "vuepress-theme-hope";

export default defineUserConfig({
  lang: "zh-CN",
  title: "BioCloudHub",
  description: "BioCloudHub 博客（VuePress Hope）",

  // 如果未来部署到子路径（例如 GitHub Pages），把这里改成 "/<repo>/"。
  base: "/",

  bundler: viteBundler(),

  theme: hopeTheme({
    // 部署后请改成你自己的站点域名（影响 SEO / sitemap 等）
    hostname: "https://example.com",

    author: {
      name: "BioCloudHub",
    },

    logo: "/logo.svg",

    navbar: [
      { text: "首页", link: "/" },
      { text: "博客", link: "/posts/" },
      { text: "关于", link: "/about/" },
    ],

    sidebar: {
      "/posts/": "structure",
      "/about/": "structure",
    },

    blog: {
      description: "记录 · 分享 · 沉淀",
      intro: "/about/",
      medias: {
        GitHub: "https://github.com/",
      },
    },

    markdown: {
      attrs: true,
      align: true,
      tasklist: true,
    },

    plugins: {
      blog: true,
      // 当前工作区未产生 git 提交时，禁用 git 信息收集，避免构建时刷错误日志
      git: {
        createdTime: false,
        updatedTime: false,
        contributors: false,
        changelog: false,
      },
    },
  }),
});

