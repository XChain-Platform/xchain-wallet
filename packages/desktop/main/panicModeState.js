// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Panic-mode freeze for the desktop shell, held by the main process.
//
// Main owns every signer and every broadcast, so main is where the freeze
// has to be read. The renderer arms and clears it (Settings > Safety, the
// duress passphrase on the Locked screen) but has no signer of its own; a
// freeze kept only in renderer localStorage shows its notice and gates
// nothing, because main has no localStorage and reads an empty freeze.
//
// The record is a file under userData, so the freeze survives a quit and a
// relaunch the same way the extension's survives a service-worker restart.
// The renderer reaches it through three messages handled ahead of the
// vault-lock gate, because the duress passphrase arms it while the wallet
// is still locked.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/** Renderer-sent message types; one wire name per operation. */
export const PANIC_STATE_LOAD_TYPE = 'panic.state.load';
export const PANIC_STATE_SAVE_TYPE = 'panic.state.save';
export const PANIC_STATE_CLEAR_TYPE = 'panic.state.clear';

export const PANIC_STATE_MESSAGE_TYPES = new Set([
    PANIC_STATE_LOAD_TYPE,
    PANIC_STATE_SAVE_TYPE,
    PANIC_STATE_CLEAR_TYPE,
]);

/**
 * File-backed freeze record with the `{ load, save, clear }` contract core's
 * `configurePanicModePersistence` takes. `load` returns the parsed record or
 * null; core coerces it, so a malformed file reads as no freeze rather than
 * as a throw on the signing path.
 */
export class FilePanicModeStore {
    /** @param {string} filePath */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FilePanicModeStore: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
    }

    get filePath() { return this._filePath; }

    async load() {
        let raw;
        try {
            raw = await fs.readFile(this._filePath, 'utf8');
        } catch {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /** @param {unknown} state */
    async save(state) {
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, JSON.stringify(state ?? null), { mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    async clear() {
        for (const p of [this._filePath, this._tmpPath]) {
            try {
                await fs.unlink(p);
            } catch (err) {
                if (err && err.code === 'ENOENT') continue;
                throw err;
            }
        }
    }
}

/** @param {string} userDataDir */
export function panicModeStatePathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('panicModeStatePathFor: userDataDir is required');
    }
    return join(userDataDir, 'panic-mode.json');
}

/**
 * Answer one renderer panic-state message against main's freeze.
 *
 * A save from the renderer is applied to main's cache first, so the very
 * next signing call in main sees it, and then written to the file. A clear
 * does the same in reverse. A load answers main's current state, which is
 * what the renderer's notice and Settings row show.
 *
 * @param {{ flows: any, store: { save: (s: unknown) => Promise<void>, clear: () => Promise<void> } | null }} deps
 * @param {string} type
 * @param {unknown} request
 */
export async function handlePanicStateMessage({ flows, store }, type, request) {
    if (type === PANIC_STATE_SAVE_TYPE) {
        flows.applyExternalPanicModeState(request);
        const state = flows.getPanicModeState();
        if (store) {
            if (state.expiresAt === 0) await store.clear();
            else await store.save(state);
        }
        return state;
    }
    if (type === PANIC_STATE_CLEAR_TYPE) {
        flows.applyExternalPanicModeState(null);
        if (store) await store.clear();
        return flows.getPanicModeState();
    }
    return flows.getPanicModeState();
}
