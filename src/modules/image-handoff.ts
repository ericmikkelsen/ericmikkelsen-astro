/**
 * Client-side image handoff between toys (e.g. image-check -> color-layers) with no
 * server involved.
 *
 * Uses IndexedDB rather than localStorage because:
 * - localStorage is strings-only (images would need base64, ~33% larger) and capped at
 *   ~5MB per origin, which real phone photos routinely exceed.
 * - IndexedDB stores the File/Blob natively, is async, and has a far larger quota.
 *
 * The store holds a single "pending" handoff record. Reading it consumes it (delete on
 * read) so a refresh of the destination page doesn't re-import the same image forever.
 */

const DB_NAME = "toy-image-handoff";
const STORE_NAME = "handoff";
const DB_VERSION = 1;
const PENDING_KEY = "pending";

type HandoffRecord = {
    blob: Blob;
    name: string;
    type: string;
};

const openDb = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB is not available in this environment."));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Failed to open handoff database."));
    });
};

/**
 * Store an image File for another page to pick up. Overwrites any pending handoff.
 */
export const storeHandoffImage = async (file: File): Promise<void> => {
    const db = await openDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const record: HandoffRecord = { blob: file, name: file.name, type: file.type };
            tx.objectStore(STORE_NAME).put(record, PENDING_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("Failed to store handoff image."));
            tx.onabort = () => reject(tx.error ?? new Error("Handoff store transaction aborted."));
        });
    } finally {
        db.close();
    }
};

/**
 * Retrieve and remove the pending handoff image, if any. Returns null when none exists.
 */
export const takeHandoffImage = async (): Promise<File | null> => {
    let db: IDBDatabase;
    try {
        db = await openDb();
    } catch {
        return null;
    }
    try {
        const record = await new Promise<HandoffRecord | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(PENDING_KEY);
            getReq.onsuccess = () => {
                // Consume it so a page refresh doesn't re-import.
                store.delete(PENDING_KEY);
                resolve(getReq.result as HandoffRecord | undefined);
            };
            getReq.onerror = () => reject(getReq.error ?? new Error("Failed to read handoff image."));
        });
        if (!record || !record.blob) return null;
        const type = record.type || "image/png";
        const name = record.name || "handoff-image.png";
        return new File([record.blob], name, { type });
    } catch {
        return null;
    } finally {
        db.close();
    }
};
