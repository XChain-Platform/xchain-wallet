// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// With storage refusing writes, the Locked screen's two failure paths write
// different records: a wrong password writes the lockout record, the duress
// passphrase arms panic mode and then writes the lockout record. The
// Developer Mode log must read the same after both, or it names the duress
// entry. Arming from Settings gives the same line too.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logConsole } from '../../../packages/core/src/shared/utils/logConsole.js';
import {
    __resetLockoutPersistenceForTests,
    configureLockoutPersistence,
    recordFailure,
} from '../../../packages/core/src/flows/lockoutTracking.js';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    clearPanicModeState,
    configurePanicModePersistence,
} from '../../../packages/core/src/flows/panicMode.js';
import {
    __resetDuressPersistenceForTests,
    clearDuressPassphrase,
    setDuressPassphrase,
    tripDuressIfMatch,
} from '../../../packages/core/src/flows/duressPassphrase.js';

const DURESS = 'duress-passphrase-9';

function reset() {
    clearPanicModeState();
    __resetLockoutPersistenceForTests();
    __resetPanicModePersistenceForTests();
    logConsole.clear();
}

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    __resetDuressPersistenceForTests();
    setDuressPassphrase(DURESS);
    reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    clearDuressPassphrase();
    __resetDuressPersistenceForTests();
    reset();
    localStorage.clear();
});

const lines = () => logConsole.entries().map((entry) => `${entry.level} ${entry.source} ${entry.message}`);

function refuseLocalStorage() {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
    });
}

function refusingStore() {
    return {
        load: async () => null,
        save: async () => { throw new Error('quota'); },
        clear: async () => {},
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the storage-failure line after a failed unlock', () => {
    it('reads the same for a wrong password, a duress entry and a Settings arm with localStorage refused', () => {
        refuseLocalStorage();
        expect(tripDuressIfMatch('not-the-passphrase')).toBe(false);
        recordFailure();
        const wrong = lines();

        reset();
        expect(tripDuressIfMatch(DURESS)).toBe(true);
        recordFailure();
        const duress = lines();

        reset();
        activatePanicMode();
        const settings = lines();

        expect(wrong).toHaveLength(1);
        expect(duress).toEqual(wrong);
        expect(settings).toEqual(wrong);
        expect(wrong.join('\n')).not.toMatch(/panic|duress|freeze/i);
    });

    it('reads the same for a wrong password and a duress entry with an injected store refused', async () => {
        await configureLockoutPersistence(refusingStore());
        await configurePanicModePersistence(refusingStore());
        recordFailure();
        await flush();
        const wrong = lines();

        logConsole.clear();
        reset();
        await configureLockoutPersistence(refusingStore());
        await configurePanicModePersistence(refusingStore());
        expect(tripDuressIfMatch(DURESS)).toBe(true);
        recordFailure();
        await flush();
        const duress = lines();

        expect(wrong).toHaveLength(1);
        expect(duress).toEqual(wrong);
    });
});
