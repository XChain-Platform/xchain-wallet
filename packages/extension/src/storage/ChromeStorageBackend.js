// ChromeStorageBackend — §11.2 MV3 adapter. Wraps chrome.storage.local
// (or .session, if passed in) to implement @xchain-wallet/core's
// StorageBackend contract.
//
// Ciphertext is base64-encoded on the wire to the Chrome storage layer.
// Chrome's structured clone does support Uint8Array in principle, but
// the round-trip behavior has been unreliable across engine versions
// and between popup / service-worker contexts. base64 is a stable,
// readable-by-humans encoding with a ~33% size overhead — acceptable
// for a single wallet blob that's at most tens of KB.

import { storage as coreStorage, crypto as coreCrypto } from '@xchain-wallet/core';

const { StorageBackend } = coreStorage;
const { bytesToBase64, base64ToBytes } = coreCrypto;

export const DEFAULT_STORAGE_KEY = 'xchain-wallet:vault';

/**
 * @typedef {Object} ChromeStorageLike
 * @property {(key?: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>} get
 * @property {(items: Record<string, unknown>) => Promise<void>} set
 * @property {(keys: string | string[]) => Promise<void>} remove
 */

/**
 * @typedef {Object} ChromeStorageBackendOpts
 * @property {string} [key]                        storage key (default 'xchain-wallet:vault')
 * @property {ChromeStorageLike} [chromeStorage]   inject for tests / non-browser targets; defaults to globalThis.chrome?.storage?.local
 */

export class ChromeStorageBackend extends StorageBackend {
    /** @param {ChromeStorageBackendOpts} [opts] */
    constructor(opts = {}) {
        super();
        this._key = opts.key ?? DEFAULT_STORAGE_KEY;
        this._storage =
            opts.chromeStorage ??
            /** @type {ChromeStorageLike | undefined} */ (
                globalThis.chrome?.storage?.local
            );
        if (!this._storage) {
            throw new Error(
                'ChromeStorageBackend: chrome.storage.local is not available; pass { chromeStorage } for non-extension contexts',
            );
        }
    }

    /** @returns {Promise<Uint8Array | null>} */
    async load() {
        const result = await this._storage.get(this._key);
        const encoded = result?.[this._key];
        if (encoded == null) return null;
        if (typeof encoded !== 'string') {
            throw new Error(
                `ChromeStorageBackend.load: unexpected value type "${typeof encoded}" at key "${this._key}"`,
            );
        }
        return base64ToBytes(encoded);
    }

    /** @param {Uint8Array} blob */
    async save(blob) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error(
                'ChromeStorageBackend.save: blob must be a Uint8Array',
            );
        }
        await this._storage.set({ [this._key]: bytesToBase64(blob) });
    }

    async clear() {
        await this._storage.remove(this._key);
    }
}
