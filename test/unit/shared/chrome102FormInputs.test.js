// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { blurNumberInputOnWheel } from '../../../packages/core/src/shared/utils/formInput.js';

const traverse = _traverse.default || _traverse;
const sourceFiles = execFileSync('git', ['ls-files', 'packages/core/src/shared'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.jsx'));

function controlsIn(source) {
    const controls = [];
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
        JSXOpeningElement(path) {
            if (path.node.name.type !== 'JSXIdentifier') return;
            if (!['input', 'Input', 'textarea', 'Textarea'].includes(path.node.name.name)) return;
            const attributes = Object.fromEntries(path.node.attributes
                .filter((attribute) => attribute.type === 'JSXAttribute')
                .map((attribute) => [
                    attribute.name.name,
                    attribute.value?.type === 'StringLiteral'
                        ? attribute.value.value
                        : attribute.value?.expression?.name || true,
                ]));
            controls.push({ tag: path.node.name.name, attributes });
        },
    });
    return controls;
}

const controls = sourceFiles.flatMap((file) => (
    controlsIn(readFileSync(file, 'utf8')).map((control) => ({ file, ...control }))
));

describe('Chrome 102 shared form inputs', () => {
    it('uses supported soft-keyboard and return-key hints', () => {
        const inputModes = new Set(['none', 'text', 'decimal', 'numeric', 'tel', 'search', 'email', 'url']);
        const enterKeyHints = new Set(['enter', 'done', 'go', 'next', 'previous', 'search', 'send']);

        for (const { file, attributes } of controls) {
            if (typeof attributes.inputMode === 'string') {
                expect(inputModes.has(attributes.inputMode), `${file}: inputMode`).toBe(true);
            }
            if (typeof attributes.enterKeyHint === 'string') {
                expect(enterKeyHints.has(attributes.enterKeyHint), `${file}: enterKeyHint`).toBe(true);
            }
        }
    });

    it('guards every number input from wheel changes and classifies autocomplete', () => {
        const numberInputs = controls.filter(({ attributes }) => attributes.type === 'number');

        expect(numberInputs).toHaveLength(7);
        for (const { file, attributes } of numberInputs) {
            expect(attributes.onWheel, `${file}: wheel guard`).toBe('blurNumberInputOnWheel');
            expect(attributes.autoComplete, `${file}: autocomplete`).toBe('off');
            expect(['numeric', 'decimal'], `${file}: inputMode`).toContain(attributes.inputMode);
            expect(['done', 'go', 'next'], `${file}: enterKeyHint`).toContain(attributes.enterKeyHint);
        }
    });

    it('blurs before Chromium applies the number-input wheel action', () => {
        const blur = vi.fn();
        blurNumberInputOnWheel({ currentTarget: { blur } });
        expect(blur).toHaveBeenCalledOnce();
    });
});
