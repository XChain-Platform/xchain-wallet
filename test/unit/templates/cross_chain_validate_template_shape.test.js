// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

const validTemplate = {
    id: 'valid-template',
    name: 'Valid template',
    description: 'A valid template',
    actions: [{ chainHint: 'primary', action: 'SEND', params: {} }],
};

describe('cross-chain template top-level validation', () => {
    it.each([undefined, null, false, 0, '', [], ['template']])(
        'rejects a non-object template: %j',
        (template) => {
            expect(validateCrossChainTemplate(template)).toEqual({
                ok: false,
                errors: ['template must be an object'],
            });
        },
    );

    it('reports every missing required top-level field', () => {
        expect(validateCrossChainTemplate({})).toEqual({
            ok: false,
            errors: [
                'id must be a non-empty string',
                'name must be a non-empty string',
                'description must be a non-empty string',
                'actions must be a non-empty array',
            ],
        });
    });

    it.each([
        ['id', '   ', 'id must be a non-empty string'],
        ['name', 17, 'name must be a non-empty string'],
        ['description', null, 'description must be a non-empty string'],
    ])('rejects an invalid %s while preserving other valid fields', (field, value, error) => {
        const result = validateCrossChainTemplate({ ...validTemplate, [field]: value });

        expect(result).toEqual({ ok: false, errors: [error] });
    });

    it('allows personas to be omitted or an empty array', () => {
        expect(validateCrossChainTemplate(validTemplate)).toEqual({ ok: true });
        expect(validateCrossChainTemplate({ ...validTemplate, personas: [] })).toEqual({ ok: true });
    });

    it('rejects a non-array personas value', () => {
        expect(validateCrossChainTemplate({ ...validTemplate, personas: 'Jin' })).toEqual({
            ok: false,
            errors: ['personas must be an array'],
        });
    });

    it('reports each empty or non-string persona by index', () => {
        expect(validateCrossChainTemplate({
            ...validTemplate,
            personas: ['Jin', '', '   ', 7, null],
        })).toEqual({
            ok: false,
            errors: [
                'personas[1]: must be a non-empty string',
                'personas[2]: must be a non-empty string',
                'personas[3]: must be a non-empty string',
                'personas[4]: must be a non-empty string',
            ],
        });
    });

    it.each([undefined, null, false, {}, 'SEND', []])(
        'requires a non-empty actions array: %j',
        (actions) => {
            expect(validateCrossChainTemplate({ ...validTemplate, actions })).toEqual({
                ok: false,
                errors: ['actions must be a non-empty array'],
            });
        },
    );
});
