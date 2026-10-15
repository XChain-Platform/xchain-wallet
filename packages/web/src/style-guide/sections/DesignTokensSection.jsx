// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Section, Guidance, LiveExample } from '../StyleGuidePage.jsx';
import { declaredToken, tokenIn } from '../tokenValues.js';

// Values come from tokens.css (see tokenValues.js); only the role text and
// the preview kind are written here.
const token = (name, role, preview = 'value') => ({
    name,
    value: declaredToken(name),
    light: tokenIn('light', name),
    dark: tokenIn('dark', name),
    role,
    preview,
});
const color = (name, role) => ({ ...token(name, role, 'color') });

export const TOKEN_GROUPS = [
    {
        title: 'Color and theme',
        tokens: [
            color('--xc-accent-primary', 'Brand fill and primary action'),
            color('--xc-accent-primary-hover', 'Brand fill hover state'),
            color('--xc-accent-secondary', 'Secondary brand accent'),
            color('--xc-accent-text', 'Accessible accent text and glyphs'),
            color('--xc-bg', 'Page background'),
            color('--xc-bg-muted', 'Muted page region'),
            color('--xc-surface', 'Default card surface'),
            color('--xc-surface-raised', 'Modal and popover surface'),
            color('--xc-border', 'Default border'),
            color('--xc-border-strong', 'Border compatibility alias'),
            color('--xc-text', 'Primary text'),
            color('--xc-text-muted', 'Secondary text'),
            color('--xc-text-inverted', 'Text on an inverted surface'),
            color('--xc-on-accent', 'Text on an accent fill'),
            color('--xc-focus-ring', 'Keyboard focus indicator'),
        ],
    },
    {
        title: 'Control states',
        tokens: [
            color('--xc-control-bg', 'Kit control fill'),
            color('--xc-control-bg-hover', 'Kit control hover fill'),
            color('--xc-control-border', 'Kit control border'),
            color('--xc-control-border-hover', 'Kit control hover border'),
            color('--xc-control-selected', 'Selected chip, tab and row fill'),
            color('--xc-control-selected-text', 'Text on a selected control'),
            color('--xc-control-focus-ring', 'Kit control focus ring'),
            color('--xc-control-disabled-bg', 'Disabled control fill'),
            color('--xc-control-disabled-border', 'Disabled control border'),
            color('--xc-control-disabled-text', 'Disabled control text'),
        ],
    },
    {
        title: 'Status colors',
        tokens: [
            color('--xc-danger', 'Danger fill and border'),
            color('--xc-danger-fg', 'Danger text and glyphs'),
            color('--xc-danger-bg', 'Danger message background'),
            color('--xc-danger-text', 'Danger message text'),
            color('--xc-on-danger', 'Text on a danger fill'),
            color('--xc-info', 'Information fill and border'),
            color('--xc-info-bg', 'Information message background'),
            color('--xc-info-text', 'Information message text'),
            color('--xc-warning', 'Warning fill and border'),
            color('--xc-warning-bg', 'Warning message background'),
            color('--xc-warning-text', 'Warning message text'),
            color('--xc-success', 'Success text and glyphs'),
            color('--xc-success-fill', 'Success fill'),
            color('--xc-success-bg', 'Success message background'),
            color('--xc-on-success', 'Text on a success fill'),
        ],
    },
    {
        title: 'Spacing',
        tokens: [
            token('--xc-space-1', 'Tight inline gap', 'length'),
            token('--xc-space-2', 'Compact control gap', 'length'),
            token('--xc-space-3', 'Compact card and tab padding', 'length'),
            token('--xc-space-4', 'Default content padding', 'length'),
            token('--xc-space-5', 'Loose cluster spacing', 'length'),
            token('--xc-space-6', 'Large surface padding', 'length'),
            token('--xc-space-8', 'Section separation', 'length'),
            token('--xc-form-gap', 'Gap between form fields', 'length'),
            token('--xc-label-gap', 'Gap from a field label to its control', 'length'),
            token('--xc-help-gap', 'Gap from a control to its help or error text', 'length'),
            token('--xc-section-gap', 'Gap between form sections and list page blocks', 'length'),
            token('--xc-settings-row-gap', 'One gap between every stacked Settings row, drill-in or field', 'length'),
            token('--xc-section-header-gap', 'Gap from a section header to its content', 'length'),
            token('--xc-list-row-padding', 'Inset inside a list row', 'length'),
            token('--xc-page-gutter', 'The one inline page inset, 12px at every width, applied only by Screen body', 'length'),
            token('--xc-page-top', 'Top page inset, applied only by Screen body (16px beside the sidebar, 8px on a short landscape phone)', 'length'),
            token('--xc-card-pad', 'Card interior inset (12px under 480px)', 'length'),
            token('--xc-card-radius', 'Card corner radius', 'radius'),
        ],
    },
    {
        title: 'Typography',
        tokens: [
            token('--xc-type-page-title-size', 'Page title size', 'type'),
            token('--xc-type-page-title-weight', 'Page title weight'),
            token('--xc-type-section-title-size', 'Section title size', 'type'),
            token('--xc-type-section-title-weight', 'Section title weight'),
            token('--xc-type-card-title-size', 'Card title size', 'type'),
            token('--xc-type-card-title-weight', 'Card title weight'),
            token('--xc-type-body-size', 'Supporting body text size', 'type'),
            token('--xc-type-body-weight', 'Supporting body text weight'),
            token('--xc-font-sans', 'Default interface family', 'font'),
            token('--xc-font-mono', 'Addresses and numeric values', 'font'),
            token('--xc-text-xs', 'Metadata and badges', 'type'),
            token('--xc-text-sm', 'Labels and hints', 'type'),
            token('--xc-text-md', 'Default body text', 'type'),
            token('--xc-text-lg', 'Section titles and large fields', 'type'),
            token('--xc-text-xl', 'Panel headings', 'type'),
            token('--xc-text-2xl', 'Screen headings and hero values', 'type'),
        ],
    },
    {
        title: 'Icon sizes',
        tokens: [
            token('--xc-icon-xs', 'Inline compact icon', 'icon'),
            token('--xc-icon-sm', 'Small control icon', 'icon'),
            token('--xc-icon-md', 'Default control icon', 'icon'),
            token('--xc-icon-lg', 'Prominent action icon', 'icon'),
            token('--xc-icon-xl', 'Navigation and feature icon', 'icon'),
        ],
    },
    {
        title: 'Radii',
        tokens: [
            token('--xc-radius-xs', 'Small indicators and inset marks', 'radius'),
            token('--xc-radius-sm', 'Chips and compact controls', 'radius'),
            token('--xc-radius-md', 'Cards and default controls', 'radius'),
            token('--xc-radius-control', 'Alias of --xc-control-radius', 'radius'),
            token('--xc-radius-lg', 'Raised cards and panels', 'radius'),
            token('--xc-radius-pill', 'Pills and round controls', 'radius'),
        ],
    },
    {
        title: 'Shadows',
        tokens: [
            token('--xc-shadow-sm', 'Subtle surface lift', 'shadow'),
            token('--xc-shadow-md', 'Default raised surface', 'shadow'),
            token('--xc-shadow-header-menu', 'Header action menu alias', 'shadow'),
            token('--xc-shadow-toast', 'Toast elevation alias', 'shadow'),
            token('--xc-shadow-popover', 'Popover elevation alias', 'shadow'),
            token('--xc-shadow-modal', 'Modal and sheet elevation', 'shadow'),
            token('--xc-shadow-side-panel', 'Side panel elevation alias', 'shadow'),
            token('--xc-shadow-bottom-sheet', 'Bottom sheet elevation alias', 'shadow'),
            token('--xc-shadow-surface-ring', 'Surface-colored ring', 'shadow'),
            token('--xc-shadow-accent-ring', 'Accent ring', 'shadow'),
            token('--xc-shadow-focus-ring', 'Focus ring shadow', 'shadow'),
            token('--xc-shadow-danger-focus-ring', 'Danger focus ring', 'shadow'),
            token('--xc-shadow-nav-indicator', 'Active navigation indicator', 'shadow'),
            token('--xc-shadow-status-halo', 'Status dot halo', 'shadow'),
            token('--xc-shadow-identity-ring', 'Active wallet identity ring', 'shadow'),
        ],
    },
    {
        title: 'Stacking layers',
        tokens: [
            token('--xc-z-base', 'Raised content'),
            token('--xc-z-sticky', 'Sticky navigation'),
            token('--xc-z-dropdown', 'Dropdowns and tooltips'),
            token('--xc-z-overlay', 'Screen overlays'),
            token('--xc-z-modal', 'Blocking dialogs'),
            token('--xc-z-toast', 'Transient notifications'),
        ],
    },
    {
        title: 'Interaction and layout',
        tokens: [
            token('--xc-tap-min', 'Minimum pointer target', 'length'),
            token('--xc-control-h-sm', 'Small control height; 36px on touch', 'length'),
            token('--xc-control-h-md', 'Default control height; 44px on touch', 'length'),
            token('--xc-control-h-lg', 'Large control and list row height; 48px on touch', 'length'),
            token('--xc-control-radius', 'Control corner radius', 'radius'),
            token('--xc-control-font', 'Control text size', 'type'),
            token('--xc-control-pad-x', 'Control inline padding', 'length'),
            token('--xc-transition', 'Default transition'),
            token('--xc-backdrop-filter', 'Scrim backdrop blur, none under reduced effects'),
            token('--xc-list-shadow', 'List card shadow, none under reduced effects', 'shadow'),
            token('--xc-privacy-filter', 'Privacy-mode value blur'),
            token('--xc-privacy-opacity', 'Privacy-mode value opacity'),
            token('--xc-disabled-opacity', 'Disabled control opacity'),
            token('--xc-disabled-saturation', 'Disabled control saturation'),
            token('--xc-viewport-h', 'Safe-area-aware shell height'),
        ],
    },
    {
        title: 'Component geometry and control states',
        tokens: [
            token('--xc-table-cell-padding-block', 'Table cell padding block', 'length'),
            token('--xc-table-cell-padding-inline', 'Table cell padding inline', 'length'),
            token('--xc-table-label-width', 'Table label width', 'length'),
            token('--xc-table-label-column', 'Table label column', 'length'),
            token('--xc-table-row-divider', 'Table row divider', 'value'),
            token('--xc-prose-max-width', 'Prose max width', 'length'),
            token('--xc-avatar-size-header', 'Avatar size header', 'length'),
            token('--xc-avatar-size-list', 'Avatar size list', 'length'),
            token('--xc-avatar-size-hero', 'Avatar size hero', 'length'),
            token('--xc-avatar-pip-header', 'Avatar pip header', 'length'),
            token('--xc-avatar-pip-list', 'Avatar pip list', 'length'),
            token('--xc-avatar-pip-hero', 'Avatar pip hero', 'length'),
            token('--xc-avatar-initials-header', 'Avatar initials header', 'type'),
            token('--xc-avatar-initials-list', 'Avatar initials list', 'type'),
            token('--xc-avatar-initials-hero', 'Avatar initials hero', 'type'),
            token('--xc-avatar-shape', 'Avatar shape', 'radius'),
            token('--xc-badge-height-sm', 'Badge height sm', 'length'),
            token('--xc-badge-height-md', 'Badge height md', 'length'),
            token('--xc-badge-radius', 'Badge radius', 'radius'),
            token('--xc-badge-font-size-sm', 'Badge font size sm', 'type'),
            token('--xc-badge-font-size-md', 'Badge font size md', 'type'),
            token('--xc-badge-font-weight', 'Badge font weight', 'type'),
            token('--xc-badge-icon-size-sm', 'Badge icon size sm', 'length'),
            token('--xc-badge-icon-size-md', 'Badge icon size md', 'length'),
            token('--xc-badge-gap', 'Badge gap', 'length'),
            token('--xc-badge-padding-inline-sm', 'Badge padding inline sm', 'length'),
            token('--xc-badge-padding-inline-md', 'Badge padding inline md', 'length'),
            token('--xc-control-font-sm', 'Control font sm', 'value'),
            token('--xc-control-font-md', 'Control font md', 'value'),
            token('--xc-control-font-lg', 'Control font lg', 'value'),
            token('--xc-control-pad-x-sm', 'Control pad x sm', 'length'),
            token('--xc-control-pad-x-md', 'Control pad x md', 'length'),
            token('--xc-control-pad-x-lg', 'Control pad x lg', 'length'),
            token('--xc-button-pad-x-sm', 'Button pad x sm', 'length'),
            token('--xc-button-pad-x-md', 'Button pad x md', 'length'),
            token('--xc-button-pad-x-lg', 'Button pad x lg', 'length'),
            token('--xc-control-icon-sm', 'Control icon sm', 'length'),
            token('--xc-control-icon-md', 'Control icon md', 'length'),
            token('--xc-control-icon-lg', 'Control icon lg', 'length'),
            token('--xc-control-line', 'Control line', 'type'),
            token('--xc-control-hit-min', 'Control hit min', 'length'),
            token('--xc-menu-item-h', 'Menu item h', 'length'),
            token('--xc-menu-item-icon', 'Menu item icon', 'length'),
            token('--xc-menu-item-pad-block', 'Menu item pad block', 'length'),
            token('--xc-menu-item-pad-inline', 'Menu item pad inline', 'length'),
            token('--xc-motion-duration-fast', 'Motion duration fast', 'value'),
            token('--xc-motion-duration-standard', 'Motion duration standard', 'value'),
            token('--xc-motion-duration-ambient', 'Motion duration ambient', 'value'),
            token('--xc-motion-ease-standard', 'Motion ease standard', 'value'),
            token('--xc-motion-ease-enter', 'Motion ease enter', 'value'),
            token('--xc-motion-ease-ambient', 'Motion ease ambient', 'value'),
            color('--xc-badge-multisig-classic-bg', 'Badge multisig classic bg'),
            color('--xc-badge-multisig-classic-fg', 'Badge multisig classic fg'),
            color('--xc-badge-multisig-classic-border', 'Badge multisig classic border'),
            color('--xc-badge-multisig-segwit-bg', 'Badge multisig segwit bg'),
            color('--xc-badge-multisig-segwit-fg', 'Badge multisig segwit fg'),
            color('--xc-badge-multisig-segwit-border', 'Badge multisig segwit border'),
            color('--xc-badge-multisig-taproot-bg', 'Badge multisig taproot bg'),
            color('--xc-badge-multisig-taproot-fg', 'Badge multisig taproot fg'),
            color('--xc-badge-multisig-taproot-border', 'Badge multisig taproot border'),
            token('--xc-shadow-selected-ring', 'Inset ring on a pressed collectible card', 'shadow'),
        ],
    },
];

