'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const colors = {qwen:'#346689',gemma:'#ae7b24',muse:'#7d7960',deepseek:'#9b493c'};
// Verified against historical model profiles and Science / Terminal campaign configurations.
const thinkingModes = {qwen:'Off',gemma:'Off',muse:'On · Low',deepseek:'Off'};
const methodColors = {'Random':'#949084','KNN':'#346689','Zero-shot LLM':'#ae7b24','Agent-as-a-Router':'#9b493c'};
const methods = Object.keys(methodColors);
let data, modelSort=null, routeSort=null;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const f = (v,d=2) => valid(v) ? Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const pct = v => valid(v) ? f(Number(v)*100,1)+'%' : '—';
const integer = v => f(v,0);
const compact = v => !valid(v) ? '—' : Number(v)>=1e6 ? f(Number(v)/1e6,2)+'M' : Number(v)>=1e3 ? f(Number(v)/1e3,1)+'K' : f(v,0);
const mean = a => {const v=a.filter(valid).map(Number);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null;};
const sum = (a,k) => a.reduce((n,r)=>n+(Number(r[k])||0),0);
const dsLabel = id => data.datasets.find(d=>d.id===id)?.label || id;
const modelLabel = id => data.models.find(m=>m.id===id)?.label || id;
function formatTime(value) {return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}

function options() {
  const oldRoute=$('#routing-dataset').value;
  $('#routing-dataset').innerHTML='<option value="all">Dataset mean (unweighted)</option>'+data.datasets.filter(d=>data.routing.coverage[d.id]).map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
  if([...$('#routing-dataset').options].some(o=>o.value===oldRoute))$('#routing-dataset').value=oldRoute;
}

function overview() {
  const rows=data.model_stats.filter(r=>r.scope==='formal');
  const totalTasks=data.datasets.reduce((n,d)=>n+Math.max(0,...rows.filter(r=>r.dataset===d.id).map(r=>Number(r.planned)||0)),0);
  const stats=[['total-task',integer(totalTasks),'','Across all datasets'],
    ['Datasets',data.datasets.length,'',`${Object.keys(data.routing.coverage).length} included in routing`],
    ['Models',data.models.length,'','Qwen · Gemma · Muse · DeepSeek'],
    ['Routing methods',methods.length,'',`${integer(data.routing.tasks)} common tasks`]];
  $('#overview').innerHTML=stats.map(a=>`<article class="overview-stat"><div class="stat-label">${a[0]}</div><div class="stat-value">${a[1]}<small>${a[2]}</small></div><div class="stat-note">${a[3]}</div></article>`).join('');
  $('#snapshot-time').textContent=`Updated ${formatTime(data.updated_at)} · UTC+8`;
  $('#footer-time').textContent=`Snapshot ${formatTime(data.updated_at)} · UTC+8`;

}

function modelRows() {
  return data.model_stats.filter(r=>r.scope==='formal');
}

function order(rows, sort) {
  if(!sort)return rows;
  return [...rows].sort((a,b)=>!valid(a[sort.key])?1:!valid(b[sort.key])?-1:(Number(a[sort.key])-Number(b[sort.key]))*sort.direction);
}

