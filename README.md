# Benchmark Router

[Live dashboard](https://shanbinn1202-cloud.github.io/benchmark-router-dashboard/) · Static HTML, CSS and JavaScript. The page makes no model API calls.

- **Models:** accuracy, pass counts, raw USD cost, normalized cost and mean input/output/total tokens.
- **Routing:** Random, pooled KNN, Zero-shot LLM and Agent-as-a-Router; Perf/Cost, Macro-F1, costs and model selections.
- Dataset filters, sortable tables, CSV/JSON exports and responsive layouts.

## Metrics

**All results** includes each model's graded formal tasks. **Routing cohort** uses tasks with complete scores and costs for all four models.

Costs are min–max normalized per dataset across task × model records: `(cost − min) / (max − min)`. Each view uses its own sample pool; the routing cohort reuses the frozen routing scale. Missing costs are never treated as zero.

Tokens are summed across calls within each selected attempt, then averaged over graded tasks with complete usage. Local runs use frozen provider prices; API runs use actual charges, including billed retries. Replaced attempts are excluded.

**Perf/Cost** = accuracy / mean normalized total cost (solver + router). **Macro-F1** uses four fixed model labels. Overall metrics are unweighted means across datasets. The best-model label is the cheapest correct model, or the cheapest model if all fail.

Terminal deadlocks, client timeouts and verifier timeouts count as failures under the experiment policy. Agent uses evaluation feedback; these results compare configured pipelines rather than strictly reproducing every paper setting.

## Preview and test

```bash
python3 -m http.server 8767 --directory docs
npm ci
npx playwright install chromium
npm test
```

Browser tests use the pinned local Node 22 dependency. The published page needs neither Node nor an external CDN.

## Refresh and publish

The exporter runs in the experiment workspace with the adjacent `router_baselines` and `benchmark_router` directories. Only aggregate statistics are published; prompts, responses, trajectories, credentials and local paths remain on the server. An ignored SQLite cache avoids repeatedly parsing large usage files.

```bash
python scripts/export_data.py
python scripts/publish.py --create    # Create a new repository and configure Pages
python scripts/publish.py --refresh   # Export, commit changed data, and push
```

GitHub Pages serves `main:/docs`. The server timer refreshes data every five minutes; the browser checks for new snapshots on the same interval. Timestamps identify exported snapshots.