export const DOCUMENTED_TOKENS = Object.freeze(
    TOKEN_GROUPS.flatMap(({ tokens }) => tokens.map(({ name }) => name)),
);

function useTokenValue(name, fallback) {
    const [value, setValue] = useState(fallback);

    useEffect(() => {
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (resolved) setValue(resolved);
    }, [name]);

    return value;
}

/** A swatch on its own theme's page background, so tints read as they do in the app. */
function ColorSwatch({ label, theme, value }) {
    const backdrop = tokenIn(theme, '--xc-bg');

    return (
        <div style={{ minWidth: 112 }}>
            <div style={{
                height: 40,
                border: `1px solid ${tokenIn(theme, '--xc-border')}`,
                borderRadius: 6,
                backgroundColor: backdrop,
                padding: 4,
                boxSizing: 'border-box',
            }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 2, backgroundColor: value }} />
            </div>
            <div style={{ marginTop: 3, fontSize: 10, color: 'var(--xc-text-muted)' }}>{label}</div>
            <code style={{ display: 'block', fontSize: 10, overflowWrap: 'anywhere' }}>{value}</code>
        </div>
    );
}

function TokenPreview({ name, value, preview }) {
    const cssValue = `var(${name}, ${value})`;

    if (preview === 'length') {
        return <div style={{ width: cssValue, minWidth: 2, maxWidth: 120, height: 14, background: 'var(--xc-accent-primary)', borderRadius: 2 }} />;
    }
    if (preview === 'radius') {
        return <div style={{ width: 54, height: 36, border: '1px solid var(--xc-border-strong)', borderRadius: cssValue, background: 'var(--xc-bg-muted)' }} />;
    }
    if (preview === 'shadow') {
        return <div style={{ width: 54, height: 36, borderRadius: 6, background: 'var(--xc-surface)', boxShadow: cssValue }} />;
    }
    if (preview === 'icon') {
        return <div style={{ width: cssValue, height: cssValue, maxWidth: 32, maxHeight: 32, borderRadius: '50%', background: 'var(--xc-accent-primary)' }} />;
    }
    if (preview === 'type') {
        return <span style={{ fontSize: cssValue, lineHeight: 1 }}>Aa</span>;
    }
    if (preview === 'font') {
        return <span style={{ fontFamily: cssValue, fontSize: 14 }}>Aa 0123</span>;
    }
    return <span style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 12 }}>{value}</span>;
}

