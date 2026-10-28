// Keep mission selection in the original Tasks UI and retain its native storage,
// faction rules, completion behavior and progress profiles.
let pending=false;
function updateTaskControls(){
  pending=false;
  if(!/\/maps\/[^/]+\/tasks(?:\/|$)/.test(location.pathname)){
    document.querySelector('#task-selection-help')?.remove();
    return;
  }
  const main=document.querySelector('.sidebar-main main')||document.querySelector('main');
  if(!main)return;
  for(const button of main.querySelectorAll('button')){
    const label=button.textContent.trim();
    if(label==='Track'||label==='Untrack'){
      const selected=label==='Untrack';
      button.textContent=selected?'Hide from map':'Show on map';
      button.setAttribute('aria-pressed',String(selected));
      button.title=selected?'Remove this mission from your map':'Select this mission and display its objectives on the map';
    }
  }
  if(!main.querySelector('#task-selection-help')){
    const help=document.createElement('div');help.id='task-selection-help';
    const text=document.createElement('p');
    text.textContent='Choose Show on map for each mission you want to do. You can select several missions. Their objectives stay visible together, including while location and loot filters are active.';
    const fit=document.createElement('button');fit.className='ui-btn';fit.textContent='Fit shown missions';
    fit.addEventListener('click',()=>{
      const bridge=window.__gzwMap;if(!bridge)return;
      const coordinates=[];
      function walk(layer){
        if(layer.getLayers){for(const child of layer.getLayers().getArray())walk(child);return;}
        if(!String(layer.get?.('id')||'').startsWith('task-')||!layer.getVisible())return;
        for(const feature of layer.getSource?.().getFeatures()||[]){
          const point=feature.getGeometry()?.getCoordinates();
          if(Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))coordinates.push(point);
        }
      }
      for(const layer of bridge.map.getLayers().getArray())walk(layer);
      if(!coordinates.length){message.textContent='Select a mission with mapped objectives using Show on map first.';return;}
      const xs=coordinates.map(p=>p[0]),ys=coordinates.map(p=>p[1]);
      bridge.map.getView().fit([Math.min(...xs)-30,Math.min(...ys)-30,Math.max(...xs)+30,Math.max(...ys)+30],{padding:[100,70,70,70],maxZoom:18,duration:300});
      message.textContent=`Showing ${coordinates.length} mission objectives.`;
    });
    const message=document.createElement('p');message.setAttribute('role','status');
    help.append(text,fit,message);main.prepend(help);
  }
}
function schedule(){if(pending)return;pending=true;queueMicrotask(updateTaskControls);}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
window.addEventListener('popstate',schedule);
// The captured SPA can update its URL after its final DOM mutation.
let lastPath=location.pathname;
setInterval(()=>{if(lastPath!==location.pathname){lastPath=location.pathname;schedule();}},250);
schedule();
