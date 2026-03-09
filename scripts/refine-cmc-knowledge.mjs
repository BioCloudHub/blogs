import fs from "fs";
import path from "path";
import { load } from "cheerio";

const rootDir = process.cwd();
const docsDir = path.join(rootDir, "docs", "posts", "cmc-knowledge");
const distDir = path.join(rootDir, "docs", ".vuepress", "dist", "posts", "cmc-knowledge");
const sidebarFile = path.join(rootDir, "docs", ".vuepress", "cmc-sidebar.ts");
const readmeFile = path.join(docsDir, "README.md");
const navFile = path.join(docsDir, "cmc.md");
const maintenanceFile = path.join(docsDir, "maintenance.md");

const CMC_LEAF_NOTICE =
  "*以下内容用于专业学习与团队知识沉淀，具体项目判断请结合产品类型、项目阶段、法规要求和实验数据综合评估。*";
const QUESTION_ID_COMMENT_RE = /^<!--\s*cmc-question-id:\s*(Q\d+)\s*-->\n?/m;
const NAV_SECTION_TITLES = new Set([
  "一级专题导航",
  "一级专题目录",
  "二级主题导航",
  "细分主题导航",
  "细分主题知识库",
  "专题补充",
  "主题补充",
  "这页先抓重点",
  "这页先抓重点的核心要点是什么",
  "这套知识库适合怎么用",
  "阅读方式",
  "阅读与维护说明",
  "维护方式",
  "维护建议",
  "说明",
  "使用说明",
]);

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