function TokenRow({ name, value, light, dark, role, preview }) {
    const resolved = useTokenValue(name, light ?? value);
    const themed = light !== dark;

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(170px, 1fr) minmax(180px, 1.4fr) minmax(100px, 0.8fr)',
            gap: 16,
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid var(--xc-border)',
            fontSize: 12,
        }}>
            <div>
                <code>{name}</code>
                <div style={{ color: 'var(--xc-text-muted)' }}>{role}</div>
            </div>
            <div style={{ minWidth: 0 }}>
                <code style={{ color: 'var(--xc-text-muted)', overflowWrap: 'anywhere' }}>{resolved}</code>
                {value !== resolved && value !== light ? (
                    <div style={{ color: 'var(--xc-text-muted)', overflowWrap: 'anywhere' }}>declared as <code>{value}</code></div>
                ) : null}
                {themed ? (
                    <div style={{ color: 'var(--xc-text-muted)', overflowWrap: 'anywhere' }}>
                        light <code>{light}</code> · dark <code>{dark}</code>
                    </div>
                ) : null}
            </div>
            <TokenPreview name={name} value={value} preview={preview} />
        </div>
    );
}

function ColorTokenRow({ name, light, dark, role }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(170px, 1fr) repeat(2, minmax(112px, 0.8fr))',
            gap: 16,
            alignItems: 'center',
            padding: '9px 0',
            borderBottom: '1px solid var(--xc-border)',
            fontSize: 12,
        }}>
            <div>
                <code>{name}</code>
                <div style={{ color: 'var(--xc-text-muted)' }}>{role}</div>
            </div>
            <ColorSwatch label="Light" theme="light" value={light} />
            <ColorSwatch label="Dark" theme="dark" value={dark} />
        </div>
    );
}

