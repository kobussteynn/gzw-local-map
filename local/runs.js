import {uid, coordinate, distance, newRun, validateRun, loadStore, nearbyMarkers, requiredKeys, matchDoorKey} from './planner-core.mjs';
import './notes.js';
import './location-filter.js';
import './task-selection.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => structuredClone(value);
let store, storageError = '';
try { store = loadStore(localStorage); }
catch (error) { store = {runs: [], draft: newRun(), open: false}; storageError = 'Saved data could not be loaded. Export or back up browser storage before saving a new run.'; }
let run = store.draft, bridge, drawingBridge, data = {markers:{}, keys:[]}, dataReady = false;
let tab = 'plan', mode = '', search = '', toastTimer, saving = false, binding = false, deleted;
let sourceListener, mapListener, renderListener, restoring = false;
const panel = document.createElement('section');
panel.id = 'runs-panel'; panel.hidden = true; panel.setAttribute('aria-label','Runs planner');
const toolbar = document.createElement('div'); toolbar.id = 'runs-toolbar'; toolbar.hidden = true; toolbar.setAttribute('aria-label','Run planning tools');
const overlay = document.createElementNS('http://www.w3.org/2000/svg','svg'); overlay.id = 'runs-overlay'; overlay.setAttribute('aria-label','Saved run route and annotations');
const toastBox = document.createElement('div'); toastBox.id = 'runs-toast'; toastBox.hidden = true; toastBox.setAttribute('role','status');
document.body.append(panel, toastBox);

