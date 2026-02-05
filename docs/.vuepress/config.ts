import { defineUserConfig } from "vuepress";
import { viteBundler } from "@vuepress/bundler-vite";
import { hopeTheme } from "vuepress-theme-hope";

export default defineUserConfig({
  lang: "zh-CN",
  title: "BioCloudHub",
  description: "BioCloudHub 博客（VuePress Hope）",

  base: "/",

  bundler: viteBundler(),

  theme: hopeTheme({
    hostname: "https://example.com",

    author: {
      name: "BioCloudHub",
    },

    logo: "/logo.png",

    favicon: "/logo.png",

    navbar: [
      { text: "首页", link: "/" },
      { text: "博客", link: "/posts/", icon: "blog" },
      { text: "关于", link: "/about/", icon: "user" },
    ],

    sidebar: {
      "/posts/": [
        {
          text: "生物信息学",
          icon: "dna",
          children: [
            "/posts/2026/genomics-analysis.md",
            "/posts/2026/proteomics-analysis.md",
            "/posts/2026/scrna-analysis.md",
          ],
        },
        {
          text: "云计算",
          icon: "cloud",
          children: [
            "/posts/2026/kubernetes-biotech.md",
          ],
        },
        {
          text: "创新研发",
          icon: "flask",
          children: [
            "/posts/2026/ai-drug-discovery.md",
            "/posts/2026/clinical-trials.md",
          ],
        },
      ],
      "/about/": "structure",
    },

    blog: {
      description: "生物医药 · 云计算 · 创新研发",
      intro: "/about/",
      timeline: true,
      articleInfo: ["Author", "ReadingTime", "Date", "Category", "Tag"],
      excerptLength: 200,
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
