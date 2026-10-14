// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

function templateWith(actions) {
    return {
        id: 'action-validation',
        name: 'Action validation',
        description: 'Exercises action row validation',
        actions,
    };
}

describe('cross-chain template action validation', () => {
    it('reports malformed rows and continues validating later rows', () => {
        const result = validateCrossChainTemplate(templateWith([
            null,
            'SEND',
            [],
            { chainHint: 'primary', action: '', params: {} },
        ]));

        expect(result).toEqual({
            ok: false,
            errors: [
                'actions[0]: must be an object',
                'actions[1]: must be an object',
                'actions[2]: must be an object',
                'actions[3].action: must be a non-empty string',
            ],
        });
    });

    it.each(['', 'PRIMARY', 'unknown', null, 1])(
        'rejects an unsupported chain hint: %j',
        (chainHint) => {
            const result = validateCrossChainTemplate(templateWith([
                { chainHint, action: 'SEND', params: {} },
            ]));

            expect(result).toEqual({
                ok: false,
                errors: [
                    "actions[0].chainHint: must be 'primary' | 'secondary' | 'tertiary'",
                ],
            });
        },
    );

    it.each(['primary', 'secondary', 'tertiary'])(
        'accepts the %s chain hint',
        (chainHint) => {
            expect(validateCrossChainTemplate(templateWith([
                { chainHint, action: 'SEND', params: {}, note: '' },
            ]))).toEqual({ ok: true });
        },
    );

    it.each([undefined, null, '', 'params', [], 7])(
        'rejects a non-object params value: %j',
        (params) => {
            const result = validateCrossChainTemplate(templateWith([
                { chainHint: 'primary', action: 'SEND', params },
            ]));

            expect(result).toEqual({
                ok: false,
                errors: ['actions[0].params: must be an object'],
            });
        },
    );

    it('reports invalid param keys, values, action, and note together', () => {
        const result = validateCrossChainTemplate(templateWith([{
            chainHint: 'other',
            action: '  ',
            params: { '': 7, VERSION: 0, MEMO: null },
            note: false,
        }]));

        expect(result).toEqual({
            ok: false,
            errors: [
                "actions[0].chainHint: must be 'primary' | 'secondary' | 'tertiary'",
                'actions[0].action: must be a non-empty string',
                'actions[0].params: keys must be non-empty strings',
                'actions[0].params.: must be a string',
                'actions[0].params.VERSION: must be a string',
                'actions[0].params.MEMO: must be a string',
                'actions[0].note: must be a string',
            ],
        });
    });

    it('accepts string params and an omitted note', () => {
        expect(validateCrossChainTemplate(templateWith([{
            chainHint: 'primary',
            action: 'SEND',
            params: { VERSION: '', MEMO: '   ' },
        }]))).toEqual({ ok: true });
    });
});
