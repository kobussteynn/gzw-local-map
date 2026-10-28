import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {filterPredicate, nameMatches, makeCatalog, LocationFilter} from '../local/location-filter-core.mjs';

class Source extends EventEmitter {
  constructor(features){super();this.features=new Set(features);}
  un(event,listener){this.off(event,listener);}
  getFeatures(){return [...this.features];}
  hasFeature(feature){return this.features.has(feature);}
  addFeature(feature){if(this.hasFeature(feature))return;this.features.add(feature);this.emit('addfeature',{feature});}
  removeFeature(feature){if(!this.features.delete(feature))return;this.emit('removefeature',{feature});}
}
class Layer extends EventEmitter {
  constructor(features,visible=false){super();this.source=new Source(features);this.visible=visible;this.min=15.3;this.max=21;}
  un(event,listener){this.off(event,listener);}
  getSource(){return this.source;}
  getVisible(){return this.visible;}
  setVisible(value){if(value===this.visible)return;this.visible=value;this.emit('change:visible');}
  getMinZoom(){return this.min;}getMaxZoom(){return this.max;}
  setMinZoom(value){this.min=value;}setMaxZoom(value){this.max=value;}
}
const feature=name=>({get:property=>property==='name'?name:undefined});

test('search handles partial names, plural forms and normal camping aliases',()=>{
  assert.ok(nameMatches('Trashed Campsite','trashed camps'));
  assert.ok(nameMatches('Campsite','camping sites'));
  assert.ok(nameMatches('Campsite','normal camps'));
  assert.ok(!nameMatches('Trashed Campsite','normal camps'));
  assert.ok(nameMatches('Hidden Poppy Fields','hidden poppy field'));
  assert.ok(nameMatches('LAF Checkpoint','laf checkpoints'));
});
test('selected names use OR and remain distinct from partial search previews',()=>{
  const matches=filterPredicate(['Campsite','Trashed Campsite'],'');
  assert.ok(matches('Campsite'));assert.ok(matches('Trashed Campsite'));assert.ok(!matches('LAF Checkpoint'));
  assert.ok(!filterPredicate(['Campsite'],'')('Trashed Campsite'));
  const preview=filterPredicate(['Campsite'],'laf checkpoint, hidden poppy');
  assert.ok(preview('Campsite'));assert.ok(preview('LAF Checkpoint'));assert.ok(preview('Hidden Poppy Fields'));
});
test('filter removes unmatched native markers and restores original categories and zoom limits',()=>{
  const camp=feature('Campsite'),trashed=feature('Trashed Campsite'),laf=feature('LAF Checkpoint');
  const layer=new Layer([camp,trashed,laf],false),other=new Layer([feature('Ammo Box')],true);
  const controller=new LocationFilter();controller.track(layer);controller.track(other);
  controller.set(['Trashed Campsite']);
  assert.deepEqual(layer.source.getFeatures(),[trashed]);assert.ok(layer.visible);assert.equal(layer.min,0);assert.equal(other.visible,false);
  controller.set(['Campsite','Trashed Campsite']);assert.equal(layer.source.getFeatures().length,2);
  controller.set([], 'no-such-location');assert.equal(layer.source.getFeatures().length,0);assert.equal(layer.visible,false);
  controller.set([]);assert.deepEqual(new Set(layer.source.getFeatures()),new Set([camp,trashed,laf]));
  assert.equal(layer.visible,false);assert.equal(layer.min,15.3);assert.equal(layer.max,21);assert.equal(other.visible,true);
});
test('late-arriving markers and newly enabled category layers obey the active filter',()=>{
  const layer=new Layer([]),controller=new LocationFilter();controller.track(layer);controller.set(['Trashed Campsite']);
  const wanted=feature('Trashed Campsite'),unwanted=feature('Ammo Box');
  layer.source.addFeature(wanted);layer.source.addFeature(unwanted);
  assert.deepEqual(layer.source.getFeatures(),[wanted]);
  layer.setVisible(false);assert.equal(layer.visible,true);
  controller.set([]);assert.ok(layer.source.hasFeature(unwanted));assert.equal(layer.visible,false);
  controller.dispose();assert.equal(controller.records.size,0);
});
test('catalog combines case/spacing variants and preserves display counts',()=>{
  const catalog=makeCatalog([{name:' Campsite '},{name:'campsite'},{name:'Trashed Campsite'}]);
  assert.equal(catalog.length,2);assert.equal(catalog.find(x=>x.key==='campsite').count,2);
});

test('active filters continue to respect native floor and faction eligibility',()=>{
  const first=feature('Campsite'),second=feature('Campsite');let allowed=first;
  const layer=new Layer([first,second]),controller=new LocationFilter(()=>{},item=>item===allowed);
  controller.track(layer);controller.set(['Campsite']);assert.deepEqual(layer.source.getFeatures(),[first]);
  allowed=second;controller.set(['Campsite']);assert.deepEqual(layer.source.getFeatures(),[second]);
  assert.equal(controller.matchingFeatures().length,1);
  controller.set([]);assert.equal(layer.source.getFeatures().length,2);
});

test('LZ and loot category selections combine with individual places using public marker metadata',()=>{
  const catalog=makeCatalog([{name:'Golf 2',icon:'landingZone'},{name:'Echo 4',icon:'landingZoneFaction'},{name:'Building Material Crate',icon:'building-material'},{name:'IMSI Catcher',icon:'disassembly-material'},{name:'Campsite',icon:'target'}]);
  const keywords=name=>catalog.find(item=>item.name===name)?.keywords||'';
  assert.ok(nameMatches('Golf 2','lzs',keywords('Golf 2')));
  assert.ok(nameMatches('Landing Zone - Golf 2','LZ Golf 2'));
  const layer=new Layer(catalog.map(item=>feature(item.name))),controller=new LocationFilter(()=>{},()=>true,keywords);
  controller.track(layer);controller.set(['All landing zones','Building Material Crate']);
  assert.deepEqual(new Set(layer.source.getFeatures().map(f=>f.get('name'))),new Set(['Golf 2','Echo 4','Building Material Crate']));
  controller.set(['Golf 2','All loot']);
  assert.deepEqual(new Set(layer.source.getFeatures().map(f=>f.get('name'))),new Set(['Golf 2','Building Material Crate','IMSI Catcher']));
  controller.set([],'loot');assert.equal(controller.matchingFeatures().length,2);
  controller.set([]);assert.equal(layer.source.getFeatures().length,5);
});
