// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G112: a field's icon sits with equal space above, below and to its side,
// exactly as on the Network field. The geometry lives once in tokens.css as
// (control height - icon box) / 2 per size; every field that draws an icon at
// its edge takes its inset from those tokens, never a hard-coded offset.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { FromSection } from '../../../packages/core/src/shared/components/formStandard/index.js';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';
import chainPickerStyles from '../../../packages/core/src/ui/ChainPicker.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

const root = process.cwd();
const read = (rel) => readFileSync(join(root, 'packages/core/src', rel), 'utf8');

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|[}/\\s])${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!match) throw new Error(`no rule for ${selector}`);
    return match[1];
}

/** The value a rule body gives one property, or null. */
function decl(body, property) {
    const match = body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`));
    return match ? match[1].trim() : null;
}

const SIZES = ['sm', 'md', 'lg'];

describe('G112 field icon tokens', () => {
    const tokens = read('ui/tokens.css');

    it('derives every inset from the control height and the icon box, per size', () => {
        for (const size of SIZES) {
            expect(tokens).toContain(
                `--xc-field-icon-inset-${size}: calc((var(--xc-control-h-${size}) - var(--xc-control-icon-${size})) / 2);`,
            );
            expect(tokens).toContain(
                `--xc-field-glyph-inset-${size}: calc((var(--xc-control-h-${size}) - var(--xc-icon-md)) / 2);`,
            );
            expect(tokens).toContain(
                `--xc-field-action-inset-${size}: calc((var(--xc-control-h-${size}) - var(--xc-tap-min)) / 2);`,
            );
        }
        expect(tokens).toContain('--xc-field-border: 1px;');
        expect(tokens).toContain('--xc-field-icon-gap: var(--xc-space-2);');
    });

    it('re-derives the insets wherever a block sets its own control height', () => {
        // The tokens resolve on :root, so a block that sets its own
        // --xc-control-h-<size> must re-declare that size's three insets,
        // or a field inside it centres its icon for the root height.
        const srcRoot = join(root, 'packages/core/src');
        const blocks = [];
        const missing = [];
        for (const file of moduleFiles(srcRoot)) {
            const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                for (const size of SIZES) {
                    if (!decl(rule[2], `--xc-control-h-${size}`)) continue;
                    const where = `${relative(srcRoot, file)} ${rule[1].trim()}`;
                    blocks.push(where);
                    const want = {
                        [`--xc-field-icon-inset-${size}`]: `calc((var(--xc-control-h-${size}) - var(--xc-control-icon-${size})) / 2)`,
                        [`--xc-field-glyph-inset-${size}`]: `calc((var(--xc-control-h-${size}) - var(--xc-icon-md)) / 2)`,
                        [`--xc-field-action-inset-${size}`]: `calc((var(--xc-control-h-${size}) - var(--xc-tap-min)) / 2)`,
                    };
                    for (const [name, value] of Object.entries(want)) {
                        if (decl(rule[2], name) !== value) missing.push(`${where} ${name}`);
                    }
                }
            }
        }
        expect(blocks.length).toBeGreaterThanOrEqual(4);
        expect(missing).toEqual([]);
    });
});

// Each field that draws an icon at its edge: the module, the rule that places
// the icon, the property that does it, and the value it must take.
const SLOTS = [
    {
        name: 'Network field (NetworkField, NetworkFilter field look)',
        file: 'ui/ChainPicker.module.css',
        selector: '.wrap .trigger.leadIcon',
        property: 'padding-inline-start',
        value: 'calc(var(--chain-picker-icon-inset) - var(--xc-field-border))',
        local: { name: '--chain-picker-icon-inset', token: 'icon' },
    },
    {
        name: 'Network field caret',
        file: 'ui/ChainPicker.module.css',
        selector: '.wrap .trigger',
        property: 'padding-inline',
        value: 'var(--chain-picker-padding-x) calc(var(--chain-picker-glyph-inset) - var(--xc-field-border))',
        local: { name: '--chain-picker-glyph-inset', token: 'glyph' },
    },
    {
        name: 'IconSelect and Select with option icons',
        file: 'ui/IconSelect.module.css',
        selector: '.wrap .trigger.leadIcon',
        property: 'padding-inline-start',
        value: 'calc(var(--icon-select-icon-inset) - var(--xc-field-border))',
        local: { name: '--icon-select-icon-inset', token: 'icon' },
    },
    {
        name: 'IconSelect chevron',
        file: 'ui/IconSelect.module.css',
        selector: '.wrap .trigger',
        property: 'padding-inline',
        value: 'var(--xc-control-padding-x) calc(var(--icon-select-glyph-inset) - var(--xc-field-border))',
        local: { name: '--icon-select-glyph-inset', token: 'glyph' },
    },
    {
        name: 'Token field',
        file: 'shared/components/TokenField.module.css',
        selector: '.control.leadIcon',
        property: 'padding-inline-start',
        value: 'calc(var(--token-field-icon-inset) - var(--xc-field-border))',
        local: { name: '--token-field-icon-inset', token: 'icon', sizes: { '.field': 'md', '.lg': 'lg' } },
    },
    {
        name: 'Token field caret',
        file: 'shared/components/TokenField.module.css',
        selector: '.control',
        property: 'padding-inline-end',
        value: 'calc(var(--token-field-glyph-inset) - var(--xc-field-border))',
        local: { name: '--token-field-glyph-inset', token: 'glyph', sizes: { '.field': 'md', '.lg': 'lg' } },
    },
    {
        name: 'Target field leading glyph',
        file: 'shared/components/TargetField.module.css',
        selector: '.control',
        property: 'padding-inline-start',
        value: 'calc(var(--xc-field-glyph-inset-md) - var(--xc-field-border))',
    },
    {
        name: 'Target field list button',
        file: 'shared/components/TargetField.module.css',
        selector: '.control',
        property: 'padding-inline-end',
        value: 'calc(var(--xc-field-action-inset-md) - var(--xc-field-border))',
    },
    {
        name: 'Input field actions (the From and To address icons, Max, show and hide)',
        file: 'ui/Input.module.css',
        selector: '.controlActions',
        property: 'inset-inline-end',
        value: 'var(--xc-control-action-inset)',
        local: { name: '--xc-control-action-inset', token: 'action' },
    },
    {
        name: 'Textarea field action (memo, scan and paste icons)',
        file: 'ui/Input.module.css',
        selector: '.textareaFieldAction',
        property: 'inset-inline-end',
        value: 'var(--xc-control-action-inset)',
    },
    {
        name: 'Textarea field action, top',
        file: 'ui/Input.module.css',
        selector: '.textareaFieldAction',
        property: 'inset-block-start',
        value: 'var(--xc-control-action-inset)',
    },
    {
        name: 'List search field',
        file: 'shared/components/ListSearchField.module.css',
        selector: '.searchIcon',
        property: 'inset-inline-start',
        value: 'var(--xc-field-icon-inset-md)',
    },
    {
        name: 'Home filter search field',
        file: 'shared/components/HomeFilterBar.module.css',
        selector: '.searchIcon',
        property: 'inset-inline-start',
        value: 'var(--xc-field-icon-inset-md)',
    },
    {
        name: 'Command palette search field',
        file: 'shared/commandPalette/CommandPalette.module.css',
        selector: '.searchIcon',
        property: 'inset-inline-start',
        value: 'var(--xc-field-glyph-inset-md)',
    },
];

describe('G112 every field icon takes its inset from the shared tokens', () => {
    for (const slot of SLOTS) {
        it(slot.name, () => {
            const css = read(slot.file);
            const body = ruleBody(css, slot.selector);
            expect(decl(body, slot.property)).toBe(slot.value);
            // The local alias, where a module has one, maps each size to its token.
            if (slot.local) {
                const sizes = slot.local.sizes || Object.fromEntries(SIZES.map((size) => [`.${size}`, size]));
                for (const [selector, size] of Object.entries(sizes)) {
                    const sized = ruleBody(css, selector);
                    expect(decl(sized, slot.local.name)).toBe(`var(--xc-field-${slot.local.token}-inset-${size})`);
                }
            }
        });
    }

    it('leaves no hard-coded pixel inset on a field icon', () => {
        const offenders = [];
        for (const slot of SLOTS) {
            const body = ruleBody(read(slot.file), slot.selector);
            for (const prop of ['inset-inline-start', 'inset-inline-end', 'padding-inline-start', 'padding-inline-end', 'left', 'right']) {
                const value = decl(body, prop);
                if (value && /\b\d+(\.\d+)?px\b/.test(value)) offenders.push(`${slot.file} ${slot.selector} ${prop}: ${value}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the text one icon gap after the icon, as on the Network field', () => {
        expect(decl(ruleBody(read('ui/ChainPicker.module.css'), '.trigger'), 'gap')).toBe('var(--xc-field-icon-gap)');
        expect(decl(ruleBody(read('ui/IconSelect.module.css'), '.trigger'), 'gap')).toBe('var(--xc-field-icon-gap)');
        expect(decl(ruleBody(read('shared/components/TokenField.module.css'), '.control'), 'gap')).toBe('var(--xc-field-icon-gap)');
        expect(decl(ruleBody(read('shared/components/TargetField.module.css'), '.control'), 'gap')).toBe('var(--xc-field-icon-gap)');
        // The search text starts where a Select option label starts: the icon
        // slot (inset plus the control icon box), one gap, less the border.
        const searchPad = 'calc(var(--xc-field-icon-inset-md) + var(--xc-control-icon-md) + var(--xc-field-icon-gap) - var(--xc-field-border))';
        expect(decl(ruleBody(read('shared/components/ListSearchField.module.css'), '.searchWrap input.search'), 'padding-inline-start')).toBe(searchPad);
        expect(decl(ruleBody(read('shared/components/HomeFilterBar.module.css'), '.searchWrap input.search'), 'padding-inline-start')).toBe(searchPad);
    });

    it('reserves the action slot in the From address read-only overlay', () => {
        const css = read('ui/AddressField.module.css');
        expect(decl(ruleBody(css, '.wrap'), '--address-field-action-room'))
            .toBe('calc(var(--address-action-inset) + var(--xc-tap-min) + var(--xc-space-1))');
        for (const size of SIZES) {
            expect(decl(ruleBody(css, `.${size}`), '--address-action-inset')).toBe(`var(--xc-field-action-inset-${size})`);
        }
    });
});

