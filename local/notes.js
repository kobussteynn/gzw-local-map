import {uid} from './planner-core.mjs';

const $ = (selector, root=document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let notes=[], storageError='', bridge, editing, deleted, renderHandler, contextHandler;
try {
  const saved=JSON.parse(localStorage.getItem('gzw.notes.v1') || '[]');
  if(!Array.isArray(saved) || saved.some(n=>!n || typeof n.id!=='string' || typeof n.title!=='string' || typeof n.note!=='string' || !['lamang','ybl-1'].includes(n.map) || !Array.isArray(n.coords) || n.coords.length!==2 || !n.coords.every(Number.isFinite)))throw Error('Invalid note storage');
  notes=saved;
} catch {storageError='Saved notes could not be read. Back up browser storage before adding new notes.';}

const panel=document.createElement('section');panel.id='map-notes-panel';panel.hidden=true;panel.setAttribute('aria-label','Map notes');
const dialog=document.createElement('dialog');dialog.id='map-note-editor';dialog.setAttribute('aria-labelledby','map-note-heading');
const layer=document.createElementNS('http://www.w3.org/2000/svg','svg');layer.id='map-notes-overlay';layer.setAttribute('aria-label','Personal map notes');
document.body.append(panel,dialog);

function saveNotes(){
  if(storageError){showError(storageError);return false;}
  try{localStorage.setItem('gzw.notes.v1',JSON.stringify(notes));return true;}
  catch{showError('Could not save this note. Browser storage is full or unavailable.');return false;}
}
function showError(message){const el=$('#map-note-error',dialog);if(el)el.textContent=message;else window.alert(message);}
function currentNotes(){return notes.filter(n=>n.map===bridge?.map.custom.mapData.code_name);}
function openPanel(){window.dispatchEvent(new Event('gzw:notes-open'));panel.hidden=false;$('#map-notes-nav')?.setAttribute('aria-expanded','true');renderPanel();}
function closePanel(){panel.hidden=true;$('#map-notes-nav')?.setAttribute('aria-expanded','false');}
function renderPanel(){
  panel.innerHTML=`<header><div><h2>NOTES</h2><small>Personal notes · Saved on this browser</small></div><button data-notes-action="close" aria-label="Close map notes">×</button></header><div class="map-notes-body"><p>Right-click anywhere on the map, then choose <strong>Notes</strong>. Click a blue dot to read or edit it.</p><p class="map-notes-hint">These notes stay on the map when you switch runs. Run-specific notes remain in their saved run.</p>${storageError?`<p role="alert">${esc(storageError)}</p>`:''}${currentNotes().map(n=>`<article class="runs-card note"><h3>${esc(n.title || 'Note')}</h3><p>${esc(n.note)}</p><div class="runs-row"><button data-notes-action="open" data-note-id="${esc(n.id)}">Read / edit</button><button data-notes-action="locate" data-note-id="${esc(n.id)}">Locate</button></div></article>`).join('') || '<div class="runs-empty">No notes on this map yet.</div>'}${deleted?'<button data-notes-action="undo">Undo last deletion</button>':''}</div>`;
}
function openEditor(note, external=null){
  editing={note:structuredClone(note),external};
  const existing=Boolean(external || notes.some(n=>n.id===note.id));
  dialog.innerHTML=`<form id="map-note-form"><header><span class="map-note-blue-dot"></span><h2 id="map-note-heading">${existing?'Note':'Add note'}</h2><button type="button" data-note-action="cancel" aria-label="Close note">×</button></header><p class="map-notes-hint">${external?'Attached to the current run.':'Saved on this map, independent of your runs.'}</p><label>Title<input name="title" maxlength="200" placeholder="Note title" value="${esc(note.title || '')}" autofocus></label><label>Note<textarea name="body" rows="6" maxlength="20000" placeholder="What do you want to remember here?">${esc(note.note || '')}</textarea></label><p id="map-note-error" role="alert"></p><footer><button type="submit" class="primary">Save note</button><button type="button" data-note-action="cancel">Cancel</button>${existing?'<button type="button" data-note-action="delete" class="danger">Delete note</button>':''}</footer></form>`;
  if(!dialog.open)dialog.showModal();
}
function paint(){
  if(!bridge || !bridge.map.getPixelFromCoordinate(bridge.map.getView().getCenter()))return;
  const svg=[];
  currentNotes().forEach(n=>{
    const p=bridge.map.getPixelFromCoordinate(n.coords);if(!p)return;
    svg.push(`<g class="map-note-pin" role="button" tabindex="0" aria-label="Open note: ${esc(n.title || 'Note')}" data-note-id="${esc(n.id)}" transform="translate(${p[0]},${p[1]})"><title>${esc(n.title || 'Note')}</title><circle r="23" fill="transparent"/><circle r="16" fill="#0b1b2b"/><circle r="13" fill="#299eff" stroke="#b9e2ff" stroke-width="2"/><text text-anchor="middle" y="33">Note</text></g>`);
  });
  layer.innerHTML=svg.join('');
}
function attachUI(){
  const nav=$('.sidebar-nav-middle');
  if(nav&&!$('#map-notes-nav',nav)){
    const button=document.createElement('button');button.id='map-notes-nav';button.type='button';button.setAttribute('aria-label','Notes');button.setAttribute('aria-expanded',String(!panel.hidden));button.title='Personal map notes';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>';
    button.addEventListener('click',()=>panel.hidden?openPanel():closePanel());nav.insertBefore(button,$('.profile-buttons',nav));
  }
  const menu=$('#menu-overlay');
  if(menu&&!$('#map-context-notes',menu)){
    const button=document.createElement('button');button.id='map-context-notes';button.type='button';button.textContent='Notes';button.className=$('button',menu)?.className || '';button.setAttribute('aria-label','Notes');
    button.addEventListener('click',event=>{event.stopPropagation();const coords=bridge?.state.coordinates.static?.slice();if(!coords)return;bridge.state.coordinates.static=null;openEditor({id:uid(),map:bridge.map.custom.mapData.code_name,coords,title:'',note:'',updatedAt:new Date().toISOString()});});
    const share=[...menu.querySelectorAll('button')].find(b=>b.textContent.trim()==='Share this location');
    share?share.after(button):menu.append(button);
  }
}
function bind(detail){
  if(!detail?.map || bridge?.map===detail.map)return;
  if(bridge){bridge.map.un('postrender',renderHandler);bridge.map.un('contextmenu',contextHandler);}
  bridge=detail;bridge.map.getViewport().append(layer);
  renderHandler=paint;
  contextHandler=event=>{event.preventDefault();if(event.coordinate)bridge.state.coordinates.static=event.coordinate.slice();};
  bridge.map.on('postrender',renderHandler);bridge.map.on('contextmenu',contextHandler);attachUI();renderPanel();paint();
}
dialog.addEventListener('submit',event=>{
  event.preventDefault();const values=new FormData(event.target),title=String(values.get('title')).trim(),body=String(values.get('body')).trim();
  if(!title&&!body)return showError('Enter a title or note before saving.');
  const updated={...editing.note,title:title || 'Note',note:body,updatedAt:new Date().toISOString()};
  if(editing.external){if(editing.external.save(updated)===false)return;}
  else{
    const previous=notes;notes=notes.filter(n=>n.id!==updated.id).concat(updated);
    if(!saveNotes()){notes=previous;return;}
  }
  dialog.close();renderPanel();paint();
});
dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-note-action]')?.dataset.noteAction;
  if(action==='cancel')dialog.close();
  if(action==='delete'){
    if(editing.external){editing.external.remove();dialog.close();return;}
    const previous=notes;deleted=notes.find(n=>n.id===editing.note.id);notes=notes.filter(n=>n.id!==editing.note.id);
    if(!saveNotes()){notes=previous;return;}
    dialog.close();renderPanel();paint();
  }
});
panel.addEventListener('click',event=>{
  const button=event.target.closest('[data-notes-action]');if(!button)return;
  const action=button.dataset.notesAction,note=notes.find(n=>n.id===button.dataset.noteId);
  if(action==='close')closePanel();
  if(action==='open'&&note)openEditor(note);
  if(action==='locate'&&note){bridge.map.getView().animate({center:note.coords,zoom:18,duration:250});if(innerWidth<=850)closePanel();}
  if(action==='undo'&&deleted){const previous=notes;notes=[...notes,deleted];if(saveNotes()){deleted=null;renderPanel();paint();}else notes=previous;}
});
function openPin(event){const pin=event.target.closest('[data-note-id]');if(!pin)return;event.stopPropagation();const note=notes.find(n=>n.id===pin.dataset.noteId);if(note)openEditor(note);}
layer.addEventListener('click',openPin);layer.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPin(event);}});
window.addEventListener('gzw:open-note',event=>openEditor(event.detail.note,event.detail));
window.addEventListener('gzw:map-ready',event=>bind(event.detail));
window.addEventListener('gzw:locations-open',closePanel);
document.addEventListener('click',event=>{if(event.target.closest('#runs-nav, #runs-toolbar, .sidebar-nav-middle a'))closePanel();},true);
new MutationObserver(()=>{attachUI();if(bridge&&!bridge.map.getTargetElement()?.isConnected)closePanel();}).observe(document.body,{childList:true,subtree:true});
if(window.__gzwMap)bind(window.__gzwMap);attachUI();
