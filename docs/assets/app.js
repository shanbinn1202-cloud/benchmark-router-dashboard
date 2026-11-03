'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const colors = {qwen:'#346689',gemma:'#ae7b24',muse:'#7d7960',deepseek:'#9b493c'};
const methodColors = {'Random':'#949084','KNN':'#346689','Zero-shot LLM':'#ae7b24','Agent-as-a-Router':'#9b493c'};
const methods = Object.keys(methodColors);
let data, scope='formal', modelSort=null, routeSort=null;
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
  const oldModel=$('#model-dataset').value, oldRoute=$('#routing-dataset').value;
  $('#model-dataset').innerHTML='<option value="all">All datasets</option>'+data.datasets.map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
  $('#routing-dataset').innerHTML='<option value="all">Dataset mean (unweighted)</option>'+data.datasets.filter(d=>data.routing.coverage[d.id]).map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
  if(oldModel)$('#model-dataset').value=oldModel;
  if([...$('#routing-dataset').options].some(o=>o.value===oldRoute))$('#routing-dataset').value=oldRoute;
}

function overview() {
  const rows=data.model_stats.filter(r=>r.scope==='formal');
  const graded=sum(rows,'graded'), planned=sum(rows,'planned');
  const stats=[['Graded model–tasks',integer(graded),' / '+integer(planned),'All formal results'],
    ['Datasets',data.datasets.length,'',`${Object.keys(data.routing.coverage).length} included in routing`],
    ['Models',data.models.length,'','Qwen · Gemma · Muse · DeepSeek'],
    ['Routing methods',methods.length,'',`${integer(data.routing.tasks)} common tasks`]];
  $('#overview').innerHTML=stats.map(a=>`<article class="overview-stat"><div class="stat-label">${a[0]}</div><div class="stat-value">${a[1]}<small>${a[2]}</small></div><div class="stat-note">${a[3]}</div></article>`).join('');
  const terminal=data.collection.terminal;
  const running=Object.values(terminal).reduce((s,r)=>s+r.running,0);
  $('#collection').innerHTML=`<span class="collection-label"><strong>Terminal-Bench 2.0</strong><span>${running?`${running} running`:'Collection complete'} · ${data.routing.includes_terminal?'Included in routing':'Routing pending'}</span></span><div class="progress-pills">${data.models.map(m=>`<span><i style="background:${colors[m.id]}"></i>${esc(m.id==='deepseek'?'DeepSeek':m.id[0].toUpperCase()+m.id.slice(1))} <strong>${terminal[m.id].graded}/${terminal[m.id].planned}</strong></span>`).join('')}</div>`;
  $('#snapshot-time').textContent=`Updated ${formatTime(data.updated_at)} · UTC+8`;
  $('#footer-time').textContent=`Snapshot ${formatTime(data.updated_at)} · UTC+8`;

}

function modelRows() {
  const ds=$('#model-dataset').value, query=$('#model-search').value.trim().toLowerCase();
  return data.model_stats.filter(r=>r.scope===scope && (ds==='all'||ds===r.dataset) &&
    (!query || `${dsLabel(r.dataset)} ${modelLabel(r.model)} ${r.dataset} ${r.model}`.toLowerCase().includes(query)));
}

function order(rows, sort) {
  if(!sort)return rows;
  return [...rows].sort((a,b)=>!valid(a[sort.key])?1:!valid(b[sort.key])?-1:(Number(a[sort.key])-Number(b[sort.key]))*sort.direction);
}

