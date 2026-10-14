// @vitest-environment node

import { describe, expect, it } from 'vitest';
import template from '../../../packages/core/src/templates/cross-chain/cross-chain-airdrop.json';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

describe('cross-chain airdrop template', () => {
    it('is valid and defines one airdrop for every chain hint', () => {
        expect(validateCrossChainTemplate(template)).toEqual({ ok: true });
        expect(template.id).toBe('cross-chain-airdrop');
        expect(template.actions.map(({ chainHint }) => chainHint)).toEqual([
            'primary',
            'secondary',
            'tertiary',
        ]);
        expect(template.actions.every(({ action }) => action === 'AIRDROP')).toBe(true);
    });

    it('keeps shared token inputs while separating recipient-list references', () => {
        expect(template.actions.map(({ params }) => [
            params.VERSION,
            params.TICK,
            params.AMOUNT,
        ])).toEqual([
            ['0', 'MYTOKEN', '<amount per recipient>'],
            ['0', 'MYTOKEN', '<amount per recipient>'],
            ['0', 'MYTOKEN', '<amount per recipient>'],
        ]);
        expect(template.actions.map(({ params }) => params.LIST_ACTION_INDEX)).toEqual([
            '<LIST action_index for chain A recipients>',
            '<LIST action_index for chain B recipients>',
            '<LIST action_index for chain C recipients>',
        ]);
    });
});
