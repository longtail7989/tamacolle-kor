const STORE = 'resources', ACTIVE = 'active';
const storageError = cause => new Error('번역 리소스를 안전하게 저장하거나 읽지 못했습니다.', {cause});

export function createResourceStore({indexedDB = globalThis.indexedDB, dbName = 'tamacolle-kor-resources'} = {}) {
  let opening = null, closed = false;
  const pending = new Set();
  function database() {
    if (closed) return Promise.reject(storageError());
    if (!opening) {
      const attempt = new Promise((resolve, reject) => {
        let request, failed = false;
        try { request = indexedDB.open(dbName, 1); } catch (error) { reject(storageError(error)); return; }
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onerror = request.onblocked = () => { failed = true; reject(storageError(request.error)); };
        request.onsuccess = () => {
          const db = request.result;
          if (closed || failed) { db.close(); reject(storageError()); return; }
          db.onversionchange = () => { db.close(); closed = true; };
          resolve(db);
        };
      });
      opening = attempt;
      attempt.catch(() => { if (opening === attempt) opening = null; });
    }
    return opening;
  }
  async function transaction(mode, operation) {
    const db = await database();
    if (closed) throw storageError();
    const work = new Promise((resolve, reject) => {
      let tx, value, failure;
      try { tx = db.transaction(STORE, mode); } catch (error) { reject(storageError(error)); return; }
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(storageError(failure || tx.error));
      // A request's success is not a commit. Keep the old active record until the
      // entire native transaction completes; quota/abort leaves it untouched.
      tx.onerror = event => { failure = event.target?.error || tx.error; };
      try {
        const request = operation(tx.objectStore(STORE));
        request.onsuccess = () => { value = request.result; };
      } catch (error) {
        failure = error;
        try { tx.abort(); } catch { reject(storageError(error)); }
      }
    });
    pending.add(work);
    try { return await work; } finally { pending.delete(work); }
  }
  return {
    async load() { return (await transaction('readonly', store => store.get(ACTIVE))) ?? null; },
    async save(pack) { await transaction('readwrite', store => store.put(pack, ACTIVE)); },
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      if (opening) { try { (await opening).close(); } catch { /* Failed opens have no connection to close. */ } }
    }
  };
}
