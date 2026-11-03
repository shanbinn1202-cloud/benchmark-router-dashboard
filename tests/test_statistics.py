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

    def test_published_means_and_selection_counts_match_source(self):
        d=json.loads((ROOT/'docs/assets/data.json').read_text())
        for mean in d['routing']['means']:
            rows=[r for r in d['routing']['metrics'] if r['method']==mean['method']]
            self.assertAlmostEqual(sum(r['perf_per_cost'] for r in rows)/len(rows),mean['mean_perf_per_cost'])
            self.assertAlmostEqual(sum(r['macro_f1'] for r in rows)/len(rows),mean['mean_macro_f1'])
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
