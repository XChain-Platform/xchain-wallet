// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DOCUMENTED_PRIMITIVES,
    SECTIONS,
} from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';

const root = path.resolve(import.meta.dirname, '../../..');
const uiIndexPath = path.join(root, 'packages/core/src/ui/index.js');
const sectionRoot = path.join(root, 'packages/web/src/style-guide/sections');

function sectionSource(file, component) {
    const source = fs.readFileSync(path.join(sectionRoot, file), 'utf8');
    const start = source.indexOf(`export function ${component}()`);
    const next = source.indexOf('\nexport function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

function namedComponentExports(source) {
    const named = [...source.matchAll(
        /export\s+\{\s*([A-Z][A-Za-z0-9]*)\s*\}\s+from/g,
    )].map((match) => match[1]);
    const namespaces = [...source.matchAll(
        /export\s+\*\s+as\s+([A-Z][A-Za-z0-9]*)\s+from/g,
    )].map((match) => match[1]);
    return [...named, ...namespaces].sort();
}

describe('style guide primitive coverage', () => {
    it('tracks every component exported by the core UI barrel', () => {
        const uiIndex = fs.readFileSync(uiIndexPath, 'utf8');

        expect([...DOCUMENTED_PRIMITIVES].sort()).toEqual(namedComponentExports(uiIndex));
        expect(new Set(SECTIONS.map(({ id }) => id)).size).toBe(SECTIONS.length);
    });

    it('gives every newly audited primitive guidance, JSX, and a live example', () => {
        const files = [
            'ChoicePrimitivesSection.jsx',
            'DisplayPrimitivesSection.jsx',
            'QrPrimitivesSection.jsx',
        ].map((file) => fs.readFileSync(
            path.join(root, 'packages/web/src/style-guide/sections', file),
            'utf8',
        )).join('\n');
        const primitives = [
            'IconSelect',
            'AddressCombobox',
            'ChainBadge',
            'AddressText',
            'CopyButton',
            'MultisigBadge',
            'VerifiedBadge',
            'InfoTip',
            'AnimatedQrFrames',
            'QrScanner',
        ];

        for (const primitive of primitives) {
            const start = files.indexOf(`export function ${primitive}Section()`);
            const next = files.indexOf('\nexport function ', start + 1);
            const section = files.slice(start, next === -1 ? files.length : next);
            expect(start, `${primitive} has a section`).toBeGreaterThanOrEqual(0);
            expect(section, `${primitive} has guidance`).toContain('<Guidance');
            expect(section, `${primitive} has canonical JSX`).toContain('<Markup>');
            expect(section, `${primitive} has a live example`).toContain('<LiveExample');
        }
    });

    it('renders finite visual variants instead of only naming them in guidance', () => {
        const fieldSizes = sectionSource('FieldSizesSection.jsx', 'FieldSizesSection');
        expect(fieldSizes).toMatch(
            /<LiveExample label="Same contract on Textarea">[\s\S]*?<Textarea[\s\S]*?label="Message \(lg, hero\)"[\s\S]*?size="lg"/,
        );

        const choices = sectionSource('ChoicePrimitivesSection.jsx', 'AddressComboboxSection');
        expect(choices).toContain('<AddressComboboxExample size="lg" />');

        const display = fs.readFileSync(
            path.join(sectionRoot, 'DisplayPrimitivesSection.jsx'),
            'utf8',
        );
        expect(display).toContain('showName={false}');
        expect(display).toContain('showNetworkKind={false}');
        expect(display).toContain('scheme="p2sh-multisig" size="sm"');
        expect(display).toContain('status="pending" size="md"');
        expect(display).toContain('placement="bottom"');

        const network = sectionSource('NetworkFieldSection.jsx', 'NetworkFieldSection');
        expect(network).toMatch(
            /<LiveExample label="Hero size for a focused transaction screen\.">[\s\S]*?<NetworkField[\s\S]*?size="lg"/,
        );

        const chainPicker = sectionSource('ChainPickerSection.jsx', 'ChainPickerSection');
        expect(chainPicker).toMatch(
            /<LiveExample label="Scoped context:[^>]+>[\s\S]*?<ChainPicker[\s\S]*?hideNetworkKind/,
        );

        const states = sectionSource('StatesSection.jsx', 'StatesSection');
        for (const shape of ['row', 'text', 'title', 'avatar', 'badge', 'card', 'tile']) {
            expect(states, `Skeleton ${shape} shape`).toContain(`shape="${shape}"`);
        }
        expect(states).toContain('<Skeleton.Row />');
        expect(states).toContain('<Skeleton.List');
        expect(states).toContain('details="available=');
        expect(states).toContain("recovery={{ label: 'Use Max'");
    });

    it('uses shipped composed components instead of local visual replicas', () => {
        const section = (file) => fs.readFileSync(path.join(sectionRoot, file), 'utf8');
        const balanceList = section('BalanceListSection.jsx');
        const contacts = section('AddressListSection.jsx');
        const tokenPicker = section('TokenSelectorSection.jsx');
        const hero = section('AccentBorderedCardSection.jsx');
        const privacy = section('PrivacyModeSection.jsx');
        const appHeader = section('AppHeaderSection.jsx');

        expect(balanceList).toContain("import { BalanceList } from '@xchain-wallet/core/shared/components/BalanceList.jsx'");
        expect(balanceList).not.toContain('function Row(');
        expect(contacts).toContain("import { ContactsPickerScreen } from '@xchain-wallet/core/shared/components/ContactsPickerScreen.jsx'");
        expect(contacts).not.toContain('<NetworkFilterDropdown');
        expect(tokenPicker).toContain("import { TokenPicker } from '@xchain-wallet/core/shared/routes/TokenPicker.jsx'");
        expect(tokenPicker).not.toContain('function Row(');
        expect(hero).toContain("import { TotalBalanceHero } from '@xchain-wallet/core/shared/components/TotalBalanceHero.jsx'");
        expect(privacy).toContain('<TotalBalanceHero');
        expect(privacy).toContain('<BalanceList');
        expect(privacy).not.toContain('settings.balancesHidden');
        expect(appHeader).not.toContain('tokenQuery');
        expect(appHeader).not.toContain('onTokenQueryChange');
    });
});
