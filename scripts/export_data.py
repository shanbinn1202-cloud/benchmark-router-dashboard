"""Read experiment artifacts; publish only aggregate statistics, never prompts or keys."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

HERE = Path(__file__).resolve().parents[1]
PROJECT_ROOT = HERE.parent
BASE = PROJECT_ROOT / 'router_baselines'
sys.path[:0] = [str(BASE / 'all_datasets'), str(BASE)]
from routing_common import data as historical
from routing_common.io import Sources, load_module
from routing_common.repairs import apply_repairs
from collect import terminal_cell, FINAL

NAMES = {'qwen': 'Qwen3.8-27B', 'gemma': 'Gemma 4 31B',
         'muse': 'Muse Glimmer 30B', 'deepseek': 'DeepSeek'}
DATASETS = {'aethercode': 'AetherCode', 'bigcodebench_hard': 'BigCodeBench Hard',
            'ds1000': 'DS-1000', 'kernelbench': 'KernelBench',
            'scicode_background': 'SciCode', 'science': 'SWE-bench Science',
            'verilogeval': 'VerilogEval', 'terminal': 'Terminal-Bench 2.0'}
TERMINAL = historical.PROJECT / 'experiments/terminalbench2_terminus2_20261102'


def read(path):
    return json.loads(Path(path).read_text())


def lines(path):
    with Path(path).open() as f:
        return [json.loads(line) for line in f if line.strip()]


def number(value):
    if value is None or isinstance(value, bool):
        return None
    d = Decimal(str(value))
    return d if d.is_finite() and d >= 0 else None


class ReceiptCache:
    """Disk cache of tiny usage records, invalidated whenever a receipt changes."""
    def __init__(self):
        folder = HERE / '.cache'; folder.mkdir(exist_ok=True)
        self.db = sqlite3.connect(folder / 'usage.sqlite3')
        self.db.execute('CREATE TABLE IF NOT EXISTS receipts(path TEXT PRIMARY KEY, stamp TEXT, payload TEXT)')
        self.reads = 0

    def get(self, path):
        path = Path(path)
        stat = path.stat(); stamp = f'{stat.st_size}:{stat.st_mtime_ns}'
        cached = self.db.execute('SELECT stamp,payload FROM receipts WHERE path=?', (str(path),)).fetchone()
        if cached and cached[0] == stamp:
            return json.loads(cached[1])
        d = read(path); r = d.get('response') or {}
        result = {k: d.get(k) for k in ('scope', 'started', 'finished', 'status', 'backend')}
        result['response'] = {k: r.get(k) for k in ('usage', 'br_backend_transition', 'id')}
        result['attempts'] = [{k: a.get(k) for k in ('outcome', 'cost_usd', 'possibly_billed', 'generation_details')}
                              for a in d.get('attempts', [])]
        self.db.execute('INSERT OR REPLACE INTO receipts VALUES(?,?,?)',
                        (str(path), stamp, json.dumps(result)))
        self.reads += 1
        if self.reads % 500 == 0:
            self.db.commit(); print(f'  indexed {self.reads} usage receipts', flush=True)
        return result

    def json(self, path):
        # terminal_cell only needs receipt usage, timestamps, status and backend.
        return self.get(path) if '/results/calls/' in str(path) else read(path)


def usage(cell, cache):
    if 'input_tokens' in cell and 'output_tokens' in cell:
        errors = set(cell.get('exclusion_reasons', []))
        complete = cell.get('token_accounting_complete', not errors.intersection({'missing_current_attempt_accounting', 'incomplete_token_accounting',
            'missing_usage_or_ambiguous_call', 'invalid_token_usage', 'no_recorded_generation_usage'})
        )
        return cell['input_tokens'], cell['output_tokens'], complete
    total_in = total_out = 0
    paths = cell.get('call_sources', []); complete = bool(paths)
    for name in paths:
        p = Path(name); p = p if p.is_absolute() else historical.PROJECT / p
        if not p.exists():
            complete = False; continue
        r = cache.get(p); u = (r.get('response') or {}).get('usage') or {}
        a, b = u.get('prompt_tokens'), u.get('completion_tokens')
        if type(a) is int and type(b) is int and a >= 0 and b >= 0:
            total_in += a; total_out += b
        else:
            complete = False
        # The final successful response is already counted. Include billed retries
        # only when their token counts are available; never infer missing tokens.
        for attempt in r.get('attempts', []):
            if attempt.get('outcome') == 'complete' or attempt.get('possibly_billed') is False:
                continue
            details = attempt.get('generation_details') or {}
            charge = number(attempt.get('cost_usd')) or number(details.get('total_cost'))
            if charge == 0:
                continue
            a = details.get('native_tokens_prompt'); b = details.get('native_tokens_completion')
            if type(a) is int and type(b) is int:
                total_in += a; total_out += b
            else:
                complete = False
    return total_in, total_out, complete


def formal_cells(cache):
    old = historical.OLD_MATRIX
    cells = {(r['dataset'], r['task_id'], r['model']): r for r in lines(old / 'matrix.jsonl')}
    sources = Sources()
    collector = load_module('dashboard_historical_collector', BASE / 'random/collect.py')
    for record in read(historical.CAMPAIGN / 'historical/source_records.json'):
        c = historical.historical_override(record, sources, collector)
        cells[c['dataset'], c['task_id'], c['model']] = c
    selected = {(r['model'], r['task']) for r in read(historical.SCIENCE / 'selection.json')['records']}
    ids = ['task_' + t for t in read(historical.PROJECT / 'swebench_science/data/selections/default-96.json')['task_ids']]
    accounts = {run: historical.accounting_rows(run, sources) for run in (historical.OLD_SCIENCE, historical.SCIENCE)}
    for task in ids:
        for model in NAMES:
            run = historical.SCIENCE if (model, task) in selected else historical.OLD_SCIENCE
            cells['science', task, model] = historical.science_cell(model, task, run, accounts[run], sources)
    pricing = read(TERMINAL / 'accounting/pricing.json')['profiles']
    for row in read(TERMINAL / 'manifest.json')['tasks']:
        for model in NAMES:
            state = read(TERMINAL / 'results' / model / 'terminal' / row['task'] / 'state.json')
            if state['status'] in FINAL:
                c = terminal_cell(model, row['task'], cache, pricing)
                c['known_cost_usd'] = str(Decimal(c['actual_api_cost_usd']) + Decimal(c['simulated_api_cost_usd']))
            else:
                c = {'dataset': 'terminal', 'task_id': row['task'], 'model': model,
                     'passed': None, 'cost_usd': None, 'eligible': False}
            c['run_status'] = state['status']
            cells['terminal', row['task'], model] = c
    return list(apply_repairs(cells, sources).values())


def enrich(cells, cache):
    result = []
    for c in cells:
        a, b, valid = usage(c, cache)
        result.append({**c, '_input': a, '_output': b, '_tokens_complete': valid})
    return result


def summarize(cells, scope, scales=None):
    """Accuracy is per graded task; cost/token averages declare their coverage."""
    by_ds = defaultdict(list)
    for c in cells:
        by_ds[c['dataset']].append(c)
    scales = dict(scales or {})
    for ds, group in by_ds.items():
        if ds in scales:
            continue
        costs = [number(c.get('cost_usd')) for c in group if isinstance(c.get('passed'), bool)]
        costs = [v for v in costs if v is not None]
        if costs:
            scales[ds] = {'min_cost_usd': str(min(costs)), 'max_cost_usd': str(max(costs)),
                          'range_cost_usd': str(max(costs)-min(costs)), 'constant_costs': min(costs)==max(costs)}
    rows = []
    for ds in DATASETS:
        for model in NAMES:
            group = [c for c in by_ds[ds] if c['model'] == model]
            if not group:
                continue
            graded = [c for c in group if isinstance(c.get('passed'), bool)]
            complete_cost_tasks = sum(number(c.get('cost_usd')) is not None for c in graded)
            complete_token_tasks = sum(c['_tokens_complete'] for c in graded)
            # A missing final receipt must not discard the rest of a task's trajectory.
            priced = [{**c, 'cost_usd': c.get('cost_usd') if number(c.get('cost_usd')) is not None else c.get('known_cost_usd')}
                      for c in graded if number(c.get('cost_usd')) is not None or
                      (c.get('usage_calls', 0) > 0 and number(c.get('known_cost_usd')) is not None)]
            tokened = [c for c in graded if c['_tokens_complete'] or c.get('usage_calls', 0) > 0]
            cost = sum((number(c['cost_usd']) for c in priced), Decimal(0))
            known = sum((number(c.get('cost_usd')) or number(c.get('known_cost_usd')) or Decimal(0) for c in graded), Decimal(0))
            norm = []
            if ds in scales:
                lo = Decimal(scales[ds]['min_cost_usd']); span = Decimal(scales[ds]['range_cost_usd'])
                norm = [(number(c['cost_usd'])-lo)/span if span else Decimal(0) for c in priced]
            ni = sum(c['_input'] for c in tokened); no = sum(c['_output'] for c in tokened)
            rows.append({'scope': scope, 'dataset': ds, 'model': model, 'planned': len(group),
                'simulated_missing_input_cost_usd': str(sum((Decimal(c.get('simulated_missing_input_cost_usd', '0')) for c in graded), Decimal(0))),
                'unknown_output_requests': sum(c.get('unknown_output_requests', 0) for c in graded),
                'complete_cost_tasks': complete_cost_tasks, 'complete_token_tasks': complete_token_tasks,
                'graded': len(graded), 'passed': sum(c['passed'] for c in graded),
                'accuracy': sum(c['passed'] for c in graded)/len(graded) if graded else None,
                'running': sum(c.get('run_status') == 'RUNNING' for c in group),
                'ungraded': len(group)-len(graded), 'cost_tasks': len(priced),
                'adjudicated_failures': sum(c.get('grade_kind') == 'user_adjudicated_interrupted_generation' for c in graded),
                'simulated_cost_repairs': sum(c.get('cost_kind') == 'simulated' for c in priced),
                'raw_cost_usd': str(cost), 'known_cost_usd': str(known),
                'mean_cost_usd': str(cost/len(priced)) if priced else None,
                'normalized_cost_sum': str(sum(norm)),
                'normalized_cost_mean': str(sum(norm)/len(norm)) if norm else None,
                'token_tasks': len(tokened), 'input_tokens': ni, 'output_tokens': no,
                'mean_input_tokens': ni/len(tokened) if tokened else None,
                'mean_output_tokens': no/len(tokened) if tokened else None,
                'mean_total_tokens': (ni+no)/len(tokened) if tokened else None})
    return rows, scales


def raw_cost_metric(row):
    """Re-score existing choices with completion rate / mean total USD."""
    row = dict(row)
    total = number(row.get('raw_total_cost_usd'))
    tasks = row.get('tasks', 0)
    row['cost_basis'] = 'raw_total_usd_per_task'
    row['metric_cost'] = str(total / tasks) if total is not None and tasks else None
    if total is None or not tasks:
        value, status = None, 'undefined'
    elif total == 0:
        value, status = None, 'infinite' if row['passed'] else 'undefined'
    else:
        value, status = float(Decimal(row['passed']) / total), 'finite'
    row['perf_per_cost'], row['perf_per_cost_status'] = value, status
    return row


def routing_data(stage, summary, cohort=None):
    metrics = [{k: r.get(k) for k in ('method','dataset','tasks','passed','performance','perf_per_cost',
        'perf_per_cost_status','macro_f1','micro_f1','weighted_f1','raw_backend_cost_usd',
        'raw_router_cost_usd','raw_total_cost_usd','metric_cost')} for r in summary['dataset_metrics']]
    # Compute exact best-model matches directly from saved decisions; no API calls.
    if cohort is None: cohort = lines(stage/'cohort/tasks.jsonl')
    labels = {task['uid']: task['best_model'] for task in cohort}
    decisions = lines(stage/'routes.jsonl')
    for row in metrics:
        selected = [r for r in decisions if r['method'] == row['method'] and r['dataset'] == row['dataset']]
        if len(selected) != row['tasks'] or len({r['uid'] for r in selected}) != row['tasks']:
            raise ValueError('Routing accuracy requires exactly one decision per task')
        row['classification_correct'] = sum(r['selected_model'] == labels[r['uid']] for r in selected)
        row['classification_accuracy'] = row['classification_correct'] / row['tasks']
    metrics = [raw_cost_metric(row) for row in metrics]
    means = []
    for original in summary['dataset_arithmetic_means']:
        rows = [r for r in metrics if r['method'] == original['method']]
        statuses = {r['perf_per_cost_status'] for r in rows}
        status = 'undefined' if not rows or 'undefined' in statuses else ('infinite' if 'infinite' in statuses else 'finite')
        means.append({**original,
            'mean_perf_per_cost': sum(r['perf_per_cost'] for r in rows)/len(rows) if status == 'finite' else None,
            'mean_perf_per_cost_status': status,
            'cost_basis': 'raw_total_usd_per_task'})
    aggregation = summary.get('aggregation_version', 'raw_usd_unweighted')
    dataset_mean_costs = {}
    if aggregation in ('raw_usd_range_weighted_v1','raw_usd_inverse_mean_weighted_v1','raw_usd_mean_cost_weighted_v1'):
        module = load_module('dashboard_cost_aggregation', BASE/'all_datasets/cost_aggregation.py')
        if cohort is None: cohort = lines(stage/'cohort/tasks.jsonl')
        means, dataset_mean_costs = module.aggregate(metrics, cohort)
        aggregation = module.VERSION
        # Reporting artifact is separate from routing policy/receipts, so metric
        # changes never invalidate or repeat paid decisions.
        report = {'aggregation_version':aggregation,'dataset_means':means,
                  'dataset_mean_trajectory_cost_usd':dataset_mean_costs,
                  'tasks_sha256':summary['snapshot_sha256']}
        (stage/'mean_cost_weighted_report.json').write_text(json.dumps(report,indent=2)+'\n')
        final_path = stage/'summary.json'
        if final_path.exists():
            original = read(final_path)
            if original.get('aggregation_version') != aggregation:
                archive = stage/'summary-before-mean-cost-weights.json'
                if not archive.exists(): archive.write_bytes(final_path.read_bytes())
            original.update(aggregation_version=aggregation, dataset_arithmetic_means=means, dataset_metrics=metrics,
                primary_metrics=['perf_per_cost', 'classification_accuracy'],
                dataset_mean_trajectory_cost_usd=dataset_mean_costs,
                dataset_weight_formula='w_d = mean_{all task-model trajectories}(solver USD) / D',
                mean_formula='sum_d w_d * (completion_rate_d / mean_raw_total_USD_d)',
                weight_note='Weights are used directly, without renormalization. No division by sum of weights.',
                reporting_module_sha256=hashlib.sha256((BASE/'all_datasets/cost_aggregation.py').read_bytes()).hexdigest())
            temporary = final_path.with_suffix('.reporting.tmp')
            temporary.write_text(json.dumps(original,indent=2)+'\n'); temporary.replace(final_path)
        knn_path=stage/'knn-metrics.json'
        knn_mean=next((m for m in means if m['method']=='KNN'),None)
        if knn_path.exists() and knn_mean:
            knn_report=read(knn_path)
            knn_report.update(dataset_arithmetic_mean=knn_mean,aggregation_version=aggregation)
            knn_path.write_text(json.dumps(knn_report,indent=2)+'\n')
        status_path=BASE/'all_datasets/raw_usd_20261103/status.json'
        if status_path.exists():
            status_report=read(status_path)
            if status_report.get('status')=='COMPLETED' and status_report.get('output')==str(stage):
                status_report.update(means=means,aggregation_version=aggregation)
                status_path.write_text(json.dumps(status_report,indent=2)+'\n')
        random_path=stage/'random/summary.json'
        if random_path.exists():
            random_summary=read(random_path)
            random_summary['mean']=next(m for m in means if m['method']=='Random')
            random_summary['aggregation_version']=aggregation
            random_path.write_text(json.dumps(random_summary,indent=2)+'\n')
    choices = []
    combined = stage / 'routes.jsonl'
    if combined.exists():
        counts = Counter((r['method'], r['dataset'], r['selected_model']) for r in lines(combined))
        choices = [{'method':method,'dataset':ds,'model':model,'count':n}
                   for (method,ds,model),n in counts.items()]
    for method, relative in [('Random','offline/Random/routes.jsonl'), ('KNN','offline/KNN/routes.jsonl'),
                             ('Zero-shot LLM','zero_shot/routes.jsonl'), ('Agent-as-a-Router','agent/routes.jsonl')]:
        if combined.exists():
            break
        p = stage / relative
        if not p.exists():
            continue
        counts = Counter((r['dataset'], r['selected_model']) for r in lines(p))
        choices.extend({'method':method,'dataset':ds,'model':model,'count':n} for (ds,model),n in counts.items())
    if summary.get('_route_paths'):
        choices=[]
        for method, path in summary['_route_paths'].items():
            counts=Counter((r['dataset'],r['selected_model']) for r in lines(path))
            choices.extend({'method':method,'dataset':ds,'model':model,'count':n} for (ds,model),n in counts.items())
    return {'method_status':summary.get('method_status',[]),'tasks': summary['tasks'], 'finished': summary['finished'], 'coverage':summary['coverage'],
            'metrics': metrics, 'means': means, 'choices': choices,
            'aggregation_version': aggregation,
            'agent_workers': summary.get('agent_workers',256),
            'agent_variant': summary.get('agent_variant','github_online_batched'),
            'zero_shot_variant': summary.get('zero_shot_variant','github_previous'),
            'zero_shot_router_model': summary.get('zero_shot_router_model','deepseek/deepseek-v4.1-flash-1017'),
            'agent_policy_note': summary.get('agent_policy_note',''),
            'dataset_mean_trajectory_cost_usd': dataset_mean_costs,
            'dataset_weights': means[0].get('dataset_weights', {}) if means else {},
            'snapshot_sha256': summary['snapshot_sha256'], 'method_version': aggregation if aggregation in ('raw_usd_range_weighted_v1','raw_usd_inverse_mean_weighted_v1','raw_usd_mean_cost_weighted_v1') else 'github_aligned',
            'includes_terminal': 'terminal' in summary['coverage']}


def save_csv(path, rows):
    with path.open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else [])
        writer.writeheader(); writer.writerows(rows)


def partial_routing(stage):
    """Publish completed methods on the new cohort; never splice in old decisions."""
    manifest, tasks = historical.load_snapshot(stage / 'cohort')
    raw = load_module('dashboard_raw_routing_metrics', BASE/'all_datasets/raw_usd_20261103/raw_metrics.py')
    specs = [('Random','random','summary.json'), ('KNN','offline/KNN','../validation.json'),
             ('Zero-shot LLM','zero_shot','validation.json'), ('Agent-as-a-Router','agent32_stage/agent','validation.json')]
    metrics, means, paths, statuses = [], [], {}, []
    for method, relative, proof_name in specs:
        folder = stage/relative
        proof = read(folder/proof_name) if (folder/proof_name).exists() else {}
        routes = folder/'routes.jsonl'
        complete = proof.get('status') in ('PASS','COMPLETED') and routes.exists()
        if not complete:
            statuses.append({'method':method,'status':'RUNNING',
                'completed':len(list((folder/'decisions').glob('*.json'))), 'total':len(tasks)})
            continue
        identity = read(folder/'summary.json') if (folder/'summary.json').exists() else proof
        if identity.get('snapshot_sha256') != manifest['tasks_sha256']:
            raise ValueError('Completed method uses another cohort: '+method)
        expected = identity.get('routes_sha256')
        if isinstance(expected, dict): expected = expected.get(method)
        if expected and hashlib.sha256(routes.read_bytes()).hexdigest() != expected:
            raise ValueError('Route file changed: '+method)
        rows = lines(routes)
        mapping = {r['uid']:r for r in rows}
        if len(rows)!=len(tasks) or set(mapping)!={t['uid'] for t in tasks}:
            raise ValueError('Incomplete completed-method routes: '+method)
        current=[]
        for ds in sorted(manifest['counts']):
            batch=[t for t in tasks if t['dataset']==ds]
            current.append({'method':method,'dataset':ds,**raw.metric(batch,[mapping[t['uid']] for t in batch],manifest['cost_normalization'])})
        metrics.extend(current); means.append({'method':method,**raw.dataset_average(current)})
        paths[method]=str(routes)
        statuses.append({'method':method,'status':'COMPLETED','completed':len(tasks),'total':len(tasks)})
    if not metrics:raise ValueError('No completed methods in current rerun')
    return {'tasks':len(tasks),'finished':None,'coverage':manifest['counts'],'dataset_metrics':metrics,
            'dataset_arithmetic_means':means,'snapshot_sha256':manifest['tasks_sha256'],
            'aggregation_version':'raw_usd_range_weighted_v1','agent_workers':32,
            'method_status':statuses,'_route_paths':paths}


def build():
    pointer = read(BASE / 'all_datasets/current-results.json')
    output = Path(pointer['primary_output'])
    stage = output if (output/'summary.json').exists() else output/'stages/existing'
    latest = BASE/'all_datasets/results/raw_usd_8datasets_20261103'
    if (latest/'cohort/manifest.json').exists() and (latest/'random/summary.json').exists():
        stage = latest
        summary = read(stage/'summary.json') if (stage/'summary.json').exists() else partial_routing(stage)
    else:
        summary = read(stage / 'summary.json')
    manifest, cohort = historical.load_snapshot(stage / 'cohort')
    cache = ReceiptCache()
    print('Collecting formal outcomes and selected-attempt usage…', flush=True)
    all_cells = enrich(formal_cells(cache), cache)
    lookup = {(c['dataset'], c['task_id'], c['model']): c for c in all_cells}
    matched = []
    for task in cohort:
        for model, c in task['outcomes'].items():
            old = lookup.get((task['dataset'], task['task_id'], model))
            tokens = {k:old[k] for k in ('_input','_output','_tokens_complete')} if old else {}
            if not tokens:
                a,b,v=usage(c,cache);tokens={'_input':a,'_output':b,'_tokens_complete':v}
            matched.append({**c, **tokens})
    all_rows, all_scales = summarize(all_cells,'formal')
    cohort_rows, cohort_scales = summarize(matched,'cohort',manifest['cost_normalization'])
    routed = routing_data(stage, summary, cohort)
    catalog = read(BASE/'routing_common/model_catalog.json')
    payload = {'schema_version':1,'updated_at':datetime.now(timezone.utc).isoformat(),
        'models':[{'id':m,'label':label,'model_id':catalog[m]['name']} for m,label in NAMES.items()],
        'datasets':[{'id':ds,'label':label,'routing_tasks':summary['coverage'].get(ds,{}).get('eligible',0)} for ds,label in DATASETS.items()],
        'model_stats': all_rows+cohort_rows, 'scales':{'formal':all_scales,'cohort':cohort_scales},
        'routing':routed,'collection':{'terminal':{
            m:{'planned':89,'graded':next(r['graded'] for r in all_rows if r['dataset']=='terminal' and r['model']==m),
               'running':next(r['running'] for r in all_rows if r['dataset']=='terminal' and r['model']==m)} for m in NAMES}},
        'notes':{
            'accuracy':'Passed / graded tasks. Three interrupted Science trials are failures under explicit user adjudication. Terminal deadlocks, client timeouts and verifier timeouts also count as failures. Running or ungraded tasks are excluded.',
            'cost':'Selected-attempt USD costs. Unavailable bills use recorded tokens at frozen provider rates, explicitly marked as simulated in the CSV. Unmeasured retry charges are excluded from simulation. Original answers and scores are retained.',
            'normalization':'c′ = (c − min) / (max − min), fitted per dataset across task × model costs; constant costs map to 0. All results and the routing cohort use separate scales. Tables report per-task means.',
            'tokens':'Recorded tokens per task, including partial trajectories, repeated inputs and verified retry usage. For interrupted Terminal-Bench requests, input is reconstructed with the model tokenizer and output uses only saved token counts, as authorized by the user. Unavailable output is excluded, not estimated. For simulated cost repairs, unmeasured retries are excluded. No missing token counts are inferred.',
            'routing': ('Perf/Cost = completion rate / mean raw total USD cost per task, including solver and router calls. Overall Perf/Cost = sum_d w_d * Perf/Cost_d, where w_d = mean trajectory cost_d / D. The mean uses all eligible tasks and all four candidate-model solver costs; router fees are excluded from weight fitting. Weights are not renormalized to sum to one. Classification accuracy is an unweighted dataset mean.' if routed['aggregation_version'] == 'raw_usd_mean_cost_weighted_v1' else 'Perf/Cost = completion rate / mean raw total USD cost per task, including solver and router calls. Classification accuracy measures exact matches to best-model labels. Overall metrics are unweighted means across datasets.'),
            'labels':'The cheapest correct model; if all models fail, the cheapest model. Ties use model-alias lexicographic order.',
            'methods':'KNN: pooled datasets, global grouped five-fold evaluation. Zero-shot: GitHub-adapted LLM router. Agent: '+routed.get('agent_policy_note','GitHub online adaptation.'),
            'comparison':'Solver harnesses, context limits and providers vary across runs. Routers use the same existing task-model outcomes. GitHub default ID Agent uses training folds only; its main-policy adaptation is distinct from the online LLM Agent and OOD verifier cascade.'}}

    cache.db.commit(); cache.db.close()
    dest=HERE/'docs/assets';dest.mkdir(parents=True,exist_ok=True)
    # An explicit aggregate-only payload prevents raw artifacts entering the site.
    raw=json.dumps(payload,ensure_ascii=False,indent=2,allow_nan=False)+'\n'
    for marker in ('/home/', 'api_key_file', 'native_request', 'call_sources', 'sk-or-'):
        if marker in raw:raise ValueError('Private source material in public payload: '+marker)
    target=dest/'data.json'
    previous=read(target) if target.exists() else None
    if previous and {k:v for k,v in previous.items() if k!='updated_at'} == {k:v for k,v in payload.items() if k!='updated_at'}:
        payload['updated_at']=previous['updated_at']
    else:
        temp=target.with_suffix('.tmp');temp.write_text(raw);temp.replace(target)
    save_csv(dest/'models.csv',payload['model_stats']);save_csv(dest/'routers.csv',routed['metrics'])
    print(json.dumps({'model_rows':len(payload['model_stats']),'routing_rows':len(routed['metrics']),
                      'routing_tasks':routed['tasks'],'receipt_reads':cache.reads,'output':str(target)},ensure_ascii=False),flush=True)
    return payload


if __name__=='__main__':
    build()