const topicSupplementMap = {
  "01-expression-cell-line": {
    module:
      "这个专题解决的不是“哪个宿主更常见”这么简单，而是回答：这个分子该放在哪个平台上做，后面工艺、质量和申报能不能顺下去。",
    pain:
      "项目里最常卡住的不是表达不出来，而是表达量、稳定性、质量属性和后续可制造性之间没有一起判断，早期看起来快，后期返工最多。",
    focus:
      "阅读时优先抓表达系统选择逻辑、建系筛选证据、单克隆性与稳定性边界，以及这些结论怎样转成后续细胞库和生产的证据链。",
    linkage:
      "如果你正在做立项评估、细胞株筛选、平台选型或申报答复，这个专题最值得和“细胞库与稳定性”“上游培养与工艺放大”联起来看。",
  },
  "02-cell-bank-stability": {
    module:
      "这个专题的核心，是把“能生产”变成“能长期稳定、可追溯、可放行、可复现地生产”。",
    pain:
      "最常见的问题不是建不出库，而是主库/工作库策略不清、放行项目不完整、稳定性研究和后续变更管理没有连成一条线。",
    focus:
      "阅读时重点看建库逻辑、代次控制、放行检测、污染与漂移风险，以及稳定性结论如何真正支撑后续生产和申报。",
    linkage:
      "如果你正在准备细胞库放行、复测、偏差调查或技术转移，这个专题最适合和“细胞株与表达系统”“病毒安全与无菌控制”一起看。",
  },
  "03-upstream-culture-scale-up": {
    module:
      "这个专题主要处理从培养基、补料、工艺参数到放大策略的一整套上游问题，本质是在回答“怎么把细胞状态稳定地变成产品产出”。",
    pain:
      "项目里最容易误判的是只盯 titer，不看细胞代谢、工艺窗口、质量属性和放大敏感点，结果小试好看，大罐失控。",
    focus:
      "建议先抓培养目标和细胞状态，再看关键参数、在线离线监测、放大策略和异常信号，最后再看如何把数据沉淀成可复制的工艺逻辑。",
    linkage:
      "如果你在做工艺开发、放大、工艺表征或偏差排查，这个专题要和“下游纯化与收获”“工艺表征、验证与统计设计”一起看才完整。",
  },
  "04-downstream-purification-harvest": {
    module:
      "这个专题不是单讲层析和过滤名词，而是在回答如何把复杂上游产物变成纯度、回收率和安全性都能接受的可放行中间体或成品。",
    pain:
      "项目里最常见的痛点是收率、纯度、宿主残留、聚体和病毒安全之间顾此失彼，单步看似优化，整条流程却不稳。",
    focus:
      "阅读时先看收获与澄清，再看层析和过滤的分离目标、关键参数和常见异常，最后看整条下游链路如何支撑一致性和放大。",
    linkage:
      "如果你正在做纯化流程搭建、树脂选择、工艺放大或偏差分析，这个专题最适合和“质量属性与分子异质性”“病毒安全与无菌控制”一起看。",
  },
  "05-quality-attributes-heterogeneity": {
    module:
      "这个专题真正要解决的是：哪些质量属性必须盯、异质性是怎么来的、哪些波动会直接影响临床、放行或工艺变更决策。",
    pain:
      "最常见的问题不是不会测，而是不知道哪些异质性是关键风险，哪些只是背景噪音，结果容易把资源用在不该放大的问题上。",
    focus:
      "阅读时重点区分结构异质性、功能异质性和工艺诱导变化，理解它们与活性、安全性、稳定性和可比性之间的因果关系。",
    linkage:
      "如果你在做 CQA 梳理、可比性评估、偏差调查或平台化开发，这个专题建议和“分析方法与质量标准”“工艺表征、验证与统计设计”联动阅读。",
  },
  "06-analytical-methods-quality-standards": {
    module:
      "这个专题的重点不是把方法名称背下来，而是搞清楚不同方法分别回答什么问题、怎么验证、什么时候可以真正支持放行和申报。",
    pain:
      "项目里最容易出问题的是方法很多、数据很多，但证据链不完整，不知道哪些方法能用于开发判断，哪些已经必须达到注册质量。",
    focus:
      "阅读时先看方法原理和适用边界，再看方法验证、标准建立、系统适用性、趋势管理和放行场景，最后看数据怎么说得清。",
    linkage:
      "如果你在做分析开发、方法转移、标准建立或 OOS/OOT 排查，这个专题最适合和“质量属性与分子异质性”“法规申报与审评策略”一起看。",
  },
  "07-viral-safety-sterility-control": {
    module:
      "这个专题聚焦的是生物制品最敏感的一类底线风险：病毒、无菌、支原体、内毒素和相关控制策略到底要做到什么程度才算放心。",
    pain:
      "最常见的误区是把“做过检测”当成“风险已经关住”，但真正审评和放行关注的是控制链路是否完整、是否能解释失效场景。",
    focus:
      "阅读时建议先分清预防、检测、清除和放行四类控制思路，再看不同工艺环节的关键风险点和验证证据。",
    linkage:
      "如果你在做细胞库放行、病毒清除研究、无菌保证或偏差调查，这个专题要和“下游纯化与收获”“法规申报与审评策略”联动使用。",
  },
  "08-formulation-packaging-stability": {
    module:
      "这个专题核心回答的是：药物做成什么剂型更稳、装进什么包材更合适、在运输和货架期里怎样把风险真正控住。",
    pain:
      "项目里最常见的问题不是不知道做稳定性，而是不知道该用什么处方思路、哪些失稳机制最关键、包材和给药装置会不会反过来制造新问题。",
    focus:
      "阅读时先看失稳机制和处方目标，再看辅料、浓度、冻结/复融、包材相容性、运输冲击和稳定性研究设计。",
    linkage:
      "如果你正在做处方筛选、稳定性研究、包材切换、上市后变更或现场问题复盘，这个专题建议和“质量属性与分子异质性”一起看。",
  },
  "09-regulatory-submission-review": {
    module:
      "这个专题不是法规条文摘抄，而是把资料准备、技术表达、桥接逻辑和审评关注点串成一条真正能落地的申报路线。",
    pain:
      "项目里最容易卡住的不是资料没写，而是证据和结论对不上、项目阶段判断失准、问题答复不够聚焦，导致越写越被动。",
    focus:
      "阅读时先区分 IND、BLA/NDA、变更和补充资料场景，再看模块边界、数据深度、风险表达和答复逻辑。",
    linkage:
      "如果你在做申报资料统稿、审评问答、变更策略或跨部门对齐，这个专题最适合和“分析方法与质量标准”“工艺表征、验证与统计设计”一起看。",
  },
  "10-process-characterization-validation-statistics": {
    module:
      "这个专题处理的是 CMC 里最容易从“经验判断”走向“数据说话”的部分：工艺表征、验证策略和统计设计。",
    pain:
      "最常见的误区是先做实验再找统计解释，或者只做 DOE 却说不清它和 CPP、控制策略、验证结论之间的关系。",
    focus:
      "阅读时要把工艺理解、参数筛选、风险评估、实验设计、统计解释和验证结论看成一条连续链路，而不是彼此割裂的任务。",
    linkage:
      "如果你在做 PPQ 前准备、工艺确认、持续工艺验证或变更可比性判断，这个专题必须和“上游培养与工艺放大”“下游纯化与收获”一起看。",
  },
  "11-pharmacology-toxicology-clinical": {
    module:
      "这个专题的价值在于把 CMC、药理毒理和临床推进连到一起，帮助团队判断什么时候现有数据够用，什么时候必须补研究。",
    pain:
      "项目里最常见的问题不是不会做试验，而是桥接逻辑不清、阶段边界判断失准、既往数据不会用，最后方案写不稳、答复也站不住。",
    focus:
      "阅读时建议先看药效、毒理、免疫原性和临床方案之间的因果链，再看不同开发阶段怎样控制风险、怎样支持剂量和变更判断。",
    linkage:
      "如果你正在做 IND 准备、临床变更评估、既往数据整合或非临床补充策略，这个专题建议和“法规申报与审评策略”联动阅读。",
  },
  "12-antibody-engineering-advanced-modalities": {
    module:
      "这个专题聚焦的是传统抗体之外更复杂的分子设计和开发问题，重点不是名词，而是复杂分子会把哪些开发难点同时放大。",
    pain:
      "最常见的问题是只盯分子机制和靶点想象空间，却低估了偶联、载荷、连接子、分析表征和安全性带来的系统复杂度。",
    focus:
      "阅读时先理解分子结构和作用机制，再看工艺实现、分析难点、质量属性和临床风险，避免只看某一个环节的局部最优。",
    linkage:
      "如果你在做 ADC、双抗、融合蛋白或新型疗法的开发评估，这个专题最好和“分析方法与质量标准”“药理毒理与临床开发”一起看。",
  },
  "13-development-transfer-project-management": {
    module:
      "这个专题真正管的是项目怎么从研发思路变成可交付结果，包括开发节奏、跨部门协同、技术转移和现场执行。",
    pain:
      "项目失败很多时候不是单点技术不行，而是边界不清、信息断层、资料交接不完整、决策时间点错了，最后所有人都在补洞。",
    focus:
      "阅读时建议把流程、角色、里程碑、资料包、风险清单和现场验证放在一条线上看，理解哪些信息必须在转移前说清楚。",
    linkage:
      "如果你负责项目管理、技术转移、CDMO 对接或跨团队沟通，这个专题建议和“平台化开发、生命周期与数字化 CMC”一起看。",
  },
  "14-cell-biology-culture-fundamentals": {
    module:
      "这个专题是很多上游、建系和细胞状态判断的基础底座，重点是把细胞生物学原理和实际培养现象对上。",
    pain:
      "最常见的误区是只记培养操作，不理解细胞为什么这样反应，结果遇到增殖异常、代谢变化或表型漂移时很难真正定位原因。",
    focus:
      "阅读时建议先抓细胞结构、代谢、周期和应激，再看培养环境、营养限制和常见实验现象，这样后面工艺判断会更稳。",
    linkage:
      "如果你在做细胞培养、状态评估、培养条件优化或异常排查，这个专题是读“上游培养与工艺放大”前很值得补上的底层知识。",
  },
  "15-integrated-topics-and-quality-system": {
    module:
      "这个专题相当于知识库里的综合训练区，处理的是单一模块拆不开、必须跨部门和跨生命周期联动判断的问题。",
    pain:
      "最常见的问题不是缺知识点，而是缺整体视角：知道每一块怎么做，却说不清整套质量体系、验证链路和管理逻辑怎么闭环。",
    focus:
      "阅读时不要把它当杂项合集，而要当成把偏差、CAPA、变更、验证、供应链、质量文化和数据治理串起来的系统问题来看。",
    linkage:
      "如果你在做质量体系建设、综合问答、审计准备或复杂偏差复盘，这个专题通常要和前面多个专题交叉使用，不能孤立阅读。",
  },
  "16-platform-lifecycle-digital-cmc": {
    module:
      "这个专题关注的是更高一层的能力建设：平台化开发、生命周期管理、可比性和数字化工具怎样真正提升 CMC 速度和一致性。",
    pain:
      "最常见的误区是把平台化理解成模板复用，把数字化理解成系统上线，但真正难的是数据标准、知识复用和决策机制能不能跑起来。",
    focus:
      "阅读时重点看平台边界、可比性证据、生命周期阶段差异，以及数字化如何支持知识沉淀、风险前移和跨项目复用。",
    linkage:
      "如果你在做平台策略、变更管理、数据治理或知识库建设，这个专题建议和“开发流程、技术转移与项目管理”“综合专题与质量体系”一起看。",
  },
};

