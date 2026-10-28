import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newRun, segmentDistance, nearbyMarkers, matchDoorKey, requiredKeys, loadStore, validateRun} from '../local/planner-core.mjs';

test('boss proximity follows route segments, including drawn routes, not just stops',()=>{
  const run=newRun();run.steps=[{coords:[0,0]},{coords:[1000,0]}];
  const markers=[{id:1,lng:500,lat:20},{id:2,lng:500,lat:900}];
  assert.deepEqual(nearbyMarkers(markers,run,50).map(x=>x.marker.id),[1]);
  run.steps=[];run.drawings=[{coordinates:[[0,0],[1000,0]]}];
  assert.equal(nearbyMarkers(markers,run,50).length,1);
  assert.equal(segmentDistance([5,0],[0,0],[0,0]),5);
});

test('keys are deduplicated and ambiguous or missing associations stay unresolved',()=>{
  const keys=[{id:1,short_name:'PLA H03'},{id:2,short_name:'PLA Meet'}];
  const doors=[{id:10,name:'PLA H03 Door',key:[]},{id:11,name:'Unknown Door',key:[]},{id:12,name:'Other Door',key:[1]}];
  const run=newRun();run.selectedDoorIds=[10,11,12];
  assert.equal(matchDoorKey(doors[0],keys).key.id,1);
  assert.equal(matchDoorKey(doors[1],keys).key,null);
  assert.equal(requiredKeys(run,doors,keys).length,1);
  run.doorKeys[11]=2;
  assert.equal(requiredKeys(run,doors,keys).length,2);
  assert.equal(matchDoorKey(doors[1],keys,run.doorKeys).source,'Selected manually');
});

test('saved run roundtrip preserves drawings, targets, notes, keys and checklists',()=>{
  const run=newRun();run.title='Golf 2';run.drawings=[{id:'stroke',coordinates:[[1,2],[3,4]],note:'Raid secondary buildings',color:'yellow',dashed:true}];
  run.targets=[{id:'target',title:'Terminal',coords:[5,6],note:'Before entry',phase:'On arrival',radius:75}];
  run.notes=[{id:'note',title:'Remember',coords:[4,5],note:'Bring keys'}];run.doorKeys={10:1};run.checked={'key-1':true};
  const store={runs:[run],draft:run,open:true};
  const loaded=loadStore({getItem:()=>JSON.stringify(store)});
  assert.deepEqual(loaded.runs[0],run);
  loaded.draft.targets[0].note='Edited';assert.notEqual(loaded.runs[0].targets[0].note,loaded.draft.targets[0].note);
});

test('import rejects invalid coordinates, malformed inventory, and unknown schemas',()=>{
  const run=newRun();run.title='test';
  assert.throws(()=>validateRun({...run,schema:99}));
  assert.throws(()=>validateRun({...run,steps:[{title:'bad',note:'',coords:[NaN,0]}]}));
  assert.throws(()=>validateRun({...run,checked:[]}));
  assert.throws(()=>validateRun({...run,map:'../../etc'}));
  assert.throws(()=>validateRun({...run,notes:[{id:'" onclick="bad',title:'bad',note:'',coords:[0,0]}]}));
});
