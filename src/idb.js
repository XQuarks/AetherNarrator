// ============================================================
// AetherNarrator · idb.js
// 轻量 IndexedDB 键值封装，替代 localStorage。
// 用法与原 localStorage 一致：按字符串 key 存取一个值。
// 关键差异：异步（Promise，不阻塞主线程），容量远超 5MB 上限。
// 值统一以字符串存储，以兼容 storage.js 中既有的 parseStored* 解析逻辑。
// ============================================================

const DB_NAME = "aigame_db";
const STORE_NAME = "kv";
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("当前环境不支持 IndexedDB"));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

// 读取：无值时返回 null（与 localStorage.getItem 行为一致）
export async function idbGet(key) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn("idbGet 失败，回退 null:", e.message);
        return null;
    }
}

// 写入：内部吞错，调用方可不等待（fire-and-forget）
export async function idbSet(key, value) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn("idbSet 失败（可能空间不足）:", e.message);
    }
}

// 删除：内部吞错，调用方可不等待
export async function idbDel(key) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn("idbDel 失败:", e.message);
    }
}
