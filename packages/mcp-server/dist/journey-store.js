const store = new Map();
export function upsertJourney(id, meta, events) {
    const existing = store.get(id);
    store.set(id, { id, meta, events, files: existing?.files ?? [] });
}
export function addEvent(journeyId, event) {
    const j = store.get(journeyId);
    if (!j)
        return;
    j.events.push(event);
}
export function setStatus(journeyId, status) {
    const j = store.get(journeyId);
    if (!j)
        return;
    j.meta.status = status;
}
export function addFile(journeyId, file) {
    const j = store.get(journeyId);
    if (!j)
        return;
    j.files.push(file);
}
export function getById(id) {
    return store.get(id);
}
export function getByDomain(domain) {
    const lower = domain.toLowerCase();
    return [...store.values()].filter(j => j.meta.domain.toLowerCase().includes(lower));
}
export function getLatest() {
    if (store.size === 0)
        return undefined;
    return [...store.values()].reduce((a, b) => a.meta.startTime > b.meta.startTime ? a : b);
}
export function listAll() {
    return [...store.values()];
}
export function clear() {
    store.clear();
}
