'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const colors = {qwen:'#2f8061',gemma:'#6288b2',muse:'#c39141',deepseek:'#8974ae'};
const methodColors = {'Random':'#9ba7a0','KNN':'#2f8061','Zero-shot LLM':'#6288b2','Agent-as-a-Router':'#8974ae'};
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
function formatTime(value) {return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}

function options() {
  const oldModel=$('#model-dataset').value, oldRoute=$('#routing-dataset').value;
  $('#model-dataset').innerHTML='<option value="all">全部数据集</option>'+data.datasets.map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
  $('#routing-dataset').innerHTML='<option value="all">数据集等权平均</option>'+data.datasets.filter(d=>data.routing.coverage[d.id]).map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
  if(oldModel)$('#model-dataset').value=oldModel;
  if([...$('#routing-dataset').options].some(o=>o.value===oldRoute))$('#routing-dataset').value=oldRoute;
}

function overview() {
  const rows=data.model_stats.filter(r=>r.scope==='formal');
  const graded=sum(rows,'graded'), planned=sum(rows,'planned');
  const stats=[['已评分模型任务',integer(graded),'/ '+integer(planned),'模型 × 题目 · 全部正式结果','▦'],
    ['评测数据集',data.datasets.length,'个',`${Object.keys(data.routing.coverage).length} 个已纳入 routing`,'◫'],
    ['候选模型',data.models.length,'个','Qwen · Gemma · Muse · DeepSeek','◇'],
    ['Routing 方法',methods.length,'种',`${integer(data.routing.tasks)} 个共同样本`,'↗']];
  $('#overview').innerHTML=stats.map((a,i)=>`<article class="kpi ${i===0?'primary':''}"><div class="kpi-label">${a[0]}<span class="kpi-icon">${a[4]}</span></div><div class="kpi-value">${a[1]}<small>${a[2]}</small></div><div class="kpi-caption">${a[3]}</div></article>`).join('');
  const terminal=data.collection.terminal;
  const running=Object.values(terminal).reduce((s,r)=>s+r.running,0);
  $('#collection').innerHTML=`<span><span class="small-dot"></span><strong>Terminal-Bench 2.0</strong> · ${running?`还有 ${running} 题运行中`:'模型运行已结束'}${data.routing.includes_terminal?' · 已纳入 routing':' · 待纳入 routing'}</span><div class="progress-pills">${data.models.map(m=>`<span><i style="background:${colors[m.id]}"></i>${esc(m.label.split(' ')[0])} <strong>${terminal[m.id].graded}/${terminal[m.id].planned}</strong></span>`).join('')}</div>`;
  $('#snapshot-time').textContent=`快照 ${formatTime(data.updated_at)} · 北京时间`;
  $('#footer-time').textContent=`数据更新于 ${formatTime(data.updated_at)} · UTC+8`;
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
    ? '全部正式结果：按各模型已评分题统计；min–max 范围随已完成数据更新。费用、Token 的有效覆盖量单独列明。'
    : '共同样本：只使用四个模型评分和费用均完整的同一批题；费用尺度与下方 routing 指标完全一致。';
  const chartRows=data.models.map(m=>({model:m.id, value:mean(rows.filter(r=>r.model===m.id).map(r=>r[metric])), count:rows.filter(r=>r.model===m.id).length}));
  const max=Math.max(...chartRows.map(r=>r.value||0),metric==='accuracy'?1:0.000001);
  const metricLabel=$('#model-metric').selectedOptions[0].textContent;
  $('#model-chart').innerHTML=chartRows.map(r=>`<div class="model-stat"><div class="model-name"><span class="model-dot" style="background:${colors[r.model]}"></span>${esc(modelLabel(r.model))}</div><div class="model-value">${metric==='accuracy'?pct(r.value):metric.includes('tokens')?compact(r.value):f(r.value,4)}</div><div class="track" role="img" aria-label="${esc(modelLabel(r.model)+' '+metricLabel+' '+(r.value??'暂无数据'))}"><span style="width:${Math.min(100,(r.value||0)/max*100)}%;background:${colors[r.model]}"></span></div><div class="model-sub">${isAll?`${r.count} 个数据集 · 等权平均`:esc(dsLabel(ds))}</div></div>`).join('');
  $('#model-table-caption').textContent=`${rows.length} 条模型统计 · ${scope==='formal'?'全部正式结果':'Routing 共同样本'}`;
  $('#model-table tbody').innerHTML=order(rows,modelSort).map(r=>{
    const partial=r.cost_tasks<r.graded, tokenPartial=r.token_tasks<r.graded;
    const costNote=partial?`<span class="coverage">费用完整 ${r.cost_tasks}/${r.graded} 题</span>`:'';
    const tokenNote=tokenPartial?`<span class="coverage">覆盖 ${r.token_tasks}/${r.graded} 题</span>`:'';
    return `<tr><td><span class="cell-title">${esc(dsLabel(r.dataset))}</span><span class="cell-sub"><span class="model-dot" style="background:${colors[r.model]};width:5px;height:5px;margin-right:5px"></span>${esc(modelLabel(r.model))}</span></td><td class="num cell-value">${pct(r.accuracy)}</td><td class="num">${r.passed} / ${r.graded}${r.ungraded?`<span class="cell-sub">${r.running?`${r.running} 运行中`:`${r.ungraded} 未评分`} · 共 ${r.planned}</span>`:''}</td><td class="num">${partial?'≥ ':''}${f(partial?r.known_cost_usd:r.raw_cost_usd,4)}${costNote}</td><td class="num">${f(r.mean_cost_usd,6)}</td><td class="num">${f(r.normalized_cost_mean,4)}</td><td class="num" title="${integer(r.mean_input_tokens)}">${integer(r.mean_input_tokens)}</td><td class="num" title="${integer(r.mean_output_tokens)}">${integer(r.mean_output_tokens)}</td><td class="num cell-value">${integer(r.mean_total_tokens)}${tokenNote}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">没有符合条件的统计数据。</td></tr>';
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
  $(target).innerHTML=rows.map(r=>`<div class="bar-row"><span>${esc(r.method)}</span><div class="bar-track" role="img" aria-label="${esc(r.method+' '+(r[key]??'暂无数据'))}"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,(r[key]||0)/actualMax*100))}%;background:${methodColors[r.method]}"></div></div><span class="bar-value">${f(r[key],key==='f1'?4:2)}</span></div>`).join('')+`<div class="axis-note">0 ${'─'.repeat(12)} ${f(actualMax,key==='f1'?1:0)}</div>`;
}

