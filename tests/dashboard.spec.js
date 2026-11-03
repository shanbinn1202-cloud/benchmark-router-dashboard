const {test,expect}=require('@playwright/test');
const data=require('../docs/assets/data.json');
const rowsFor=(scope,dataset)=>data.model_stats.filter(r=>r.scope===scope&&(!dataset||r.dataset===dataset));
test('English results, simplified layout, routing tables and metrics',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#model-tables tbody tr')).toHaveCount(rowsFor('formal').length);
  await expect(page.locator('.model-window')).toHaveCount(4);
  await expect(page.locator('.dataset-bar-row')).toHaveCount(rowsFor('formal').length);
  await page.locator('#model-details summary').click();
  await expect(page.locator('#efficiency-chart .bar-row')).toHaveCount(4);
  await expect(page.locator('#routing-tables tbody tr')).toHaveCount(data.routing.metrics.length);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  expect(await page.locator('body').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await expect(page).toHaveTitle('Coding Routing Benchmark — Results');
  await expect(page.locator('.brand')).toHaveText('Coding Routing Benchmark');
  await expect(page.locator('header nav, #collection, #model-dataset, #model-search, [data-scope]')).toHaveCount(0);
  const total=data.datasets.reduce((n,d)=>n+Math.max(...rowsFor('formal',d.id).map(r=>r.planned)),0);
  await expect(page.locator('.overview-stat').first()).toContainText('total-task');
  await expect(page.locator('.overview-stat .stat-value').first()).toHaveText(total.toLocaleString('en-US'));
  await page.locator('#model-metric').selectOption('mean_output_tokens');
  await page.locator('[data-model-sort=accuracy]').first().click();
  await expect(page.locator('.model-dataset-panel')).toHaveCount(data.datasets.length);
  for(const panel of await page.locator('.model-dataset-panel').all()){
    await expect(panel.locator('tbody tr')).toHaveCount(4);
    const accuracy=await panel.locator('tbody td:nth-child(2)').allTextContents();
    expect(parseFloat(accuracy[0])).toBeGreaterThanOrEqual(parseFloat(accuracy.at(-1)));
  }
  await page.locator('#routing-dataset').selectOption('ds1000');
  await expect(page.locator('#routing-tables tbody tr')).toHaveCount(4);
  const dsTasks=data.routing.metrics.find(r=>r.dataset==='ds1000').tasks.toLocaleString('en-US');
  for(const row of await page.locator('.selection-row').allTextContents())expect(row).toContain(dsTasks);
  await page.locator('#routing-dataset').selectOption('all');
  const best=data.routing.means.reduce((a,b)=>a.mean_perf_per_cost>b.mean_perf_per_cost?a:b);
  await expect(page.locator('#efficiency-chart .bar-row').filter({has:page.locator('.best')})).toContainText(best.method);
  await expect(page.locator('a.download, a[download], #methodology, #method-notes')).toHaveCount(0);
  await expect(page.locator('#routing-methods h4')).toHaveCount(4);
  await expect(page.locator('#routing-metrics h4')).toHaveCount(2);
  await expect(page.locator('#routing-methods')).toContainText('Training labels select the cheapest successful model');
  await expect(page.locator('.routing-dataset-panel')).toHaveCount(new Set(data.routing.metrics.map(r=>r.dataset)).size);
  for(const panel of await page.locator('.routing-dataset-panel').all()){
    await expect(panel).not.toHaveAttribute('open','');
    await panel.locator('summary').click();
    await expect(panel.locator('table')).toBeVisible();
    const dataset=await panel.getAttribute('data-dataset');
    const rows=data.routing.metrics.filter(r=>r.dataset===dataset);
    await expect(panel.locator('tbody tr')).toHaveCount(rows.length);
    await expect(panel.locator('thead')).toContainText('Solver, USD');
    await expect(panel.locator('thead')).not.toContainText('Router, USD');
    await expect(panel.locator('thead')).not.toContainText('Total, USD');
    for(const r of rows){
      const row=panel.locator('tbody tr').filter({has:page.getByText(r.method,{exact:true})});
      await expect(row.locator('td').nth(3)).toHaveText(Number(r.raw_backend_cost_usd).toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:4}));
    }
  }
  await page.locator('[data-route-sort=macro_f1]').first().click();
  await expect(page.locator('.routing-dataset-panel[open]')).toHaveCount(new Set(data.routing.metrics.map(r=>r.dataset)).size);
  await page.locator('.routing-dataset-panel summary').first().click();
  await expect(page.locator('.routing-dataset-panel').first().locator('table')).toBeHidden();
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:innerWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.view+1);
  expect(errors).toEqual([]);
  await page.locator('#model-metric').selectOption('accuracy');
  await page.locator('#model-details summary').click();
  await page.locator('#models').screenshot({path:`test-results/model-cards-${test.info().project.name}.png`});
  await page.evaluate(()=>{document.activeElement?.blur();document.querySelectorAll('.table-wrap').forEach(el=>el.scrollLeft=0);window.scrollTo({top:0,behavior:'instant'});});
  await page.screenshot({path:`test-results/dashboard-${test.info().project.name}.png`,fullPage:true});
});
test('network errors are visible and recoverable',async({page})=>{
  await page.route('**/assets/data.json*',r=>r.fulfill({status:503,body:'unavailable'}));
  await page.goto('/');await expect(page.locator('#error')).toBeVisible();
  await page.unroute('**/assets/data.json*');await page.locator('#refresh').click();
  await expect(page.locator('#error')).toBeHidden();await expect(page.locator('#model-tables tbody tr')).toHaveCount(rowsFor('formal').length);
});

