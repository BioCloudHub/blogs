---
title: 临床试验数据分析方法
date: 2026-02-03 08:30:00
category: 创新研发
tags: [临床试验, 统计分析, 生存分析, 医学研究]
author: BioCloudHub
---

# 临床试验数据分析方法

## 临床试验概述

临床试验是验证药物或治疗方案安全性和有效性的关键环节。数据分析贯穿整个试验过程，从方案设计到最终报告。

### 试验分期

| 阶段 | 目的 | 样本量 | 主要终点 |
|------|------|--------|----------|
| I 期 | 安全性、耐受性 | 20-100 | 不良事件 |
| II 期 | 有效性、剂量 | 100-300 | 疗效指标 |
| III 期 | 确证性研究 | 300-3000 | 临床终点 |
| IV 期 | 上市后监测 | 数千+ | 长期安全性 |

## 统计分析计划

### 主要分析框架

```r
library(clinicalr)
library(survival)
library(tidyverse)

# 临床试验主分析函数
primary_analysis <- function(data, 
                               primary_endpoint,
                               analysis_method = "ANCOVA") {
  
  # 协变量调整分析
  model <- switch(analysis_method,
    "ANCOVA" = {
      lm(formula = paste(primary_endpoint, "~ treatment + baseline + stratum"),
         data = data)
    },
    "CochranMantelHaenszel" = {
      mantelhaen.test(data$response ~ data$treatment | data$stratum)
    },
    "Logistic" = {
      glm(formula = paste("response ~ treatment + baseline"),
          family = binomial, data = data)
    }
  )
  
  # 提取治疗效果估计
  result <- extract_effect_estimate(model, 
                                    reference = "placebo",
                                    treatment = "active")
  
  return(list(
    estimate = result$estimate,
    ci_lower = result$ci[1],
    ci_upper = result$ci[2],
    p_value = result$pvalue,
    model_summary = summary(model)
  ))
}
```

## 样本量计算

### 效能分析

```python
import numpy as np
from scipy import stats

class SampleSizeCalculator:
    """临床试验样本量计算器"""
    
    def __init__(self, alpha=0.05, power=0.8, two_sided=True):
        self.alpha = alpha
        self.power = power
        self.two_sided = two_sided
        
    def calculate_continuous(self, effect_size, std_dev, 
                            allocation_ratio=1):
        """
        连续型终点样本量计算
        
        参数:
            effect_size: 预期效应量 (差值)
            std_dev: 标准差
            allocation_ratio: 组间分配比例
        """
        if self.two_sided:
            z_alpha = stats.norm.ppf(1 - self.alpha / 2)
        else:
            z_alpha = stats.norm.ppf(1 - self.alpha)
            
        z_beta = stats.norm.ppf(self.power)
        
        n_per_group = (
            2 * (effect_size ** 2) / (std_dev ** 2) *
            (z_alpha + z_beta) ** 2
        )
        
        # 调整分配比例
        n_treatment = n_per_group
        n_control = n_per_group * allocation_ratio
        
        return {
            'per_group': np.ceil(n_per_group),
            'treatment': np.ceil(n_treatment),
            'control': np.ceil(n_control),
            'total': np.ceil(n_treatment + n_control)
        }
    
    def calculate_proportions(self, p1, p2, allocation_ratio=1):
        """二分类终点样本量计算"""
        if self.two_sided:
            z_alpha = stats.norm.ppf(1 - self.alpha / 2)
        else:
            z_alpha = stats.norm.ppf(1 - self.alpha)
            
        z_beta = stats.norm.ppf(self.power)
        
        p_bar = (p1 + p2 * allocation_ratio) / (1 + allocation_ratio)
        
        n_per_group = (
            (z_alpha * np.sqrt(2 * p_bar * (1 - p_bar)) +
             z_beta * np.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / allocation_ratio)) ** 2 /
            (p1 - p2) ** 2
        )
        
        return {
            'per_group': np.ceil(n_per_group),
            'total': np.ceil(n_per_group * (1 + allocation_ratio))
        }
```

## 生存分析

### Cox 比例风险模型

```r
# 生存分析主程序
survival_analysis <- function(data, 
                                followup_time,
                                event_indicator,
                                treatment_var,
                                covariates = NULL) {
  
  # 建立生存对象
  surv_obj <- with(data, Surv(
    time = .data[[followup_time]],
    event = .data[[event_indicator]]
  ))
  
  # Cox 模型
  if (is.null(covariates)) {
    formula <- as.formula(paste("surv_obj ~", treatment_var))
  } else {
    formula <- as.formula(
      paste("surv_obj ~", treatment_var, "+", paste(covariates, collapse = "+"))
    )
  }
  
  fit <- coxph(formula, data = data)
  
  # 提取结果
  result <- summary(fit)
  
  return(list(
    n = result$n,
    events = result$nevent,
    coefficient = result$coefficients[1, "coef"],
    se = result$coefficients[1, "se(coef)"],
    hazard_ratio = exp(result$coefficients[1, "coef"]),
    ci_lower = exp(result$coefficients[1, "coef"] - 
                   1.96 * result$coefficients[1, "se(coef)"]),
    ci_upper = exp(result$coefficients[1, "coef"] + 
                   1.96 * result$coefficients[1, "se(coef)"]),
    p_value = result$coefficients[1, "Pr(>|z|)"],
    concordance = result$concordance
  ))
}
```

