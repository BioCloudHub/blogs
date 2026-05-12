<template>
  <div class="home-bg" aria-hidden="true">
    <div class="home-bg-blob home-bg-blob--1"></div>
    <div class="home-bg-blob home-bg-blob--2"></div>
    <div class="home-bg-blob home-bg-blob--3"></div>

    <div class="home-bg-grid"></div>

    <div class="home-bg-dna">
      <div class="dna-helix">
        <div class="dna-strand dna-strand--a">
          <span v-for="i in 10" :key="'a'+i" class="dna-node" :style="nodeStyle(i, 'a')" />
        </div>
        <div class="dna-strand dna-strand--b">
          <span v-for="i in 10" :key="'b'+i" class="dna-node dna-node--b" :style="nodeStyle(i, 'b')" />
        </div>
      </div>
    </div>

    <svg class="home-bg-lines" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
      <line v-for="(l, i) in conLines" :key="i"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        class="bg-line" :style="{ animationDelay: -i * 0.3 + 's' }" />
    </svg>

    <div class="home-bg-nodes">
      <span v-for="n in 14" :key="n" class="bg-node"
        :class="'bg-node--' + (n % 3 === 0 ? 'green' : n % 3 === 1 ? 'blue' : 'purple')"
        :style="bgNodeStyle(n)" />
    </div>
  </div>
</template>

<script setup lang="ts">
function seed(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const nodeStyle = (i: number, strand: string) => ({
  top: `calc(8% + ${(i - 1) * 9.5}%)`,
  animationDelay: `${strand === 'a' ? -i * 0.12 : -(i * 0.12 + 0.6)}s`,
});

// Pre-computed node positions and connections
const nodes = Array.from({ length: 14 }, (_, i) => ({
  x: 5 + seed(i * 13 + 1) * 90,
  y: 5 + seed(i * 23 + 1) * 90,
  size: 5 + seed(i * 31 + 1) * 10,
}));

const conLines = [];
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const dx = (nodes[i].x - nodes[j].x) / 100 * 1200;
    const dy = (nodes[i].y - nodes[j].y) / 100 * 800;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 280) {
      conLines.push({
        x1: nodes[i].x / 100 * 1200, y1: nodes[i].y / 100 * 800,
        x2: nodes[j].x / 100 * 1200, y2: nodes[j].y / 100 * 800,
      });
    }
  }
}

const bgNodeStyle = (n: number) => {
  const nd = nodes[n - 1];
  return {
    left: `${nd.x}%`, top: `${nd.y}%`,
    width: `${nd.size}px`, height: `${nd.size}px`,
    animationDelay: `${-n * 0.7}s`,
  };
};
</script>