const exactQuestionTitleMap = new Map([
  ["III 期临床实验该如何开展", "III 期临床试验通常怎么设计和推进"],
  ["III 期临床试验设计", "III 期临床试验通常怎么设计更合理"],
  ["临床试验协议的设计内容", "临床试验方案通常要包含哪些核心内容"],
  ["临床实验受试者招募", "临床试验受试者招募为什么难，通常怎么提高效率"],
  ["临床试验受试者招募", "临床试验受试者招募为什么难，通常怎么提高效率"],
  ["Ⅱ 期临床试验的结束或中止", "什么情况下可以结束、中止或提前推进 II 期临床试验"],
  ["临床试验研发成本", "为什么临床试验往往最耗时也最烧钱"],
  ["临床试验失败的主要原因有哪些", "临床试验为什么会失败，最常见原因有哪些"],
  ["免疫缺陷型小鼠有哪些", "常见的免疫缺陷型小鼠有哪些，各自适合什么场景"],
  ["SCID 小鼠", "SCID 小鼠有什么特点，适合用在什么场景"],
  ["NOD-SCID 小鼠", "NOD-SCID 小鼠有什么特点，适合用在什么场景"],
  ["CBA/N 小鼠", "CBA/N 小鼠有什么特点，适合用在什么场景"],
  ["Beige (bg)小鼠", "Beige（bg）小鼠有什么特点，适合用在什么场景"],
  ["药效学研究的差异", "药效学研究在不同监管语境下有哪些关键差异"],
  ["临床试验方案", "临床试验方案通常应包含哪些核心内容"],
  ["药理毒理信息", "药理毒理信息通常包括哪些核心内容"],
  ["既往临床使用经验说明", "既往临床使用经验通常要说明哪些内容"],
]);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.writeFileSync(file, content);
}

function parseFrontmatter(text) {
  const match = text.match(/^([\s\S]*?)---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { lead: "", frontmatter: "", body: text };
  }
  return {
    lead: match[1].trim(),
    frontmatter: match[2],
    body: match[3],
  };
}

function setFrontmatterLine(frontmatter, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(frontmatter)) {
    return frontmatter.replace(pattern, line);
  }
  return `${frontmatter.trim()}\n${line}`.trim();
}

function removeFrontmatterLine(frontmatter, key) {
  return frontmatter
    .split("\n")
    .filter((line) => !line.startsWith(`${key}:`))
    .join("\n")
    .trim();
}

function getFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function getPathNoExt(file) {
  return file.replace(/\.md$/, "");
}

function getSuffixDepth(value) {
  return (value.match(/-\d{2}/g) ?? []).length;
}

function getParentSlug(slug) {
  return slug.replace(/-\d{2}$/, "");
}

function getTopLevelSlug(slug) {
  return slug.replace(/(?:-\d{2})+$/, "");
}

function getTitleFromMarkdown(text) {
  const { frontmatter, body } = parseFrontmatter(text);
  return (
    getFrontmatterValue(frontmatter, "title") ||
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    ""
  );
}

function getTitleSegments(title) {
  return title
    .split("：")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSecondLevelLabel(title) {
  const segments = getTitleSegments(title);
  return segments.slice(1).join("：") || title;
}

function getLeafLabel(title, slug) {
  const segments = getTitleSegments(title);
  if (segments.length >= 3) {
    return segments.at(-1);
  }

  const secondLevelSlug = getParentSlug(slug);
  const topLevelSlug = getTopLevelSlug(slug);
  const leafIndex = Number(slug.slice(-2)) - 1;
  const fallbackLabels = segmentLabelMap[topLevelSlug] ?? [];
  return fallbackLabels[leafIndex] ?? segments.at(-1) ?? title;
}

function cleanupQuestionTitle(title) {
  return title
    .replace(/^Q\d+\.\s*/u, "")
    .replace(/^\d{1,3}[.)、]\s*/u, "")
    .replace(/^\d{2}\s*[-—]\s*/u, "")
    .replace(/[：:]\s*回答$/u, "")
    .replace(/\s+/g, " ")
    .replace(/[?？]+$/u, "")
    .trim();
}

