// @vitest-environment node

import { describe, expect, it } from 'vitest';
import template from '../../../packages/core/src/templates/cross-chain/bridge-token-pair.json';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

describe('bridge token pair template', () => {
    it('is valid and issues on both chains before linking the pair', () => {
        expect(validateCrossChainTemplate(template)).toEqual({ ok: true });
        expect(template.id).toBe('bridge-token-pair');
        expect(template.actions.map(({ chainHint, action }) => [chainHint, action])).toEqual([
            ['primary', 'ISSUE'],
            ['secondary', 'ISSUE'],
            ['primary', 'LINK'],
        ]);
    });

    it('keeps both issue definitions compatible and links their action indices', () => {
        const [primaryIssue, secondaryIssue, link] = template.actions;

        expect(primaryIssue.params).toMatchObject({
            VERSION: '0',
            TICK: 'BRIDGEME',
            DECIMALS: '8',
            MINT_SUPPLY: '1000000',
        });
        expect(secondaryIssue.params).toMatchObject({
            VERSION: primaryIssue.params.VERSION,
            TICK: primaryIssue.params.TICK,
            DECIMALS: primaryIssue.params.DECIMALS,
            MINT_SUPPLY: primaryIssue.params.MINT_SUPPLY,
        });
        expect(link.params).toMatchObject({
            COIN1_ACTION_INDEX: '<ISSUE action_index from row 1>',
            COIN2_ACTION_INDEX: '<ISSUE action_index from row 2>',
        });
    });
});