test('model windows share scales and retain costs, tokens and coverage',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.model-window')).toHaveCount(4);
  const positions=await page.locator('.model-window').evaluateAll(cards=>cards.map(el=>({x:el.offsetLeft,y:el.offsetTop})));
  if(test.info().project.name==='desktop')expect(positions[0].y).toBe(positions[1].y);
  else expect(positions[0].x).toBe(positions[1].x);
  for(const metric of ['accuracy','raw_cost_usd','mean_cost_usd','normalized_cost_mean','mean_input_tokens','mean_output_tokens','mean_total_tokens']){
    await page.locator('#model-metric').selectOption(metric);
    const axes=await page.locator('.dataset-axis').allTextContents();
    expect(new Set(axes).size).toBe(1);
    for(const model of data.models){
      const r=rowsFor('formal').find(r=>r.model===model.id&&r.dataset==='science');
      const row=page.locator(`.model-window[data-model="${model.id}"] .dataset-bar-row[data-dataset="science"]`);
      const value=metric==='raw_cost_usd'&&r.cost_tasks<r.graded?r.known_cost_usd:r[metric];
      const expected=await page.evaluate(([v,k])=>formatModelMetric(v,k),[value,metric]);
      await expect(row.locator('.dataset-value')).toContainText(expected);
      if(metric.includes('tokens')&&r.token_tasks<r.graded)await expect(row.locator('.dataset-value')).toContainText('†');
      if(metric==='raw_cost_usd'&&r.cost_tasks<r.graded)await expect(row.locator('.dataset-value')).toContainText('≥');
      if(metric==='accuracy'){
        const width=await row.locator('.dataset-track>span').evaluate(el=>parseFloat(el.style.width));
        expect(width).toBeCloseTo(Number(value)*100,3);
      }
    }
  }
  for(const model of data.models){
    const order=await page.locator(`.model-window[data-model="${model.id}"] .dataset-bar-row`).evaluateAll(rows=>rows.map(r=>r.dataset.dataset));
    expect(order.indexOf('science')).toBe(order.indexOf('verilogeval')+1);
  }
});
