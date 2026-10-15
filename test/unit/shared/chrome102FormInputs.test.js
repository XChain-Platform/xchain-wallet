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
const sourceFiles = execFileSync(
    'git',
    ['ls-files', 'packages/core/src/shared', 'packages/core/src/ui/FeeSelector.jsx'],
    { encoding: 'utf8' },
)
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

    it('classifies native integer, amount, and fee-rate keyboards', () => {
        // The Ads settings fields moved to the kit Input, which forwards the
        // same keyboard attributes, so that file's kit Inputs count as well.
        const ADS = 'packages/core/src/shared/components/settings/AdsSection.jsx';
        const classified = controls.filter(({ file, tag, attributes }) => (
            (tag === 'input' || (tag === 'Input' && file.endsWith(ADS)))
            && ['numeric', 'decimal'].includes(attributes.inputMode)
        ));
        const modesByFile = Object.groupBy(classified, ({ file }) => file);
        const inputModes = (file) => modesByFile[file]?.map(({ attributes }) => attributes.inputMode);

        // Both amount fields come from the one shared AmountField.
        expect(inputModes('packages/core/src/shared/components/settings/AdsSection.jsx'))
            .toEqual(['numeric']);
        expect(inputModes('packages/core/src/shared/components/settings/FeesSection.jsx'))
            .toEqual(['decimal']);
        expect(inputModes('packages/core/src/shared/components/settings/SafetySection.jsx'))
            .toEqual(['numeric']);
        expect(inputModes('packages/core/src/ui/FeeSelector.jsx'))
            .toEqual(['decimal', 'decimal']);

        expect(classified).toHaveLength(8);
        for (const { file, attributes } of classified) {
            expect(attributes.autoComplete, `${file}: autocomplete`).toBe('off');
            expect(['done', 'go'], `${file}: enterKeyHint`).toContain(attributes.enterKeyHint);
        }
    });

    it('blurs before Chromium applies the number-input wheel action', () => {
        const blur = vi.fn();
        blurNumberInputOnWheel({ currentTarget: { blur } });
        expect(blur).toHaveBeenCalledOnce();
    });
});