function toast(message) { toastBox.textContent = message; toastBox.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastBox.hidden = true, 6500); }
function status(message) { const el = $('.runs-status',panel); if (el) el.textContent = message; }
function persist() {
  if (storageError) { status(storageError); return false; }
  run.updatedAt = new Date().toISOString(); store.draft = run;
  const savedIndex=store.runs.findIndex(item=>item.id===run.id);
  if(savedIndex>=0)store.runs[savedIndex]=clone(run);
  try { localStorage.setItem('gzw.runs.v1',JSON.stringify(store)); status(savedIndex>=0?'Changes saved locally · This run is in your library':'Draft kept on this browser · Save run to add it to your library'); return true; }
  catch { status('Storage is full or unavailable. Export your run now to avoid losing changes.'); toast('Could not save locally. Use Export JSON to back up this run.'); return false; }
}
function getDrawings() { return drawingBridge?.capture?.() || run.drawings; }
function snapshot() {
  run.drawings = clone(getDrawings());
  if (bridge) {
    const view = bridge.map.getView();
    run.view = {center: view.getCenter().slice(), zoom: view.getZoom()};
    run.mortar = bridge.state.mortar; run.mapVersion = bridge.state.mapVersion;
  }
}
function saveRun() {
  snapshot();
  if (!run.title.trim()) { toast('Give this run a name before saving.'); $('#run-title',panel)?.focus(); return; }
  const backup = clone(store.runs), saved = clone(run), index = store.runs.findIndex(item => item.id === run.id);
  index < 0 ? store.runs.unshift(saved) : store.runs.splice(index,1,saved);
  if (!persist()) { store.runs = backup; return; }
  toast(`Saved “${run.title}” with ${run.steps.length} stops, ${run.drawings.length} drawings and ${run.targets.length} mortar targets.`);
  render();
}
function blankRun() { snapshot(); run = newRun(bridge?.map.custom.mapData.code_name || 'lamang'); store.draft = run; mode = ''; tab = 'plan'; drawingBridge?.restore([]); persist(); render(); paint(); }
function loadRun(id, edit = false) {
  const saved = store.runs.find(item => item.id === id); if (!saved) return;
  run = clone(saved); store.draft = run; store.open = true; mode = ''; tab = edit ? 'plan' : 'briefing'; persist();
  const currentMap = bridge?.map.custom.mapData.code_name;
  if (currentMap && currentMap !== run.map) { location.href = `/maps/${run.map}${run.view ? `#m=${run.view.zoom}/${run.view.center[0]}/${run.view.center[1]}` : ''}`; return; }
  restoreRun(); render();
}
function restoreRun() {
  if (!bridge) return;
  restoring = true;
  window.__gzwPlannerDraw=false;
  drawingBridge?.restore(run.drawings);
  bridge.state.freeHandMode.enabled = false; bridge.state.measureState = false;
  bridge.state.mortar = run.mortar; bridge.state.mapVersion = run.mapVersion;
  if (run.view) { bridge.map.getView().setCenter(run.view.center); bridge.map.getView().setZoom(run.view.zoom); }
  restoring = false; paint();
}
function setOpen(open) {
  store.open = open; panel.hidden = !open; toolbar.hidden = !bridge;
  $('#runs-nav')?.setAttribute('aria-expanded',String(open));
  if (!open) { mode = ''; window.__gzwPlannerDraw=false; if (bridge) bridge.state.freeHandMode.enabled = false; }
  persist(); render();
}
function allMarkers() { return Object.entries(data.markers).flatMap(([group, info]) => info.markersArray.map(m => ({...m, group}))); }
const group = id => data.markers[String(id)]?.markersArray || [];
const doors = () => group(3);
const keyName = key => key.long_name || key.short_name;
const phaseOptions = selected => ['Before landing','On arrival','While looting secondary buildings','Before entering objective','After objective','Before extraction'].map(value => `<option ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
const lineItems = text => text.split('\n').map(s => s.trim()).filter(Boolean);
function checklist(id, label, hint = '') { return `<label class="runs-check"><input type="checkbox" data-check="${esc(id)}" ${run.checked[id] ? 'checked' : ''}><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`; }
function selectedDoors() { return run.selectedDoorIds.map(id => doors().find(d => Number(d.id) === Number(id))).filter(Boolean); }
function targetsCard(target, index) {
  return `<article class="runs-card target"><div class="runs-row top"><span class="runs-badge">M${index+1}</span><input aria-label="Mortar target ${index+1} name" data-item="targets" data-id="${target.id}" data-field="title" value="${esc(target.title)}"></div>
    <label class="field"><span>Strike timing</span><select data-item="targets" data-id="${target.id}" data-field="phase">${phaseOptions(target.phase)}</select></label>
    <label class="field"><span>Target note / coordination</span><textarea data-item="targets" data-id="${target.id}" data-field="note">${esc(target.note)}</textarea></label>
    <label class="field"><span>Planning radius (m)</span><input type="number" min="10" max="500" data-item="targets" data-id="${target.id}" data-field="radius" value="${Number(target.radius)||75}"></label>
    <p class="runs-help">${esc(rangeText(target.coords))}</p><div class="runs-row"><button class="small" data-action="focus-targets" data-id="${target.id}">Locate</button><button class="small danger" data-action="remove-targets" data-id="${target.id}">Remove target</button></div></article>`;
}
function renderPlan() {
  const doorOptions = [...selectedDoors(), ...nearbyMarkers(doors(),run,100).map(x => x.marker)].filter((item,index,array) => array.findIndex(d => d.id === item.id) === index);
  const keys = requiredKeys(run,doors(),data.keys);
  return `<label class="field"><span>Run name</span><input id="run-title" class="run-title" data-run="title" placeholder="e.g. Golf 2 → Airfield sweep" value="${esc(run.title)}"></label>
    <div class="runs-row"><button class="primary" data-action="save">Save run</button><button data-action="new">New run</button><button data-action="fit">Fit route</button></div>
    <section class="runs-section"><h3>01 / Route & drawings</h3><p class="runs-help">Add stops in order. Click the map for custom stops, or search known locations. Choose Draw route, then drag on the map for a freehand route.</p>
    <div class="runs-row"><button data-action="mode-waypoint">＋ Map stop</button><button data-action="draw">✎ Draw route</button><button data-action="mode-note">＋ Note pin</button></div>
    <label class="field"><span>Find landing zones, places, doors or bosses</span><input id="run-search" type="search" autocomplete="off" placeholder="Golf 2, hangar, terminal…" value="${esc(search)}"></label><div id="run-results" class="runs-search-results">${searchResults()}</div>
    ${!run.steps.length ? '<div class="runs-empty">No stops yet. Add your landing zone, then plan the order of the raid.</div>' : ''}
    ${run.steps.map((step,index) => `<article class="runs-card"><div class="runs-row top"><span class="runs-badge">${index+1}</span><input aria-label="Stop ${index+1} name" data-item="steps" data-id="${step.id}" data-field="title" value="${esc(step.title)}"></div><label class="field"><span>What to do here</span><textarea data-item="steps" data-id="${step.id}" data-field="note" placeholder="Loot here while mortar hits the terminal…">${esc(step.note)}</textarea></label><div class="runs-row"><button class="small" data-action="focus-steps" data-id="${step.id}">Locate</button><button class="small" aria-label="Move stop ${index+1} up" data-action="up" data-id="${step.id}" ${index===0?'disabled':''}>↑</button><button class="small" aria-label="Move stop ${index+1} down" data-action="down" data-id="${step.id}" ${index===run.steps.length-1?'disabled':''}>↓</button><button class="small danger" data-action="remove-steps" data-id="${step.id}">Remove</button></div></article>`).join('')}
    <div id="run-drawings">${drawingsHTML()}</div>
    ${run.notes.map((note,index) => `<article class="runs-card note"><input aria-label="Note ${index+1} name" data-item="notes" data-id="${note.id}" data-field="title" value="${esc(note.title)}"><label class="field"><span>Remember at this point</span><textarea data-item="notes" data-id="${note.id}" data-field="note">${esc(note.note)}</textarea></label><div class="runs-row"><button class="small" data-action="focus-notes" data-id="${note.id}">Locate</button><button class="small danger" data-action="remove-notes" data-id="${note.id}">Remove note</button></div></article>`).join('')}</section>
    <section class="runs-section"><h3>02 / Mortar plan</h3><p class="runs-help">Place intended strike locations and schedule them alongside the raid. Range rings use the original map overlay. Target circles are your planning areas.</p>
    <label class="field"><span>Mortar range overlay</span><select id="run-mortar"><option value="none">Off</option><option value="all">All factions</option><option value="lri">Lamang Recovery Initiative</option><option value="csi">Crimson Shield International</option><option value="mss">Mithras Security Systems</option></select></label>
    <button data-action="mode-target">＋ Place mortar target</button>${run.targets.map(targetsCard).join('')}</section>
    <section class="runs-section"><h3>03 / Doors & inventory</h3><p class="runs-help">Nearby doors are suggested within 100 m of the route. Select the doors you intend to enter. You can also add a door using location search.</p>
    ${doorOptions.map(door => `<label class="runs-check"><input type="checkbox" data-door="${door.id}" ${run.selectedDoorIds.includes(door.id)?'checked':''}><span>${esc(door.name)}<small>${esc(door.poi?.name || '')}</small></span></label>`).join('') || '<p class="runs-help">Add a route to see nearby doors.</p>'}
    ${selectedDoors().map(door => {const match = matchDoorKey(door,data.keys,run.doorKeys); return `<label class="field"><span>${esc(door.name)} → Key</span><select data-door-key="${door.id}"><option value="">${match.key && !run.doorKeys[door.id] ? esc(keyName(match.key))+' · name match' : 'Choose key manually'}</option>${data.keys.map(key => `<option value="${key.id}" ${Number(run.doorKeys[door.id])===key.id?'selected':''}>${esc(keyName(key))}</option>`).join('')}</select><small>${esc(match.source)}</small></label>`;}).join('')}
    ${keys.length ? `<p class="runs-help">${keys.length} required key${keys.length===1?'':'s'} added to the briefing.</p>` : ''}
    <label class="field"><span>Extra key to carry</span><select id="run-extra-key"><option value="">Add a key…</option>${data.keys.filter(k => !run.extraKeyIds.includes(k.id)).map(k=>`<option value="${k.id}">${esc(keyName(k))}</option>`).join('')}</select></label>
    ${run.extraKeyIds.map(id => {const key=data.keys.find(k=>k.id===id);return key?`<div class="runs-row"><span>${esc(keyName(key))}</span><button class="small" data-action="remove-key" data-id="${id}">Remove</button></div>`:'';}).join('')}
    <label class="field"><span>What to carry · one item per line</span><textarea data-run="carry" placeholder="Mortar ammunition\nMedical supplies\nSpare magazines">${esc(run.carry)}</textarea></label></section>
    <section class="runs-section"><h3>04 / Reminders & nearby bosses</h3><label class="field"><span>Remember before starting</span><textarea data-run="reminders" placeholder="Wait for the strike before entering the main building…">${esc(run.reminders)}</textarea></label><label class="field"><span>Boss search distance from route</span><select id="run-boss-radius">${[250,600,1000,1500,2000].map(n=>`<option value="${n}" ${run.bossRadius===n?'selected':''}>${n} m</option>`).join('')}</select></label>${bossHTML()}</section>
    <section class="runs-section"><h3>Backup</h3><div class="runs-row"><button data-action="export">Export JSON</button><button data-action="import">Import JSON</button></div></section>`;
}
function drawingsHTML() {
  return run.drawings.map((drawing,index) => `<article class="runs-card"><h4>Drawing ${index+1}</h4><label class="field"><span>Note connected to this drawing</span><textarea data-drawing="${drawing.id}" placeholder="What this drawn route means…">${esc(drawing.note)}</textarea></label><div class="runs-row"><button class="small" data-action="focus-drawing" data-id="${drawing.id}">Locate</button><button class="small danger" data-action="remove-drawing" data-id="${drawing.id}">Remove drawing</button></div></article>`).join('');
}
function bossHTML() {
  const nearby = nearbyMarkers(group(17),run,run.bossRadius);
  return `<p class="runs-help">Known spawn locations within ${run.bossRadius} m of your stops, drawn route or target pins. This does not show live boss presence.</p>${nearby.map(({marker,distance:d}) => `<article class="runs-card"><div class="runs-row between"><h4>${esc(marker.name)}</h4><span class="runs-badge">${Math.round(d)} m</span></div><small>${esc(marker.poi?.name || '')}${marker.floor != null ? ` · Floor ${esc(marker.floor)}` : ''}</small><button class="small" data-action="boss" data-id="${marker.id}">Locate spawn</button></article>`).join('') || '<p class="runs-help">No known boss spawns within this distance.</p>'}`;
}
function renderBriefing() {
  const keys = requiredKeys(run,doors(),data.keys), unknown=selectedDoors().filter(d=>!matchDoorKey(d,data.keys,run.doorKeys).key);
  return `<h2 style="font-size:20px;margin:0">${esc(run.title || 'Untitled run')}</h2><p class="runs-intro">${run.map==='lamang'?'Lamang Island':'YBL-1'} · Pre-run briefing</p><div class="runs-row"><button class="primary" data-action="fit">Show entire run</button><button data-action="edit">Edit plan</button><button data-action="reset-checks">Reset checklist</button></div>
    <div class="runs-stats"><div><span class="runs-summary-number">${run.steps.length}</span>STOPS</div><div><span class="runs-summary-number">${run.targets.length}</span>TARGETS</div><div><span class="runs-summary-number">${keys.length}</span>KEYS</div></div>
    <section class="runs-section"><h3>Pack before departure</h3>${keys.map(({key,doors:d})=>checklist(`key-${key.id}`,keyName(key),d.map(x=>`${x.door.name} · ${x.source}`).join('; '))).join('')}${lineItems(run.carry).map((item,i)=>checklist(`carry-${i}-${item}`,item)).join('') || (!keys.length?'<p class="runs-help">No gear checklist added yet.</p>':'')}${unknown.map(d=>`<div class="runs-warning">Key unresolved: ${esc(d.name)}. Select a key in Edit plan.</div>`).join('')}</section>
    ${run.reminders ? `<section class="runs-section"><h3>Remember</h3><p style="white-space:pre-wrap">${esc(run.reminders)}</p></section>`:''}
    <section class="runs-section"><h3>Mortar sequence</h3>${run.targets.map((target,i)=>`<article class="runs-card target"><h4>M${i+1} · ${esc(target.title)}</h4><span class="runs-badge">${esc(target.phase)}</span><p>${esc(target.note || 'No coordination note added.')}</p><small>${esc(rangeText(target.coords))}</small><button class="small" data-action="focus-targets" data-id="${target.id}">Show target</button></article>`).join('') || '<p class="runs-help">No planned strikes.</p>'}</section>
    <section class="runs-section"><h3>Route in order</h3>${run.steps.map((step,i)=>`<article class="runs-card"><h4>${i+1} · ${esc(step.title)}</h4><p>${esc(step.note || 'No stop note added.')}</p><button class="small" data-action="focus-steps" data-id="${step.id}">Show stop</button></article>`).join('') || '<p class="runs-help">No ordered stops.</p>'}${run.drawings.map((d,i)=>`<article class="runs-card"><h4>Drawing ${i+1}</h4><p>${esc(d.note || 'No drawing note added.')}</p><button class="small" data-action="focus-drawing" data-id="${d.id}">Show drawing</button></article>`).join('')}</section>
    <section class="runs-section"><h3>Doors you plan to enter</h3>${selectedDoors().map(door=>{const match=matchDoorKey(door,data.keys,run.doorKeys);return `<article class="runs-card"><h4>${esc(door.name)}</h4><p>${esc(match.key ? keyName(match.key) : 'Key unresolved')}</p><small>${esc(match.source)}</small><button class="small" data-action="door" data-id="${door.id}">Show door</button></article>`;}).join('') || '<p class="runs-help">No doors selected.</p>'}</section>
    ${run.notes.length ? `<section class="runs-section"><h3>Map notes</h3>${run.notes.map(note=>`<article class="runs-card note"><h4>${esc(note.title)}</h4><p>${esc(note.note)}</p><button class="small" data-action="focus-notes" data-id="${note.id}">Show note</button></article>`).join('')}</section>`:''}
    <section class="runs-section"><h3>Nearby bosses</h3>${bossHTML()}</section><section class="runs-section"><button data-action="export">Export run backup</button></section>`;
}
function renderLibrary() {
  return `<div class="runs-row"><button class="primary" data-action="new">＋ New run</button><button data-action="import">Import JSON</button></div><p class="runs-help">Saved on this browser. Opening a run restores its route, drawings, notes, targets and briefing.</p>${store.runs.map(saved=>`<article class="runs-card"><h4>${esc(saved.title)}</h4><small>${esc(saved.map)} · ${new Date(saved.updatedAt).toLocaleDateString()} · ${saved.steps.length} stops · ${saved.targets.length} targets</small><div class="runs-row"><button class="primary small" data-action="load" data-id="${saved.id}">Open briefing</button><button class="small" data-action="load-edit" data-id="${saved.id}">Edit</button><button class="small" data-action="duplicate" data-id="${saved.id}">Duplicate</button><button class="small danger" data-action="delete" data-id="${saved.id}">Delete</button></div></article>`).join('') || '<div class="runs-empty">Your saved runs will appear here. Plan a route and choose Save run.</div>'}${deleted?'<button data-action="undo-delete">Undo last deletion</button>':''}<section class="runs-section"><h3>Try your example</h3><p class="runs-help">Golf 2 → secondary buildings → hangars → terminal, with a planned terminal strike, door keys and nearby bosses. Creates an editable draft using real map locations.</p><button data-action="example" ${!dataReady?'disabled':''}>Load Golf 2 example</button></section>`;
}
function render() {
  const scroll = $('.runs-body',panel)?.scrollTop || 0;
  panel.hidden = !store.open;
  panel.innerHTML = `<header class="runs-header"><div><h2>RUNS</h2><div class="runs-subtitle">Plan once · Raid again</div></div><button data-action="close" aria-label="Close runs planner">×</button></header><nav class="runs-tabs" aria-label="Runs sections" role="tablist">${[['library','Saved runs'],['plan','Plan'],['briefing','Briefing']].map(([id,label])=>`<button role="tab" aria-selected="${tab===id}" data-tab="${id}">${label}${id==='library'?' ('+store.runs.length+')':''}</button>`).join('')}</nav><div class="runs-body">${!dataReady ? '<div class="runs-warning">Loading map references… You can still plan and save. Door and boss suggestions appear when data is ready.</div>' : ''}${tab==='library'?renderLibrary():tab==='briefing'?renderBriefing():renderPlan()}</div><footer class="runs-status" role="status">${esc(storageError || 'Saved locally · Export JSON for a portable backup')}</footer>`;
  const mortar=$('#run-mortar',panel); if (mortar) mortar.value=run.mortar;
  $('.runs-body',panel).scrollTop=scroll;
  $('#runs-nav')?.setAttribute('aria-expanded',String(store.open));
  renderTools();
}
function searchResults() {
  if (search.trim().length < 2) return '';
  const results = allMarkers().filter(m=>['1','3','4','17','37'].includes(m.group) && `${m.name} ${m.poi?.name || ''} ${m.tooltip || ''}`.toLowerCase().includes(search.toLowerCase())).slice(0,15);
  return results.map(m=>`<button data-action="add-marker" data-id="${m.id}"><strong>${esc(m.tooltip || m.name)}</strong><small>${esc(m.poi?.name || '')}${m.group==='3'?' · Door · adds required key if linked':''}</small></button>`).join('') || '<button disabled>No matching map locations</button>';
}
function renderTools() {
  toolbar.hidden=!bridge;
  toolbar.innerHTML=`<button data-tool="open">☷ Runs${run.title?' · '+esc(run.title.slice(0,22)):''}</button>${[['waypoint','＋ Stop'],['note','＋ Note'],['target','⊕ Mortar target']].map(([id,label])=>`<button data-tool="${id}" aria-pressed="${mode===id}">${label}</button>`).join('')}${mode?'<button data-tool="done">Done</button>':''}${mode?`<div id="runs-mode">${mode==='target'?'Click the map to place a mortar target.':mode==='note'?'Click the map to pin a note.':'Click the map to add the next route stop.'} Press Esc to finish.</div>`:''}`;
  if (bridge) bridge.map.getViewport().style.cursor=mode?'crosshair':'';
}
function chooseMode(next) {
  mode=mode===next?'':next;
  if (mode && bridge) {window.__gzwPlannerDraw=false;bridge.state.freeHandMode.enabled=false;bridge.state.measureState=false;}
  store.open=window.innerWidth>850;tab='plan';
  if(!store.open)$('.mobile-close')?.click();
  persist();render();
}
function addMarker(id) {
  const marker=allMarkers().find(m=>Number(m.id)===Number(id)); if (!marker) return;
  run.steps.push({id:uid(),title:marker.tooltip || marker.name,coords:coordinate(marker),note:'',markerId:marker.id});
  if (marker.group==='3' && !run.selectedDoorIds.includes(marker.id)) run.selectedDoorIds.push(marker.id);
  search='';persist();render();paint();focusPoint(coordinate(marker));
}
function focusPoint(coords) {if (bridge) bridge.map.getView().animate({center:coords,zoom:18,duration:350});}
function fitRun() {
  const points=[...run.steps,...run.targets,...run.notes].map(s=>s.coords).concat(run.drawings.flatMap(d=>d.coordinates));
  if (!bridge || !points.length) return toast('Add a route or pin first.');
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  bridge.map.getView().fit([Math.min(...xs)-100,Math.min(...ys)-100,Math.max(...xs)+100,Math.max(...ys)+100],{padding:[150,100,90,70],maxZoom:18,duration:350});
}
function mortarRanges() {
  const layer=bridge?.map.getLayers().getArray().find(l=>l.get('title')==='mortars');
  return (layer?.getLayers().getArray() || []).map(l=>{
    const circles=l.getSource().getFeatures().map(f=>f.getGeometry()).filter(g=>g.getType()==='Circle');
    return {faction:l.get('faction'),center:circles[0]?.getCenter(),radii:circles.map(g=>g.getRadius()).sort((a,b)=>a-b)};
  }).filter(x=>x.center);
}
function rangeText(coords) {
  if (run.map!=='lamang') return 'Faction mortar range overlay is available on Lamang.';
  const ranges=mortarRanges().filter(r=>run.mortar==='all'||r.faction===run.mortar);
  if (!ranges.length) return 'Select a faction range overlay to compare this target with the map’s range rings.';
  return ranges.map(r=>{const d=distance(coords,r.center),outer=r.radii.at(-1);return `${r.faction.toUpperCase()}: ${Math.round(d).toLocaleString()} m from mortar · ${d<=outer?'inside':'outside'} outer ${Math.round(outer).toLocaleString()} m ring`;}).join(' / ')+'. Range reference only.';
}
function paint() {
  if (!bridge) return;
  const map=bridge.map, pixel=p=>map.getPixelFromCoordinate(p), svg=[];
  if (!pixel(map.getView().getCenter())) return;
  const points=run.steps.map(s=>pixel(s.coords));
  if (points.length>1) svg.push(`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#111" stroke-width="6"/><polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#ffd833" stroke-width="3" stroke-dasharray="9 5"/>`);
  const pin=(item,label,color,type)=>{
    const actual=pixel(item.coords);if(!actual)return;
    const p=type==='doors'?[actual[0]-22,actual[1]+26]:actual;
    if(type==='doors')svg.push(`<line x1="${actual[0]}" y1="${actual[1]}" x2="${p[0]}" y2="${p[1]}" stroke="#caa4ef" stroke-width="1.5"/>`);
    svg.push(`<g transform="translate(${p[0]},${p[1]})"><circle class="pin-hit" data-pin="${type}" data-id="${esc(item.id)}" r="13" fill="${color}" stroke="#111" stroke-width="2"><title>${esc(item.title)}${item.note?' — '+esc(item.note):''}</title></circle><text text-anchor="middle" y="4" style="font-size:10px;stroke-width:2">${label}</text>${type==='doors'?'':`<text x="19" y="4">${esc(item.title.slice(0,44))}</text>`}</g>`);
  };
  run.steps.forEach((item,i)=>pin(item,i+1,'#a18b19','steps'));
  run.notes.forEach(item=>{
    const p=pixel(item.coords);if(!p)return;
    svg.push(`<g class="map-note-pin" role="button" tabindex="0" aria-label="Open run note: ${esc(item.title)}" data-pin="notes" data-id="${esc(item.id)}" transform="translate(${p[0]},${p[1]})"><title>${esc(item.title)}</title><circle class="pin-hit" r="23" fill="transparent"/><circle class="pin-hit" r="16" fill="#0b1b2b"/><circle class="pin-hit" r="13" fill="#299eff" stroke="#b9e2ff" stroke-width="2"/><text text-anchor="middle" y="33">Note</text></g>`);
  });
  selectedDoors().forEach((door,i)=>pin({id:door.id,title:door.name,coords:coordinate(door),note:''},'D'+(i+1),'#735096','doors'));
  run.targets.forEach((item,i)=>{
    const p=pixel(item.coords),edge=pixel([item.coords[0]+(Number(item.radius)||75),item.coords[1]]);
    svg.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${Math.abs(edge[0]-p[0])}" fill="#ef70502b" stroke="#ff876c" stroke-width="2" stroke-dasharray="6 4"/>`);pin(item,'M'+(i+1),'#a33d28','targets');
  });
  overlay.innerHTML=svg.join('');
}
function example() {
  if (bridge?.map.custom.mapData.code_name!=='lamang') return toast('Open the Lamang map to load this example.');
  const find=name=>allMarkers().find(m=>(m.name===name || m.tooltip===name) && m.poi?.name==='Pha Lang Airfield');
  const locations=['Golf 2','Remote Farms','Remote Hangars','South Hangar','Terminal'].map(find);
  if (locations.some(m=>!m)) return toast('Some example locations are unavailable in the current map data.');
  run=newRun('lamang');run.title='Golf 2 · Airfield sweep';run.mortar='lri';
  const notes=['Land and coordinate the terminal strike.','Raid the secondary buildings while the terminal strike is planned.','Enter the remote hangars; check the locked room.','Clear and loot the south hangar.','Enter the main building after the strike; check the meeting room.'];
  run.steps=locations.map((marker,i)=>({id:uid(),title:marker.tooltip||marker.name,coords:coordinate(marker),note:notes[i],markerId:marker.id}));
  run.targets=[{id:uid(),title:'Terminal / main building',coords:coordinate(locations[4]),phase:'While looting secondary buildings',radius:75,note:'Coordinate this strike on arrival at Golf 2. Loot secondary buildings first, then enter the main building after the strike.'}];
  const selected=doors().filter(d=>['PLA H03 Door','PHA Meet Door'].includes(d.name));run.selectedDoorIds=selected.map(d=>d.id);
  const meet=selected.find(d=>d.name==='PHA Meet Door'),key=data.keys.find(k=>k.short_name==='PLA Meet');if(meet&&key)run.doorKeys[meet.id]=key.id;
  run.carry='Mortar ammunition / coordinate with mortar operator\nMedical supplies\nSpare magazines\nSpace for loot';run.reminders='Confirm faction and mortar availability. Review the marked target before calling the strike. Check the nearby Viper spawn and bring the selected door keys.';
  run.view={center:[8050,5700],zoom:16.5};tab='plan';mode='';store.open=true;restoreRun();persist();render();fitRun();toast('Example loaded as a draft. Edit the plan and choose Save run.');
}
function exportRun() {
  snapshot();const blob=new Blob([JSON.stringify(run,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=(run.title || 'gzw-run').replace(/[^a-z0-9-]/gi,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function importRun() {
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('Run file must be smaller than 10 MB.');const imported=validateRun(JSON.parse(await file.text()));imported.id=uid();imported.title=(imported.title||'Imported run');store.runs.unshift(imported);if(persist()){loadRun(imported.id,true);toast('Run imported.');}}catch(error){toast(error.message || 'Could not import this run.');}};input.click();
}
panel.addEventListener('input',event=>{
  const el=event.target;
  if (el.id==='run-search') {search=el.value;$('#run-results',panel).innerHTML=searchResults();return;}
  if (el.dataset.run) run[el.dataset.run]=el.value;
  if (el.dataset.item) {const item=run[el.dataset.item].find(x=>x.id===el.dataset.id);if(item)item[el.dataset.field]=el.dataset.field==='radius'?Math.max(10,Math.min(500,Number(el.value)||75)):el.value;}
  if (el.dataset.drawing) {const feature=drawingBridge?.source.getFeatures().find(f=>f.get('runId')===el.dataset.drawing);feature?.set('runNote',el.value);const d=run.drawings.find(d=>d.id===el.dataset.drawing);if(d)d.note=el.value;}
  persist();paint();
});
panel.addEventListener('change',event=>{
  const el=event.target;
  if (el.dataset.check) {run.checked[el.dataset.check]=el.checked;persist();return;}
  if (el.dataset.door) {const id=Number(el.dataset.door);run.selectedDoorIds=run.selectedDoorIds.filter(x=>x!==id);if(el.checked)run.selectedDoorIds.push(id);persist();render();}
  if (el.dataset.doorKey) {run.doorKeys[el.dataset.doorKey]=Number(el.value)||null;persist();render();}
  if(el.id==='run-extra-key' && el.value){run.extraKeyIds.push(Number(el.value));persist();render();}
  if(el.id==='run-mortar'){run.mortar=el.value;if(bridge)bridge.state.mortar=el.value;persist();render();}
  if(el.id==='run-boss-radius'){run.bossRadius=Number(el.value);persist();render();}
});
panel.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.tab){snapshot();tab=button.dataset.tab;render();return;}
  const action=button.dataset.action,id=button.dataset.id;
  if(action?.startsWith('mode-'))return chooseMode(action.slice(5));
  if(action?.startsWith('remove-') && ['steps','targets','notes'].includes(action.slice(7))){const field=action.slice(7);run[field]=run[field].filter(x=>x.id!==id);persist();render();paint();return;}
  if(action?.startsWith('focus-') && ['steps','targets','notes'].includes(action.slice(6))){const item=run[action.slice(6)].find(x=>x.id===id);if(item)focusPoint(item.coords);return;}
  switch(action){
    case 'close':setOpen(false);break;
    case 'save':saveRun();break;
    case 'new':blankRun();break;
    case 'fit':fitRun();break;
    case 'edit':tab='plan';render();break;
    case 'add-marker':addMarker(id);break;
    case 'load':loadRun(id);break;
    case 'load-edit':loadRun(id,true);break;
    case 'example':example();break;
    case 'draw':mode='';if(bridge){bridge.state.measureState=false;bridge.state.freeHandMode.enabled=!bridge.state.freeHandMode.enabled;window.__gzwPlannerDraw=bridge.state.freeHandMode.enabled;}if(window.innerWidth<=850&&bridge?.state.freeHandMode.enabled){store.open=false;$('.mobile-close')?.click();persist();render();}else renderTools();toast(bridge?.state.freeHandMode.enabled?'Drag on the map to draw. Add a note to your drawing below the route stops, then save the run.':'Drawing is off.');break;
    case 'up':case 'down':{const i=run.steps.findIndex(s=>s.id===id),j=i+(action==='up'?-1:1);if(j>=0&&j<run.steps.length)[run.steps[i],run.steps[j]]=[run.steps[j],run.steps[i]];persist();render();paint();break;}
    case 'remove-drawing':{run.drawings=run.drawings.filter(d=>d.id!==id);drawingBridge?.restore(run.drawings);persist();render();break;}
    case 'focus-drawing':{const d=run.drawings.find(d=>d.id===id);if(d?.coordinates.length)focusPoint(d.coordinates[Math.floor(d.coordinates.length/2)]);break;}
    case 'boss':{const m=group(17).find(m=>String(m.id)===id);if(m)focusPoint(coordinate(m));break;}
    case 'door':{const m=doors().find(m=>String(m.id)===id);if(m)focusPoint(coordinate(m));break;}
    case 'remove-key':run.extraKeyIds=run.extraKeyIds.filter(k=>String(k)!==id);persist();render();break;
    case 'reset-checks':run.checked={};persist();render();break;
    case 'duplicate':{const saved=store.runs.find(r=>r.id===id);if(saved){run=clone(saved);run.id=uid();run.title+=' (copy)';tab='plan';restoreRun();persist();render();}break;}
    case 'delete':deleted=store.runs.find(r=>r.id===id);store.runs=store.runs.filter(r=>r.id!==id);persist();render();toast('Run removed. Undo is available in Saved runs.');break;
    case 'undo-delete':if(deleted){store.runs.unshift(deleted);deleted=null;persist();render();}break;
    case 'export':exportRun();break;
    case 'import':importRun();break;
  }
});
toolbar.addEventListener('click',event=>{const tool=event.target.closest('[data-tool]')?.dataset.tool;if(!tool)return;if(tool==='open'){setOpen(!store.open);return;}if(tool==='done'){mode='';renderTools();return;}chooseMode(tool);});
overlay.addEventListener('click',event=>{
  const pin=event.target.closest('[data-pin]');if(!pin)return;event.stopPropagation();
  mode='';store.open=true;tab='briefing';
  if(pin.dataset.pin==='doors'){
    const door=selectedDoors().find(d=>String(d.id)===pin.dataset.id);if(!door)return;
    const match=matchDoorKey(door,data.keys,run.doorKeys);
    const locationRun=newRun(run.map);locationRun.steps=[{coords:coordinate(door)}];
    const bosses=nearbyMarkers(group(17),locationRun,run.bossRadius).map(x=>x.marker.name);
    persist();render();toast(`${door.name}\nKey: ${match.key?keyName(match.key):'Unresolved — select a key in Edit plan.'}\n${match.source}${bosses.length?'\nNearby boss spawns: '+[...new Set(bosses)].join(', '):''}`);return;
  }
  const item=run[pin.dataset.pin].find(x=>x.id===pin.dataset.id);if(!item)return;
  if(pin.dataset.pin==='notes'){
    window.dispatchEvent(new CustomEvent('gzw:open-note',{detail:{note:item,save(updated){item.title=updated.title;item.note=updated.note;const ok=persist();render();paint();return ok;},remove(){run.notes=run.notes.filter(n=>n.id!==item.id);persist();render();paint();}}}));return;
  }
  persist();render();toast(`${item.title}${item.phase?' · '+item.phase:''}\n${item.note||'No note added yet.'}`);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mode){mode='';renderTools();}});
