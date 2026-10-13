// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSource = join(process.cwd(), 'packages', 'core', 'src');
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const physicalProperties = new Set([
    'margin-left',
    'margin-right',
    'padding-left',
    'padding-right',
    'left',
    'right',
    'border-left',
    'border-left-color',
    'border-left-style',
    'border-left-width',
    'border-right',
    'border-right-color',
    'border-right-style',
    'border-right-width',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
]);

const physicalDeclarationAllowlist = new Set([
    'packages/core/src/shared/components/OriginIdentity.module.css|.registrableDomain, .hostEnding, .fullOrigin|direction',
    'packages/core/src/shared/routes/AddressList.module.css|.addrAmount, .addrFiat|direction',
    'packages/core/src/shared/routes/ContactsList.module.css|.addressText|direction',
    'packages/core/src/shared/routes/ContactsList.module.css|.modalOverlay|padding',
    'packages/core/src/shared/routes/ContractScreens.module.css|.monospaceInput, .monospaceValue, .codeSource|direction',
    'packages/core/src/shared/routes/DispenserDetail.module.css|.dispenseAmount, .dispensePaid, .remainingPill, .buyerAddressSelect|direction',
    'packages/core/src/shared/routes/DispenserExplorer.module.css|.numericValue|direction',
    'packages/core/src/shared/routes/History.module.css|.dateRow input, .paginationCount, .rowSourceAddress, .confirmationsPill, .copyableText, .pendingSegments, .pendingAmount|direction',
    'packages/core/src/shared/routes/IssueTokenForm.module.css|.txid|direction',
    'packages/core/src/shared/routes/Locked.module.css|.lockoutCountdown|direction',
]);

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function normalized(value) {
    return value.trim().replace(/\s+/g, ' ');
}

function physicalDeclarations(source, from = 'Fixture.module.css', { checkShorthands = true } = {}) {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = normalized(declaration.value).toLowerCase();
        const selector = normalized(declaration.parent?.selector || '');
        const shorthandValues = postcss.list.space(value);
        const asymmetricInlineShorthand = checkShorthands
            && /^(?:margin|padding|inset)$/.test(property)
            && shorthandValues.length === 4
            && shorthandValues[1] !== shorthandValues[3];
        if (physicalProperties.has(property)
            || asymmetricInlineShorthand
            || (property === 'text-align' && /^(?:left|right)$/.test(value))
            || (property === 'direction' && /^(?:ltr|rtl)$/.test(value))) {
            findings.push({
                selector,
                property,
                value,
                line: declaration.source.start.line,
            });
        }
    });
    return findings;
}

describe('core CSS module logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
            '.c { padding: 1px 2px 3px 4px; direction: ltr; }',
        ].join('\n');

        expect(physicalDeclarations(source)).toEqual([
            { selector: '.a', property: 'margin-left', value: '1rem', line: 1 },
            { selector: '.a', property: 'right', value: '0', line: 1 },
            { selector: '.b', property: 'text-align', value: 'right', line: 2 },
            { selector: '.b', property: 'border-top-left-radius', value: '2px', line: 2 },
            { selector: '.c', property: 'padding', value: '1px 2px 3px 4px', line: 3 },
            { selector: '.c', property: 'direction', value: 'ltr', line: 3 },
        ]);
    });

    it('uses logical inline-axis declarations throughout core CSS modules', () => {
        const modules = cssModules(coreSource);
        const findings = modules.flatMap((file) => (
            physicalDeclarations(readFileSync(file, 'utf8'), file, {
                checkShorthands: /\/routes\/[A-L][^/]*\.module\.css$/.test(file),
            }).map((finding) => ({
                file: relative(process.cwd(), file).replaceAll('\\', '/'),
                ...finding,
            }))
        ));
        const keyFor = ({ file, selector, property }) => `${file}|${selector}|${property}`;
        const allowlisted = findings.filter((finding) => (
            physicalDeclarationAllowlist.has(keyFor(finding))
        ));
        const unexpected = findings.filter((finding) => (
            !physicalDeclarationAllowlist.has(keyFor(finding))
        ));
        const usedAllowlist = new Set(allowlisted.map(keyFor));
        const unusedAllowlist = [...physicalDeclarationAllowlist].filter((key) => !usedAllowlist.has(key));

        expect(modules.length).toBeGreaterThan(0);
        expect(unusedAllowlist).toEqual([]);
        expect(unexpected).toEqual([]);
    });
});
