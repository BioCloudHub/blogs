# BioCloudHub 博客（VuePress Hope）

本目录是一个基于 **VuePress 2 + vuepress-theme-hope** 的博客项目。

## 开发

```bash
cd blogs
npm install
npm run docs:dev
```

默认会启动本地开发服务器（控制台会输出访问地址）。

> 说明：如果你本机的 npm 全局缓存 `~/.npm` 权限有问题，本项目已在 `blogs/.npmrc` 内配置使用本地缓存目录 `.npm-cache`，通常可直接避免该问题。

## 构建

```bash
cd blogs
npm run docs:build
```

