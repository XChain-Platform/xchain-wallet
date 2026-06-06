// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Section, Guidance, LiveExample } from '../StyleGuidePage.jsx';

// Just the curated palette the wallet actually leans on — not every
// token in tokens.css. Add more here if a new color earns repeated
// use across the app.
const ROLES = [
    { name: '--xc-accent-primary',       role: 'Brand accent · headers, primary CTAs, back chevron, title icons' },
    { name: '--xc-accent-primary-hover', role: 'Hover tint for accent fills' },
    { name: '--xc-bg-muted',             role: 'Gray card / row hover background' },
    { name: '--xc-surface',              role: 'Card surface (white in light, dark in dark)' },
    { name: '--xc-surface-raised',       role: 'Elevated card surface (modal, popover)' },
    { name: '--xc-border',               role: 'Default hairline (card edges, dividers)' },
    { name: '--xc-border-strong',        role: 'Emphasised hairline (input borders, pill rings)' },
    { name: '--xc-text',                 role: 'Primary text' },
    { name: '--xc-text-muted',           role: 'Secondary text · labels, hints, subtitles' },
    { name: '--xc-danger',               role: 'Errors, destructive actions' },
    { name: '--xc-warning',              role: 'Warnings, "supersedes" notes' },
    { name: '--xc-success',              role: 'Confirmations, checkmarks' },
];

function Swatch({ name, role }) {
    const [value, setValue] = useState('');
    useEffect(() => {
        setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    }, [name]);
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '56px 1fr',
            gap: 12,
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid var(--xc-border)',
            fontSize: 13,
        }}>
            <div style={{
                width: 56,
                height: 40,
                borderRadius: 6,
                background: `var(${name})`,
                border: '1px solid var(--xc-border)',
            }} />
            <div>
                <div style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 12 }}>{name}</div>
                <div style={{ color: 'var(--xc-text-muted)', fontSize: 12 }}>{role}</div>
                {value ? <div style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 11, color: 'var(--xc-text-muted)' }}>{value}</div> : null}
            </div>
        </div>
    );
}

export function ColorPaletteSection() {
    return (
        <Section
            id="color-palette"
            title="Color palette"
            tag="curated · the colors we actually use"
            kicker="Brand accent + key surface / text / status tokens. All other --xc-* tokens exist in tokens.css but get pulled in less often — start here when designing a new screen."
        >
            <Guidance
                what={<>The wallet's visual identity sits on a single brand-blue accent (<code>--xc-accent-primary</code>, <code>#1E90C7</code>) over neutral gray surfaces. Status colors (danger / warning / success) appear sparingly — for errors, confirmations, and "supersedes" callouts.</>}
                doRule={<>✓ Always reference tokens (e.g. <code>var(--xc-accent-primary)</code>) so dark-mode + high-contrast overrides apply uniformly · use <code>color-mix(in srgb, var(--xc-accent-primary) 12%, transparent)</code> for accent-tinted backgrounds (matches the quick-action icon halo)</>}
                dontRule={<>✗ Hard-code hex values · introduce a new accent color for a new feature — extend the existing palette via tint/shade with <code>color-mix</code> if you need variation</>}
            />
            <LiveExample label="Tokens · auto-themed (try a system-level dark-mode toggle)">
                <div>
                    {ROLES.map((r) => <Swatch key={r.name} {...r} />)}
                </div>
            </LiveExample>
        </Section>
    );
}
