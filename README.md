# Router Lab

模型与路由实验 Dashboard，静态 HTML / CSS / JavaScript，可直接部署到 GitHub Pages。页面不调用模型 API。

## 页面内容

- **模型原始统计**：按模型和数据集展示准确率、通过题数、原始 USD 费用、每题费用、每题归一化费用，以及平均输入 / 输出 / 总 token。
- **Routing 对比**：Random、跨数据集合并训练的 KNN、GitHub 适配版 Zero-shot LLM、Agent-as-a-Router；提供 Perf/Cost、Macro-F1、完成率、解题和路由费用、选模分布。
- 支持数据集筛选、搜索、排序、移动端浏览、CSV / JSON 导出。

## 数据口径

“全部正式结果”按各模型已评分题统计；运行中或缺少原生评分的题单独显示。“Routing 共同样本”使用四模型都有完整评分和费用的同一批样本，与 routing 的冻结快照对齐。

每个数据集跨 task × model 做 min–max：`(cost − min) / (max − min)`。两种视图各用自己的样本池；共同样本的尺度严格复用 routing 的原始尺度。页面展示每题平均归一化费用，不能将两个视图的归一化数值混用。费用缺失不当作零。

Token 是每道题所有调用的累计 token，再按记录完整的题取平均，包含重复输入；不是单次上下文长度。本地使用冻结供应商单价模拟 API 费用，云端使用实际费用。只取当前选定的正式尝试，保留已计费重试。

Perf/Cost = 完成率 / 每题平均归一化总费用（解题 + 路由）。F1 是四模型固定标签上的 Macro-F1。总体结果对各数据集直接等权平均。Best model 为正确模型中费用最低者；全错则选最便宜者。

终端死锁、LLM 客户端超时、原生 verifier 超时按本实验用户指定规则计为失败，原始证据保留在实验服务器，不随站点发布。Agent 包含离线评测反馈，这里比较的是已授权配置下的完整流程，不是论文全部实验的逐项复现。

## 本地预览与验证

```bash
python3 -m http.server 8767 --directory docs
# http://localhost:8767
npm ci
npx playwright install chromium
npm test
```

浏览器测试需要 Node 22（开发依赖已固定本地 Node 版本）。静态页面不需要 Node 或第三方 CDN。

## 从实验服务器更新

`scripts/export_data.py` 仅在原实验工作区运行，需要相邻的 `router_baselines` 和 `benchmark_router` 数据。导出只包含聚合统计，不复制题面、模型回复、轨迹、密钥或本地绝对路径。SQLite usage 缓存放在被 Git 忽略的 `.cache`，避免反复解析大型调用文件。

```bash
python scripts/export_data.py
python scripts/publish.py --create     # 使用已登录的 GitHub CLI 创建独立公开仓库并启用 Pages
python scripts/publish.py --refresh    # 更新快照；仅有内容变化时提交
```

发布目录为 `main` 分支的 `/docs`。服务器上可用 systemd timer 每五分钟执行 refresh，实验和 routing 新结果完成后自动切换到新的统计快照。网页每五分钟检查最新发布的快照，时间戳表示数据生成时间，不代表实时连接实验服务器。
