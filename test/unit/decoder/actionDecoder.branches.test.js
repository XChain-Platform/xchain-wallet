// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

describe('decodeAction error and edge branches', () => {
    it('returns the malformed result when registry lookup throws', () => {
        const chainRegistry = {
            get() {
                throw new Error('registry unavailable');
            },
        };

        expect(decodeAction({ action: 'SEND', chainId: 'broken', chainRegistry })).toEqual({
            summary: 'Action data could not be decoded',
            details: [],
            warnings: [
                'The action data is malformed. Review the raw transaction carefully before approving.',
            ],
        });
    });

    it('renders a cyclic fallback parameter without failing the whole decode', () => {
        const cyclic = {};
        cyclic.self = cyclic;

        const decoded = decodeAction({ action: 'UNKNOWN_EDGE', params: { CYCLIC: cyclic } });

        expect(decoded.summary).toBe('Sign Unknown edge');
        expect(decoded.details).toEqual([{ label: 'Cyclic', value: '[object Object]' }]);
    });

    it('flags an invalid address fee preference that changes no option', () => {
        const decoded = decodeAction({
            action: 'ADDRESS',
            params: { VERSION: '0', FEE_PREFERENCE: '9' },
        });

        expect(decoded.summary).toBe('Set address options (no options changed)');
        expect(decoded.warnings).toEqual([
            'This action sets no address options. Every option field is blank.',
            'Fee preference must be 0, 1 or 2: the protocol will reject this transaction.',
        ]);
    });

    it('describes ownership exchange without amount warnings', () => {
        const decoded = decodeAction({
            action: 'ORDER',
            params: {
                GIVE_TICK: 'ALPHA',
                GIVE_OWNERSHIP: '1',
                GET_TICK: 'BETA',
                GET_OWNERSHIP: '1',
            },
        });

        expect(decoded.summary).toBe('Create order: give ownership of ALPHA for ownership of BETA');
        expect(decoded.warnings).toEqual([]);
    });

    it('states encrypted file visibility when no token gate is present', () => {
        const decoded = decodeAction({
            action: 'FILE',
            params: { NAME: 'backup.bin', ENCRYPTION_METHOD: 'AES-256-GCM' },
        });

        expect(decoded.warnings).toContain(
            'File is stored on the blockchain permanently. Its contents are encrypted.',
        );
        expect(decoded.warnings.join(' ')).not.toContain('Anyone can read');
    });

    it('uses singular batch wording for one valid command', () => {
        const decoded = decodeAction({
            action: 'BATCH',
            params: {
                COMMANDS: [{ action: 'COLLECT', params: {} }],
            },
            chainId: 'test-chain',
        });

        expect(decoded.summary).toBe(
            'Batch of 1 action on test-chain:\n1. Collect validator rewards on test-chain',
        );
        expect(decoded.details).toEqual([
            { label: 'Step 1', value: 'Collect validator rewards on test-chain' },
        ]);
    });
});
