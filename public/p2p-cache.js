/**
 * LinkVault P2P Cache - Lightweight Transfer Resume Store
 *
 * What is this file for?
 * When sending large files over WebRTC or Wormhole, mobile devices might temporarily
 * lock their screen or switch apps.
 *
 * To allow resuming transfers without restarting from byte 0, this module saves
 * lightweight resume metadata in the browser's IndexedDB:
 * - fileId: Unique signature for the file (name + size + timestamp)
 * - lastContiguousChunk: The last chunk index safely written
 * - totalChunks: Total number of chunks in the file
 *
 * NOTE: We do NOT store gigabytes of raw file data in IndexedDB (which would crash
 * mobile browsers and exceed browser storage quotas). We only store a tiny JSON pointer!
 */

const DB_NAME = 'linkvault_p2p_cache';
const DB_VERSION = 1;
const STORE_NAME = 'resume_records';

/**
 * Opens or initializes the IndexedDB database.
 *
 * @returns {Promise<IDBDatabase|null>} Resolves with database instance or null if unavailable.
 */
function openResumeDb() {
  return new Promise((resolve) => {
    // If browser does not support IndexedDB (e.g. strict private browsing)
    if (!window.indexedDB) {
      return resolve(null);
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    // Runs only when the database is created for the first time
    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      console.warn('Could not open IndexedDB:', request.error);
      resolve(null);
    };
  });
}

/**
 * Saves the progress pointer of a file transfer into IndexedDB.
 *
 * @param {string} fileId - Unique file identifier.
 * @param {number} lastContiguousChunk - Index of the last successfully received chunk.
 * @param {number} totalChunks - Total number of chunks in the file.
 * @returns {Promise<boolean>} Resolves to true on success, false on error.
 */
async function saveResumeRecord(fileId, lastContiguousChunk, totalChunks) {
  try {
    const db = await openResumeDb();
    if (!db) {
      return false;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      store.put({
        fileId: fileId,
        lastContiguousChunk: lastContiguousChunk,
        totalChunks: totalChunks,
        updatedAt: Date.now()
      });

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function () {
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('Failed to save resume record:', err);
    return false;
  }
}

/**
 * Retrieves the saved progress pointer for a given file.
 *
 * @param {string} fileId - Unique file identifier.
 * @returns {Promise<object|null>} Object containing progress info, or null if not found.
 */
async function getResumeRecord(fileId) {
  try {
    const db = await openResumeDb();
    if (!db) {
      return null;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(fileId);

      request.onsuccess = function () {
        resolve(request.result || null);
      };

      request.onerror = function () {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('Failed to get resume record:', err);
    return null;
  }
}

/**
 * Deletes the progress pointer from IndexedDB once the file is completely downloaded.
 *
 * @param {string} fileId - Unique file identifier.
 * @returns {Promise<boolean>} Resolves to true on success, false on error.
 */
async function clearResumeRecord(fileId) {
  try {
    const db = await openResumeDb();
    if (!db) {
      return false;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(fileId);

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function () {
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('Failed to clear resume record:', err);
    return false;
  }
}

// Expose on global window object for use by Beam and Wormhole engines
window.LinkVaultCache = {
  saveResumeRecord,
  getResumeRecord,
  clearResumeRecord
};