### Kaplan-Meier 曲线

```python
import matplotlib.pyplot as plt
from lifelines import KaplanMeierFitter
from lifelines.statistics import logrank_test

def plot_survival_curves(data, time_col, event_col, group_col, 
                          title="Kaplan-Meier 曲线"):
    """绘制生存曲线并执行 log-rank 检验"""
    
    fig, ax = plt.subplots(figsize=(10, 8))
    
    groups = data[group_col].unique()
    colors = ['#0284c7', '#10b981', '#f59e0b']
    
    results = {}
    
    for i, group in enumerate(groups):
        subset = data[data[group_col] == group]
        
        kmf = KaplanMeierFitter()
        kmf.fit(
            subset[time_col],
            subset[event_col],
            label=group
        )
        
        kmf.plot_survival_function(
            ax=ax,
            color=colors[i % len(colors)],
            linewidth=2
        )
        
        results[group] = {
            'median_survival': kmf.median_survival_time_,
            'ci': kmf.confidence_interval_
        }
    
    # Log-rank 检验
    groups_data = [data[data[group_col] == g] for g in groups]
    test_result = logrank_test(
        groups_data[0][time_col],
        groups_data[1][time_col],
        groups_data[0][event_col],
        groups_data[1][event_col]
    )
    
    ax.set_title(f"{title}\nLog-rank p = {test_result.p_value:.4f}")
    ax.set_xlabel("随访时间（月）")
    ax.set_ylabel("生存概率")
    ax.legend(loc="best")
    ax.grid(True, alpha=0.3)
    
    return fig, results, test_result
```

## 多重检验校正

```r
# 多重比较校正
multiple_comparison_correction <- function(p_values, 
                                            method = "bonferroni") {
  
  n_tests <- length(p_values)
  adjusted_p <- switch(method,
    "bonferroni" = pmin(p_values * n_tests, 1),
    "holm" = p.adjust(p_values, method = "holm"),
    "fdr_bh" = p.adjust(p_values, method = "BH"),
    "hochberg" = p.adjust(p_values, method = "hochberg")
  )
  
  results <- data.frame(
    test = names(p_values),
    p_value = p_values,
    adjusted_p = adjusted_p,
    significant = adjusted_p < 0.05
  )
  
  return(results[order(results$adjusted_p), ])
}
```

## 缺失数据处理

```python
import pandas as pd
from sklearn.experimental import enable_iterative_imputer
from sklearn.impute import IterativeImputer

class MissingDataHandler:
    """临床试验缺失数据处理器"""
    
    def __init__(self, method='MAR'):
        self.method = method
        self.imputer = None
        
    def analyze_missing(self, df):
        """分析缺失数据模式"""
        missing_info = pd.DataFrame({
            'variable': df.columns,
            'missing_count': df.isnull().sum(),
            'missing_percent': (df.isnull().sum() / len(df) * 100).round(2)
        })
        
        # MCAR 检验
        mcar_result = self._test_mcar(df)
        
        return missing_info, mcar_result
    
    def impute_missing(self, df, strategy='mice'):
        """多重插补"""
        if strategy == 'mice':
            self.imputer = IterativeImputer(max_iter=10)
            imputed_data = pd.DataFrame(
                self.imputer.fit_transform(df),
                columns=df.columns,
                index=df.index
            )
        elif strategy == ' LOCF':
            imputed_data = df.fillna(method='ffill')
            
        return imputed_data
    
    def sensitivity_analysis(self, df, primary_analysis, 
                             methods=c('worst_case', 'best_case')):
        """敏感性分析"""
        results = {}
        
        for method in methods:
            if method == 'worst_case':
                # 最差情况：治疗组缺失视为失败，对照组视为成功
                imputed = self._worst_case_imputation(df)
            elif method == 'best_case':
                # 最好情况相反
                imputed = self._best_case_imputation(df)
                
            result = primary_analysis(imputed)
            results[method] = result
            
        return results
```

## 监管要求

### CDISC 标准

```yaml
# CDISC SDTM 数据结构示例
SDTM:
  DM:  # 受试者人口学
    - USUBJID: 受试者唯一标识
    - SITEID: 研究中心编号
    - AGE: 年龄
    - SEX: 性别
    - RACE: 种族
    - ARM: 治疗组
    
  AE:  # 不良事件
    - USUBJID: 受试者标识
    - AEDECOD: 不良事件术语
    - AESTDTC: 开始日期
    - AEENDTC: 结束日期
    - AESER: 严重不良事件
    - AETOXGR: 毒性等级
    
  VS:  # 体格检查
    - USUBJID: 受试者标识
    - VSTESTCD: 检查项目
    - VSSTRESN: 数值结果
    - VSUNIT: 单位
```

## 总结

临床试验数据分析需要严格遵循统计学原理和监管要求。正确的分析方法和敏感性分析是确保结果可靠性的关键。
