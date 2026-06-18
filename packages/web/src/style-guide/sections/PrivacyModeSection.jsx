// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);

const PRIVACY_MASK = '•••••';

function HeroDemo({ hidden, onToggle }) {
    return (
        <div style={{
            background: 'linear-gradient(180deg, var(--xc-accent-primary) 0%, color-mix(in srgb, var(--xc-accent-primary) 80%, #000) 100%)',
            color: '#fff',
            borderRadius: 'var(--xc-radius-md)',
            padding: 'var(--xc-space-2) var(--xc-space-3)',
            boxShadow: '0 6px 18px rgba(30,144,199,0.25)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.85)' }}>
                    Total balance
                </span>
                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={hidden ? 'Show balances' : 'Hide balances'}
                    style={{
                        background: 'rgba(255,255,255,0.15)',
                        border: 'none',
                        color: '#fff',
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {hidden ? <Icon.EyeIcon /> : <Icon.EyeOffIcon />}
                </button>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
                {hidden ? PRIVACY_MASK : '$12,345.67'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                {hidden ? PRIVACY_MASK : '+$182.40 (1.5%) ▲'}
            </div>
        </div>
    );
}

function RowDemo({ hidden }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            background: 'var(--xc-surface)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <img src={BTC_ICON} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Bitcoin</div>
                <div style={{ fontSize: 11, color: 'var(--xc-text-muted)' }}>BTC</div>
            </div>
            <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--xc-font-mono)', fontWeight: 700, fontSize: 14 }}>
                    {hidden ? PRIVACY_MASK : '1.23456789'}
                </div>
                <div style={{ fontFamily: 'var(--xc-font-mono)', fontSize: 11, color: 'var(--xc-text-muted)', fontWeight: 600 }}>
                    {hidden ? PRIVACY_MASK : '$76,543.21'}
                </div>
            </div>
        </div>
    );
}

export function PrivacyModeSection() {
    const [hidden, setHidden] = useState(false);
    return (
        <Section
            id="privacy-mode"
            title="Privacy mode"
            tag="GUIDANCE · figure-masking pattern"
            kicker="One global toggle masks every figure (balance / fiat / fee amount) across the wallet so a user can pull the app up in a public place without showing the world their net worth. Identifying labels (asset names, ticks, addresses) stay visible; the goal is hiding $$$, not making the app unusable."
        >
            <Guidance
                what={<>A boolean flag (<code>settings.balancesHidden</code>) that swaps every numeric figure for the mask glyph <code>{PRIVACY_MASK}</code>. The trigger is a single eye-button in the Total balance hero on Home; the flag persists across sessions in settings.</>}
                doRule={<>✓ Mask figures: balance quantity, fiat conversion, fee amounts, transaction values, change deltas · keep identifying text visible: asset name, tick, chain badge, address, action labels · use the same <code>{PRIVACY_MASK}</code> glyph everywhere (no "<em>***</em>" or "<em>HIDDEN</em>"; one mask language) · transition icon between <code>EyeIcon</code> (currently masked, tap to show) and <code>EyeOffIcon</code> (currently visible, tap to hide)</>}
                dontRule={<>✗ Mask labels (turning "Bitcoin" into <code>{PRIVACY_MASK}</code> defeats wayfinding; the user still needs to know which row is which) · mask addresses (they're not private; they're already public on-chain) · build a per-row mask toggle (one global switch keeps the contract predictable; every figure is either shown or masked) · ask before enabling (it's a UI preference, not a security action)</>}
                supersedes={<>Per-component masking code in BalanceList, History, GroupCard, OpenOrders, TotalBalanceHero. The canonical flag is <code>settings.balancesHidden</code>; the canonical mask glyph is <code>{PRIVACY_MASK}</code>.</>}
            />

            <Markup>
{`import { useSettings } from '../hooks/useSettings.js';
const PRIVACY_MASK = '•••••';

const { settings, setSettings } = useSettings();
const hidden = settings?.balancesHidden ?? false;

// Render a figure:
<div className={styles.qty}>
    {hidden ? PRIVACY_MASK : formatAmount(row.quantity, row.divisibility)}
</div>

// Toggle button: eye icon flips between EyeIcon (masked) and EyeOffIcon (visible):
<button onClick={() => setSettings({ ...settings, balancesHidden: !hidden })}
        aria-label={hidden ? 'Show balances' : 'Hide balances'}>
    {hidden ? <Icon.EyeIcon /> : <Icon.EyeOffIcon />}
</button>`}
            </Markup>

            <LiveExample label="Toggle the eye button: every figure swaps to the mask glyph">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <HeroDemo hidden={hidden} onToggle={() => setHidden((h) => !h)} />
                    <RowDemo hidden={hidden} />
                    <RowDemo hidden={hidden} />
                </div>
            </LiveExample>
        </Section>
    );
}
