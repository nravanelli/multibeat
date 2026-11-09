const PAIRED_KEY = 'multibeat-paired';
const validIds = value => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0);

export function loadPairedIds(storage) {
  const current = storage.getItem(PAIRED_KEY);
  if (current !== null) {
    const ids = JSON.parse(current);
    return validIds(ids) ? [...new Set(ids)] : [];
  }
  // Preserve a single prior pairing list by its structure; never guess between
  // multiple lists or delete the original settings.
  const candidates = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.endsWith('-paired') || key === PAIRED_KEY) continue;
    try {
      const ids = JSON.parse(storage.getItem(key));
      if (validIds(ids) && ids.length) candidates.push([...new Set(ids)]);
    } catch { /* Ignore unrelated or malformed settings. */ }
  }
  if (candidates.length !== 1) return [];
  try { savePairedIds(storage, candidates[0]); } catch { /* Existing permissions can still be used on this page. */ }
  return candidates[0];
}

export function savePairedIds(storage, ids) {
  storage.setItem(PAIRED_KEY, JSON.stringify(ids));
}
