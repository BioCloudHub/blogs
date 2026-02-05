---
title: 单细胞测序数据分析实战
date: 2026-01-28 16:45:00
category: 生物信息学
tags: [单细胞测序, scRNA-seq, 聚类分析, 细胞命运]
author: BioCloudHub
---

# 单细胞测序数据分析实战

## 单细胞技术概述

单细胞测序技术革命性地改变了我们对细胞异质性的理解。通过对单个细胞进行转录组测序，我们可以：

- 揭示细胞类型的多样性
- 追踪细胞发育轨迹
- 发现罕见细胞群体
- 解析组织微环境

## 分析流程

### 数据预处理

```python
import scanpy as sc
import anndata as ad

class SingleCellAnalysis:
    """单细胞数据分析工具类"""
    
    def __init__(self, raw_counts):
        self.adata = ad.AnnData(X=raw_counts)
        
    def quality_control(self, min_genes=200, min_cells=3, mt_ratio=0.2):
        """质量控制"""
        # 过滤低质量细胞
        sc.pp.filter_cells(self.adata, min_genes=min_genes)
        sc.pp.filter_genes(self.adata, min_cells=min_cells)
        
        # 计算线粒体基因比例
        self.adata.var['mt'] = self.adata.var_names.str.startswith('MT-')
        self.adata.obs['mt_percent'] = (
            self.adata[:, self.adata.var['mt']].X.sum(axis=1) / 
            self.adata.X.sum(axis=1) * 100
        )
        
        # 过滤高线粒体比例细胞
        self.adata = self.adata[self.adata.obs['mt_percent'] < mt_ratio]
        return self.adata
    
    def normalize(self, target_sum=1e4):
        """标准化"""
        sc.pp.normalize_total(self.adata, target_sum=target_sum)
        sc.pp.log1p(self.adata)
        return self.adata
    
    def dimensionality_reduction(self, n_neighbors=15, n_pcs=50):
        """降维分析"""
        # PCA
        sc.pp.highly_variable_genes(self.adata, n_top_genes=2000)
        sc.pp.pca(self.adata, n_comps=n_pcs, use_highly_variable=True)
        
        # UMAP
        sc.pp.neighbors(self.adata, n_neighbors=n_neighbors, n_pcs=n_pcs)
        sc.tl.umap(self.adata)
        
        return self.adata
```

### 细胞聚类

```python
def cluster_cells(adata, resolution=1.0, algorithm='leiden'):
    """细胞聚类"""
    # Leiden 聚类
    sc.tl.leiden(adata, resolution=resolution, flavor='algorithm')
    
    # 计算聚类标记基因
    sc.tl.rank_genes_groups(adata, 'leiden', method='wilcoxon')
    
    return adata

# 聚类结果可视化
def plot_cluster(adata, color=['leiden', 'marker_genes']):
    """绘制聚类结果"""
    sc.pl.umap(adata, 
               color=color,
               frameon=False,
               cmap='RdBu_r',
               legend_loc='on data',
               save='clustering_results.pdf')
```

## 细胞类型注释

### 自动化注释

```python
class CellTypeAnnotator:
    """细胞类型注释器"""
    
    def __init__(self, marker_database='cellmarker'):
        self.marker_db = self._load_marker_database(marker_database)
        
    def _load_marker_database(self, db_name):
        """加载标记基因数据库"""
        return {
            'T细胞': ['CD3D', 'CD3E', 'CD3G', 'CD2'],
            'B细胞': ['CD79A', 'CD79B', 'MS4A1', 'CD19'],
            'NK细胞': ['GNLY', 'NKG7', 'KLRD1', 'FGFBP2'],
            '单核细胞': ['CD14', 'FCGR3A', 'LYZ', 'CST3'],
            '树突状细胞': ['FCER1A', 'CD1C', 'CST3', 'CCR7']
        }
    
    def annotate_cluster(self, adata, cluster_id):
        """注释细胞簇"""
        cluster_genes = sc.get.rank_genes_groups_df(
            adata, group=str(cluster_id)
        )
        
        scores = {}
        for cell_type, markers in self.marker_db.items():
            overlap = set(markers) & set(cluster_genes.names)
            scores[cell_type] = len(overlap)
        
        return max(scores, key=scores.get)
```

### 细胞轨迹分析

```python
def trajectory_inference(adata):
    """细胞轨迹推断"""
    # 选择根细胞
    root_cell = adata.obs['pseudotime'].idxmin()
    adata.uns['iroot'] = adata.obs_names.tolist().index(root_cell)
    
    # 计算伪时间
    sc.tl.dpt(adata)
    
    # 检测分化分支点
    sc.tl.paga(adata, groups='leiden')
    sc.pl.paga(adata, 
               color=['leiden', 'dpt_pseudotime'],
               save='trajectory.pdf')
    
    return adata
```

## 数据整合分析

### 批次效应校正

```python
def integrate_datasets(adata_list, batch_key='batch'):
    """整合多个数据集"""
    # 合并数据集
    combined = adata_list[0].concatenate(
        *adata_list[1:], 
        batch_key=batch_key,
        batch_categories=[f'batch_{i}' for i in range(len(adata_list))]
    )
    
    # Harmony 批次校正
    sc.external.pp.harmony_integrate(
        combined, 
        key=batch_key,
        max_iter_harmony=20
    )
    
    # 基于校正后的矩阵重新聚类
    sc.pp.neighbors(combined, use_rep='X_pca_harmony')
    sc.tl.umap(combined)
    sc.tl.leiden(combined)
    
    return combined
```

## 可视化展示

### 多组学整合

```python
import matplotlib.pyplot as plt

def create_multi_panel_figure(adata):
    """创建多面板展示图"""
    fig, axes = plt.subplots(2, 3, figsize=(15, 10))
    
    # UMAP 按聚类着色
    sc.pl.umap(adata, color='leiden', 
               ax=axes[0, 0], show=False)
    
    # UMAP 按 marker 基因着色
    marker_genes = ['CD3D', 'CD79A', 'CD14']
    for i, gene in enumerate(marker_genes[:2]):
        sc.pl.umap(adata, color=gene,
                  ax=axes[0, i+1], show=False)
    
    # 细胞周期分析
    sc.pl.umap(adata, color='phase',
               ax=axes[1, 0], show=False)
    
    # 伪时间轨迹
    sc.pl.umap(adata, color='dpt_pseudotime',
               ax=axes[1, 1], show=False)
    
    # 基因表达热图
    sc.pl.rank_genes_groups_heatmap(adata, 
                                    ax=axes[1, 2], 
                                    show=False)
    
    plt.tight_layout()
    plt.savefig('single_cell_analysis.png', dpi=300)
```

## 常见问题

### Q1: 如何处理双胞（doublets）？

```python
# 使用 Scrublet 检测双胞
from scrublet import Scrublet

def detect_doublets(adata):
    """双胞检测"""
    scrub = Scrublet(adata.X)
    doublet_scores, predicted_doublets = scrub.scrub_doublets()
    
    adata.obs['doublet_score'] = doublet_scores
    adata.obs['predicted_doublet'] = predicted_doublets
    
    # 过滤双胞
    adata = adata[~adata.obs['predicted_doublet']]
    
    return adata
```

## 总结

单细胞数据分析需要综合运用统计方法和生物学知识。掌握这些核心技术将帮助你从单细胞数据中挖掘有价值的生物学洞察。
