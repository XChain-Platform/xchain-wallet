// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SECTIONS = path.join(ROOT, 'packages/web/src/style-guide/sections');
const GROUPS = [
    {
        shim: 'PickersAndShellSections.jsx',
        sections: ['PickerScreens', 'ListToolbar', 'UnavailableStates', 'ActivityRows', 'ShellNavigation', 'HomeTabs'],
    },
    {
        shim: 'ConfirmAndResultSections.jsx',
        sections: ['ActionConfirm', 'SignCredentials', 'ContractNotices', 'DraftAndExit', 'NativeFeeToggle', 'FeesCard'],
    },
];

const readSection = (file) => fs.readFileSync(path.join(SECTIONS, file), 'utf8');

describe('shell and confirm style-guide section split', () => {
    it.each(GROUPS)('$shim remains a re-export shim', ({ shim, sections }) => {
        const source = readSection(shim);
        expect(source).not.toContain('<Section');
        expect(source).not.toMatch(/export function/);
        for (const name of sections) {
            expect(source).toContain(`export { ${name}Section } from './${name}Section.jsx';`);
        }
    });

    it.each(GROUPS.flatMap(({ sections }) => sections))('%sSection has its own module', (name) => {
        const source = readSection(`${name}Section.jsx`);
        expect(source).toContain(`export function ${name}Section()`);
        expect(source).toContain('<Section');
    });
});
