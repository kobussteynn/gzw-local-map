export const locationKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
export function searchWords(value) {
  return locationKey(value).replace(/\blzs?\b/g,'landing zone').replace(/landing zones\b/g,'landing zone').replace(/camping\s+sites?/g,'camp').replace(/campsites?\b/g,'camp').replace(/camps\b/g,'camp')
    .replace(/checkpoints\b/g,'checkpoint').replace(/fields\b/g,'field').replace(/\blocations?\b/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
export function nameMatches(name, query, keywords='') {
  const terms=searchWords(query).split(' ').filter(Boolean);
  if (!terms.length) return false;
  let candidate=searchWords(name+' '+keywords);
  if (locationKey(name)==='campsite') candidate+=' normal';
  return terms.every(term=>candidate.includes(term));
}
export function markerKeywords(marker) {
  const icon=String(marker.icon||'');
  if(/^landingZone/.test(icon)||/^Landing Zone\b/i.test(marker.name||''))return 'landing zone';
  if([4,37].includes(Number(marker.nav_item)))return '';
  if(/^(woodenMilitary|safe|cashRegister|key|keycard|stone|ammo|unBox|unGearCrate|militaryGearCrate|foodStorage|firstAidCabinet|medicalBag|cooler|metalBox|unCrate|militaryBox|militaryCrate|militaryMedicalCrate|civilianChest|duffleBag-\d|briefcase|buriedCache\w*|purse\w*|pmcBox|jewelryBox|plasticContainer|unFirearmsBox|unFirearmsCrate|jacket|carTrunk|toolBox|atm|item|building-material|disassembly-material)$/.test(icon))return 'loot '+(/material/.test(icon)?'materials supplies':'');
  return '';
}
export function makeCatalog(markers) {
  const index=new Map();
  for(const marker of markers){
    const name=String(marker.name || '').trim(),key=locationKey(name);
    if(!key || marker.type==='polygon')continue;
    const entry=index.get(key)||{key,name,count:0,keywords:''};entry.count++;const tags=markerKeywords(marker);if(tags&&!entry.keywords.includes(tags))entry.keywords+=' '+tags;index.set(key,entry);
  }
  return [...index.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function filterPredicate(selected, query, keywords=()=> '') {
  const exact=new Set(selected.map(locationKey)),queries=query.split(/[,;\n]/).map(q=>q.trim()).filter(Boolean);
  return name=>exact.has(locationKey(name)) || (exact.has('all landing zones')&&nameMatches(name,'lz',keywords(name))) || (exact.has('all loot')&&nameMatches(name,'loot',keywords(name))) || queries.some(q=>nameMatches(name,q,keywords(name)));
}

// Remove unmatched features from native sources so they are neither drawn nor clickable.
// Keep each source's eligible features separate from our temporary visibility filter.
export class LocationFilter {
  constructor(onChange=()=>{},eligible=()=>true,keywords=()=> ''){this.records=new Map();this.active=false;this.selected=[];this.query='';this.mutating=false;this.onChange=onChange;this.isEligible=eligible;this.keywords=keywords;}
  track(layer){
    // Mission visibility belongs exclusively to the native Tasks section.
    if(String(layer.get?.('id')||'').startsWith('task-'))return;
    if(this.records.has(layer))return;
    const source=layer.getSource?.();if(!source?.getFeatures)return;
    const record={layer,source,eligible:new Set(source.getFeatures()),visible:layer.getVisible(),minZoom:layer.getMinZoom(),maxZoom:layer.getMaxZoom()};
    record.add=event=>{
      if(this.mutating)return;record.eligible.add(event.feature);
      if(this.active){this.mutating=true;try{
        if(!this.isEligible(event.feature)||!filterPredicate(this.selected,this.query,this.keywords)(event.feature.get('name')))source.removeFeature(event.feature);
        else{layer.setVisible(true);layer.setMinZoom(0);layer.setMaxZoom(30);}
      }finally{this.mutating=false;}}
      this.onChange();
    };
    record.remove=event=>{if(this.mutating)return;record.eligible.delete(event.feature);this.onChange();};
    record.clear=()=>{if(this.mutating)return;record.eligible.clear();this.onChange();};
    record.visibility=()=>{if(this.mutating)return;record.visible=layer.getVisible();if(this.active)this.apply();};
    source.on('addfeature',record.add);source.on('removefeature',record.remove);source.on('clear',record.clear);layer.on('change:visible',record.visibility);
    this.records.set(layer,record);if(this.active)this.apply();
  }
  untrack(layer){
    const record=this.records.get(layer);if(!record)return;
    this.restore(record);
    record.source.un('addfeature',record.add);record.source.un('removefeature',record.remove);record.source.un('clear',record.clear);layer.un('change:visible',record.visibility);
    this.records.delete(layer);
  }
  set(selected,query=''){
    this.selected=selected;this.query=query;this.active=selected.length>0 || query.trim().length>0;this.apply();
  }
  restore(record){
    this.mutating=true;
    try{for(const feature of record.eligible)if(!record.source.hasFeature(feature))record.source.addFeature(feature);
      record.layer.setVisible(record.visible);record.layer.setMinZoom(record.minZoom);record.layer.setMaxZoom(record.maxZoom);
    }finally{this.mutating=false;}
  }
  apply(){
    if(!this.active){for(const record of this.records.values())this.restore(record);return;}
    const matches=filterPredicate(this.selected,this.query,this.keywords);
    this.mutating=true;
    try{
      for(const record of this.records.values()){
        let count=0;
        for(const feature of record.eligible){
          const match=this.isEligible(feature)&&matches(feature.get('name'));
          if(match){count++;if(!record.source.hasFeature(feature))record.source.addFeature(feature);}
          else if(record.source.hasFeature(feature))record.source.removeFeature(feature);
        }
        record.layer.setVisible(count>0);record.layer.setMinZoom(0);record.layer.setMaxZoom(30);
      }
    }finally{this.mutating=false;}
  }
  getFeatures(){return [...this.records.values()].flatMap(r=>[...r.eligible]);}
  matchingFeatures(){const matches=filterPredicate(this.selected,this.query,this.keywords);return this.getFeatures().filter(f=>this.isEligible(f)&&matches(f.get('name')));}
  dispose(){for(const layer of [...this.records.keys()])this.untrack(layer);}
}
