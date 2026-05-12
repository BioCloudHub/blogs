# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

VuePress 2 knowledge base using `vuepress-theme-hope` for BioCloudHub (生物制药知识库). Content is in Chinese, covering 6 knowledge base modules: CMC, GMP & Quality Systems, Analytical Science, Bioprocess Engineering, Regulatory Strategy, and R&D Management. Deployed to GitHub Pages via a GitHub Actions workflow (`.github/workflows/pages.yml`).

## Commands

```bash
pnpm install          # install dependencies (pnpm is required — see packageManager in package.json)
pnpm docs:dev         # start dev server
pnpm docs:build       # production build to docs/.vuepress/dist
pnpm docs:clean-dev   # dev server with clean cache (use when sidebar/config changes don't take effect)
pnpm docs:deploy      # build + deploy to gh-pages branch
```

Local npm cache is redirected to `.npm-cache/` via `.npmrc` — do not remove this file.

## Architecture

### Content structure

Six knowledge base modules under `docs/posts/`:

| Directory | Module | Topics | Status |
|-----------|--------|--------|--------|
| `cmc-knowledge/` | CMC 知识库 | 16 existing + 4 planned | Content available |
| `gmp-quality-systems/` | GMP 与质量体系 | 18 | Framework only |
| `analytical-science/` | 分析科学与方法学 | 18 | Framework only |
| `bioprocess-engineering/` | 生物工艺工程 | 18 | Framework only |
| `regulatory-strategy/` | 法规注册策略 | 16 | Framework only |
| `rd-management/` | 研发管理与商业化 | 16 | Framework only |

All knowledge bases follow a numbered hierarchy: `NN-topic-slug[-NN][-NN].md` (3-level nesting: topic → subsection → subsubsection).

- `docs/README.md` — homepage (YAML frontmatter with `home: true`)
- `docs/about/README.md` — about page
- `docs/posts/README.md` — knowledge base navigation hub
- `docs/search.md` — search page

### Critical config: sidebar generation

Each knowledge base has its own sidebar file in `docs/.vuepress/`:

| File | Knowledge Base |
|------|---------------|
| `cmc-sidebar.ts` | CMC 知识库 (16+ topics) |
| `gmp-quality-systems-sidebar.ts` | GMP 与质量体系 (18 topics) |
| `analytical-science-sidebar.ts` | 分析科学与方法学 (18 topics) |
| `bioprocess-engineering-sidebar.ts` | 生物工艺工程 (18 topics) |
| `regulatory-strategy-sidebar.ts` | 法规注册策略 (16 topics) |
| `rd-management-sidebar.ts` | 研发管理与商业化 (16 topics) |

All sidebars follow a strict 3-level nesting pattern: section → subsection → subsubsection (2 children per subsection). Adding new pages requires updating both the markdown file and the corresponding sidebar file.

### Custom client plugins

Located in `docs/.vuepress/`:

| File | Purpose |
|------|---------|
| `config.ts` | Main VuePress config — registers all plugins, defines the `::: answer` custom markdown container, configures slimsearch with page-filtering |
| `*-sidebar.ts` | Six knowledge base sidebar files (see above) |
| `search-constants.ts` | Shared constants for the custom search system (route paths, event names, query keys) |
| `answer-glow.ts` | Hover glow effects on `::: answer` blocks; click-to-copy share card generation (renders a styled card with QR code as image) |
| `home-animations.ts` | GSAP + ScrollTrigger animations on the homepage — reveal animations, metric counters, hover glow, hero spotlight |
| `search-ui.ts` | Custom search implementation with iframe-based preview mode (`?search-preview=1`), in-page text highlighting, and `Ctrl+K` shortcut handling |
| `register-components.ts` | Registers 6 global Vue components: `CategoryList`, `HomeHero`, `HomePipeline`, `SearchPageButton`, `SearchWorkspace`, `TagList` |

### Custom Vue components

`docs/.vuepress/components/`:
- `HomeHero.vue` — Multi-layer CSS parallax background for the homepage (gradient mesh, hex grid, DNA helix, molecular network, pulse rings, wave, particles). Uses GSAP ticker for scroll + mouse parallax.
- `HomePipeline.vue` — Scroll-pinned biopharma pipeline visualization (5 stages with animated progress bar). Uses GSAP ScrollTrigger pin + scrub.
- `SearchPageButton.vue` — navbar search button
- `SearchWorkspace.vue` — full search UI rendered on `/search.html`
- `CategoryList.vue`, `TagList.vue` — blog taxonomy listing pages

### Custom markdown container

The `::: answer` container renders styled Q&A cards. The `answer-glow.ts` client plugin adds hover interaction and a click-to-copy-as-image feature on these cards. The container title text appears after `::: answer` (e.g., `::: answer Some title`).

### Search system

Uses `@vuepress/plugin-slimsearch` for indexing (configured in `config.ts`), plus a custom search UI (`search-ui.ts` + `SearchWorkspace.vue`). The search supports:
- `Ctrl+K` global shortcut
- Preview mode via postMessage for iframe embedding (`search-preview=1` query param)
- In-page text highlighting and scroll-to-target

### Patch

`patches/vuepress-theme-hope@2.0.0-rc.102.patch` — pnpm patch on the theme. Changing theme version requires regenerating this patch.

### Dependencies to note

- `three` + `@types/three` + `gsap` — used only by the HomeBio3D 3D background component on the homepage
- `katex` — math rendering in markdown (configured via `markdown.math.type: "katex"` in theme config)
- `cheerio` — HTML parsing (used by search/rendering utilities)
- `gh-pages` — deployment to GitHub Pages
