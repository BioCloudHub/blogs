import fs from "fs";
import path from "path";
import { load } from "cheerio";

const rootDir = process.cwd();
const docsDir = path.join(rootDir, "docs", "posts", "cmc-knowledge");
const distDir = path.join(rootDir, "docs", ".vuepress", "dist", "posts", "cmc-knowledge");
const sidebarFile = path.join(rootDir, "docs", ".vuepress", "cmc-sidebar.ts");
const readmeFile = path.join(docsDir, "README.md");
const navFile = path.join(docsDir, "cmc.md");

const segmentLabelMap = {
  "01-expression-cell-line": [
    "表达系统与细胞株认知",
    "建系筛选与证据判断",
  ],
  "02-cell-bank-stability": [
    "建库基础与状态认知",
    "放行管理与异常排查",
  ],
  "03-upstream-culture-scale-up": [
    "培养原理与工艺认知",
    "过程控制与放大实操",
  ],
  "04-downstream-purification-harvest": [
    "收获纯化原理",
    "过滤控制与异常处理",
  ],
  "05-quality-attributes-heterogeneity": [
    "异质性形成机制",
    "分析判断与工艺调控",
  ],
  "06-analytical-methods-quality-standards": [
    "方法原理与指标认知",
    "验证放行与标准应用",
  ],
  "07-viral-safety-sterility-control": [
    "病毒无菌基础",
    "清除控制与风险判断",
  ],
  "08-formulation-packaging-stability": [
    "处方稳定性基础",
    "包材工艺与研究实操",
  ],
  "09-regulatory-submission-review": [
    "申报框架与资料基础",
    "审评重点与法规应用",
  ],
  "10-process-characterization-validation-statistics": [
    "研究框架与统计基础",
    "验证设计与参数判断",
  ],
  "11-pharmacology-toxicology-clinical": [
    "药理临床基础",
    "开发设计与变更判断",
  ],
  "12-antibody-engineering-advanced-modalities": [
    "机制靶点与技术基础",
    "开发策略与实操控制",
  ],
  "13-development-transfer-project-management": [
    "开发流程与项目基础",
    "转移管理与现场执行",
  ],
  "14-cell-biology-culture-fundamentals": [
    "细胞生物学基础",
    "培养应用与机制理解",
  ],
  "15-integrated-topics-and-quality-system": [
    "体系认知与核心概念",
    "验证控制与案例判断",
  ],
  "16-platform-lifecycle-digital-cmc": [
    "平台化与生命周期基础",
    "可比性与数字化应用",
  ],
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.writeFileSync(file, content);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: "", body: text };
  }
  return { frontmatter: match[1], body: match[2] };
}

function setFrontmatterLine(frontmatter, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(frontmatter)) {
    return frontmatter.replace(pattern, line);
  }
  return `${frontmatter.trim()}\n${line}`;
}

function removeFrontmatterLine(frontmatter, key) {
  return frontmatter
    .split("\n")
    .filter((line) => !line.startsWith(`${key}:`))
    .join("\n");
}

function getFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function getTitle(text) {
  const { frontmatter, body } = parseFrontmatter(text);
  return (
    getFrontmatterValue(frontmatter, "title") ||
    (body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "")
  );
}

