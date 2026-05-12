<template>
  <div v-if="reducedMotion" class="home-pipeline-wrapper">
    <div class="home-pipeline">
      <div class="pipeline-header">
        <h2>生物药开发全流程</h2>
        <p>从靶点发现到商业化生产的技术链路</p>
      </div>
      <div class="pipeline-steps-static">
        <div v-for="(step, i) in steps" :key="i" class="pipeline-step">
          <div class="pipeline-step-marker">
            <span class="pipeline-step-icon">{{ step.icon }}</span>
          </div>
          <div class="pipeline-step-content" style="opacity:1;transform:none;">
            <h3>{{ step.title }}</h3>
            <p>{{ step.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else ref="wrapperRef" class="home-pipeline-wrapper">
    <div ref="sectionRef" class="home-pipeline">
      <div class="pipeline-header">
        <h2>生物药开发全流程</h2>
        <p>从靶点发现到商业化生产的技术链路</p>
      </div>

      <div class="pipeline-track">
        <div ref="progressRef" class="pipeline-progress" :style="progressStyle"></div>

        <div
          v-for="(step, i) in steps"
          :key="i"
          class="pipeline-step"
          :class="{ 'is-active': activeStep >= i }"
        >
          <div class="pipeline-step-marker">
            <span class="pipeline-step-icon">{{ step.icon }}</span>
          </div>
          <div class="pipeline-step-content">
            <h3>{{ step.title }}</h3>
            <p>{{ step.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const steps = [
  { icon: "🔬", title: "靶点发现", desc: "AI 驱动的靶点识别、分子模拟与虚拟筛选" },
  { icon: "🧬", title: "临床前研究", desc: "ADMET 预测、先导化合物优化与成药性评估" },
  { icon: "⚗️", title: "CMC 开发", desc: "细胞株开发、上下游工艺、制剂处方研究" },
  { icon: "📋", title: "临床申报", desc: "IND/NDA 申报策略、CTD 资料撰写与审评沟通" },
  { icon: "🏭", title: "生产质控", desc: "工艺放大、质量体系、持续工艺验证与供应链" },
];

const wrapperRef = ref<HTMLElement | null>(null);
const sectionRef = ref<HTMLElement | null>(null);
const progressRef = ref<HTMLElement | null>(null);
const reducedMotion = ref(false);
const activeStep = ref(0);
const progressPct = ref(0);

const progressStyle = computed(() => {
  if (typeof window === "undefined") return {};
  const isVertical = window.innerWidth < 960;
  if (isVertical) {
    return { height: `${progressPct.value * 100}%`, width: "2px" };
  }
  return { width: `${progressPct.value * 100}%` };
});

let st: InstanceType<typeof ScrollTrigger> | null = null;
let gsapModule: typeof import("gsap").default | null = null;
let STModule: typeof import("gsap/ScrollTrigger").ScrollTrigger | null = null;

async function ensureGSAP(): Promise<boolean> {
  if (gsapModule) return true;
  try {
    const [gsap, stMod] = await Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
    ]);
    gsapModule = gsap.default;
    STModule = stMod.ScrollTrigger;
    gsapModule.registerPlugin(STModule);
    return true;
  } catch {
    return false;
  }
}

function getPinDistance(): number {
  const h = window.innerHeight;
  return Math.max(steps.length * h * 0.45, steps.length * 280);
}

async function createScrollTrigger(): Promise<void> {
  if (!sectionRef.value) return;
  const ok = await ensureGSAP();
  if (!ok) return;

  const ScrollTrigger = STModule!;

  const pinEnd = `+=${getPinDistance()}`;

  st = ScrollTrigger.create({
    trigger: wrapperRef.value!,
    start: "top center",
    end: pinEnd,
    pin: sectionRef.value,
    pinSpacing: true,
    scrub: 0.8,
    onUpdate(self) {
      const progress = self.progress;
      progressPct.value = progress;

      const stepSize = 1 / (steps.length - 1);
      const rawStep = Math.round(progress / stepSize);
      activeStep.value = Math.min(rawStep, steps.length - 1);
    },
  });
}

function destroyScrollTrigger(): void {
  if (st) {
    (st as any).kill();
    st = null;
  }
}

let resizeTimer = 0;
function handleResize(): void {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    destroyScrollTrigger();
    void createScrollTrigger();
  }, 300);
}

onMounted(() => {
  reducedMotion.value =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (!reducedMotion.value) {
    requestAnimationFrame(() => {
      void createScrollTrigger();
    });
    window.addEventListener("resize", handleResize);
  }
});

onBeforeUnmount(() => {
  destroyScrollTrigger();
  window.removeEventListener("resize", handleResize);
  clearTimeout(resizeTimer);
});
</script>

<style scoped>
.pipeline-steps-static {
  display: flex;
  gap: 0;
  padding-top: 28px;
  position: relative;
}

.pipeline-steps-static::before {
  content: "";
  position: absolute;
  top: 20px;
  left: 8%;
  right: 8%;
  height: 2px;
  background: var(--bc-line);
  border-radius: 1px;
}

.pipeline-steps-static .pipeline-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pipeline-steps-static .pipeline-step-content {
  opacity: 1;
  transform: none;
  text-align: center;
  margin-top: 0.8rem;
  padding: 0 0.3rem;
}

.pipeline-steps-static .pipeline-step-marker {
  border-color: var(--vp-c-brand-1);
  background: linear-gradient(135deg, rgba(15, 155, 215, 0.15), rgba(58, 165, 115, 0.1));
}

@media (max-width: 959px) {
  .pipeline-steps-static {
    flex-direction: column;
    gap: 0;
    padding-top: 0;
    padding-left: 28px;
  }

  .pipeline-steps-static::before {
    top: 0;
    bottom: 0;
    left: 20px;
    right: auto;
    width: 2px;
    height: auto;
  }

  .pipeline-steps-static .pipeline-step {
    flex-direction: row;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.8rem 0;
  }

  .pipeline-steps-static .pipeline-step-content {
    text-align: left;
    margin-top: 0;
  }
}
</style>
