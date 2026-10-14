// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One RTL audit for every stylesheet the wallet ships: core, extension,
// desktop renderer and web. Physical inline-axis declarations are findings
// unless an exact file, selector, property and value entry below explains
// why the physical side is the intended one.

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSource = join(process.cwd(), 'packages', 'core', 'src');
const sourceRoots = [
    coreSource,
    join(process.cwd(), 'packages', 'extension', 'src'),
    join(process.cwd(), 'packages', 'desktop', 'renderer'),
    join(process.cwd(), 'packages', 'web', 'src'),
];
const shellSourceRoots = sourceRoots.slice(1);
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

// Safe-area insets name physical screen cutouts, LTR numbers scale from their
// LTR edge, and number inputs stay LTR in every locale.
const allowedPhysicalDeclarations = new Set([
    'packages/core/src/shared/components/AlertsOverlay.module.css|.overlay|padding|env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0)',
    'packages/core/src/shared/components/BottomTabBar.module.css|.sheet|padding|var(--xc-space-2) env(safe-area-inset-right, 0px) calc(var(--xc-space-3) + env(safe-area-inset-bottom, var(--xc-space-3))) env(safe-area-inset-left, 0px)',
    'packages/core/src/shared/components/GatedFileViewer.module.css|.overlay|padding|calc(var(--xc-space-4) + env(safe-area-inset-top, 0)) calc(var(--xc-space-4) + env(safe-area-inset-right, 0)) calc(var(--xc-space-4) + env(safe-area-inset-bottom, 0)) calc(var(--xc-space-4) + env(safe-area-inset-left, 0))',
    "packages/core/src/shared/components/LeftNav.module.css|.layout[data-xc-tier='compact'] > .main > .header|padding|env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px)",
    'packages/core/src/shared/components/NoticeModal.module.css|.overlay|padding|calc(var(--xc-page-top) + env(safe-area-inset-top, 0)) calc(var(--xc-space-4) + env(safe-area-inset-right, 0)) calc(var(--xc-page-top) + env(safe-area-inset-bottom, 0)) calc(var(--xc-space-4) + env(safe-area-inset-left, 0))',
    'packages/core/src/shared/components/OverlaySurface.module.css|.dialogOverlay|padding|calc(var(--xc-space-4) + env(safe-area-inset-top, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-right, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-bottom, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-left, 0px))',
    'packages/core/src/shared/routes/ContactsList.module.css|.modalOverlay|padding|calc(var(--xc-space-4) + env(safe-area-inset-top, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-right, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-bottom, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-left, 0px))',
    'packages/core/src/shared/routes/TokenDetail.module.css|.balanceHeroAmountFitInner|transform-origin|left center',
    'packages/core/src/ui/FeeSelector.module.css|.customInput|direction|ltr',
    "packages/core/src/ui/Input.module.css|.input:is([type='number'],[inputmode='decimal'],[inputmode='numeric'])|direction|ltr",
    "packages/core/src/ui/tokens.css|:where( input[type='number'],input[inputmode='numeric'],input[inputmode='decimal'] )|direction|ltr",
    'packages/core/src/ui/tokens.css|body|padding-left|env(safe-area-inset-left, 0)',
    'packages/core/src/ui/tokens.css|body|padding-right|env(safe-area-inset-right, 0)',
    'packages/web/src/style-guide/style-guide.css|.sg-example-wide|left|50%',
]);
const allowedPhysicalInlineStyles = new Set([
    'packages/web/src/DevVariantBadge.jsx|left|`${pos.x}px`',
    "packages/web/src/DevVariantBadge.jsx|right|'auto'",
]);