function finalizeQuestionTitle(title) {
  return title
    .replace(/^什么是(?=[A-Za-z0-9])/u, "什么是 ")
    .replace(/^(.+?)可能可能带来哪些风险$/u, "$1可能带来哪些风险")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteQuestionTitle(title) {
  let next = cleanupQuestionTitle(title)
    .replace(/临床实验/gu, "临床试验")
    .replace(/\s*（/gu, "（");

  next = next
    .replace(/^(.*?)的?有哪些关键有哪些关键差异$/u, "$1有哪些关键差异")
    .replace(
      /^(.*?为什么会失败，最常见原因有哪些)为什么会失败，最常见原因有哪些$/u,
      "$1"
    )
    .replace(/^常见的常用于/u, "常用于")
    .replace(
      /^(.*?)(?:通常要包含哪些(?:关键|核心))通常要包含哪些核心内容$/u,
      "$1通常要包含哪些核心内容"
    )
    .replace(
      /^(.*?)(?:通常要包含哪些(?:关键|核心))通常应包含哪些核心内容$/u,
      "$1通常应包含哪些核心内容"
    )
    .replace(
      /^(.*?)(?:通常应包含哪些(?:关键|核心))通常应包含哪些核心内容$/u,
      "$1通常应包含哪些核心内容"
    )
    .replace(
      /^(.*?)(?:通常应包含哪些(?:关键|核心))通常要包含哪些核心内容$/u,
      "$1通常要包含哪些核心内容"
    )
    .replace(
      /^(.*?为什么会失败，最常见原因有哪些)，各自怎么理解$/u,
      "$1为什么会失败，最常见原因有哪些"
    );

  if (/(什么|怎么|如何|为什么|哪些|多少|是否|能否|何时|谁|哪种|哪类)/u.test(next)) {
    next = next.replace(/的核心要点是什么$/u, "");
  } else {
    next = next.replace(/^(.+?)的核心要点是什么$/u, "什么是$1，关键要点有哪些");
  }

  if (exactQuestionTitleMap.has(next)) {
    return finalizeQuestionTitle(exactQuestionTitleMap.get(next));
  }

  if (
    /(?:^|.*)(通常怎么|通常要包含哪些核心内容|通常应包含哪些核心内容|为什么|什么情况下可以|最常见原因有哪些|各自怎么理解|各自适合什么场景|有哪些关键差异|适合用在什么场景|关键要点有哪些)$/u.test(
      next
    )
  ) {
    return finalizeQuestionTitle(next);
  }

  const replacementRules = [
    [/^(.+?)该如何开展$/u, "$1通常怎么开展"],
    [/^(.+?)如何开展$/u, "$1通常怎么开展"],
    [/^(.+?)如何设计$/u, "$1通常怎么设计"],
    [/^(.+?)试验设计$/u, "$1通常怎么设计"],
    [/^(.+?)设计内容$/u, "$1通常要包含哪些关键内容"],
    [/^(.+?)的设计内容$/u, "$1通常要包含哪些关键内容"],
    [/^(.+?)的意义$/u, "为什么要重视$1"],
    [/^(.+?)产生的影响因素$/u, "哪些因素会影响$1"],
    [/^(.+?)影响因素$/u, "哪些因素会影响$1"],
    [/^(.+?)评价内容$/u, "$1通常要评估哪些内容"],
    [/^(.+?)未来面临的问题$/u, "$1未来还面临哪些关键挑战"],
    [/^(.+?)受试者招募$/u, "$1为什么难，通常怎么提高效率"],
    [/^(.+?)差异$/u, "$1有哪些关键差异"],
    [/^(.+?)的重要性$/u, "为什么要重视$1"],
    [/^(.+?)的危害$/u, "$1可能带来哪些风险"],
    [/^(.+?)的优点$/u, "$1有哪些主要优点"],
    [/^(.+?)的缺点$/u, "$1有哪些主要局限"],
    [/^(.+?)的关系$/u, "$1之间是什么关系"],
    [/^(.+?)的作用$/u, "$1起什么作用"],
    [/^(.+?)的类型$/u, "$1常见有哪些类型"],
    [/^(.+?)的历史$/u, "$1是怎么发展起来的"],
    [/^(.+?)介绍$/u, "什么是$1"],
    [/^(.+?)汇总$/u, "$1通常包括哪些关键点"],
    [/^(.+?)说明$/u, "$1通常要怎么说明"],
  ];

  for (const [pattern, replacement] of replacementRules) {
    if (pattern.test(next)) {
      next = next.replace(pattern, replacement).trim();
      break;
    }
  }

  if (/^(.+?)失败的主要原因有哪些$/u.test(next)) {
    next = next.replace(/^(.+?)失败的主要原因有哪些$/u, "$1为什么会失败，最常见原因有哪些");
  }

  if (/^(.+?)有哪些$/u.test(next) && !/^(常见的|常用的|常用于|主要的)/u.test(next)) {
    next = next.replace(/^(.+?)有哪些$/u, "$1有哪些，各自怎么理解");
  }

  if (/小鼠$/u.test(next) && !/(什么|为什么|哪些|怎么|场景|特点)/u.test(next)) {
    next = `${next}有什么特点，适合用在什么场景`;
  }

  if (
    !/(什么|为什么|哪些|怎么|如何|多少|是否|能否|何时|场景|特点|意义|内容|影响|原因|挑战|判断|设计|开展|说明|调控|控制|分析|机理|原则|依据|风险|差异)/u.test(
      next
    )
  ) {
    next = `什么是${next}，关键要点有哪些`;
  }

  return finalizeQuestionTitle(next);
}

function normalizeBulletSentence(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[；;、，.\s]+/u, "")
    .trim();
}

function convertInlineNumberingToList(block) {
  const numbered = block
    .replace(/\s*(\d+[）)])\s*/gu, "\n$1 ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const numberedItems = numbered.filter((line) => /^\d+[）)]\s*/u.test(line));
  if (numberedItems.length < 2) {
    return block;
  }

  return numberedItems
    .map((line) => `- ${normalizeBulletSentence(line.replace(/^\d+[）)]\s*/u, ""))}`)
    .join("\n");
}

function convertSemicolonParagraphToList(block) {
  const parts = block
    .split(/[；;]+/u)
    .map((part) => normalizeBulletSentence(part))
    .filter(Boolean);

  if (parts.length < 2 || block.length < 70) {
    return block;
  }

  return parts.map((part) => `- ${part}`).join("\n");
}

function splitDenseParagraph(block) {
  const sentences = block
    .split(/(?<=[。！？])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length < 3 || block.length < 140) {
    return block;
  }

  return sentences.join("\n\n");
}

