---
home: true
title: BioCloudHub
heroText: BioCloudHub
tagline: 生物医药 · 云计算 · 创新研发
actions:
  - text: 技术博客
    link: /posts/
    type: primary
  - text: 关于我们
    link: /about/
    type: secondary
features:
  - title: 生物信息学
    details: 基因组学、蛋白质组学与大数据分析。
  - title: 云计算平台
    details: 高性能计算、容器化部署与弹性扩展。
  - title: 创新研发
    details: AI 药物发现、分子模拟与临床数据分析。
---

<div align="center">

## 探索生命科学的数字化未来

**BioCloudHub** 致力于生物医药领域的云计算与数据分析解决方案。

</div>

<script setup>
const concepts = [
  { name: '🧬 基因组分析', desc: '高通量测序数据处理' },
  { name: '💊 药物发现', desc: 'AI 驱动的分子设计' },
  { name: '🔬 临床研究', desc: '数据标准化与可视化' },
  { name: '☁️ 云端计算', desc: '弹性算力与存储' }
]
</script>

<div class="concept-grid">
  <div v-for="item in concepts" :key="item.name" class="concept-card">
    <div class="concept-icon">{{ item.name.split(' ')[0] }}</div>
    <div class="concept-title">{{ item.name.split(' ').slice(1).join(' ') }}</div>
    <div class="concept-desc">{{ item.desc }}</div>
  </div>
</div>

<style>
.concept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.concept-card {
  background: linear-gradient(135deg, #f0f7ff 0%, #e8f4f8 100%);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
  border: 1px solid #e0e7ff;
  transition: all 0.3s ease;
}

.concept-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.15);
  border-color: #3b82f6;
}

.concept-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.concept-title {
  font-weight: 600;
  color: #1e40af;
  margin-bottom: 0.25rem;
}

.concept-desc {
  font-size: 0.875rem;
  color: #64748b;
}
</style>