overlay.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-pin="notes"]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('gzw:notes-open',()=>setOpen(false));
window.addEventListener('gzw:locations-open',()=>setOpen(false));

async function fetchData(mapName) {
  dataReady=false;
  try {const response=await fetch('/__mirror/planner-data?map='+encodeURIComponent(mapName));if(!response.ok)throw Error('Map references unavailable');const payload=await response.json();if(bridge?.map.custom.mapData.code_name!==mapName)return;data=payload;dataReady=true;render();paint();}
  catch {toast('Map references could not load. Manual route planning still works. Retry by reloading the page.');}
}
function attachNav() {
  const nav=$('.sidebar-nav-middle');if(!nav || $('#runs-nav',nav))return;
  const button=document.createElement('button');button.id='runs-nav';button.title='Runs — saved raid plans';button.setAttribute('aria-label','Runs');button.setAttribute('aria-expanded',String(store.open));button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="M9 5h7a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h7"/></svg>';button.addEventListener('click',()=>{tab=store.runs.length?'library':'plan';setOpen(!store.open);});
  const profiles=$('.profile-buttons',nav);nav.insertBefore(button,profiles || null);
}
function bindMap(detail) {
  if(!detail?.map || bridge?.map===detail.map)return;
  if(bridge){bridge.map.un('click',mapListener);bridge.map.un('postrender',renderListener);}
  bridge=detail;binding=true;
  const name=bridge.map.custom.mapData.code_name;
  if(run.map!==name)run=newRun(name);
  const viewport=bridge.map.getViewport();viewport.append(overlay,toolbar);
  mapListener=event=>{
    if(!mode || event.originalEvent?.target?.closest?.('#runs-toolbar, #runs-overlay'))return;
    const coords=event.coordinate.slice();
    if(mode==='waypoint')run.steps.push({id:uid(),title:`Stop ${run.steps.length+1}`,coords,note:''});
    else if(mode==='note')run.notes.push({id:uid(),title:`Map note ${run.notes.length+1}`,coords,note:''});
    else run.targets.push({id:uid(),title:`Mortar target ${run.targets.length+1}`,coords,note:'',phase:'On arrival',radius:75});
    if(window.innerWidth<=850){mode='';store.open=true;}
    persist();render();paint();
  };
  renderListener=()=>paint();bridge.map.on('click',mapListener);bridge.map.on('postrender',renderListener);
  bridge.map.on('moveend',()=>{if(restoring)return;const view=bridge.map.getView();run.view={center:view.getCenter().slice(),zoom:view.getZoom()};persist();});
  mode='';attachNav();restoreRun();render();fetchData(name);binding=false;
}
function bindDrawing(detail) {
  if(!detail || detail===drawingBridge)return;
  if(drawingBridge&&sourceListener){drawingBridge.source.un('addfeature',sourceListener);drawingBridge.source.un('removefeature',sourceListener);drawingBridge.source.un('clear',sourceListener);}
  drawingBridge=detail;
  restoring=true;detail.restore(run.drawings);restoring=false;
  sourceListener=()=>{if(restoring)return;clearTimeout(saving);saving=setTimeout(()=>{run.drawings=clone(getDrawings());persist();const area=$('#run-drawings',panel);if(area&&!area.contains(document.activeElement))area.innerHTML=drawingsHTML();paint();},80);};
  detail.source.on('addfeature',sourceListener);detail.source.on('removefeature',sourceListener);detail.source.on('clear',sourceListener);
}
window.addEventListener('gzw:map-ready',event=>bindMap(event.detail));
window.addEventListener('gzw:draw-ready',event=>bindDrawing(event.detail));
const observer=new MutationObserver(()=>{attachNav();if(!bridge?.map.getTargetElement()?.isConnected){panel.hidden=true;toolbar.hidden=true;}else if(store.open)panel.hidden=false;});observer.observe(document.body,{childList:true,subtree:true});
if(window.__gzwMap)bindMap(window.__gzwMap);
if(window.__gzwDrawing)bindDrawing(window.__gzwDrawing);
attachNav();render();
window.addEventListener('beforeunload',()=>{snapshot();persist();});
