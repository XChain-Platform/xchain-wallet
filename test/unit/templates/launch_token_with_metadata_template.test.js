// @vitest-environment node

import { describe, expect, it } from 'vitest';
import template from '../../../packages/core/src/templates/cross-chain/launch-token-with-metadata.json';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

describe('launch token with metadata template', () => {
    it('is valid and sequences issuance, metadata storage, and linking', () => {
        expect(validateCrossChainTemplate(template)).toEqual({ ok: true });
        expect(template.id).toBe('launch-token-with-metadata');
        expect(template.actions.map(({ chainHint, action }) => [chainHint, action])).toEqual([
            ['primary', 'ISSUE'],
            ['secondary', 'FILE'],
            ['primary', 'LINK'],
        ]);
    });

    it('links the issue row to the metadata file row', () => {
        const [issue, file, link] = template.actions;

        expect(issue.params).toMatchObject({
            VERSION: '0',
            TICK: 'MYTOKEN',
            MINT_SUPPLY: '1000000',
        });
        expect(file.params).toMatchObject({
            VERSION: '0',
            NAME: 'MYTOKEN.json',
            TYPE: 'application/json',
        });
        expect(link.params).toMatchObject({
            COIN1_ACTION_INDEX: '<ISSUE action_index from row 1>',
            COIN2_ACTION_INDEX: '<FILE action_index from row 2>',
        });
    });
});
