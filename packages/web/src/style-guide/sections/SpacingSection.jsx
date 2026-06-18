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

const SPACING = [
    { token: '--xc-space-1', value: '4px',  role: 'Inside-control gap (icon → label, label → counter pill)' },
    { token: '--xc-space-2', value: '8px',  role: 'Sibling controls in a row, AppHeader button gap' },
    { token: '--xc-space-3', value: '12px', role: 'Card padding (default), field margin, tab padding' },
    { token: '--xc-space-4', value: '16px', role: 'Big-field input horizontal padding' },
    { token: '--xc-space-5', value: '20px', role: 'Loose-cluster spacing' },
    { token: '--xc-space-6', value: '24px', role: 'Card outer padding (main surface card)' },
    { token: '--xc-space-8', value: '32px', role: 'Section breaks, page-level vertical rhythm' },
];

const RADII = [
    { token: '--xc-radius-sm',   value: '4px',    role: 'Tiny chips, Max button, hints' },
    { token: '--xc-radius-md',   value: '8px',    role: 'Default: cards, inputs, buttons, hero' },
    { token: '--xc-radius-lg',   value: '12px',   role: 'Larger raised cards (modal, popover)' },
    { token: '--xc-radius-pill', value: '9999px', role: 'Pill-segmented selector, count badges, round buttons' },
];

function SpaceBar({ token, value, role }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '140px 50px 1fr 1fr',
            gap: 16,
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid var(--xc-border)',
            fontSize: 12,
        }}>
            <code style={{ color: 'var(--xc-text-muted)' }}>{token}</code>
            <span style={{ fontFamily: 'var(--xc-font-mono)', color: 'var(--xc-text-muted)' }}>{value}</span>
            <div style={{
                background: 'var(--xc-accent-primary)',
                height: 14,
                width: `var(${token})`,
                borderRadius: 2,
            }} />
            <span style={{ color: 'var(--xc-text-muted)' }}>{role}</span>
        </div>
    );
}

function RadiusBox({ token, value, role }) {
    return (
        <div style={{ textAlign: 'center', fontSize: 12 }}>
            <div style={{
                width: 80,
                height: 56,
                background: 'var(--xc-bg-muted)',
                border: '1px solid var(--xc-border-strong)',
                borderRadius: `var(${token})`,
                margin: '0 auto 8px',
            }} />
            <code style={{ fontSize: 11, color: 'var(--xc-text-muted)' }}>{token}</code>
            <div style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 11, color: 'var(--xc-text-muted)' }}>{value}</div>
            <div style={{ marginTop: 4, color: 'var(--xc-text-muted)', maxWidth: 120 }}>{role}</div>
        </div>
    );
}

export function SpacingSection() {
    return (
        <Section
            id="spacing"
            title="Spacing & radii"
            tag="4px grid"
            kicker="The wallet runs on a 4px spacing grid (1 / 2 / 3 / 4 / 5 / 6 / 8, skipping 7 deliberately as the spec settled there) and four radius tokens. Always reach for a token, never raw px."
        >
            <Guidance
                doRule={<>✓ Use the smallest token that achieves visual separation · pair like-sized tokens (gap and padding on the same row should both pull from the same scale step or one step apart) · default to <code>--xc-radius-md</code> for cards/inputs/buttons; diverge only when a component is genuinely round (pill) or genuinely small (chip)</>}
                dontRule={<>✗ Use raw px values · invent a 7th step (round to the nearest existing token) · mix radii within a row of sibling components (one button at <code>radius-sm</code> next to another at <code>radius-md</code> reads as a bug)</>}
            />
            <LiveExample label="Spacing scale (bar width matches the token)">
                <div>
                    {SPACING.map((s) => <SpaceBar key={s.token} {...s} />)}
                </div>
            </LiveExample>
            <LiveExample label="Radius scale">
                <div style={{ display: 'flex', gap: 32, justifyContent: 'space-around', flexWrap: 'wrap' }}>
                    {RADII.map((r) => <RadiusBox key={r.token} {...r} />)}
                </div>
            </LiveExample>
        </Section>
    );
}