function normalizeTitle(title) {
  return title.replace(/：核心问题总览$/, "").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSummaryParagraph(body, title) {
  const pattern = new RegExp(
    `^#\\s+${escapeRegExp(title)}\\n\\n>[^\\n]+\\n\\n([\\s\\S]*?)\\n##\\s+`,
    "m"
  );
  const match = body.match(pattern);
  return match ? match[1].trim() : "";
}

function parseQuestionBlocks(body) {
  const headingMatches = [...body.matchAll(/^##\s+Q(\d+)\.\s+(.+)$/gm)];
  if (headingMatches.length === 0) {
    return [];
  }

  return headingMatches.map((match, index) => {
    const start = match.index;
    const end =
      index + 1 < headingMatches.length ? headingMatches[index + 1].index : body.length;
    return {
      number: Number(match[1]),
      title: match[2].trim(),
      block: body.slice(start, end).trimEnd(),
    };
  });
}

function splitQuestions(questions) {
  if (questions.length <= 1) {
    return [questions];
  }
  const firstSize = Math.ceil(questions.length / 2);
  return [questions.slice(0, firstSize), questions.slice(firstSize)].filter(
    (segment) => segment.length > 0
  );
}

function getSegmentLabels(topLevelSlug, count) {
  if (count <= 1) {
    return ["核心问题总览"];
  }
  return segmentLabelMap[topLevelSlug] ?? ["基础认知与关键问题", "方法设计与实操判断"];
}

function buildFrontmatter(frontmatter, title, articleFalse = false) {
  let next = setFrontmatterLine(frontmatter, "title", title);
  if (articleFalse) {
    next = setFrontmatterLine(next, "article", "false");
  } else {
    next = removeFrontmatterLine(next, "article");
  }
  return `---\n${next.trim()}\n---\n`;
}

function getPathNoExt(file) {
  return file.replace(/\.md$/, "");
}

function getBaseSlug(secondLevelSlug) {
  return secondLevelSlug.replace(/-\d{2}$/, "");
}

function buildQuestionRange(questions) {
  return `Q${questions[0].number}-Q${questions[questions.length - 1].number}`;
}

function countLooseQuestionHeadings(text) {
  return [...text.matchAll(/^##\s+Q(\d+)\./gm)].length;
}

const allFiles = fs.readdirSync(docsDir);
const topLevelFiles = allFiles
  .filter(
    (file) =>
      /^\d{2}-.+\.md$/.test(file) &&
      file !== "README.md" &&
      file !== "cmc.md" &&
      !/-(\d{2})\.md$/.test(file)
  )
  .sort();
const secondLevelFiles = allFiles
  .filter((file) => {
    if (!/^\d{2}-.+\.md$/.test(file)) {
      return false;
    }
    const suffixGroups = file.replace(/\.md$/, "").match(/-\d{2}/g) ?? [];
    return suffixGroups.length === 1;
  })
  .sort();

function getThirdLevelFiles(slug) {
  return allFiles
    .filter((file) => {
      if (!file.startsWith(`${slug}-`) || !file.endsWith(".md")) {
        return false;
      }
      const suffixGroups = file.replace(/\.md$/, "").match(/-\d{2}/g) ?? [];
      return suffixGroups.length === 2;
    })
    .sort();
}

function renderInline($, node) {
  if (node.type === "text") {
    return node.data.replace(/\s+/g, " ");
  }

  if (node.type !== "tag") {
    return "";
  }

  const $node = $(node);
  const children = $node.contents().toArray().map((child) => renderInline($, child)).join("");

  switch (node.name) {
    case "strong":
    case "b":
      return `**${children.trim()}**`;
    case "em":
    case "i":
      return `*${children.trim()}*`;
    case "code":
      return `\`${$node.text()}\``;
    case "br":
      return "<br >\n";
    case "a": {
      const href = $node.attr("href");
      const text = children.trim();
      if (href && text && href !== text) {
        return `[${text}](${href})`;
      }
      return text || href || "";
    }
    default:
      return children;
  }
}

function renderBlocks($, nodes, indent = "") {
  let output = "";

  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.data.replace(/\s+/g, " ").trim();
      if (text) {
        output += `${indent}${text}\n\n`;
      }
      continue;
    }

    if (node.type !== "tag") {
      continue;
    }

    const $node = $(node);

    if ($node.hasClass("hint-container-title")) {
      continue;
    }

    switch (node.name) {
      case "p": {
        const text = $node.contents().toArray().map((child) => renderInline($, child)).join("").trim();
        if (text) {
          output += `${indent}${text}\n\n`;
        }
        break;
      }
      case "ul":
      case "ol": {
        const ordered = node.name === "ol";
        $node.children("li").each((index, li) => {
          const $li = $(li);
          const inlineParts = [];
          const blockChildren = [];
          $li.contents().each((_, child) => {
            if (child.type === "tag" && (child.name === "ul" || child.name === "ol")) {
              blockChildren.push(child);
            } else {
              inlineParts.push(renderInline($, child));
            }
          });
          const prefix = ordered ? `${index + 1}. ` : "- ";
          const line = inlineParts.join("").replace(/\s+\n/g, "\n").trim();
          output += `${indent}${prefix}${line}\n`;
          if (blockChildren.length) {
            output += renderBlocks($, blockChildren, `${indent}  `);
          }
        });
        output += "\n";
        break;
      }
      case "table": {
        const rows = $node.find("tr").toArray().map((tr) =>
          $(tr)
            .children("th, td")
            .toArray()
            .map((cell) => $(cell).text().replace(/\s+/g, " ").trim())
        );
        if (rows.length) {
          const header = rows[0];
          const divider = header.map(() => "---");
          output += `| ${header.join(" | ")} |\n`;
          output += `| ${divider.join(" | ")} |\n`;
          for (const row of rows.slice(1)) {
            output += `| ${row.join(" | ")} |\n`;
          }
          output += "\n";
        }
        break;
      }
      case "blockquote": {
        const text = renderBlocks($, $node.contents().toArray()).trim();
        if (text) {
          output += text
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n");
          output += "\n\n";
        }
        break;
      }
      default:
        output += renderBlocks($, $node.contents().toArray(), indent);
        break;
    }
  }

  return output;
}

function getLastQuestionFromDist(slug) {
  const file = path.join(distDir, `${slug}.html`);
  if (!fs.existsSync(file)) {
    return null;
  }

  const html = read(file);
  const $ = load(html, { decodeEntities: false });
  const headings = $('h2[id^="q"]').toArray();
  if (!headings.length) {
    return null;
  }

  const heading = headings[headings.length - 1];
  const headingText = $(heading).find("span").first().text().trim() || $(heading).text().trim();
  const match = headingText.match(/^Q(\d+)\.\s+(.+)$/);
  if (!match) {
    return null;
  }

  const answer = $(heading).nextAll("div.hint-container.answer").first();
  const answerMarkdown = renderBlocks($, answer.contents().toArray())
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    number: Number(match[1]),
    title: match[2].trim(),
    block: `## ${headingText}\n\n:::answer\n\n${answerMarkdown}\n\n:::`,
  };
}

function getAllQuestionsFromDist(slug) {
  const file = path.join(distDir, `${slug}.html`);
  if (!fs.existsSync(file)) {
    return [];
  }

  const html = read(file);
  const $ = load(html, { decodeEntities: false });
  const headings = $('h2[id^="q"]').toArray();

  return headings
    .map((heading) => {
      const headingText =
        $(heading).find("span").first().text().trim() || $(heading).text().trim();
      const match = headingText.match(/^Q(\d+)\.\s+(.+)$/);
      if (!match) {
        return null;
      }
      const answer = $(heading).nextAll("div.hint-container.answer").first();
      const answerMarkdown = renderBlocks($, answer.contents().toArray())
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      return {
        number: Number(match[1]),
        title: match[2].trim(),
        block: `## ${headingText}\n\n:::answer\n\n${answerMarkdown}\n\n:::`,
      };
    })
    .filter(Boolean);
}

const topLevelMeta = new Map();

for (const file of topLevelFiles) {
  const fullPath = path.join(docsDir, file);
  const text = read(fullPath);
  const title = getTitle(text);
  const { frontmatter, body } = parseFrontmatter(text);
  topLevelMeta.set(getPathNoExt(file), {
    file,
    fullPath,
    title,
    frontmatter,
    summary: getSummaryParagraph(body, title),
  });
}

const grouped = new Map();

for (const file of secondLevelFiles) {
  const fullPath = path.join(docsDir, file);
  const text = read(fullPath);
  const { frontmatter, body } = parseFrontmatter(text);
  const currentTitle = getTitle(text);
  const slug = getPathNoExt(file);
  const baseSlug = getBaseSlug(slug);
  const topLevel = topLevelMeta.get(baseSlug);
  if (!topLevel) {
    throw new Error(`Missing top-level topic for ${file}`);
  }

  const questions = parseQuestionBlocks(body);
  let looseQuestionCount = countLooseQuestionHeadings(body);
  let sourceFrontmatter = frontmatter;
  let sourceTitle = normalizeTitle(currentTitle);
  let sourceQuestions = questions;

  if (sourceQuestions.length === 0) {
    const thirdLevelFiles = getThirdLevelFiles(slug);
    if (thirdLevelFiles.length === 0) {
      throw new Error(`No questions found in ${file}`);
    }
    sourceQuestions = thirdLevelFiles.flatMap((thirdLevelFile, index) => {
      const thirdLevelText = read(path.join(docsDir, thirdLevelFile));
      const parsedThirdLevel = parseFrontmatter(thirdLevelText);
      looseQuestionCount += countLooseQuestionHeadings(parsedThirdLevel.body);
      if (index === 0) {
        sourceFrontmatter = parsedThirdLevel.frontmatter;
      }
      return parseQuestionBlocks(parsedThirdLevel.body);
    });
  }

  if (looseQuestionCount > sourceQuestions.length) {
    const distQuestions = getAllQuestionsFromDist(slug);
    if (distQuestions.length) {
      sourceQuestions = distQuestions;
    }
  }

  const lastQuestionFromDist = getLastQuestionFromDist(slug);
  if (
    lastQuestionFromDist &&
    sourceQuestions.length > 0 &&
    lastQuestionFromDist.number > sourceQuestions[sourceQuestions.length - 1].number
  ) {
    sourceQuestions.push(lastQuestionFromDist);
  }

  if (sourceQuestions.length === 0) {
    throw new Error(`No questions found in ${file}`);
  }

  const secondLevelTitle = sourceTitle.includes("：")
    ? sourceTitle.split("：").slice(1).join("：").trim()
    : sourceTitle;
  const segments = splitQuestions(sourceQuestions);
  const segmentLabels = getSegmentLabels(baseSlug, segments.length);

  const segmentMeta = segments.map((segment, index) => {
    const label = segmentLabels[index] ?? `细分主题 ${index + 1}`;
    const segmentSlug = `${slug}-${String(index + 1).padStart(2, "0")}`;
    const segmentTitle = `${sourceTitle}：${label}`;
    const segmentBody = [
      `# ${segmentTitle}`,
      "",
      `> 本细分知识库收录原专题 Q${segment[0].number} 到 Q${
        segment[segment.length - 1].number
      }，共 ${segment.length} 题，聚焦“${secondLevelTitle}”中的${label}。`,
      "",
      `- [返回二级主题总览](/posts/cmc-knowledge/${slug}.html)`,
      `- [返回一级专题总览](/posts/cmc-knowledge/${baseSlug}.html)`,
    ];

    if (index > 0) {
      segmentBody.push(
        `- [上一细分主题](/posts/cmc-knowledge/${slug}-${String(index)
          .padStart(2, "0")}.html)`
      );
    }
    if (index < segments.length - 1) {
      segmentBody.push(
        `- [下一细分主题](/posts/cmc-knowledge/${slug}-${String(index + 2)
          .padStart(2, "0")}.html)`
      );
    }
    segmentBody.push("", segment.map((item) => item.block).join("\n\n"), "");

    write(
      path.join(docsDir, `${segmentSlug}.md`),
      `${buildFrontmatter(sourceFrontmatter, segmentTitle)}\n${segmentBody.join("\n")}`.trimEnd() + "\n"
    );

    return {
      label,
      slug: segmentSlug,
      start: segment[0].number,
      end: segment[segment.length - 1].number,
      count: segment.length,
    };
  });

  const overviewBody = [
    `# ${sourceTitle}`,
    "",
    `> 当前二级主题共 ${sourceQuestions.length} 题，现已拆分为 ${segmentMeta.length} 个细分知识库，适合先按主题定位，再进入更具体的问题组。`,
    "",
    `围绕${secondLevelTitle}组织相关问题，便于从主题层先找到方向，再下钻到更聚焦的问答集合。`,
    "",
    "## 细分主题知识库",
    "",
    ...segmentMeta.map(
      (segment) =>
        `- [${segment.label}](/posts/cmc-knowledge/${segment.slug}.html)（Q${segment.start}-Q${segment.end} / ${segment.count} 题）`
    ),
    "",
    "## 使用说明",
    "",
    "- 当前页面保留为二级主题导航页，原题号延续不变。",
    "- 建议先看前一个细分主题打基础，再进入后一个细分主题做方法和判断题。",
    "- 若通过站内搜索进入具体问题，仍可回到本页快速查看同主题下的相邻问题组。",
    "",
  ];

  write(
    fullPath,
    `${buildFrontmatter(sourceFrontmatter, sourceTitle, true)}\n${overviewBody.join("\n")}`.trimEnd() + "\n"
  );

  const topicEntry = {
    slug,
    title: secondLevelTitle,
    fullTitle: sourceTitle,
    start: sourceQuestions[0].number,
    end: sourceQuestions[sourceQuestions.length - 1].number,
    count: sourceQuestions.length,
    segments: segmentMeta,
  };

  if (!grouped.has(baseSlug)) {
    grouped.set(baseSlug, []);
  }
  grouped.get(baseSlug).push(topicEntry);
}

for (const [baseSlug, entries] of grouped.entries()) {
  const topLevel = topLevelMeta.get(baseSlug);
  const totalQuestions = entries.reduce((sum, item) => sum + item.count, 0);
  const totalSegments = entries.reduce((sum, item) => sum + item.segments.length, 0);
  const overviewBody = [
    `# ${topLevel.title}`,
    "",
    `> 当前专题共 ${totalQuestions} 题，现已拆分为 ${entries.length} 个二级主题、${totalSegments} 个细分知识库，阅读颗粒度更细，便于按问题域快速检索。`,
    "",
  ];

  if (topLevel.summary) {
    overviewBody.push(topLevel.summary, "");
  }

  overviewBody.push("## 二级主题知识库", "");
  overviewBody.push(
    ...entries.map(
      (entry) =>
        `- [${entry.title}](/posts/cmc-knowledge/${entry.slug}.html)（Q${entry.start}-Q${entry.end} / ${entry.count} 题 / ${entry.segments.length} 个细分主题）`
    ),
    "",
    "## 使用说明",
    "",
    "- 一级专题页作为总入口，用于先按工作模块定位问题域。",
    "- 二级主题页继续承担语义化导航，把同一类问题收拢到一起。",
    "- 细分主题页承载具体问答内容，适合连续阅读、搜索命中和局部复盘。",
    ""
  );

  write(
    topLevel.fullPath,
    `${buildFrontmatter(topLevel.frontmatter, topLevel.title, true)}\n${overviewBody.join("\n")}`.trimEnd() + "\n"
  );
}

const topLevelEntries = [...topLevelMeta.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([slug, meta]) => {
    const entries = grouped.get(slug) ?? [];
    const totalQuestions = entries.reduce((sum, item) => sum + item.count, 0);
    const totalSegments = entries.reduce((sum, item) => sum + item.segments.length, 0);
    return {
      slug,
      title: meta.title,
      totalQuestions,
      secondLevelCount: entries.length,
      segmentCount: totalSegments,
      entries,
    };
  });

const totalSecondLevel = topLevelEntries.reduce(
  (sum, entry) => sum + entry.secondLevelCount,
  0
);
const totalSegments = topLevelEntries.reduce(
  (sum, entry) => sum + entry.segmentCount,
  0
);

const sidebar = topLevelEntries.map((entry) => ({
  text: entry.title,
  link: `/posts/cmc-knowledge/${entry.slug}.html`,
  collapsible: true,
  expanded: false,
  children: entry.entries.map((subtopic) => ({
    text: subtopic.title,
    link: `/posts/cmc-knowledge/${subtopic.slug}.html`,
    collapsible: true,
    expanded: false,
    children: subtopic.segments.map((segment) => ({
      text: segment.label,
      link: `/posts/cmc-knowledge/${segment.slug}.html`,
    })),
  })),
}));

write(sidebarFile, `export const cmcSidebar = ${JSON.stringify(sidebar, null, 2)};\n`);

const readmeLines = [
  "---",
  "title: CMC 知识库",
  "description: Chemistry, Manufacturing and Controls 技术知识专题",
  "icon: note",
  "article: false",
  "---",
  "",
  "# CMC 知识库",
  "",
  `围绕生物制品 CMC 全流程建立的问答式知识库，当前已拆分为 16 个一级专题、${totalSecondLevel} 个二级主题、${totalSegments} 个细分主题知识库，便于按问题域系统阅读、站内检索和持续维护。`,
  "",
  '<div class="home-intro">',
  '  <p class="home-lead">',
  "    该专题适用于工艺开发、分析开发、质量、注册、技术转移以及平台化团队进行系统学习和快速检索。",
  "  </p>",
  "</div>",
  "",
  "## 阅读方式",
  "",
  "- 按一级专题阅读：先进入总览页，再按二级主题和细分主题逐层下钻。",
  "- 按工作场景阅读：工艺开发关注上游/下游/表征，质量与注册关注分析/法规/病毒安全。",
  "- 按关键词搜索：站内搜索会直接命中细分主题中的具体问题，不只落在专题首页。",
  "",
  "## 一级专题目录",
  "",
  ...topLevelEntries.map(
    (entry) =>
      `- [${entry.title}](/posts/cmc-knowledge/${entry.slug}.html)（${entry.totalQuestions} 题 / ${entry.secondLevelCount} 个二级主题 / ${entry.segmentCount} 个细分主题）`
  ),
  "",
  "## 说明",
  "",
  "- 每个一级专题页保留原路径，旧链接不会失效。",
  "- 二级主题页负责语义化分组，细分主题页负责承载具体问答。",
  "- 详细树状导航可在 [CMC 问答导航](/posts/cmc-knowledge/cmc.html) 和左侧 sidebar 中查看。",
  "",
];

write(readmeFile, `${readmeLines.join("\n")}`.trimEnd() + "\n");

const navLines = [
  "---",
  "title: CMC 问答导航（按主题颗粒度细分）",
  "date: 2026-03-07 18:30:00",
  "category: CMC 核心技术",
  "tags: [CMC, 知识导航, 主题拆分]",
  "author: BioCloudHub",
  "article: false",
  "---",
  "",
  "# CMC 问答导航",
  "",
  `> 当前知识库已拆分为 16 个一级专题、${totalSecondLevel} 个二级主题、${totalSegments} 个细分主题知识库。建议先按一级专题定位，再进入二级主题，最后下钻到具体细分页。`,
  "",
  "## 一级专题导航",
  "",
  ...topLevelEntries.map(
    (entry) =>
      `- [${entry.title}](/posts/cmc-knowledge/${entry.slug}.html)（${entry.totalQuestions} 题 / ${entry.secondLevelCount} 个二级主题 / ${entry.segmentCount} 个细分主题）`
  ),
  "",
  "## 二级主题导航",
  "",
];

for (const entry of topLevelEntries) {
  navLines.push(`### ${entry.title}`, "");
  navLines.push(
    ...entry.entries.map(
      (subtopic) =>
        `- [${subtopic.title}](/posts/cmc-knowledge/${subtopic.slug}.html)（Q${subtopic.start}-Q${subtopic.end} / ${subtopic.count} 题 / ${subtopic.segments.length} 个细分主题）`
    ),
    ""
  );
}

navLines.push("## 细分主题知识库", "");

for (const entry of topLevelEntries) {
  navLines.push(`### ${entry.title}`, "");
  for (const subtopic of entry.entries) {
    navLines.push(`#### ${subtopic.title}`, "");
    navLines.push(
      ...subtopic.segments.map(
        (segment) =>
          `- [${segment.label}](/posts/cmc-knowledge/${segment.slug}.html)（Q${segment.start}-Q${segment.end} / ${segment.count} 题）`
      ),
      ""
    );
  }
}

navLines.push(
  "## 使用说明",
  "",
  "- 一级专题页仍保留，作为全局入口。",
  "- 二级主题页用于语义化收束同类问题。",
  "- 细分主题页用于承载更小颗粒度的连续问答，适合系统学习和定向搜索。",
  ""
);

write(navFile, `${navLines.join("\n")}`.trimEnd() + "\n");

console.log(
  `Refined CMC knowledge base into ${totalSecondLevel} second-level topics and ${totalSegments} fine-grained topic pages.`
);