function modelMetricValue(row, metric) {
  return metric==='raw_cost_usd' && row.cost_tasks<row.graded ? row.known_cost_usd : row[metric];
}
function formatModelMetric(value,metric,axis=false) {
  if(!valid(value))return '—';
  if(metric==='accuracy')return axis?f(Number(value)*100,0):pct(value);
  if(metric.includes('tokens'))return compact(value);
  if(metric==='normalized_cost_mean')return f(value,axis?1:4);
  const digits=axis?(Number(value)===0?0:Math.max(0,Math.min(6,1-Math.floor(Math.log10(Math.abs(Number(value))))))):(metric==='mean_cost_usd'?6:4);
  return '$'+f(value,digits);
}
function modelScale(rows,metric) {
  if(metric==='accuracy'||metric==='normalized_cost_mean')return 1;
  const maximum=Math.max(...rows.map(r=>Number(modelMetricValue(r,metric))||0),0);
  if(maximum===0)return 1;
  const magnitude=10**Math.floor(Math.log10(maximum));
  return [1,2,5,10].find(n=>n*magnitude>=maximum)*magnitude;
}
function orderedDatasets() {
  const datasets=data.datasets.filter(d=>d.id!=='science');
  const science=data.datasets.find(d=>d.id==='science');
  if(science)datasets.splice(datasets.findIndex(d=>d.id==='verilogeval')+1,0,science);
  return datasets;
}
function renderModels() {
  const rows=modelRows(), metric=$('#model-metric').value;
  $('#scope-note').textContent='All graded results · Shared chart scale across models';
  const max=modelScale(rows,metric), metricLabel=$('#model-metric').selectedOptions[0].textContent;
  const datasetOrder=orderedDatasets().map(d=>d.id);
  const showModels=data.models.filter(m=>rows.some(r=>r.model===m.id));
  $('#model-chart').innerHTML=showModels.map(m=>{
    const modelRows=rows.filter(r=>r.model===m.id).sort((a,b)=>datasetOrder.indexOf(a.dataset)-datasetOrder.indexOf(b.dataset));
    const values=modelRows.map(r=>modelMetricValue(r,metric)).filter(valid).map(Number);
    const aggregate=values.length?(metric==='raw_cost_usd'?values.reduce((a,b)=>a+b,0):mean(values)):null;
    const partial=r=>metric.includes('tokens')?r.token_tasks<r.graded:metric!=='accuracy'&&r.cost_tasks<r.graded;
    const aggregatePartial=modelRows.some(partial);
    const prefix=metric==='raw_cost_usd'&&aggregatePartial?'≥ ':'';
    const suffix=metric!=='raw_cost_usd'&&aggregatePartial?'†':'';
    return `<article class="model-window" data-model="${esc(m.id)}" aria-labelledby="model-title-${esc(m.id)}">
      <div class="model-window-heading"><span class="window-kicker">${esc(metricLabel)}</span><h3 id="model-title-${esc(m.id)}" title="${esc(m.model_id)}">${esc(m.label)} <span class="thinking-label">(Thinking: ${esc(thinkingModes[m.id])})</span></h3></div>
      <div class="dataset-axis" aria-hidden="true"><span></span><div><span>${formatModelMetric(0,metric,true)}</span><span>${formatModelMetric(max/2,metric,true)}</span><span>${formatModelMetric(max,metric,true)}</span></div><span></span></div>
      <div class="dataset-bars">${modelRows.map(r=>{
        const value=modelMetricValue(r,metric), hasValue=valid(value), incomplete=partial(r);
        const lower=metric==='raw_cost_usd'&&incomplete;
        const note=metric==='accuracy'?`${r.passed} passed / ${r.graded} graded`:metric.includes('tokens')?`${r.token_tasks}/${r.graded} trajectories with recorded usage`:`${r.cost_tasks}/${r.graded} trajectories with recorded cost`;
        const display=(hasValue&&lower?'≥ ':'')+formatModelMetric(value,metric)+(hasValue&&incomplete&&!lower?'†':'');
        const title=`${dsLabel(r.dataset)}: ${display}. ${note}${metric.includes('tokens')&&hasValue?'. '+integer(value)+' tokens per task':''}`;
        return `<div class="dataset-bar-row" data-dataset="${esc(r.dataset)}" title="${esc(title)}"><span class="dataset-label">${esc(dsLabel(r.dataset))}</span><div class="dataset-track ${hasValue?'':'missing'}" role="img" aria-label="${esc(title)}"><span style="width:${hasValue?Math.max(0,Math.min(100,Number(value)/max*100)):0}%;background:${colors[m.id]}"></span></div><span class="dataset-value">${display}</span></div>`;
      }).join('')}</div>
      <div class="model-window-footer"><span>${modelRows.length} datasets · ${integer(sum(modelRows,'graded'))} graded</span><span>${metric==='raw_cost_usd'?'Total':'Dataset mean'} <strong>${prefix}${formatModelMetric(aggregate,metric)}${suffix}</strong></span></div>
    </article>`;
  }).join('')||'<div class="empty">No matching results.</div>';
  const renderRow=r=>{
    const partial=r.cost_tasks<r.graded, tokenPartial=r.token_tasks<r.graded;
    const incompleteCalls=r.complete_cost_tasks<r.cost_tasks||r.complete_token_tasks<r.token_tasks;
    const costNote=incompleteCalls?`<span class="coverage">${r.cost_tasks}/${r.graded} trajectories · recorded cost</span>`:partial?`<span class="coverage">Complete: ${r.cost_tasks}/${r.graded}</span>`:'';
    const tokenNote=incompleteCalls?`<span class="coverage">${r.token_tasks}/${r.graded} trajectories · recorded tokens</span>`:tokenPartial?`<span class="coverage">Coverage: ${r.token_tasks}/${r.graded}</span>`:'';
    return `<tr><td><span><span class="model-dot" style="background:${colors[r.model]};width:5px;height:5px;margin-right:5px"></span>${esc(modelLabel(r.model))}</span></td><td class="num">${r.passed} / ${r.graded}${r.ungraded?`<span class="cell-sub">${r.running?`${r.running} running`:`${r.ungraded} ungraded`} · ${r.planned} total</span>`:''}</td><td class="num">${f(r.mean_cost_usd,6)}</td><td class="num" title="${integer(r.mean_input_tokens)}">${integer(r.mean_input_tokens)}</td><td class="num" title="${integer(r.mean_output_tokens)}">${integer(r.mean_output_tokens)}</td><td class="num">${integer(r.mean_total_tokens)}${tokenNote}</td><td class="num cell-value">${partial?'≥ ':''}${f(partial?r.known_cost_usd:r.raw_cost_usd,4)}${costNote}</td><td class="num cell-value">${pct(r.accuracy)}</td></tr>`;
  };
  $('#model-tables').innerHTML=datasetOrder.filter(id=>rows.some(r=>r.dataset===id)).map(id=>{
    const datasetRows=order(rows.filter(r=>r.dataset===id),modelSort);
    return `<article class="panel model-dataset-panel" data-dataset="${esc(id)}"><div class="table-top"><h3>${esc(dsLabel(id))}</h3><span>${datasetRows.length} models</span></div><div class="table-wrap" tabindex="0" role="region" aria-label="${esc(dsLabel(id))} model statistics"><table><caption class="sr-only">${esc(dsLabel(id))} model results</caption><thead><tr>
        <th>Model</th><th class="num">Pass / Graded</th><th class="num">USD / task</th><th class="num">Input / task</th><th class="num">Output / task</th><th class="num sortable" data-model-sort="mean_total_tokens" tabindex="0" role="button">Tokens / task ↕</th><th class="num sortable" data-model-sort="raw_cost_usd" tabindex="0" role="button">Cost, USD ↕</th><th class="num sortable" data-model-sort="accuracy" tabindex="0" role="button">Accuracy ↕</th>
      </tr></thead><tbody>${datasetRows.map(renderRow).join('')}</tbody></table></div></article>`;
  }).join('');
  bindSort('[data-model-sort]','modelSort',()=>modelSort,v=>modelSort=v,renderModels);
}

