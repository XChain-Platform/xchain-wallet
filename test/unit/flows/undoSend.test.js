// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    createUndoSendController,
    createUndoSendRequest,
    isUndoSendCancellation,
} from '../../../packages/core/src/flows/undoSend.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

describe('createUndoSendRequest', () => {
    it('returns no host hold when undo send is not opted in', () => {
        const createId = vi.fn(() => 'id-1');
        expect(createUndoSendRequest(createDefaultSettings(), createId)).toBeNull();
        expect(createId).not.toHaveBeenCalled();
    });

    it('creates a unique host hold request using the resolved window', () => {
        const settings = createDefaultSettings();
        settings.grace.undoSendEnabled = true;
        settings.grace.undoSendSeconds = 12;

        expect(createUndoSendRequest(settings, () => 'id-1')).toEqual({
            holdId: 'undo-send:id-1',
            undoSeconds: 12,
        });
    });

    it('caps hand-edited windows before they cross the host boundary', () => {
        const settings = createDefaultSettings();
        settings.grace.undoSendEnabled = true;
        settings.grace.undoSendSeconds = 600;

        expect(createUndoSendRequest(settings, () => 'id-1').undoSeconds).toBe(30);
    });
});

describe('createUndoSendController', () => {
    it('counts down and elapses without calling the cancel route', () => {
        let now = 10_000;
        let tick;
        const onTick = vi.fn();
        const onElapsed = vi.fn();
        const holdCancel = vi.fn();
        const controller = createUndoSendController({
            now: () => now,
            setTick: (fn) => {
                tick = fn;
                return 7;
            },
            clearTick: vi.fn(),
            onTick,
            onElapsed,
            onCancel: holdCancel,
        });

        controller.start(2);
        expect(onTick).toHaveBeenLastCalledWith(2);
        now += 1_000;
        tick();
        expect(onTick).toHaveBeenLastCalledWith(1);
        now += 1_000;
        tick();
        expect(controller.state()).toBe('elapsed');
        expect(onElapsed).toHaveBeenCalledOnce();
        expect(holdCancel).not.toHaveBeenCalled();
    });

    it('Cancel calls holdCancel once and prevents the held send from elapsing', () => {
        const holdCancel = vi.fn();
        const onElapsed = vi.fn();
        const clearTick = vi.fn();
        const controller = createUndoSendController({
            now: () => 10_000,
            setTick: vi.fn(() => 7),
            clearTick,
            onElapsed,
            onCancel: holdCancel,
        });

        controller.start(5);
        expect(controller.cancel()).toBe(true);
        expect(controller.cancel()).toBe(false);
        expect(controller.state()).toBe('cancelled');
        expect(holdCancel).toHaveBeenCalledOnce();
        expect(onElapsed).not.toHaveBeenCalled();
        expect(clearTick).toHaveBeenCalledWith(7);
    });
});

describe('isUndoSendCancellation', () => {
    it('recognizes only the host cancellation error', () => {
        expect(isUndoSendCancellation({ name: 'SendHoldCancelledError' })).toBe(true);
        expect(isUndoSendCancellation(new Error('send hold cancelled'))).toBe(false);
        expect(isUndoSendCancellation(null)).toBe(false);
    });
});