function normalizeAnswerMarkdown(answerMarkdown) {
  const blocks = answerMarkdown
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^(?:[-*]\s|\d+\.\s|>\s|```|:::|\|)/u.test(block)) {
        return block;
      }

      const numbered = convertInlineNumberingToList(block);
      if (numbered !== block) {
        return numbered;
      }

      const bulleted = convertSemicolonParagraphToList(block);
      if (bulleted !== block) {
        return bulleted;
      }

      return splitDenseParagraph(block);
    });

  return blocks.join("\n\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function renderAnswerContainer(markdown) {
  return `:::answer\n\n${markdown.trim()}\n\n:::`;
}

function buildTopicSupplement(topic) {
  const supplement = topicSupplementMap[topic.slug] ?? {
    module: `这个专题围绕${topic.title}建立整体判断框架，帮助你把分散知识点重新收拢成可用于项目决策的主线。`,
    pain: "真正难的通常不是记住概念，而是不知道什么时候该做、做到什么程度才算够、哪些结论可以真正支撑跨团队决策。",
    focus: "阅读时建议按“先看原理 -> 再看关键参数 -> 再看风险点 -> 最后看数据如何支持结论”的顺序进入。",
    linkage: "如果要把知识用到实际项目，建议把这个专题和上下游相关主题一起看，避免单点判断失真。",
  };

  return [
    "## 专题补充",
    "",
    renderAnswerContainer(
      [
        `- **这个专题真正要解决什么：** ${supplement.module}`,
        `- **项目里最常见的痛点：** ${supplement.pain}`,
        `- **阅读时最该抓住什么：** ${supplement.focus}`,
        `- **怎样把它用到项目里：** ${supplement.linkage}`,
      ].join("\n")
    ),
    "",
  ];
}

function buildSecondLevelSupplement(topic, topTopic) {
  const leafLabels = topic.leafs.map((leaf) => `“${leaf.label}”`).join("、");

  return [
    "## 主题补充",
    "",
    renderAnswerContainer(
      [
        `- **这组内容主要解决什么：** 这个主题聚焦${topTopic.title}中与“${topic.label}”相关的核心判断问题，重点不是背术语，而是把概念、场景和证据连起来。`,
        `- **最容易卡住的地方：** 很多问题表面看像知识题，实际本质是阶段判断、数据深度和风险边界没有分清楚。`,
        `- **建议怎么读：** 先看原理和目标，再看方法和参数，最后看异常情况、变更影响和结论怎么表达。`,
        `- **这一组会覆盖：** ${leafLabels}。`,
        `- **真正的使用场景：** 适合在方案设计、结果复盘、跨部门沟通和资料撰写前先建立统一口径。`,
      ].join("\n")
    ),
    "",
  ];
}

function buildLeafSupplement(leaf, parent, topTopic) {
  return [
    "## 这页先抓重点",
    "",
    renderAnswerContainer(
      [
        `- **这一页主要帮你解决什么：** 本页围绕“${leaf.label}”展开，重点处理${parent.label}里最常见、最容易混淆、也最影响项目判断的一组问题。`,
        `- **什么时候最适合读：** 当你已经知道问题大致属于“${topTopic.title}”，但还不确定该先补原理、方法、风险还是结论表达时，可以从这里开始。`,
        `- **建议阅读顺序：** 先看“是什么/为什么”类问题，再看“怎么做/怎么判断”类问题，最后看“风险、变更和例外情况”类问题。`,
        `- **使用提醒：** 任何结论都要结合产品类型、开发阶段、数据质量和法规场景一起理解，不能脱离上下文机械套用。`,
      ].join("\n")
    ),
    "",
  ];
}

function renderQuestionBlock(title, answerMarkdown, legacyId = "") {
  const heading = `## ${rewriteQuestionTitle(title)}`;
  const prefix = legacyId ? `<!-- cmc-question-id: ${legacyId} -->\n` : "";
  return `${prefix}${heading}\n\n${renderAnswerContainer(normalizeAnswerMarkdown(answerMarkdown))}`;
}

function extractAnswerMarkdown(block) {
  return block
    .replace(QUESTION_ID_COMMENT_RE, "")
    .replace(/^##\s+(?:Q\d+\.\s+)?(.+)$/m, "")
    .replace(/^:::\s*answer\s*\n?/m, "")
    .replace(/\n:::\s*$/m, "")
    .trim();
}

function parseQuestionBlocks(body, { requireLegacyId = false } = {}) {
  const headingMatches = [
    ...body.matchAll(
      /^(?:<!--\s*cmc-question-id:\s*(Q\d+)\s*-->\n)?##\s+(?:Q(\d+)\.\s+)?(.+)$/gm
    ),
  ];

  return headingMatches
    .map((match, index) => {
      const start = match.index;
      const end =
        index + 1 < headingMatches.length ? headingMatches[index + 1].index : body.length;
      const rawBlock = body.slice(start, end).trimEnd();
      const title = cleanupQuestionTitle(match[3]);

      if (!/\n:::\s*answer\b/m.test(rawBlock)) {
        return null;
      }
      if (requireLegacyId && !match[1]) {
        return null;
      }
      if (!title || NAV_SECTION_TITLES.has(title)) {
        return null;
      }

      const answerMarkdown = extractAnswerMarkdown(rawBlock);
      if (!answerMarkdown) {
        return null;
      }

      const legacyId = match[1] || (match[2] ? `Q${match[2]}` : "");
      const number = legacyId
        ? Number(legacyId.replace(/^Q/, ""))
        : match[2]
          ? Number(match[2])
          : index + 1;

      return {
        legacyId,
        number,
        title,
        answerMarkdown,
      };
    })
    .filter(Boolean);
}

function renderInline($, node) {
  if (node.type === "text") {
    return node.data.replace(/\s+/g, " ");
  }

  if (node.type !== "tag") {
    return "";
  }

  const $node = $(node);
  const children = $node
    .contents()
    .toArray()
    .map((child) => renderInline($, child))
    .join("");

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
      return "<br>\n";
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
        const text = $node
          .contents()
          .toArray()
          .map((child) => renderInline($, child))
          .join("")
          .trim();
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
          output += `${indent}${prefix}${inlineParts.join("").trim()}\n`;

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
          output += `| ${rows[0].join(" | ")} |\n`;
          output += `| ${rows[0].map(() => "---").join(" | ")} |\n`;
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

const distCache = new Map();
const distHtmlCache = new Map();

function getDistDocument(slug) {
  if (distCache.has(slug)) {
    return distCache.get(slug);
  }

  const file = path.join(distDir, `${slug}.html`);
  if (!fs.existsSync(file)) {
    distCache.set(slug, null);
    return null;
  }

  const $ = load(read(file), { decodeEntities: false });
  distCache.set(slug, $);
  return $;
}

function getDistHtml(slug) {
  if (distHtmlCache.has(slug)) {
    return distHtmlCache.get(slug);
  }

  const file = path.join(distDir, `${slug}.html`);
  if (!fs.existsSync(file)) {
    distHtmlCache.set(slug, "");
    return "";
  }

  const html = read(file);
  distHtmlCache.set(slug, html);
  return html;
}

function getTitleFromDist(slug) {
  const $ = getDistDocument(slug);
  return $?.(".vp-page-title h1").first().text().trim() ?? "";
}

function getQuestionsFromDist(slug) {
  const $ = getDistDocument(slug);
  if (!$) {
    return [];
  }

  return $(".theme-default-content h2")
    .toArray()
    .map((heading, index) => {
      const $heading = $(heading);
      const answer = $heading.nextAll("div.hint-container.answer").first();
      if (!answer.length) {
        return null;
      }

      const headingText =
        $heading.find("span").last().text().trim() ||
        $heading.text().trim();
      const title = cleanupQuestionTitle(headingText);
      if (!title || NAV_SECTION_TITLES.has(title)) {
        return null;
      }

      const answerMarkdown = renderBlocks($, answer.contents().toArray())
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!answerMarkdown) {
        return null;
      }

      return {
        legacyId: `Q${index + 1}`,
        number: index + 1,
        title,
        answerMarkdown,
      };
    })
    .filter(Boolean);
}

function hasBrokenQuestionBlocks(questions) {
  return questions.some(
    (question) =>
      /(?:^|\n)Q\d+\.\s+/m.test(question.answerMarkdown) ||
      /^这页先抓重点/u.test(question.title) ||
      /通常(?:要|应)包含哪些(?:关键|核心).*通常(?:要|应)包含哪些核心内容/u.test(
        question.title
      ) ||
      /为什么会失败，最常见原因有哪些，各自怎么理解/u.test(question.title) ||
      /(什么|怎么|如何|为什么|哪些|多少|是否).+的核心要点是什么$/u.test(question.title)
  );
}

function applyLegacyIds(questions, sourceQuestions = []) {
  return questions.map((question, index) => {
    const legacyId = sourceQuestions[index]?.legacyId || question.legacyId || `Q${index + 1}`;

    return {
      ...question,
      legacyId,
      number: Number(legacyId.replace(/^Q/, "")) || question.number || index + 1,
    };
  });
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

function buildDocument({ lead, frontmatter, title, articleFalse = false, body }) {
  const parts = [];
  if (lead) {
    parts.push(lead);
  }
  parts.push(buildFrontmatter(frontmatter, title, articleFalse).trimEnd());
  parts.push(body.trim());
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

function pluralizeKnowledge(count) {
  return `${count} 个知识点`;
}

const allFiles = fs
  .readdirSync(docsDir)
  .filter((file) => file.endsWith(".md"))
  .sort();

const topicFiles = allFiles.filter((file) => /^\d{2}-.+\.md$/.test(file));
const topLevelFiles = topicFiles.filter((file) => getSuffixDepth(getPathNoExt(file)) === 0);
const secondLevelFiles = topicFiles.filter((file) => getSuffixDepth(getPathNoExt(file)) === 1);
const leafFiles = topicFiles.filter((file) => getSuffixDepth(getPathNoExt(file)) === 2);

function getFileMeta(file) {
  const fullPath = path.join(docsDir, file);
  const text = read(fullPath);
  const parsed = parseFrontmatter(text);
  return {
    file,
    slug: getPathNoExt(file),
    fullPath,
    lead: parsed.lead,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    title: getTitleFromMarkdown(text) || getTitleFromDist(getPathNoExt(file)) || getPathNoExt(file),
  };
}

const topLevelMeta = new Map(topLevelFiles.map((file) => [getPathNoExt(file), getFileMeta(file)]));
const secondLevelMeta = new Map(
  secondLevelFiles.map((file) => [getPathNoExt(file), getFileMeta(file)])
);
const leafMeta = new Map(leafFiles.map((file) => [getPathNoExt(file), getFileMeta(file)]));

const leafData = new Map();

for (const file of leafFiles) {
  const meta = getFileMeta(file);
  const strictQuestions = parseQuestionBlocks(meta.body, { requireLegacyId: true });
  const fallbackQuestions = strictQuestions.length ? strictQuestions : parseQuestionBlocks(meta.body);
  const distQuestions = getQuestionsFromDist(meta.slug);
  let questions = fallbackQuestions;

  if (questions.length === 0 && distQuestions.length > 0) {
    questions = applyLegacyIds(distQuestions, fallbackQuestions);
  } else if (hasBrokenQuestionBlocks(questions) && distQuestions.length > 0) {
    questions = applyLegacyIds(distQuestions, fallbackQuestions);
  } else if (distQuestions.length === questions.length && strictQuestions.length === 0) {
    questions = applyLegacyIds(distQuestions, fallbackQuestions);
  }

  if (questions.length === 0) {
    throw new Error(`No knowledge blocks found for ${file}`);
  }

  leafData.set(meta.slug, {
    ...meta,
    title: meta.title || getTitleFromDist(meta.slug),
    label: getLeafLabel(meta.title || getTitleFromDist(meta.slug), meta.slug),
    parentSlug: getParentSlug(meta.slug),
    topLevelSlug: getTopLevelSlug(meta.slug),
    questions,
    count: questions.length,
  });
}

const secondLevelData = new Map();

for (const file of secondLevelFiles) {
  const meta = secondLevelMeta.get(getPathNoExt(file));
  const childLeafs = leafFiles
    .map(getPathNoExt)
    .filter((slug) => getParentSlug(slug) === meta.slug)
    .map((slug) => leafData.get(slug))
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (childLeafs.length === 0) {
    throw new Error(`No leaf pages found under ${file}`);
  }

  secondLevelData.set(meta.slug, {
    ...meta,
    title: meta.title || getTitleFromDist(meta.slug),
    label: getSecondLevelLabel(meta.title || getTitleFromDist(meta.slug)),
    topLevelSlug: getTopLevelSlug(meta.slug),
    leafs: childLeafs,
    count: childLeafs.reduce((sum, item) => sum + item.count, 0),
  });
}

const topLevelData = new Map();

for (const file of topLevelFiles) {
  const meta = topLevelMeta.get(getPathNoExt(file));
  const children = secondLevelFiles
    .map(getPathNoExt)
    .filter((slug) => getTopLevelSlug(slug) === meta.slug)
    .map((slug) => secondLevelData.get(slug))
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  topLevelData.set(meta.slug, {
    ...meta,
    title: meta.title || getTitleFromDist(meta.slug),
    label: meta.title || getTitleFromDist(meta.slug),
    topics: children,
    count: children.reduce((sum, item) => sum + item.count, 0),
    leafCount: children.reduce((sum, item) => sum + item.leafs.length, 0),
  });
}

for (const [slug, leaf] of leafData) {
  const parent = secondLevelData.get(leaf.parentSlug);
  const top = topLevelData.get(leaf.topLevelSlug);
  const siblings = parent.leafs;
  const index = siblings.findIndex((item) => item.slug === slug);
  const sectionLabel = leaf.label;
  const secondLevelLabel = parent.label;
  const lines = [
    `# ${leaf.title}`,
    "",
    `> 本页把“${secondLevelLabel}”里与“${sectionLabel}”最常见、最容易混淆、也最影响判断的知识点集中整理在一起，共 ${pluralizeKnowledge(
      leaf.count
    )}。`,
    "",
    CMC_LEAF_NOTICE,
    "",
    `- [返回二级主题总览](/posts/cmc-knowledge/${parent.slug}.html)`,
    `- [返回一级专题总览](/posts/cmc-knowledge/${top.slug}.html)`,
  ];

  if (index > 0) {
    lines.push(`- [上一细分主题](/posts/cmc-knowledge/${siblings[index - 1].slug}.html)`);
  }
  if (index < siblings.length - 1) {
    lines.push(`- [下一细分主题](/posts/cmc-knowledge/${siblings[index + 1].slug}.html)`);
  }

  lines.push(
    "",
    ...buildLeafSupplement(leaf, parent, top),
    "",
    ...leaf.questions.flatMap((question, questionIndex) => [
      renderQuestionBlock(
        question.title,
        question.answerMarkdown,
        question.legacyId || `Q${question.number || questionIndex + 1}`
      ),
      "",
    ])
  );

  write(
    leaf.fullPath,
    buildDocument({
      lead: leaf.lead,
      frontmatter: leaf.frontmatter,
      title: leaf.title,
      body: lines.join("\n"),
    })
  );
}

for (const [, topic] of secondLevelData) {
  const topTopic = topLevelData.get(topic.topLevelSlug);
  const lines = [
    `# ${topic.title}`,
    "",
    `> 这一组内容把“${topic.label}”下最值得优先掌握的问题收拢到一起，共整理 ${pluralizeKnowledge(
      topic.count
    )}，按 ${topic.leafs.length} 个细分页面分层展开。`,
    "",
    `如果你已经知道问题属于“${topTopic.title}”，但还不确定应该先补哪一类内容，这一页可以先帮你把阅读路径理顺。`,
    "",
    ...buildSecondLevelSupplement(topic, topTopic),
    "",
    "## 细分主题",
    "",
    ...topic.leafs.map(
      (leaf) =>
        `- [${leaf.label}](/posts/cmc-knowledge/${leaf.slug}.html)（${pluralizeKnowledge(
          leaf.count
        )}）`
    ),
    "",
    "## 维护建议",
    "",
    "- 当前页面保留为二级主题导航页，适合先判断自己要解决的是哪一类问题。",
    "- 细分页已经取消题号式展示，后续新增内容可以直接补到最合适的位置。",
    "- 若通过站内搜索进入单个知识点，也可以回到本页查看同主题下的相邻内容。",
    "",
  ];

  write(
    topic.fullPath,
    buildDocument({
      lead: topic.lead,
      frontmatter: topic.frontmatter,
      title: topic.title,
      articleFalse: true,
      body: lines.join("\n"),
    })
  );
}

for (const [, topic] of topLevelData) {
  const lines = [
    `# ${topic.title}`,
    "",
    `> 当前专题共整理 ${pluralizeKnowledge(topic.count)}、${topic.topics.length} 个二级主题、${topic.leafCount} 个细分页面，已经按“先理解问题，再进入判断，再补充证据”的逻辑重组。`,
    "",
    `这不是一组零散问答，而是一套围绕${topic.title}搭起来的知识结构。建议先看下面的专题补充，再决定从哪个二级主题切入。`,
    "",
    ...buildTopicSupplement(topic),
    "",
    "## 二级主题",
    "",
    ...topic.topics.map(
      (child) =>
        `- [${child.label}](/posts/cmc-knowledge/${child.slug}.html)（${pluralizeKnowledge(
          child.count
        )} / ${child.leafs.length} 个细分主题）`
    ),
    "",
    "## 阅读与维护",
    "",
    "- 一级专题页继续作为总入口，适合先按工作模块定位问题域。",
    "- 二级主题页负责把同一类问题收拢到一起，减少重复翻页和重复维护。",
    "- 细分主题页承载具体知识点，适合连续阅读、搜索命中和后续增补。",
    "",
  ];

  write(
    topic.fullPath,
    buildDocument({
      lead: topic.lead,
      frontmatter: topic.frontmatter,
      title: topic.title,
      articleFalse: true,
      body: lines.join("\n"),
    })
  );
}

const totalKnowledgeCount = [...topLevelData.values()].reduce((sum, item) => sum + item.count, 0);
const totalSecondLevelCount = secondLevelData.size;
const totalLeafCount = leafData.size;

const readmeMeta = getFileMeta(path.basename(readmeFile));
const readmeLines = [
  "# CMC 知识库",
  "",
  `围绕生物制品 CMC 全流程建立的主题式知识库，当前已整理为 16 个一级专题、${totalSecondLevelCount} 个二级主题、${totalLeafCount} 个细分主题页面，总计 ${pluralizeKnowledge(
    totalKnowledgeCount
  )}。这套内容已经按“问题更像真实项目、回答更像专业判断、结构更适合持续补充”的思路完成一次统一重整。`,
  "",
  '<div class="home-intro">',
  '  <p class="home-lead">',
  "    该专题适用于工艺开发、分析开发、质量、注册、技术转移以及平台化团队进行系统学习、快速定位和持续沉淀。",
  "  </p>",
  "</div>",
  "",
  "## 这套知识库适合怎么用",
  "",
  renderAnswerContainer(
    [
      "- **如果你想系统学习：** 建议按一级专题 -> 二级主题 -> 细分页的顺序读，先建立全局框架，再进入具体问题。",
      "- **如果你要解决项目问题：** 先按专题定位问题域，再用站内搜索命中具体知识点，最后回到上一级页面看相邻主题。",
      "- **如果你要继续维护内容：** 现在所有问答都已经取消外显题号，并统一包裹在 `answer` 容器中，后续可以直接插到最合适的位置。",
      "- **如果你是跨部门协同：** 建议把这里当作统一口径的底稿，先在知识库里对齐问题定义，再回到项目文件里做决策。",
    ].join("\n")
  ),
  "",
  "## 阅读方式",
  "",
  "- 按一级专题阅读：先进入总览页，再按二级主题和细分主题逐层下钻。",
  "- 按工作场景阅读：工艺开发重点看上游、下游、表征；质量与注册重点看分析、法规、病毒安全。",
  "- 按关键词搜索：站内搜索会直接命中细分主题中的具体知识点，而不只停留在专题首页。",
  "",
  "## 维护方式",
  "",
  "- 当前知识库已取消题号式展示，后续新增内容可以直接插入对应主题，不需要整体顺延重排。",
  "- 目录结构按“一级专题 -> 二级主题 -> 细分主题页”组织，适合持续扩充。",
  `- 维护规则见 [CMC 知识库维护说明](/posts/cmc-knowledge/${getPathNoExt(
    path.basename(maintenanceFile)
  )}.html)，批量整理可执行 \`pnpm cmc:organize\`。`,
  "",
  "## 一级专题目录",
  "",
  ...[...topLevelData.values()].map(
    (topic) =>
      `- [${topic.title}](/posts/cmc-knowledge/${topic.slug}.html)（${pluralizeKnowledge(
        topic.count
      )} / ${topic.topics.length} 个二级主题 / ${topic.leafCount} 个细分主题）`
  ),
  "",
  "## 说明",
  "",
  "- 每个一级专题页保留原路径，旧链接不会失效。",
  "- 二级主题页负责语义化分组，细分主题页负责承载具体内容。",
  "- 详细树状导航可在 [CMC 知识导航](/posts/cmc-knowledge/cmc.html) 和左侧 sidebar 中查看。",
  "",
];

write(
  readmeFile,
  buildDocument({
    lead: readmeMeta.lead,
    frontmatter: readmeMeta.frontmatter,
    title: readmeMeta.title,
    articleFalse: true,
    body: readmeLines.join("\n"),
  })
);

const navMeta = getFileMeta(path.basename(navFile));
const navLines = [
  "# CMC 知识导航",
  "",
  `> 当前知识库共整理 ${pluralizeKnowledge(totalKnowledgeCount)}、${totalSecondLevelCount} 个二级主题、${totalLeafCount} 个细分页面。建议先按一级专题定位，再进入二级主题和具体细分页。`,
  "",
  "## 使用方式",
  "",
  "- 先按一级专题确认问题属于哪个 CMC 模块，再进入二级主题页判断阅读路径。",
  "- 如果已经有明确关键词，可直接用站内搜索命中对应知识点，再回到导航页查看相邻内容。",
  `- 需要继续补充或改写内容时，优先参考 [CMC 知识库维护说明](/posts/cmc-knowledge/${getPathNoExt(
    path.basename(maintenanceFile)
  )}.html)。`,
  "",
  "## 专题树状导航",
  "",
];

for (const topic of [...topLevelData.values()]) {
  navLines.push(`### ${topic.title}`, "");
  navLines.push(
    `- [专题总览](/posts/cmc-knowledge/${topic.slug}.html)（${pluralizeKnowledge(topic.count)}）`
  );

  for (const child of topic.topics) {
    navLines.push(
      `- [${child.label}](/posts/cmc-knowledge/${child.slug}.html)（${pluralizeKnowledge(
        child.count
      )}）`
    );
    for (const leaf of child.leafs) {
      navLines.push(
        `  - [${leaf.label}](/posts/cmc-knowledge/${leaf.slug}.html)（${pluralizeKnowledge(
          leaf.count
        )}）`
      );
    }
  }

  navLines.push("");
}

write(
  navFile,
  buildDocument({
    lead: navMeta.lead,
    frontmatter: navMeta.frontmatter,
    title: navMeta.title,
    articleFalse: true,
    body: navLines.join("\n"),
  })
);

const sidebar = [...topLevelData.values()].map((topic) => ({
  text: topic.title,
  link: `/posts/cmc-knowledge/${topic.slug}.html`,
  collapsible: true,
  expanded: false,
  children: topic.topics.map((child) => ({
    text: child.label,
    link: `/posts/cmc-knowledge/${child.slug}.html`,
    collapsible: true,
    expanded: false,
    children: child.leafs.map((leaf) => ({
      text: leaf.label,
      link: `/posts/cmc-knowledge/${leaf.slug}.html`,
    })),
  })),
}));

write(sidebarFile, `export const cmcSidebar = ${JSON.stringify(sidebar, null, 2)};\n`);