// Machine-readable values the RTL passes set LTR inside RTL prose. Each one
// must exist and must isolate itself from the surrounding text.
const ltrIslands = [
    'packages/core/src/shared/components/MnemonicGrid.module.css|.cell',
    'packages/core/src/shared/components/NetworkFilter.module.css|.itemTicker',
    'packages/core/src/shared/components/OriginIdentity.module.css|.registrableDomain,.hostEnding,.fullOrigin',
    'packages/core/src/shared/components/PsbtIntentPanel.module.css|.addr,.value,.totalsValue,.details code',
    'packages/core/src/shared/components/RawPsbtViewer.module.css|.hex,.json',
    'packages/core/src/shared/components/TotalBalanceHero.module.css|.amount',
    'packages/core/src/shared/components/WatcherResultPanel.module.css|.successMono',
    'packages/core/src/shared/components/WatcherResultPanel.module.css|.machineText',
    'packages/core/src/shared/components/settings/BackupSection.module.css|.mnemonicInput',
    'packages/core/src/shared/components/settings/BackupSection.module.css|.gapLimitInput',
    'packages/core/src/shared/components/settings/DeveloperModeSection.module.css|.descriptor',
    'packages/core/src/shared/components/settings/ThisWalletSection.module.css|.xpub',
    'packages/core/src/shared/routes/AddressList.module.css|.addrAmount,.addrFiat',
    'packages/core/src/shared/routes/ContactsList.module.css|.addressText',
    'packages/core/src/shared/routes/ContractScreens.module.css|.monospaceInput,.monospaceValue,.codeSource',
    'packages/core/src/shared/routes/DispenserDetail.module.css|.dispenseAmount,.dispensePaid,.remainingPill,.buyerAddressSelect',
    'packages/core/src/shared/routes/DispenserExplorer.module.css|.numericValue',
    'packages/core/src/shared/routes/History.module.css|.dateRow input,.paginationCount,.rowSourceAddress,.confirmationsPill,.copyableText,.pendingSegments,.pendingAmount',
    'packages/core/src/shared/routes/IssueTokenForm.module.css|.txid',
    'packages/core/src/shared/routes/Locked.module.css|.lockoutCountdown',
    'packages/core/src/shared/routes/ManageToken.module.css|.heroOwner',
    'packages/core/src/shared/routes/MySwapsView.module.css|.side',
    'packages/core/src/shared/routes/StakeDetail.module.css|.eventAmount',
    'packages/core/src/shared/routes/StakingList.module.css|.amount',
    'packages/core/src/shared/routes/TokenDetail.module.css|.balanceHeroAmount',
    'packages/core/src/shared/routes/ViewPrivateKey.module.css|.wif',
    'packages/core/src/ui/AddressText.module.css|.addr',
    'packages/web/src/style-guide/sections/AddressListSection.module.css|.abAddr',
    'packages/web/src/style-guide/sections/BalanceListSection.module.css|.amounts',
    'packages/web/src/style-guide/sections/TokenSelectorSection.module.css|.amounts',
];

// Build output repeats the sources with hashed class names, so only the
// authored trees are audited.
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules']);

function cssFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : cssFiles(path);
        return entry.name.endsWith('.css') ? [path] : [];
    });
}

function scriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : scriptFiles(path);
        return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

function repoPath(from) {
    return (from.startsWith(process.cwd()) ? relative(process.cwd(), from) : from).replaceAll('\\', '/');
}

function normalizedSelector(node) {
    const selector = node?.type === 'rule' ? node.selector : '';
    return selector
        .split(',')
        .map((part) => part.trim().replace(/\s+/g, ' '))
        .join(',');
}

function quadValues(values) {
    if (values.length === 1) return [values[0], values[0], values[0], values[0]];
    if (values.length === 2) return [values[0], values[1], values[0], values[1]];
    if (values.length === 3) return [values[0], values[1], values[2], values[1]];
    return values;
}

function isPhysical(property, value) {
    if (physicalProperties.has(property)) return true;
    if (property === 'text-align') return /^(?:left|right)$/.test(value);
    if (property === 'direction') return /^(?:ltr|rtl)$/.test(value);
    if (property === 'transform-origin') return /\b(?:left|right)\b/.test(value);
    if (/^(?:margin|padding|inset)$/.test(property)) {
        const values = postcss.list.space(value);
        return values.length === 4 && values[1] !== values[3];
    }
    if (property === 'border-radius') {
        return value.split('/').some((part) => {
            const corners = quadValues(postcss.list.space(part.trim()));
            return corners.length === 4
                && (corners[0] !== corners[1] || corners[3] !== corners[2]);
        });
    }
    return false;
}

function isIsolated(rule) {
    return Boolean(rule?.nodes?.some((node) => (
        node.type === 'decl'
        && node.prop === 'unicode-bidi'
        && /^(?:isolate|isolate-override|plaintext)$/.test(node.value.trim())
    )));
}

function physicalDeclarations(source, from = 'Fixture.module.css', allowlist = new Set()) {
    const file = repoPath(from);
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!isPhysical(property, value)) return;
        const selector = normalizedSelector(declaration.parent);
        // An isolated LTR island keeps numbers and addresses readable in RTL
        // prose without leaking its direction into the surrounding text.
        if (property === 'direction' && value === 'ltr' && isIsolated(declaration.parent)) return;
        const key = `${file}|${selector}|${property}|${value}`;
        if (allowlist.has(key)) return;
        findings.push({ file, selector, property, value, line: declaration.source.start.line });
    });
    return findings;
}

