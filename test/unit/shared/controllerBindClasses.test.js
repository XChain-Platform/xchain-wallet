// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { toggleActionClass, waitForTxOutputsVisible } from '../../../packages/core/src/shared/utils/controllerBindClasses.js';

describe('waitForTxOutputsVisible', () => {
    it('polls until an output of the txid is listed', async () => {
        const getUtxos = vi.fn()
            .mockResolvedValueOnce([{ txid: 'other', vout: 0 }])
            .mockRejectedValueOnce(new Error('tracker down'))
            .mockResolvedValueOnce({ utxos: [{ txid: 'ABC', vout: 1 }] });
        const sleep = vi.fn().mockResolvedValue(undefined);
        await expect(waitForTxOutputsVisible({ getUtxos, txid: 'abc', sleep })).resolves.toBe(true);
        expect(getUtxos).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('gives up after the time box without throwing', async () => {
        const getUtxos = vi.fn().mockResolvedValue([]);
        const sleep = vi.fn().mockResolvedValue(undefined);
        await expect(waitForTxOutputsVisible({
            getUtxos, txid: 'abc', sleep, timeoutMs: 10000, intervalMs: 2000,
        })).resolves.toBe(false);
        expect(getUtxos).toHaveBeenCalledTimes(6);
    });

    it('does nothing without a txid or a reader', async () => {
        await expect(waitForTxOutputsVisible({ getUtxos: vi.fn(), txid: '' })).resolves.toBe(false);
        await expect(waitForTxOutputsVisible({ getUtxos: null, txid: 'abc' })).resolves.toBe(false);
    });
});

describe('controller bind action-class selection', () => {
    it('makes all mutually exclusive with class-specific choices', () => {
        expect(toggleActionClass(['transfer'], 'all')).toEqual(['all']);
        expect(toggleActionClass(['all'], 'burn')).toEqual(['burn']);
    });

    it('keeps several class-specific choices and permits an empty selection', () => {
        expect(toggleActionClass(['transfer'], 'burn')).toEqual(['transfer', 'burn']);
        expect(toggleActionClass(['transfer'], 'transfer')).toEqual([]);
    });
});
