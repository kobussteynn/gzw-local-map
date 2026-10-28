// End-to-end check in an isolated maintainer test profile, never normal app data.
module.exports = async function missionSmoke(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label = 'mission control') => {
      const end = Date.now() + 30000;
      while (Date.now() < end) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
      throw new Error('Mission-selection test timed out: ' + label);
    };
    const search = value => { const input = document.querySelector('input[placeholder="Search tasks by name"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    const row = name => [...document.querySelectorAll('main article')].find(item => item.querySelector('h3 a')?.textContent.trim() === name);
    const action = (name, label) => [...(row(name)?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === label);
    document.querySelector('a[href$="/tasks"]').click();
    await wait(() => document.querySelector('#task-selection-help'), 'Tasks section help; local scripts: ' + performance.getEntriesByType('resource').filter(entry => entry.name.includes('/__mirror/local/')).map(entry => entry.name).join(', '));
    const faction = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Crimson Shield International');
    if (faction) faction.click();
    await wait(() => ![...document.querySelectorAll('dialog')].some(dialog => dialog.open));
    for (const [index, name] of ['Mire Job', 'Hacker'].entries()) {
      search(name);
      await wait(() => document.querySelectorAll('main article').length <= index + 1 && action(name, 'Show on map'), 'filtered task ' + name);
      action(name, 'Show on map').click();
      await wait(() => action(name, 'Hide from map'), 'selected state for ' + name);
    }
    const states = () => {
      const map = window.__gzwMap.map;
      const group = map.getLayers().getArray().find(layer => layer.get('name') === 'tasks');
      return [271,65].map(id => group.getLayers().getArray().find(layer => layer.get('id') === 'task-' + id)?.getVisible() === true);
    };
    await wait(() => states().every(Boolean));
    document.querySelector('#location-filter-nav').click();
    const filter = document.querySelector('#location-name-search');
    filter.value = 'Campsite'; filter.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => document.querySelector('.location-filter-status').textContent.includes('matching locations'));
    if (!states().every(Boolean)) throw new Error('Loot filtering hid selected missions');
    if (document.querySelector('[data-select-name="All tasks"]') || document.querySelector('[data-select-name^="Task: "]')) throw new Error('Tasks still appear in Locations');
    document.querySelector('[aria-label="Clear all location filters"]').click();
    document.querySelector('[aria-label="Close location filters"]').click();
    search('Mire Job');
    (await wait(() => action('Mire Job', 'Hide from map'))).click();
    await wait(() => !states()[0] && states()[1]);
    (await wait(() => action('Mire Job', 'Show on map'))).click();
    await wait(() => states().every(Boolean));
    document.querySelector('#task-selection-help button').click();
    return { twoMissionsVisible: states().every(Boolean), survivesLootFilter: true, hideOneKeepsOther: true };
  })()`);
};