function physicalInlineStyles(source) {
    const findings = [];
    const property = [
        '(?:margin|padding|border)(?:Left|Right)',
        'border(?:Top|Bottom)(?:Left|Right)Radius',
        'left',
        'right',
        'textAlign',
    ].join('|');
    const pattern = new RegExp(`(?:^|[,{])\\s*(${property})\\s*:\\s*([^,\\n]+)`, 'g');
    for (const match of source.matchAll(pattern)) {
        if (match[1] === 'textAlign' && !/^["'](?:left|right)["']$/.test(match[2].trim())) continue;
        findings.push({ property: match[1], value: match[2].trim() });
    }
    return findings;
}

function ruleFor(file, selector) {
    let found = null;
    postcss.parse(readFileSync(join(process.cwd(), file), 'utf8'), { from: file }).walkRules((rule) => {
        if (!found && normalizedSelector(rule) === selector) found = rule;
    });
    return found;
}

describe('wallet CSS logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
            '.c { padding: 1px 2px 3px 4px; direction: ltr; }',
            '.d { margin: 0 1rem 0 2rem; border-radius: 1rem 0 0 1rem; }',
            '.e { transform-origin: right center; inset: 0 1px 0 2px; }',
            '.f { padding: 1px 2px; border-radius: 4px; text-align: start; }',
        ].join('\n');

        expect(physicalDeclarations(source).map(({ selector, property, value, line }) => (
            { selector, property, value, line }
        ))).toEqual([
            { selector: '.a', property: 'margin-left', value: '1rem', line: 1 },
            { selector: '.a', property: 'right', value: '0', line: 1 },
            { selector: '.b', property: 'text-align', value: 'right', line: 2 },
            { selector: '.b', property: 'border-top-left-radius', value: '2px', line: 2 },
            { selector: '.c', property: 'padding', value: '1px 2px 3px 4px', line: 3 },
            { selector: '.c', property: 'direction', value: 'ltr', line: 3 },
            { selector: '.d', property: 'margin', value: '0 1rem 0 2rem', line: 4 },
            { selector: '.d', property: 'border-radius', value: '1rem 0 0 1rem', line: 4 },
            { selector: '.e', property: 'transform-origin', value: 'right center', line: 5 },
            { selector: '.e', property: 'inset', value: '0 1px 0 2px', line: 5 },
        ]);
    });

    it('permits only exact selector-specific entries and isolated LTR islands', () => {
        const source = [
            '.machine { direction: ltr; }',
            '.prose { direction: ltr; }',
            '.island { direction: ltr; unicode-bidi: isolate; }',
        ].join('\n');
        const allowlist = new Set(['Fixture.module.css|.machine|direction|ltr']);

        expect(physicalDeclarations(source, 'Fixture.module.css', allowlist)).toEqual([
            { file: 'Fixture.module.css', selector: '.prose', property: 'direction', value: 'ltr', line: 2 },
        ]);
    });

    it('allows a safe-area shorthand only while every inset stays exact', () => {
        const file = join(coreSource, 'shared', 'components', 'AlertsOverlay.module.css');
        const source = readFileSync(file, 'utf8');

        expect(physicalDeclarations(source, file)).toHaveLength(1);
        expect(physicalDeclarations(source, file, allowedPhysicalDeclarations)).toEqual([]);
        expect(physicalDeclarations(
            source.replace('env(safe-area-inset-left, 0)', '1px'),
            file,
            allowedPhysicalDeclarations,
        )).toHaveLength(1);
    });

    it('uses logical inline-axis declarations throughout wallet CSS and shell inline styles', () => {
        const files = sourceRoots.flatMap(cssFiles);
        const allFindings = files.flatMap((file) => physicalDeclarations(readFileSync(file, 'utf8'), file));
        const keyFor = ({ file, selector, property, value }) => `${file}|${selector}|${property}|${value}`;
        const violations = allFindings.filter((finding) => !allowedPhysicalDeclarations.has(keyFor(finding)));
        const used = new Set(allFindings.map(keyFor).filter((key) => allowedPhysicalDeclarations.has(key)));

        const inlineKey = (finding) => `${finding.file}|${finding.property}|${finding.value}`;
        const inlineFindings = shellSourceRoots.flatMap(scriptFiles).flatMap((file) => (
            physicalInlineStyles(readFileSync(file, 'utf8')).map((finding) => ({
                file: repoPath(file),
                ...finding,
            }))
        ));
        const inlineViolations = inlineFindings.filter((finding) => (
            !allowedPhysicalInlineStyles.has(inlineKey(finding))
        ));
        const inlineUsed = new Set(inlineFindings.map(inlineKey)
            .filter((key) => allowedPhysicalInlineStyles.has(key)));

        expect(files.length).toBeGreaterThan(100);
        expect(violations).toEqual([]);
        expect([...allowedPhysicalDeclarations].filter((key) => !used.has(key))).toEqual([]);
        expect(inlineViolations).toEqual([]);
        expect([...allowedPhysicalInlineStyles].filter((key) => !inlineUsed.has(key))).toEqual([]);
    });

    it('keeps every audited LTR island present and isolated from surrounding RTL prose', () => {
        for (const key of ltrIslands) {
            const [file, selector] = key.split('|');
            const rule = ruleFor(file, selector);
            expect(rule, key).toBeTruthy();
            expect(rule.nodes.some((node) => (
                node.type === 'decl' && node.prop === 'direction' && node.value.trim() === 'ltr'
            )), key).toBe(true);
            expect(isIsolated(rule), key).toBe(true);
        }
    });

    it('mirrors directional chrome in shared components', () => {
        const component = (name) => readFileSync(join(coreSource, 'shared', 'components', name), 'utf8');

        expect(component('AlertsOverlay.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.panel\s*\{[^}]*--xc-slide-in-offset:\s*calc\(-1 \* var\(--xc-space-5\)\)/s,
        );
        expect(component('HeaderActionMenu.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.rowChevron\s*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
        expect(component('HeaderSettingsButton.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.summaryChevron\s*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
        expect(component('LearnNote.module.css')).toMatch(
            /:global\(\[dir='rtl'\]\)[^{]+\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
        expect(component('PlatformSwitcher.module.css')).toMatch(
            /:global\(\[dir='rtl'\]\) \.trigger svg,[^{]+\{[^}]*transform:\s*scaleX\(-1\)/s,
        );

        for (const name of [
            'ActionIntentSummary.module.css',
            'AmountField.module.css',
            'BalanceChanges.module.css',
            'BalanceList.module.css',
            'ConfirmActionModal.module.css',
            'ContactsPickerScreen.module.css',
            'DataTable.module.css',
            'DerivationPathCrossCheck.module.css',
        ]) {
            expect(component(name), name).toMatch(/direction:\s*ltr;/);
            expect(component(name), name).toMatch(/unicode-bidi:\s*isolate;/);
        }
    });

    it('mirrors route-owned directional visuals', () => {
        const route = (name, selector) => ruleFor(`packages/core/src/shared/routes/${name}.module.css`, selector);
        const value = (rule, property) => rule?.nodes.find((node) => node.type === 'decl' && node.prop === property)?.value;

        expect(value(route('MarketActivity', ":global([dir='rtl']) .marketSelectorChevron"), 'transform')).toBe('scaleX(-1)');
        expect(value(route('MySwapsView', ":global([dir='rtl']) .side + .side::before"), 'transform')).toBe('scaleX(-1)');
        expect(value(route('OnboardingCarousel', ":global([dir='rtl']) .frame"), '--xc-frame-enter-offset')).toBe('calc(-1 * var(--xc-space-4))');
    });

    it('mirrors shell affordances and isolates machine-readable values', () => {
        const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
        const assetCard = read('packages/web/src/style-guide/sections/AssetCardSection.module.css');
        const badge = read('packages/web/src/DevVariantBadge.module.css');
        const shell = read('packages/web/src/DevVariantShell.module.css');
        const approval = read('packages/extension/src/approval/kinds/SignApproval.jsx');

        expect(assetCard).toMatch(/\.chevron:dir\(rtl\)[^{]*\{[^}]*transform:\s*scaleX\(-1\)/s);
        expect(badge).toMatch(/\.badge:dir\(rtl\)[^{]*\{[^}]*safe-area-inset-right/s);
        expect(badge).toMatch(/\.picker:dir\(rtl\)[^{]*\{[^}]*background-position:\s*left/s);
        expect(shell).toMatch(/\.sidebarFrame:dir\(rtl\)[^{]*\{[^}]*box-shadow:\s*16px/s);
        expect(approval.match(/dir="ltr"/g)).toHaveLength(3);
    });
});