function routeSummary() {
  const ds=$('#routing-dataset').value;
  return methods.map(method=>{
    if(ds==='all') {
      const r=data.routing.means.find(r=>r.method===method);
      return {method,perf:r?.mean_perf_per_cost,f1:r?.mean_macro_f1,datasets:r?.datasets};
    }
    const r=data.routing.metrics.find(r=>r.dataset===ds&&r.method===method);
    return {method,perf:r?.perf_per_cost,f1:r?.macro_f1,datasets:1};
  });
}

function bars(target, rows, key, max) {
  const actualMax=max || Math.max(...rows.map(r=>r[key]||0),.000001);
  $(target).innerHTML=rows.map(r=>`<div class="bar-row"><span>${esc(r.method)}</span><div class="bar-track" role="img" aria-label="${esc(r.method+' '+(r[key]??'No data'))}"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,(r[key]||0)/actualMax*100))}%;background:${methodColors[r.method]}"></div></div><span class="bar-value ${r[key]===Math.max(...rows.map(x=>x[key]||0))?'best':''}">${f(r[key],key==='f1'?4:2)}</span></div>`).join('')+`<div class="axis-note"><span>0</span><span>${f(actualMax/2,key==='f1'?1:0)}</span><span>${f(actualMax,key==='f1'?1:0)}</span></div>`;
}