function renderRouting() {
  const ds=$('#routing-dataset').value, rows=routeSummary(), best=Math.max(...rows.map(r=>r.perf||0));
  const equal=ds==='all';
  $('#routing-coverage').textContent=`${Object.keys(data.routing.coverage).length} 个数据集 / ${integer(data.routing.tasks)} 题`;
  $('#route-cards').innerHTML=rows.map(r=>`<article class="route-card ${r.perf===best?'winner':''}"><div class="route-name"><span class="model-dot" style="background:${methodColors[r.method]}"></span>${esc(r.method)}</div><div class="route-main">${f(r.perf,2)}<small>Perf / Cost</small></div><div class="route-bottom"><span>Macro-F1 <strong>${f(r.f1,4)}</strong></span>${r.perf===best?'<span class="winner-label">效率最高</span>':''}</div></article>`).join('');
  bars('#efficiency-chart',rows,'perf');bars('#f1-chart',rows,'f1',1);
  const filtered=data.routing.metrics.filter(r=>equal||r.dataset===ds);
  $('#routing-row-count').textContent=`${filtered.length} 条统计`;
  $('#routing-table tbody').innerHTML=order(filtered,routeSort).map(r=>`<tr><td><span class="cell-title">${esc(dsLabel(r.dataset))}</span><span class="cell-sub">${esc(r.method)}</span></td><td class="num">${integer(r.tasks)}</td><td class="num cell-value">${pct(r.performance)}</td><td class="num">${f(r.raw_backend_cost_usd,4)}</td><td class="num">${f(r.raw_router_cost_usd,5)}</td><td class="num">${f(r.raw_total_cost_usd,4)}</td><td class="num">${f(r.metric_cost,4)}</td><td class="num cell-value">${f(r.perf_per_cost,3)}</td><td class="num">${f(r.macro_f1,4)}</td></tr>`).join('');
  $('#legend').innerHTML=data.models.map(m=>`<span><i class="model-dot" style="background:${colors[m.id]}"></i>${esc(m.id==='deepseek'?'DeepSeek':m.id[0].toUpperCase()+m.id.slice(1))}</span>`).join('');
  $('#selection-chart').innerHTML=methods.map(method=>{
    const choices=data.routing.choices.filter(r=>r.method===method&&(equal||r.dataset===ds));
    const total=sum(choices,'count');
    return `<div class="selection-row"><span>${esc(method)}</span><div class="selection-stack">${data.models.map(m=>{
      const n=sum(choices.filter(c=>c.model===m.id),'count');
      return `<div tabindex="0" role="img" style="width:${total?n/total*100:0}%;background:${colors[m.id]}" title="${esc(modelLabel(m.id))}: ${n} / ${total} (${pct(total?n/total:0)})" aria-label="${esc(method+' 选择 '+modelLabel(m.id)+' '+n+' 次')}"></div>`;
    }).join('')}</div><span>${integer(total)} 次</span></div>`;
  }).join('');
  $('#routing-note').textContent=`${equal?'上方卡片与图表是各数据集指标的直接等权平均，不按题数加权。':'当前展示 '+dsLabel(ds)+' 的单数据集结果。'} ${data.routing.includes_terminal?'Terminal-Bench 已纳入本版 routing。':'Terminal-Bench 尚未纳入本版 routing，完成后将更新。'} KNN 为跨数据集合并训练的全局五折结果。`;
}

function notes() {
  const labels={accuracy:'01 · 准确率与失败判定',cost:'02 · 原始费用',normalization:'03 · 费用归一化',tokens:'04 · Token 统计',routing:'05 · Routing 指标',labels:'06 · Best model 标签',methods:'07 · 方法实现',comparison:'08 · 比较边界'};
  $('#method-notes').innerHTML=Object.entries(labels).map(([k,label])=>`<div class="method-note"><h3>${label}</h3><p>${esc(data.notes[k])}</p></div>`).join('')+'<div class="method-note formula"><h3>归一化公式</h3><code>c′ = (c − min) / (max − min)</code><p>min、max 来自同一数据集的 task × model 费用池；max = min 时记为 0。各 router 共用同一尺度。</p></div>';
}

async function load() {
  $('#refresh').disabled=true;
  try {
    const r=await fetch('assets/data.json?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const next=await r.json();
    if(next.schema_version!==1 || !Array.isArray(next.model_stats))throw new Error('数据格式不兼容');
    data=next;options();overview();renderModels();renderRouting();notes();$('#error').hidden=true;
  }catch(e){$('#error').hidden=false;$('#error').textContent='数据暂时无法读取，请点击右上角刷新。'+e.message;}
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
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)$$('.nav-item').forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));}),{rootMargin:'-12% 0px -70% 0px'});
['models','routing','methodology'].forEach(id=>observer.observe($('#'+id)));
load();setInterval(load,300000);
