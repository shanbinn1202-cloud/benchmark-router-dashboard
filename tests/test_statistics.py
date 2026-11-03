import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('exporter',ROOT/'scripts/export_data.py')
exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)

class StatisticsTests(unittest.TestCase):
    def test_simulated_repair_keeps_score_and_declares_scope(self):
        cell={'dataset':'aethercode','model':'qwen','passed':False,'cost_usd':'0.04',
              'cost_kind':'simulated','input_tokens':100,'output_tokens':10,
              'token_accounting_complete':True,'_input':100,'_output':10,'_tokens_complete':True}
        rows,_=exporter.summarize([cell],'formal')
        self.assertEqual(rows[0]['accuracy'],0)
        self.assertEqual(rows[0]['simulated_cost_repairs'],1)
        self.assertEqual(exporter.usage(cell,None),(100,10,True))

    def test_dataset_scale_shared_across_models_and_missing_is_not_zero(self):
        cells=[{'dataset':'ds1000','model':m,'passed':p,'cost_usd':c,
                '_input':i,'_output':o,'_tokens_complete':ok}
               for m,p,c,i,o,ok in [('qwen',True,'2',100,10,True),
                   ('qwen',False,None,0,0,False),('gemma',False,'6',200,20,True)]]
        rows,scales=exporter.summarize(cells,'formal')
        q=next(r for r in rows if r['model']=='qwen')
        self.assertEqual(q['accuracy'],.5)
        self.assertEqual(q['mean_total_tokens'],110)
        self.assertEqual(q['token_tasks'],1)
        self.assertEqual(q['normalized_cost_mean'],'0')
        self.assertEqual(scales['ds1000']['range_cost_usd'],'4')

    def test_partial_trajectory_is_included_in_means(self):
        cells=[{'dataset':'terminal','model':'gemma','passed':False,
                'cost_usd':None,'known_cost_usd':'2','usage_calls':3,
                '_input':900,'_output':100,'_tokens_complete':False},
               {'dataset':'terminal','model':'gemma','passed':True,
                'cost_usd':'1','_input':400,'_output':100,'_tokens_complete':True}]
        rows,_=exporter.summarize(cells,'formal')
        r=rows[0]
        self.assertEqual(r['cost_tasks'],2)
        self.assertEqual(r['token_tasks'],2)
        self.assertEqual(r['complete_cost_tasks'],1)
        self.assertEqual(r['mean_cost_usd'],'1.5')
        self.assertEqual(r['mean_total_tokens'],750)

    def test_raw_cost_metric(self):
        row={'tasks':10,'passed':4,'raw_backend_cost_usd':'1.5',
             'raw_router_cost_usd':'0.5','raw_total_cost_usd':'2'}
        result=exporter.raw_cost_metric(row)
        self.assertEqual(result['metric_cost'],'0.2')
        self.assertEqual(result['perf_per_cost'],2)
        for cost, passed, status in [(None,4,'undefined'),('0',4,'infinite'),('0',0,'undefined')]:
            result=exporter.raw_cost_metric({**row,'raw_total_cost_usd':cost,'passed':passed})
            self.assertIsNone(result['perf_per_cost'])
            self.assertEqual(result['perf_per_cost_status'],status)

    def test_mean_cost_weights_are_not_renormalized(self):
        module=exporter.load_module('test_cost_aggregation',exporter.BASE/'all_datasets/cost_aggregation.py')
        tasks=[{'dataset':ds,'outcomes':{m:{'cost_usd':str(cost)} for m in ('qwen','gemma','muse','deepseek')}} for ds,cost in [('a',2),('b',8)]]
        rows=[{'method':'Random','dataset':ds,'perf_per_cost':score,'perf_per_cost_status':'finite','classification_accuracy':f1} for ds,score,f1 in [('a',10,.2),('b',20,.6)]]
        means,averages=module.aggregate(rows,tasks)
        self.assertEqual(means[0]['dataset_weights'],{'a':'1','b':'4'})
        self.assertEqual(means[0]['mean_perf_per_cost'],90)
        self.assertAlmostEqual(means[0]['mean_classification_accuracy'],.4)
        self.assertEqual(averages,{'a':'2','b':'8'})
        tasks[0]['outcomes']={m:{'cost_usd':'0'} for m in tasks[0]['outcomes']}
        with self.assertRaises(ValueError):module.aggregate(rows,tasks)

    def test_published_means_and_selection_counts_match_source(self):
        d=json.loads((ROOT/'docs/assets/data.json').read_text())
        for row in d['routing']['metrics']:
            self.assertEqual(row['cost_basis'],'raw_total_usd_per_task')
            total=float(row['raw_backend_cost_usd'])+float(row['raw_router_cost_usd'])
            self.assertAlmostEqual(row['perf_per_cost'],row['passed']/total)
        for mean in d['routing']['means']:
            rows=[r for r in d['routing']['metrics'] if r['method']==mean['method']]
            weights=mean.get('dataset_weights')
            expected=sum(r['perf_per_cost']*float(weights[r['dataset']]) for r in rows) if weights else sum(r['perf_per_cost'] for r in rows)/len(rows)
            self.assertAlmostEqual(expected,mean['mean_perf_per_cost'])
            self.assertAlmostEqual(sum(r['classification_accuracy'] for r in rows)/len(rows),mean['mean_classification_accuracy'])
            counts=[r['count'] for r in d['routing']['choices'] if r['method']==mean['method']]
            self.assertEqual(sum(counts),d['routing']['tasks'])
        for r in d['model_stats']:
            if r['graded']:self.assertAlmostEqual(r['accuracy'],r['passed']/r['graded'])
            if r['token_tasks']:self.assertAlmostEqual(r['mean_total_tokens'],r['mean_input_tokens']+r['mean_output_tokens'])
            if r['normalized_cost_mean'] is not None:self.assertTrue(0<=float(r['normalized_cost_mean'])<=1)
        raw=json.dumps(d)
        for forbidden in ['api_key','/home/exouser','native_request','call_sources','sk-or-']:
            self.assertNotIn(forbidden,raw)

if __name__=='__main__':unittest.main()