function renderModels() {
  const rows=modelRows(), metric=$('#model-metric').value, ds=$('#model-dataset').value;
  const isAll=ds==='all';
  $('#scope-note').textContent=scope==='formal'
    ? 'All graded tasks per model. Cost normalization uses the current results; charts show unweighted dataset means.'
    : 'Tasks with complete scores and costs for all four models. Normalization matches the routing evaluation.';
  const chartRows=data.models.map(m=>({model:m.id, value:mean(rows.filter(r=>r.model===m.id).map(r=>r[metric])), count:rows.filter(r=>r.model===m.id).length}));
  const max=Math.max(...chartRows.map(r=>r.value||0),metric==='accuracy'?1:0.000001);
  const metricLabel=$('#model-metric').selectedOptions[0].textContent;
  $('#model-chart').innerHTML=chartRows.map(r=>`<div class="model-stat"><div class="model-name"><span class="model-dot" style="background:${colors[r.model]}"></span>${esc(modelLabel(r.model))}</div><div class="model-value">${metric==='accuracy'?pct(r.value):metric.includes('tokens')?compact(r.value):f(r.value,4)}</div><div class="track" role="img" aria-label="${esc(modelLabel(r.model)+' '+metricLabel+' '+(r.value??'No data'))}"><span style="width:${Math.min(100,(r.value||0)/max*100)}%;background:${colors[r.model]}"></span></div><div class="model-sub">${isAll?`${r.count} datasets · unweighted mean`:esc(dsLabel(ds))}</div></div>`).join('');
  $('#model-table-caption').textContent=`${rows.length} rows · ${scope==='formal'?'All results':'Routing cohort'}`;
  $('#model-table tbody').innerHTML=order(rows,modelSort).map(r=>{
    const partial=r.cost_tasks<r.graded, tokenPartial=r.token_tasks<r.graded;
    const costNote=partial?`<span class="coverage">Complete: ${r.cost_tasks}/${r.graded}</span>`:'';
    const tokenNote=tokenPartial?`<span class="coverage">Coverage: ${r.token_tasks}/${r.graded}</span>`:'';
    return `<tr><td><span class="cell-title">${esc(dsLabel(r.dataset))}</span><span class="cell-sub"><span class="model-dot" style="background:${colors[r.model]};width:5px;height:5px;margin-right:5px"></span>${esc(modelLabel(r.model))}</span></td><td class="num cell-value">${pct(r.accuracy)}</td><td class="num">${r.passed} / ${r.graded}${r.ungraded?`<span class="cell-sub">${r.running?`${r.running} running`:`${r.ungraded} ungraded`} · ${r.planned} total</span>`:''}</td><td class="num">${partial?'≥ ':''}${f(partial?r.known_cost_usd:r.raw_cost_usd,4)}${costNote}</td><td class="num">${f(r.mean_cost_usd,6)}</td><td class="num">${f(r.normalized_cost_mean,4)}</td><td class="num" title="${integer(r.mean_input_tokens)}">${integer(r.mean_input_tokens)}</td><td class="num" title="${integer(r.mean_output_tokens)}">${integer(r.mean_output_tokens)}</td><td class="num cell-value">${integer(r.mean_total_tokens)}${tokenNote}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">No matching results.</td></tr>';
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
  $('#routing-row-count').textContent=`${filtered.length} rows`;
  $('#routing-table tbody').innerHTML=order(filtered,routeSort).map(r=>`<tr><td><span class="cell-title">${esc(dsLabel(r.dataset))}</span><span class="cell-sub">${esc(r.method)}</span></td><td class="num">${integer(r.tasks)}</td><td class="num cell-value">${pct(r.performance)}</td><td class="num">${f(r.raw_backend_cost_usd,4)}</td><td class="num">${f(r.raw_router_cost_usd,5)}</td><td class="num">${f(r.raw_total_cost_usd,4)}</td><td class="num">${f(r.metric_cost,4)}</td><td class="num cell-value">${f(r.perf_per_cost,3)}</td><td class="num">${f(r.macro_f1,4)}</td></tr>`).join('');
  $('#legend').innerHTML=data.models.map(m=>`<span><i class="model-dot" style="background:${colors[m.id]}"></i>${esc(m.id==='deepseek'?'DeepSeek':m.id[0].toUpperCase()+m.id.slice(1))}</span>`).join('');
  $('#selection-chart').innerHTML=methods.map(method=>{
    const choices=data.routing.choices.filter(r=>r.method===method&&(equal||r.dataset===ds));
    const total=sum(choices,'count');
    return `<div class="selection-row"><span>${esc(method)}</span><div class="selection-stack">${data.models.map(m=>{
      const n=sum(choices.filter(c=>c.model===m.id),'count');
      return `<div tabindex="0" role="img" style="width:${total?n/total*100:0}%;background:${colors[m.id]}" title="${esc(modelLabel(m.id))}: ${n} / ${total} (${pct(total?n/total:0)})" aria-label="${esc(method+' selected '+modelLabel(m.id)+' '+n+' times')}"></div>`;
    }).join('')}</div><span>${integer(total)}</span></div>`;
  }).join('');
  $('#routing-note').textContent=equal
    ? 'Unweighted mean across datasets. Cost includes solver and router calls; F1 uses all four model labels.'
    : `${dsLabel(ds)}. Cost includes solver and router calls; F1 uses all four model labels.`;
}

function notes() {
  const labels={accuracy:'Accuracy',cost:'Raw cost',normalization:'Normalized cost',tokens:'Tokens',routing:'Routing metrics',labels:'Best-model labels',methods:'Methods',comparison:'Evaluation scope'};
  $('#method-notes').innerHTML=Object.entries(labels).map(([k,label])=>`<div class="method-note"><h3>${label}</h3><p>${esc(data.notes[k])}</p></div>`).join('');
}

async function load() {
  $('#refresh').disabled=true;
  try {
    const r=await fetch('assets/data.json?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const next=await r.json();
    if(next.schema_version!==1 || !Array.isArray(next.model_stats))throw new Error('Unsupported data format');
    data=next;options();overview();renderModels();renderRouting();notes();$('#error').hidden=true;
  }catch(e){$('#error').hidden=false;$('#error').textContent='Unable to load data. Use the refresh button to retry. '+e.message;}
  finally{$('#refresh').disabled=false;}
}

$$('[data-scope]').forEach(button=>button.addEventListener('click',()=>{
  scope=button.dataset.scope;$$('[data-scope]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});renderModels();
}));
$('#model-dataset').addEventListener('change',renderModels);$('#model-metric').addEventListener('change',renderModels);$('#model-search').addEventListener('input',renderModels);
$('#routing-dataset').addEventListener('change',renderRouting);$('#refresh').addEventListener('click',load);
function bindSort(selector,key,readState,setState,render) { $$(selector).forEach(el=>{
  const run=()=>{const current=readState();setState({key:el.dataset[key],direction:current?.key===el.dataset[key]?-current.direction:-1});render();};
  el.addEventListener('click',run);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run();}});
});}
bindSort('[data-model-sort]','modelSort',()=>modelSort,v=>modelSort=v,renderModels);
bindSort('[data-route-sort]','routeSort',()=>routeSort,v=>routeSort=v,renderRouting);
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(window.scrollY<150){$$('.nav-item').forEach(a=>a.classList.toggle('active',a.hash==='#models'));return;}if(e.isIntersecting)$$('.nav-item').forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));}),{rootMargin:'-12% 0px -70% 0px'});
['models','routing','methodology'].forEach(id=>observer.observe($('#'+id)));
load();setInterval(load,300000);
