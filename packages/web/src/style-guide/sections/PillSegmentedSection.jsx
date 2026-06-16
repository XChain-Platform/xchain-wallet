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
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './PillSegmentedSection.module.css';

function PillSegmented({ options, value, onChange }) {
    return (
        <div className={styles.pill} role="tablist">
            {options.map((opt) => {
                const active = value === opt.id;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
                        onClick={() => onChange(opt.id)}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export function PillSegmentedSection() {
    const [kind, setKind] = useState('all');
    const [tab, setTab] = useState('info');
    return (
        <Section
            id="pill-segmented"
            title="Pill segmented selector"
            tag="CANONICAL inline filter / tab strip"
            kicker="A rounded-pill control with 2–4 short segments. The active segment fills with accent-primary + white text; the resting segments are muted text on a transparent background inside a bordered pill."
        >
            <Guidance
                what={<>A flex row inside a pill-radius container (<code>border-radius: 999px</code>, 2px padding). Each segment is a transparent button; the active one swaps to <code>background: var(--xc-accent-primary); color: #FFFFFF</code>. Used on Receive's All / Coins / Tokens kind filter and TokenDetail's Media sub-tab strip.</>}
                when={<>Inline filter switches (2–4 short options), sub-tab strips inside a tab panel. Anywhere a horizontal exclusive-choice picker fits — and the option labels are short enough to live on a single row.</>}
                whenNot={<>Top-level page tabs use a different style (underline + larger text — see TokenDetail's main tab strip). More than 4 options → use a dropdown / chip-filter row. Multi-select → use a chip group, not a pill.</>}
                sizing={<>Pill: <code>padding: 2px</code>, 2px gap between segments. Segment: <code>padding: var(--xc-space-1) var(--xc-space-3)</code>, font-size <code>--xc-text-sm</code>, weight 600. Use <code>flex-shrink: 0</code> on the pill when it shares a row with a search input — keeps the segments at their natural width and lets the search flex.</>}
                doRule={<>✓ Keep labels to one word ("All", "Coins", "Tokens") or short two-word phrases · order options by frequency-of-use (left to right) · animate via CSS transition on background-color + color (160ms) so the active state slide reads cleanly</>}
                dontRule={<>✗ Use this for page-level tabs (different look — keep it scoped to inline switches) · expand to 5+ segments (the pill stops scanning as one unit) · skip the accent-primary active state for a subtle inverse</>}
                supersedes={<>The inline kind-filter on the Send/Receive picker (<code>.kindSegments</code> in TokenPicker.module.css) and the Media sub-tab strip on TokenDetail. Lift to <code>&lt;PillSegmented&gt;</code> in <code>@xchain-wallet/core/ui</code> when a third caller appears.</>}
            />

            <Markup>
{`<div className={styles.pill} role="tablist">
    {OPTIONS.map((opt) => (
        <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={value === opt.id}
            className={\`\${styles.segment} \${value === opt.id ? styles.segmentActive : ''}\`}
            onClick={() => onChange(opt.id)}
        >
            {opt.label}
        </button>
    ))}
</div>`}
            </Markup>

            <LiveExample label="3-option inline filter — Receive kind picker">
                <PillSegmented
                    value={kind}
                    onChange={setKind}
                    options={[
                        { id: 'all', label: 'All' },
                        { id: 'coins', label: 'Coins' },
                        { id: 'tokens', label: 'Tokens' },
                    ]}
                />
            </LiveExample>

            <LiveExample label="2-option sub-tab strip">
                <PillSegmented
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'info', label: 'Info' },
                        { id: 'media', label: 'Media' },
                    ]}
                />
            </LiveExample>
        </Section>
    );
}
