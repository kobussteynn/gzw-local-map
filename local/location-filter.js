import {locationKey, nameMatches, searchWords, makeCatalog, LocationFilter} from './location-filter-core.mjs';
const $=(selector,root=document)=>root.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bridge,controller,query='',selected=[],catalog=[],mapName='',updateTimer,pending=false;
let collectionWatches=[];
let keywordsByName=new Map();
const keywords=name=>keywordsByName.get(locationKey(name))||'';
function indexCatalog(items){for(const item of items)if(item.keywords?.trim())keywordsByName.set(item.key,item.keywords);}
const panel=document.createElement('section');panel.id='location-filter-panel';panel.hidden=true;panel.setAttribute('aria-label','Location name filters');
panel.innerHTML=`<header><h2>Locations</h2><button aria-label="Close location filters" data-filter-action="close">×</button></header><div class="location-filter-body"><label for="location-name-search">Search locations on the map</label><div class="location-search-row"><input id="location-name-search" type="search" autocomplete="off" placeholder="LZs, Golf 2, loot, material crates, camps…"><button data-filter-action="clear" aria-label="Clear all location filters">Clear</button></div><p class="location-filter-help">Search to preview matching locations. Add names or All landing zones / All loot to keep several types visible together. Clear returns to the normal category filters.</p><div id="location-filter-chips" aria-label="Selected location names"></div><div class="location-filter-status" role="status" aria-live="polite"></div><div class="location-filter-actions"><button data-filter-action="fit">Fit matches</button></div><h3 id="location-results-heading">Location names</h3><div id="location-name-results" aria-labelledby="location-results-heading"></div></div><footer>Filters game markers. Your notes and saved routes stay visible.</footer>`;
document.body.append(panel);
function save(){try{localStorage.setItem('gzw.location-filters.v1.'+mapName,JSON.stringify({selected,query}));}catch{status('Filters work, but could not be saved in this browser.');}}
function status(text){$('.location-filter-status',panel).textContent=text;}
function open(){window.dispatchEvent(new Event('gzw:locations-open'));panel.hidden=false;$('#location-filter-nav')?.setAttribute('aria-expanded','true');$('#location-name-search',panel).focus();}
function close(){panel.hidden=true;$('#location-filter-nav')?.setAttribute('aria-expanded','false');}
function apply(){
  if(!controller)return;
  if(selected.length || query.trim()){
    bridge.state.selectedMarker.feature=null;bridge.state.selectedMarker.coords=null;
  }
  controller.set(selected,query);save();render();
}
function results(){
  const parts=query.split(/[,;\n]/).map(q=>q.trim()).filter(Boolean);
  const categories=[['All landing zones','lz'],['All loot','loot']].map(([name,term])=>({name,key:locationKey(name),keywords:term,count:catalog.filter(item=>nameMatches(item.name,term,keywords(item.name))).reduce((n,item)=>n+item.count,0)})).filter(item=>item.count>0);
  return [...categories,...catalog].filter(item=>!parts.length||parts.some(q=>nameMatches(item.name,q,item.keywords||keywords(item.name)))).sort((a,b)=>{
    if(!parts.length){
      const preferred=['All landing zones','All loot','Trashed Campsite','Campsite','Hidden Poppy Fields','LAF Checkpoint','Field Shelter'];
      const ai=preferred.indexOf(a.name),bi=preferred.indexOf(b.name);
      if(ai!==bi&&(ai>=0||bi>=0))return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);
    }
    const exactA=searchWords(a.name)===searchWords(query),exactB=searchWords(b.name)===searchWords(query);
    return Number(exactB)-Number(exactA)||b.count-a.count||a.name.localeCompare(b.name);
  });
}
function render(){
  if(!controller)return;
  const active=controller.active,count=controller.matchingFeatures().length;
  $('#location-filter-chips',panel).innerHTML=selected.map(name=>`<button class="location-filter-chip" data-remove-name="${esc(name)}" aria-label="Remove ${esc(name)} filter">${esc(name)} <span aria-hidden="true">×</span></button>`).join('');
  if(!catalog.length)status(pending?'Loading map locations…':'No map locations available yet.');
  else status(active?`${count.toLocaleString()} matching locations · ${selected.length} selected name${selected.length===1?'':'s'}${query.trim()?' · search preview':''}`:'No name filter active · Normal category filters apply');
  const options=results(),visible=options.slice(0,100);
  $('#location-name-results',panel).innerHTML=visible.map(item=>`<button class="location-filter-option" aria-pressed="${selected.includes(item.name)}" data-select-name="${esc(item.name)}"><span>${esc(item.name)}</span><span class="location-result-count">${item.count.toLocaleString()}</span><span class="location-select-state">${selected.includes(item.name)?'✓ Selected':'+ Add'}</span></button>`).join('') || `<p class="location-filter-empty">${catalog.length?'No matching names. Try “LZ”, “Golf 2”, “loot” or “camp”.':pending?'Loading locations…':'Waiting for map markers…'}</p>`;
  if(options.length>100)$('#location-name-results',panel).insertAdjacentHTML('beforeend','<p class="location-filter-help">Showing 100 names. Type to narrow the list.</p>');
  const shortcut=$('#location-filter-shortcut');if(shortcut){shortcut.textContent=active?`Locations [ ${count} ]`:'Locations';shortcut.setAttribute('aria-pressed',String(active));}
  $('.location-filter-actions button',panel).disabled=!active || count===0;
}
function schedule(){clearTimeout(updateTimer);updateTimer=setTimeout(()=>{const live=controller?.getFeatures()||[];if(live.length){catalog=makeCatalog(live.map(f=>({name:f.get('name'),type:f.get('type')})));indexCatalog(catalog);catalog.forEach(item=>item.keywords=keywords(item.name));}render();},80);}
function discover(){
  if(!bridge||!controller)return;
  const found=new Set();
  const walk=layer=>{
    const children=layer.getLayers?.();
    if(children){for(const item of children.getArray())walk(item);return;}
    if(layer.get('layerType')==='markers'){found.add(layer);controller.track(layer);}
  };
  for(const layer of bridge.map.getLayers().getArray())walk(layer);
  for(const layer of [...controller.records.keys()])if(!found.has(layer))controller.untrack(layer);
  for(const [collection,add,remove]of collectionWatches){collection.un('add',add);collection.un('remove',remove);}collectionWatches=[];
  const watch=collection=>{
    const changed=()=>{discover();schedule();};collection.on('add',changed);collection.on('remove',changed);collectionWatches.push([collection,changed,changed]);
    for(const layer of collection.getArray())if(layer.getLayers)watch(layer.getLayers());
  };
  watch(bridge.map.getLayers());schedule();
}
async function bind(detail){
  if(!detail?.map || detail.map===bridge?.map)return;
  if(controller)controller.dispose();
  for(const [collection,add,remove]of collectionWatches){collection.un('add',add);collection.un('remove',remove);}collectionWatches=[];
  bridge=detail;mapName=bridge.map.custom.mapData.code_name;query='';selected=[];catalog=[];keywordsByName=new Map();
  try{const saved=JSON.parse(localStorage.getItem('gzw.location-filters.v1.'+mapName)||'{}');if(Array.isArray(saved.selected))selected=saved.selected.filter(n=>typeof n==='string').slice(0,100);if(typeof saved.query==='string')query=saved.query.slice(0,500);}catch{}
  const previousCount=selected.length;
  selected=selected.filter(name=>name!=='All tasks'&&!name.startsWith('Task: '));
  if(selected.length!==previousCount)query='';
  $('#location-name-search',panel).value=query;
  controller=new LocationFilter(schedule,feature=>{
    const floor=bridge.state.settings.activeFloor,faction=bridge.state.userFaction;
    return (floor==null||feature.get('floor')===floor)&&(!faction||!feature.get('faction')||feature.get('faction')===faction);
  },keywords);discover();apply();pending=true;render();
  try{
    const response=await fetch('/__mirror/planner-data?map='+encodeURIComponent(mapName));if(!response.ok)throw Error();const data=await response.json();
    if(bridge!==detail)return;
    const markers=Object.values(data.markers).flatMap(info=>info.markersArray||[]);catalog=makeCatalog(markers);indexCatalog(catalog);pending=false;controller.set(selected,query);render();
  }catch{pending=false;schedule();}
}
function selectName(name){
  selected=selected.includes(name)?selected.filter(n=>n!==name):[...selected,name];
  query='';$('#location-name-search',panel).value='';apply();$('#location-name-search',panel).focus();
}
$('#location-name-search',panel).addEventListener('input',event=>{query=event.target.value;apply();});
$('#location-name-search',panel).addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();const match=results()[0];if(match)selectName(match.name);}
  if(event.key==='Escape'){query='';event.target.value='';apply();}
});
panel.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.selectName)return selectName(button.dataset.selectName);
  if(button.dataset.removeName){selected=selected.filter(n=>n!==button.dataset.removeName);apply();return;}
  switch(button.dataset.filterAction){
    case 'close':close();break;
    case 'clear':selected=[];query='';$('#location-name-search',panel).value='';apply();break;
    case 'fit':{
      const features=controller.matchingFeatures(),coords=features.map(f=>{const g=f.getGeometry();return g.getType()==='Circle'?g.getCenter():g.getCoordinates();}).filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
      if(!coords.length)return;const xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]);
      bridge.map.getView().fit([Math.min(...xs)-50,Math.min(...ys)-50,Math.max(...xs)+50,Math.max(...ys)+50],{padding:[130,70,70,70],maxZoom:18,duration:300});if(innerWidth<=720)close();break;
    }
  }
});
function attach(){
  const nav=$('.sidebar-nav-middle');
  if(nav&&!$('#location-filter-nav',nav)){
    const button=document.createElement('button');button.id='location-filter-nav';button.type='button';button.title='Search and filter locations';button.setAttribute('aria-label','Location filters');button.setAttribute('aria-expanded',String(!panel.hidden));button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/></svg>';
    button.addEventListener('click',()=>panel.hidden?open():close());nav.insertBefore(button,$('.profile-buttons',nav));
  }
  const tools=$('#runs-toolbar');if(tools&&!$('#location-filter-shortcut',tools)){
    const button=document.createElement('button');button.id='location-filter-shortcut';button.type='button';button.textContent='Locations';button.setAttribute('aria-label','Search location names');button.addEventListener('click',event=>{event.stopPropagation();panel.hidden?open():close();});tools.append(button);
    const count=controller?.active?controller.matchingFeatures().length:null;if(count!==null)button.textContent=`Locations [ ${count} ]`;
  }
}
document.addEventListener('click',event=>{if(event.target.closest('#runs-nav,#map-notes-nav,.sidebar-nav-middle a,#runs-toolbar [data-tool]'))close();},true);
window.addEventListener('gzw:map-ready',event=>bind(event.detail));
new MutationObserver(()=>{attach();if(bridge&&!bridge.map.getTargetElement()?.isConnected)close();}).observe(document.body,{childList:true,subtree:true});
if(window.__gzwMap)bind(window.__gzwMap);attach();