function TokenGroup({ title, tokens }) {
    return (
        <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{title}</h3>
            <div style={{ minWidth: 470 }}>
                {tokens.map((item) => (
                    item.preview === 'color'
                        ? <ColorTokenRow key={item.name} {...item} />
                        : <TokenRow key={item.name} {...item} />
                ))}
            </div>
        </div>
    );
}

export function DesignTokensSection() {
    return (
        <Section
            id="design-tokens"
            title="Design tokens"
            tag="complete tokens.css reference"
            kicker="Every shared --xc-* token, including theme-specific color values. Light and dark swatches show both palettes without requiring an OS theme toggle."
        >
            <Guidance
                what={<>The complete shared token contract from <code>packages/core/src/ui/tokens.css</code>. Every value on this page is read from that file when the guide builds, so it is always the current one: colors show the light and dark value side by side, and any other token whose dark value differs (the shadows) lists both. A token declared as another token shows the resolved value with its declaration under it.</>}
                doRule={<>✓ Reference tokens with <code>var(--xc-*)</code> so theme, contrast, motion, and safe-area behavior remain consistent · choose semantic status and stacking tokens by purpose</>}
                dontRule={<>✗ Hard-code a value that already has a token · infer stacking order from arbitrary numbers · use a fill token for status text when a <code>-text</code> or <code>-fg</code> token exists</>}
            />
            <LiveExample label="Complete token catalog">
                <div style={{ overflowX: 'auto' }}>
                    {TOKEN_GROUPS.map((group) => <TokenGroup key={group.title} {...group} />)}
                </div>
            </LiveExample>
        </Section>
    );
}
