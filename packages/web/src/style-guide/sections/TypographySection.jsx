// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Section, Guidance, LiveExample } from '../StyleGuidePage.jsx';

const SIZES = [
    { token: '--xc-text-2xl', value: '24px', role: 'Hero figures (Total balance), screen H1' },
    { token: '--xc-text-xl',  value: '20px', role: 'Asset hero name, panel section headers' },
    { token: '--xc-text-lg',  value: '16px', role: 'Big-field input text, section titles' },
    { token: '--xc-text-md',  value: '14px', role: 'Body text (default), balance quantity, button labels' },
    { token: '--xc-text-sm',  value: '13px', role: 'Form labels, tab labels, address text' },
    { token: '--xc-text-xs',  value: '11px', role: 'Metadata, hints, subtitles, badges' },
];

const SAMPLE = 'The quick brown fox jumps over the lazy dog · 0123456789';

function SizeRow({ token, value, role }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '180px 60px 1fr',
            gap: 16,
            alignItems: 'baseline',
            padding: '10px 0',
            borderBottom: '1px solid var(--xc-border)',
        }}>
            <code style={{ fontSize: 12, color: 'var(--xc-text-muted)' }}>{token}</code>
            <span style={{ fontSize: 12, color: 'var(--xc-text-muted)', fontFamily: 'var(--xc-font-mono)' }}>{value}</span>
            <span style={{ fontSize: `var(${token})`, color: 'var(--xc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {SAMPLE}
            </span>
            <span></span>
            <span></span>
            <span style={{ fontSize: 12, color: 'var(--xc-text-muted)', gridColumn: '1 / -1' }}>
                {role}
            </span>
        </div>
    );
}

export function TypographySection() {
    return (
        <Section
            id="typography"
            title="Typography"
            tag="6-step scale + 2 families"
            kicker="System sans for everything by default; mono only for digits (balance quantities, addresses, fee rates). The six size tokens cover everything from hero figures down to badge text. Never hard-code a font-size."
        >
            <Guidance
                what={<>Two font families (<code>--xc-font-sans</code> / <code>--xc-font-mono</code>, both system stacks, no web-font fetch) and six size tokens (<code>--xc-text-xs</code> through <code>--xc-text-2xl</code>). Line-height stays at the default (1.5) unless a specific component needs tighter (hero figures use 1.1).</>}
                doRule={<>✓ Always reference the tokens: <code>font-size: var(--xc-text-sm)</code>, never <code>font-size: 13px</code> · use the mono family for digits that should line up across rows (balance quantities, address text, fee rates in sat/vB) · weights: 400 for default body, 600 for labels / button text, 700 for names + values, 800 for hero figures only</>}
                dontRule={<>✗ Hard-code px values (defeats theme overrides + accessibility user-scaling) · use mono for non-numeric text · introduce a new size between the existing steps (pick the nearest token instead)</>}
            />
            <LiveExample label="Size scale (auto-themed)">
                <div>
                    {SIZES.map((s) => <SizeRow key={s.token} {...s} />)}
                </div>
            </LiveExample>
            <LiveExample label="Family contrast: sans vs. mono">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                    <div><strong>Sans</strong> (<code>--xc-font-sans</code>): Bitcoin balance pending confirmation</div>
                    <div style={{ fontFamily: 'var(--xc-font-mono)' }}>
                        <strong>Mono</strong> (<code>--xc-font-mono</code>): 1.23456789 BTC · bc1qxy2k…7qz3
                    </div>
                </div>
            </LiveExample>
            <LiveExample label="Weight ladder">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                    <div style={{ fontWeight: 400 }}>400: Default body text</div>
                    <div style={{ fontWeight: 600 }}>600: Form labels, button text, hints</div>
                    <div style={{ fontWeight: 700 }}>700: Token names, balance quantities, tab labels</div>
                    <div style={{ fontWeight: 800 }}>800: Hero figures (Total balance) only</div>
                </div>
            </LiveExample>
        </Section>
    );
}