function renderRouting() {
  const ds=$('#routing-dataset').value, rows=routeSummary();
  const equal=ds==='all';
  $('#routing-coverage').textContent=`${Object.keys(data.routing.coverage).length} datasets · ${integer(data.routing.tasks)} common tasks`;
  bars('#efficiency-chart',rows,'perf');bars('#f1-chart',rows,'f1',1);
  const filtered=data.routing.metrics.filter(r=>equal||r.dataset===ds);
  $('#routing-tables').innerHTML=orderedDatasets().filter(d=>filtered.some(r=>r.dataset===d.id)).map(d=>{
    const datasetRows=order(filtered.filter(r=>r.dataset===d.id),routeSort);
    const bestValue=key=>Math.max(...datasetRows.map(r=>r[key]).filter(valid).map(Number));
    const isBest=(r,key)=>valid(r[key])&&Number(r[key])===bestValue(key);
    return `<article class="panel routing-dataset-panel" data-dataset="${esc(d.id)}"><div class="table-top"><h3>${esc(d.label)}</h3><span>${integer(datasetRows[0].tasks)} tasks</span></div><div class="table-wrap" tabindex="0" role="region" aria-label="${esc(d.label)} routing statistics"><table><caption class="sr-only">${esc(d.label)} routing results</caption><thead><tr><th>Method</th><th class="num">Tasks</th><th class="num sortable" data-route-sort="performance" tabindex="0" role="button">Completion rate ↕</th><th class="num">Solver, USD</th><th class="num sortable" data-route-sort="perf_per_cost" tabindex="0" role="button">Perf / Cost ↕</th><th class="num sortable" data-route-sort="macro_f1" tabindex="0" role="button">Macro-F1 ↕</th></tr></thead><tbody>${datasetRows.map(r=>`<tr><td>${esc(r.method)}</td><td class="num">${integer(r.tasks)}</td><td class="num">${pct(r.performance)}</td><td class="num">${f(r.raw_backend_cost_usd,4)}</td><td class="num${isBest(r,'perf_per_cost')?' cell-value':''}">${f(r.perf_per_cost,3)}</td><td class="num${isBest(r,'macro_f1')?' cell-value':''}">${f(r.macro_f1,4)}</td></tr>`).join('')}</tbody></table></div></article>`;
  }).join('');
  bindSort('[data-route-sort]','routeSort',()=>routeSort,v=>routeSort=v,renderRouting);
  $('#legend').innerHTML=data.models.map(m=>`<span><i class="model-dot" style="background:${colors[m.id]}"></i>${esc(m.id==='deepseek'?'DeepSeek':m.id[0].toUpperCase()+m.id.slice(1))}</span>`).join('');
  $('#selection-chart').innerHTML=methods.map(method=>{
    const choices=data.routing.choices.filter(r=>r.method===method&&(equal||r.dataset===ds));
    const total=sum(choices,'count');
    return `<div class="selection-row"><span>${esc(method)}</span><div class="selection-stack">${data.models.map(m=>{
      const n=sum(choices.filter(c=>c.model===m.id),'count');
      return `<div tabindex="0" role="img" style="width:${total?n/total*100:0}%;background:${colors[m.id]}" title="${esc(modelLabel(m.id))}: ${n} / ${total} (${pct(total?n/total:0)})" aria-label="${esc(method+' selected '+modelLabel(m.id)+' '+n+' times')}"></div>`;
    }).join('')}</div><span>${integer(total)}</span></div>`;
  }).join('');
}

async function load() {
  $('#refresh').disabled=true;
  try {
    const r=await fetch('assets/data.json?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const next=await r.json();
    if(next.schema_version!==1 || !Array.isArray(next.model_stats))throw new Error('Unsupported data format');
    data=next;options();overview();renderModels();renderRouting();$('#error').hidden=true;
  }catch(e){$('#error').hidden=false;$('#error').textContent='Unable to load data. Use the refresh button to retry. '+e.message;}
  finally{$('#refresh').disabled=false;}
}

$('#model-metric').addEventListener('change',renderModels);
$('#routing-dataset').addEventListener('change',renderRouting);$('#refresh').addEventListener('click',load);
function bindSort(selector,key,readState,setState,render) { $$(selector).forEach(el=>{
  const run=()=>{const current=readState();setState({key:el.dataset[key],direction:current?.key===el.dataset[key]?-current.direction:-1});render();};
  el.addEventListener('click',run);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run();}});
});}
load();setInterval(load,300000);
