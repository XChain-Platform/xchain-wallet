// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Crash hook helpers behind the diagnostic dump's recent_errors.

import { describe, it, expect } from 'vitest';
import {
    diagnosticDump,
    createErrorRingBuffer,
    installShellErrorCapture,
} from '../../../packages/core/src/flows/diagnosticDump.js';

function fakeTarget() {
    const handlers = {};
    return {
        handlers,
        addEventListener: (t, fn) => { handlers[t] = fn; },
        removeEventListener: (t) => { delete handlers[t]; },
    };
}

describe('installShellErrorCapture', () => {
    it('records error and unhandledrejection events', () => {
        const buffer = createErrorRingBuffer();
        const target = fakeTarget();
        installShellErrorCapture(target, buffer);
        target.handlers.error({ error: new TypeError('boom') });
        target.handlers.unhandledrejection({ reason: 'nope' });
        const list = buffer.list();
        expect(list.map((e) => e.kind)).toEqual(['TypeError', 'Error']);
        expect(list.map((e) => e.phase)).toEqual(['error', 'unhandledrejection']);
    });

    it('uninstalls and tolerates targets without listeners', () => {
        const buffer = createErrorRingBuffer();
        const target = fakeTarget();
        installShellErrorCapture(target, buffer)();
        expect(target.handlers).toEqual({});
        expect(installShellErrorCapture({}, buffer)).toBeTypeOf('function');
    });

    it('feeds recent_errors in the dump', async () => {
        const buffer = createErrorRingBuffer();
        buffer.record(new Error('x'));
        const dump = await diagnosticDump({ recentErrors: buffer.list() });
        expect(dump.recent_errors[0].message).toBe('x');
    });
});
