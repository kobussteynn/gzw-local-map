export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const coordinate = marker => [Number(marker.lng), Number(marker.lat)];
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function segmentDistance(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return distance(point, [a[0] + t * dx, a[1] + t * dy]);
}

export function distanceToRun(point, run) {
  const lines = [run.steps.map(s => s.coords), ...run.drawings.map(d => d.coordinates)];
  let nearest = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) nearest = Math.min(nearest, i ? segmentDistance(point, line[i - 1], line[i]) : distance(point, line[i]));
  }
  for (const item of [...run.targets, ...run.notes]) nearest = Math.min(nearest, distance(point, item.coords));
  return nearest;
}

export function nearbyMarkers(markers, run, radius) {
  return markers.map(marker => ({marker, distance: distanceToRun(coordinate(marker), run)}))
    .filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance);
}

export function newRun(map = 'lamang') {
  return {schema: 1, id: uid(), title: '', map, steps: [], targets: [], notes: [], drawings: [],
    carry: '', reminders: '', selectedDoorIds: [], doorKeys: {}, extraKeyIds: [], checked: {},
    mortar: 'none', bossRadius: 600, view: null, mapVersion: '0.5', updatedAt: new Date().toISOString()};
}

const normalized = name => String(name || '').toLowerCase().replace(/\bdoor\b/g, '').replace(/[^a-z0-9]/g, '');
export function matchDoorKey(door, keys, overrides = {}) {
  if (overrides[door.id]) return {key: keys.find(k => Number(k.id) === Number(overrides[door.id])), source: 'Selected manually'};
  const linked = (door.key || []).map(k => typeof k === 'object' ? (k.key_id ?? k.id) : k);
  const direct = keys.find(k => linked.includes(k.id));
  if (direct) return {key: direct, source: 'Linked in map data'};
  const matched = keys.filter(k => normalized(k.short_name) === normalized(door.name));
  return matched.length === 1 ? {key: matched[0], source: 'Matched by door name'} : {key: null, source: 'No key linked — choose one manually'};
}

export function requiredKeys(run, doors, keys) {
  const result = new Map();
  for (const id of run.selectedDoorIds) {
    const door = doors.find(d => Number(d.id) === Number(id));
    if (!door) continue;
    const match = matchDoorKey(door, keys, run.doorKeys);
    if (match.key) {
      const entry = result.get(match.key.id) || {key: match.key, doors: []};
      entry.doors.push({door, source: match.source});
      result.set(match.key.id, entry);
    }
  }
  for (const id of run.extraKeyIds) {
    const key = keys.find(k => Number(k.id) === Number(id));
    if (key && !result.has(key.id)) result.set(key.id, {key, doors: []});
  }
  return [...result.values()];
}

export function validateRun(input) {
  if (!input || input.schema !== 1 || typeof input.id !== 'string' || typeof input.title !== 'string' || !['lamang', 'ybl-1'].includes(input.map)) throw Error('Unsupported run file.');
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  if (!validId(input.id) || input.title.length > 500) throw Error('Invalid run name or identifier.');
  for (const name of ['steps', 'targets', 'notes', 'drawings', 'selectedDoorIds', 'extraKeyIds']) if (!Array.isArray(input[name]) || input[name].length > 2000) throw Error(`Invalid ${name}.`);
  const validCoords = point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7);
  for (const item of [...input.steps, ...input.targets, ...input.notes]) if (!item || !validId(item.id) || !validCoords(item.coords) || typeof item.title !== 'string' || typeof item.note !== 'string') throw Error('Invalid map annotation.');
  for (const drawing of input.drawings) if (!validId(drawing.id) || !Array.isArray(drawing.coordinates) || drawing.coordinates.length > 100000 || !drawing.coordinates.every(validCoords) || typeof drawing.note !== 'string' || typeof drawing.color !== 'string') throw Error('Invalid drawing.');
  if (typeof input.carry !== 'string' || typeof input.reminders !== 'string') throw Error('Invalid briefing.');
  if (!input.doorKeys || typeof input.doorKeys !== 'object' || Array.isArray(input.doorKeys) || !input.checked || typeof input.checked !== 'object' || Array.isArray(input.checked)) throw Error('Invalid inventory.');
  input.bossRadius = Math.max(100, Math.min(2000, Number(input.bossRadius) || 600));
  if (!['none','all','lri','csi','mss'].includes(input.mortar)) input.mortar = 'none';
  if (typeof input.mapVersion !== 'string' || !/^\d+\.\d+$/.test(input.mapVersion)) input.mapVersion = '0.5';
  if (input.view && (!validCoords(input.view.center) || !Number.isFinite(input.view.zoom))) input.view = null;
  return structuredClone(input);
}

export function loadStore(storage) {
  const raw = storage.getItem('gzw.runs.v1');
  if (!raw) return {runs: [], draft: newRun(), open: false};
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.runs)) throw Error('The saved runs store is invalid.');
  return {runs: parsed.runs.map(validateRun), draft: parsed.draft ? validateRun(parsed.draft) : newRun(), open: Boolean(parsed.open)};
}
