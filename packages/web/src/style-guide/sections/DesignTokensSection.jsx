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

const token = (name, value, role, preview = 'value') => ({ name, value, role, preview });
const color = (name, light, dark, role) => ({ name, light, dark, role, preview: 'color' });

export const TOKEN_GROUPS = [
    {
        title: 'Color and theme',
        tokens: [
            color('--xc-accent-primary', '#1A7BAC', '#1A7BAC', 'Brand fill and primary action'),
            color('--xc-accent-primary-hover', '#156690', '#156690', 'Brand fill hover state'),
            color('--xc-accent-secondary', '#7B2C8F', '#7B2C8F', 'Secondary brand accent'),
            color('--xc-accent-text', '#1A77AA', '#4AA8D8', 'Accessible accent text and glyphs'),
            color('--xc-bg', '#FFFFFF', '#0B0F17', 'Page background'),
            color('--xc-bg-muted', '#F5F6F8', '#121824', 'Muted page region'),
            color('--xc-surface', '#FFFFFF', '#151B28', 'Default card surface'),
            color('--xc-surface-raised', '#FFFFFF', '#1B2231', 'Modal and popover surface'),
            color('--xc-border', '#818B9B', '#5F6D83', 'Default border'),
            color('--xc-border-strong', '#727D8E', '#718096', 'Emphasized border'),
            color('--xc-text', '#0F172A', '#E5EAF2', 'Primary text'),
            color('--xc-text-muted', '#5F7086', '#94A3B8', 'Secondary text'),
            color('--xc-text-inverted', '#FFFFFF', '#0B0F17', 'Text on an inverted surface'),
            color('--xc-on-accent', '#FFFFFF', '#FFFFFF', 'Text on an accent fill'),
            color('--xc-focus-ring', 'rgba(26, 123, 172, 0.80)', 'rgba(74, 168, 216, 0.75)', 'Keyboard focus indicator'),
        ],
    },
    {
        title: 'Status colors',
        tokens: [
            color('--xc-danger', '#DC2626', '#DC2626', 'Danger fill and border'),
            color('--xc-danger-fg', '#DA2525', '#F87171', 'Danger text and glyphs'),
            color('--xc-danger-bg', 'rgba(220, 38, 38, 0.10)', 'rgba(252, 165, 165, 0.14)', 'Danger message background'),
            color('--xc-danger-text', '#7F1D1D', '#FCA5A5', 'Danger message text'),
            color('--xc-on-danger', '#FFFFFF', '#FFFFFF', 'Text on a danger fill'),
            color('--xc-info', '#1A7BAC', '#4AA8D8', 'Information fill and border'),
            color('--xc-info-bg', 'rgba(26, 123, 172, 0.10)', 'rgba(74, 168, 216, 0.14)', 'Information message background'),
            color('--xc-info-text', '#134B6E', '#7DD3FC', 'Information message text'),
            color('--xc-warning', '#A8500A', '#F59E0B', 'Warning fill and border'),
            color('--xc-warning-bg', 'rgba(217, 119, 6, 0.10)', 'rgba(252, 211, 77, 0.14)', 'Warning message background'),
            color('--xc-warning-text', '#6E520A', '#FCD34D', 'Warning message text'),
            color('--xc-success', '#146F34', '#4ADE80', 'Success text and glyphs'),
            color('--xc-success-fill', '#146F34', '#4ADE80', 'Success fill'),
            color('--xc-success-bg', 'rgba(20, 111, 52, 0.10)', 'rgba(74, 222, 128, 0.14)', 'Success message background'),
            color('--xc-on-success', '#FFFFFF', '#0B0F17', 'Text on a success fill'),
        ],
    },
    {
        title: 'Spacing',
        tokens: [
            token('--xc-space-1', '4px', 'Tight inline gap', 'length'),
            token('--xc-space-2', '8px', 'Compact control gap', 'length'),
            token('--xc-space-3', '12px', 'Default field and card gap', 'length'),
            token('--xc-space-4', '16px', 'Default content padding', 'length'),
            token('--xc-space-5', '20px', 'Loose cluster spacing', 'length'),
            token('--xc-space-6', '24px', 'Large surface padding', 'length'),
            token('--xc-space-8', '32px', 'Section separation', 'length'),
        ],
    },
    {
        title: 'Typography',
        tokens: [
            token('--xc-font-sans', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 'Default interface family', 'font'),
            token('--xc-font-mono', "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace", 'Addresses and numeric values', 'font'),
            token('--xc-text-xs', '0.6875rem', 'Metadata and badges', 'type'),
            token('--xc-text-sm', '0.8125rem', 'Labels and hints', 'type'),
            token('--xc-text-md', '0.875rem', 'Default body text', 'type'),
            token('--xc-text-lg', '1rem', 'Section titles and large fields', 'type'),
            token('--xc-text-xl', '1.25rem', 'Panel headings', 'type'),
            token('--xc-text-2xl', '1.5rem', 'Screen headings and hero values', 'type'),
        ],
    },
    {
        title: 'Icon sizes',
        tokens: [
            token('--xc-icon-xs', '14px', 'Inline compact icon', 'icon'),
            token('--xc-icon-sm', '16px', 'Small control icon', 'icon'),
            token('--xc-icon-md', '18px', 'Default control icon', 'icon'),
            token('--xc-icon-lg', '20px', 'Prominent action icon', 'icon'),
            token('--xc-icon-xl', '24px', 'Navigation and feature icon', 'icon'),
        ],
    },
    {
        title: 'Radii',
        tokens: [
            token('--xc-radius-xs', '2px', 'Small indicators and inset marks', 'radius'),
            token('--xc-radius-sm', '4px', 'Chips and compact controls', 'radius'),
            token('--xc-radius-md', '8px', 'Cards and default controls', 'radius'),
            token('--xc-radius-control', '10px', 'Prominent controls', 'radius'),
            token('--xc-radius-lg', '12px', 'Raised cards and panels', 'radius'),
            token('--xc-radius-pill', '9999px', 'Pills and round controls', 'radius'),
        ],
    },
    {
        title: 'Shadows',
        tokens: [
            token('--xc-shadow-sm', '0 1px 2px rgba(15, 23, 42, 0.06)', 'Subtle surface lift', 'shadow'),
            token('--xc-shadow-md', '0 4px 12px rgba(15, 23, 42, 0.08)', 'Default raised surface', 'shadow'),
            token('--xc-shadow-header-menu', '0 8px 20px rgba(0, 0, 0, 0.18)', 'Header action menu', 'shadow'),
            token('--xc-shadow-toast', '0 8px 24px rgba(0, 0, 0, 0.15)', 'Toast elevation', 'shadow'),
            token('--xc-shadow-popover', '0 12px 30px rgba(0, 0, 0, 0.18)', 'Popover elevation', 'shadow'),
            token('--xc-shadow-modal', '0 16px 40px rgba(0, 0, 0, 0.35)', 'Modal elevation', 'shadow'),
            token('--xc-shadow-side-panel', '-16px 0 40px rgba(0, 0, 0, 0.35)', 'Side panel separation', 'shadow'),
            token('--xc-shadow-bottom-sheet', '0 -8px 32px rgba(0, 0, 0, 0.18)', 'Bottom sheet separation', 'shadow'),
            token('--xc-shadow-surface-ring', '0 0 0 1.5px var(--xc-surface)', 'Surface-colored ring', 'shadow'),
            token('--xc-shadow-accent-ring', '0 0 0 1px var(--xc-accent-primary)', 'Accent ring', 'shadow'),
            token('--xc-shadow-focus-ring', '0 0 0 3px var(--xc-focus-ring)', 'Focus ring shadow', 'shadow'),
            token('--xc-shadow-danger-focus-ring', '0 0 0 3px rgba(220, 38, 38, 0.2)', 'Danger focus ring', 'shadow'),
            token('--xc-shadow-nav-indicator', 'inset 3px 0 0 var(--xc-accent-primary)', 'Active navigation indicator', 'shadow'),
            token('--xc-shadow-status-halo', '0 0 0 3px color-mix(in srgb, currentColor 18%, transparent)', 'Status dot halo', 'shadow'),
            token('--xc-shadow-identity-ring', '0 0 0 2px var(--xc-surface), 0 0 0 4px currentColor', 'Active wallet identity ring', 'shadow'),
        ],
    },
    {
        title: 'Stacking layers',
        tokens: [
            token('--xc-z-base', '1', 'Raised content'),
            token('--xc-z-sticky', '20', 'Sticky navigation'),
            token('--xc-z-dropdown', '50', 'Dropdowns and tooltips'),
            token('--xc-z-overlay', '60', 'Screen overlays'),
            token('--xc-z-modal', '1000', 'Blocking dialogs'),
            token('--xc-z-toast', '9999', 'Transient notifications'),
        ],
    },
    {
        title: 'Interaction and layout',
        tokens: [
            token('--xc-tap-min', '24px', 'Minimum pointer target', 'length'),
            token('--xc-transition', '160ms cubic-bezier(0.2, 0, 0.2, 1)', 'Default transition'),
            token('--xc-backdrop-filter', 'blur(2px)', 'Scrim backdrop blur, none under reduced effects'),
            token('--xc-list-shadow', 'var(--xc-shadow-md)', 'List card shadow, none under reduced effects', 'shadow'),
            token('--xc-privacy-filter', 'blur(12px)', 'Privacy-mode value blur'),
            token('--xc-privacy-opacity', '1', 'Privacy-mode value opacity'),
            token('--xc-disabled-opacity', '1', 'Disabled control opacity'),
            token('--xc-disabled-saturation', '0.35', 'Disabled control saturation'),
            token('--xc-viewport-h', 'calc(100vh - env(safe-area-inset-top, 0px))', 'Safe-area-aware shell height'),
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

function ColorSwatch({ label, value }) {
    const backdrop = label === 'Dark' ? '#0B0F17' : '#FFFFFF';

    return (
        <div style={{ minWidth: 112 }}>
            <div style={{
                height: 40,
                border: '1px solid #818B9B',
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

function TokenRow({ name, value, role, preview }) {
    const resolved = useTokenValue(name, value);

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
            <code style={{ color: 'var(--xc-text-muted)', overflowWrap: 'anywhere' }}>{resolved}</code>
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
            <ColorSwatch label="Light" value={light} />
            <ColorSwatch label="Dark" value={dark} />
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
                what={<>The complete shared token contract from <code>packages/core/src/ui/tokens.css</code>. Theme colors use separate light and dark values; structural scales stay shared across themes.</>}
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
