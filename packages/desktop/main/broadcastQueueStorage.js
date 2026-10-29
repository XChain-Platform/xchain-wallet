// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import {
    BROADCAST_QUEUE_STORAGE_VERSION,
    createBroadcastQueueStorageAdapter,
} from '@xchain-wallet/extension/src/background/broadcastQueueStorage.js';

/**
 * Desktop queue persistence under Electron's userData directory. The shared
 * adapter owns the queue envelope and validation; this class supplies atomic
 * file IO and keeps write order stable when queue and settlement saves overlap.
 */
export class FileBroadcastQueueStorage {
    /**
     * @param {string} filePath
     * @param {{ warn?: Function }} [logger]
     */
    constructor(filePath, logger = console) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileBroadcastQueueStorage: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
        this._logger = logger;
        this._mutation = Promise.resolve();
        this._adapter = createBroadcastQueueStorageAdapter({
            read: () => this._read(),
            write: (blob) => this._mutate(() => this._write(blob)),
            remove: () => this._mutate(() => this._write({
                storageVersion: BROADCAST_QUEUE_STORAGE_VERSION,
                queues: {},
                settlements: [],
            })),
        });
    }

    get filePath() { return this._filePath; }

    load() { return this._adapter.load(); }

    save(snapshot) { return this._adapter.save(snapshot); }

    loadSettlements() { return this._adapter.loadSettlements(); }

    saveSettlements(owed) { return this._adapter.saveSettlements(owed); }

    clear() { return this._adapter.clear(); }

    async _read() {
        let raw;
        try {
            raw = await fs.readFile(this._filePath, 'utf8');
        } catch (err) {
            if (err?.code === 'ENOENT') return { ok: true, blob: undefined };
            this._warn(err);
            return { ok: true, blob: {} };
        }
        try {
            return { ok: true, blob: JSON.parse(raw) };
        } catch (err) {
            this._warn(err);
            return { ok: true, blob: {} };
        }
    }

    async _write(blob) {
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, JSON.stringify(blob), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    _mutate(operation) {
        const mutation = this._mutation.catch(() => {}).then(operation);
        this._mutation = mutation;
        return mutation;
    }

    _warn(err) {
        this._logger?.warn?.(
            '[xchain] broadcast queue file is unreadable; starting with an empty queue:',
            err,
        );
    }
}

/** @param {string} userDataDir */
export function broadcastQueuePathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('broadcastQueuePathFor: userDataDir is required');
    }
    return join(userDataDir, 'broadcast-queue.json');
}