// Every rule in any CSS module that places an icon slot inside a field,
// leading or trailing, must take its side offset from the shared G112 tokens
// (directly, through --xc-control-action-inset, or through a local alias that
// resolves to a --xc-field-* token). A new field that sets its own offset
// (10px, var(--xc-space-1), ...) fails here.
const SLOT_SELECTOR = /(searchIcon|searchSubmit|searchClear|controlActions|textareaFieldAction|fieldAction|triggerIcon|triggerCaret|leadIcon|trailIcon|fieldIcon|inputIcon|adorn|startIcon|endIcon|prefixIcon|suffixIcon)/i;
const OFFSET_PROPS = /^(inset|inset-inline|inset-inline-start|inset-inline-end|left|right|padding-inline|padding-inline-start|padding-inline-end|padding-left|padding-right|margin-inline|margin-inline-start|margin-inline-end|margin-left|margin-right)$/;
// Fields that keep their own geometry, with the reason. Each must still be
// equal on every side by construction.
const SCAN_EXCEPTIONS = new Map([
    // The dispenser explorer's hero search is its own 48px box with 40px
    // buttons centred 4px in from each side, so each icon is 15px from the
    // top, the bottom and its side; it is not on the control height scale.
    ['shared/routes/DispenserExplorer.module.css|.searchSubmit|inset-inline-start', '4px'],
    ['shared/routes/DispenserExplorer.module.css|.searchClear|inset-inline-end', '4px'],
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite']);

function moduleFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : moduleFiles(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

/** Every package's own source tree, core and the shells alike. */
function packageSourceRoots() {
    const packagesRoot = join(root, 'packages');
    return readdirSync(packagesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(packagesRoot, entry.name, 'src'))
        .filter((dir) => { try { return readdirSync(dir).length >= 0; } catch { return false; } });
}

/** Local custom properties that resolve, at any depth, to a G112 token. */
function tokenAliases(css) {
    const defs = [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]]);
    const aliases = new Set(['--xc-control-action-inset']);
    let grew = true;
    while (grew) {
        grew = false;
        for (const [name, value] of defs) {
            if (aliases.has(name)) continue;
            if (/var\(--xc-field-/.test(value) || [...aliases].some((a) => value.includes(`var(${a})`))) {
                aliases.add(name);
                grew = true;
            }
        }
    }
    return aliases;
}

describe('G112 scan: no field sets its own icon offset', () => {
    it('places every leading and trailing field icon slot from the shared tokens', () => {
        // Paths read relative to core's src (another package's file shows as
        // ../../<package>/src/...).
        const srcRoot = join(root, 'packages/core/src');
        const offenders = [];
        let slotsSeen = 0;
        for (const file of packageSourceRoots().flatMap(moduleFiles)) {
            const rel = relative(srcRoot, file).replaceAll('\\', '/');
            const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            const aliases = tokenAliases(css);
            for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                const selector = rule[1].trim().replace(/\s+/g, ' ');
                // Hit-area pseudo elements grow a target; they do not place an icon.
                if (!SLOT_SELECTOR.test(selector) || /::?(before|after)\b/.test(selector)) continue;
                slotsSeen += 1;
                for (const declaration of rule[2].split(';')) {
                    const colon = declaration.indexOf(':');
                    if (colon < 0) continue;
                    const property = declaration.slice(0, colon).trim();
                    const value = declaration.slice(colon + 1).trim();
                    if (!OFFSET_PROPS.test(property)) continue;
                    if (/^(0|0px|auto)$/.test(value)) continue;
                    if (/var\(--xc-field-/.test(value) || [...aliases].some((a) => value.includes(`var(${a})`))) continue;
                    if (SCAN_EXCEPTIONS.get(`${rel}|${selector}|${property}`) === value) continue;
                    offenders.push(`${rel} ${selector} { ${property}: ${value} }`);
                }
            }
        }
        expect(slotsSeen).toBeGreaterThan(10);
        expect(offenders).toEqual([]);
    });
});

describe('G112 From section DOM', () => {
    const registry = defaultRegistry();

    it('puts the Network icon and the From address icon in the shared slots', () => {
        render(
            <FromSection
                defaultOpen
                chainId="bitcoin-mainnet"
                chainRegistry={registry}
                onNetworkChange={() => {}}
                address="bc1qexampleexampleexampleexample7c1c"
                onOpenPicker={() => {}}
            />,
        );
        const network = screen.getByRole('button', { name: /^Network: / });
        expect(network).toHaveClass(chainPickerStyles.trigger);
        expect(network).toHaveClass(chainPickerStyles.leadIcon);

        const fromIcon = screen.getByRole('button', { name: 'Choose address' });
        // The From address icon is an in-field action: it sits in the Input's
        // one action slot, whose inset is the G112 token pinned above.
        expect(fromIcon.parentElement).toHaveClass(inputStyles.controlActions);
        const input = screen.getByLabelText('From address', { selector: 'input' });
        expect(input).toHaveClass(inputStyles.inputWithFieldAction);
        expect(input.parentElement).toContainElement(fromIcon);
    });

    it('drops the lead slot when the Network field has no icon to show', () => {
        // No network chosen yet: the placeholder starts at the field's text
        // padding, with no icon slot before it.
        render(
            <NetworkField
                value=""
                onChange={() => {}}
                chainIds={['bitcoin-mainnet']}
                chainRegistry={registry}
                placeholder="Choose a network"
            />,
        );
        const network = screen.getByRole('button', { name: /^Network: / });
        expect(network.querySelector(`.${chainPickerStyles.triggerIcon}`)).toBeNull();
        expect(network).not.toHaveClass(chainPickerStyles.leadIcon);
    });
});
