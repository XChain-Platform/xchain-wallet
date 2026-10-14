// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const indexPath = '../../../packages/core/src/templates/cross-chain/index.js';
const validatePath = '../../../packages/core/src/templates/cross-chain/validate.js';
const launchTemplatePath = '../../../packages/core/src/templates/cross-chain/launch-token-with-metadata.json';

afterEach(() => {
    vi.doUnmock(validatePath);
    vi.doUnmock(launchTemplatePath);
    vi.resetModules();
});

describe('cross-chain template registry', () => {
    it('exports the validated templates in a frozen stable order', async () => {
        const { CROSS_CHAIN_TEMPLATES, validateCrossChainTemplate } = await import(indexPath);

        expect(CROSS_CHAIN_TEMPLATES.map(({ id }) => id)).toEqual([
            'launch-token-with-metadata',
            'bridge-token-pair',
            'cross-chain-airdrop',
        ]);
        expect(Object.isFrozen(CROSS_CHAIN_TEMPLATES)).toBe(true);
        expect(CROSS_CHAIN_TEMPLATES.every((template) => validateCrossChainTemplate(template).ok))
            .toBe(true);
        expect(() => CROSS_CHAIN_TEMPLATES.push({})).toThrow(TypeError);
    });

    it('fails fast with the template id and all validation errors', async () => {
        vi.doMock(validatePath, () => ({
            validateCrossChainTemplate: () => ({
                ok: false,
                errors: ['first problem', 'second problem'],
            }),
        }));

        await expect(import(indexPath)).rejects.toThrow(
            'cross-chain templates: invalid template "launch-token-with-metadata": first problem; second problem',
        );
    });

    it('labels a malformed template without an id as unknown', async () => {
        vi.doMock(launchTemplatePath, () => ({ default: null }));

        await expect(import(indexPath)).rejects.toThrow(
            'cross-chain templates: invalid template "(unknown)": template must be an object',
        );
    });
});
