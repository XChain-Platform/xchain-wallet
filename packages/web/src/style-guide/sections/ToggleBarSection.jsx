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
import styles from './ToggleBarSection.module.css';

// Reproduces the `.segmented` filter bar from
// shared/routes/AddressList.jsx (the All / Normal / Imported toggle).
function ToggleBar({ options, value, onChange, ariaLabel }) {
    return (
        <div className={styles.segmented} role="tablist" aria-label={ariaLabel}>
            {options.map((opt) => (
                <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={value === opt.id}
                    className={`${styles.segment} ${value === opt.id ? styles.segmentActive : ''}`}
                    onClick={() => onChange(opt.id)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

export function ToggleBarSection() {
    const [source, setSource] = useState('all');
    const [scope, setScope] = useState('active');
    return (
        <Section
            id="toggle-bar"
            title="Toggle bar (segmented filter)"
            tag="CANONICAL full-width list filter"
            kicker="A full-width bar of equal-width segments that filters the list below it. The active segment fills with accent-primary + white; flipping it changes which rows show without leaving the page. This is the All / Normal / Imported bar on the Addresses page."
        >
            <Guidance
                what={<>A flex row of equal-width buttons (<code>flex: 1 1 0</code>) inside a single bordered, <code>radius-md</code> container with hairline dividers between segments. The active segment fills <code>var(--xc-accent-primary)</code> with white text. Sits directly under the search + network filter and drives an in-page filter over the same list.</>}
                when={<>2–4 mutually-exclusive <em>views of the same list</em>, where the choice changes which rows render (Addresses: All / Normal / Imported). The full-width treatment signals "this filters everything below me," distinct from an inline sub-tab.</>}
                whenNot={<>Compact inline filters or sub-tab strips that don't span the column → <a href="#pill-segmented">Pill segmented</a> (rounded, auto-width). An independent on/off setting → a switch (Settings <code>ToggleRow</code>). More than ~4 segments, or long labels → a dropdown / chip-filter row.</>}
                sizing={<>Spans 100% of the column. Segments share width equally via <code>flex: 1 1 0</code>; a 1px <code>var(--xc-border)</code> divider separates them (suppressed on the first). Segment padding <code>var(--xc-space-2) var(--xc-space-1)</code>, font-size <code>--xc-text-sm</code>, weight 600.</>}
                doRule={<>✓ Keep labels to one word ("All", "Normal", "Imported") · order left-to-right from broadest to narrowest (All first) · pair with <code>role="tablist"</code> + <code>aria-selected</code> so it reads as an exclusive choice · always have exactly one active segment</>}
                dontRule={<>✗ Use it for an inline/compact filter (that's the pill) · let it wrap to two rows · use it for independent booleans (each toggle would need its own bar) · leave zero segments active</>}
                supersedes={<>The inline source filter on Addresses. Source of truth is <code>.segmented</code> / <code>.segment</code> / <code>.segmentActive</code> in <code>shared/routes/AddressList.module.css</code>; lift to a shared <code>&lt;ToggleBar&gt;</code> in <code>@xchain-wallet/core/ui</code> when a second caller appears.</>}
            />

            <Markup>
{`<div className={styles.segmented} role="tablist" aria-label="Filter by address type">
    {[
        { id: 'all', label: 'All' },
        { id: 'normal', label: 'Normal' },
        { id: 'imported', label: 'Imported' },
    ].map((opt) => (
        <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={sourceFilter === opt.id}
            className={\`\${styles.segment} \${sourceFilter === opt.id ? styles.segmentActive : ''}\`}
            onClick={() => setSourceFilter(opt.id)}
        >
            {opt.label}
        </button>
    ))}
</div>`}
            </Markup>

            <LiveExample label="Addresses: All / Normal / Imported">
                <ToggleBar
                    ariaLabel="Filter by address type"
                    value={source}
                    onChange={setSource}
                    options={[
                        { id: 'all', label: 'All' },
                        { id: 'normal', label: 'Normal' },
                        { id: 'imported', label: 'Imported' },
                    ]}
                />
            </LiveExample>

            <LiveExample label="2-segment variant">
                <ToggleBar
                    ariaLabel="Scope"
                    value={scope}
                    onChange={setScope}
                    options={[
                        { id: 'active', label: 'Active' },
                        { id: 'archived', label: 'Archived' },
                    ]}
                />
            </LiveExample>
        </Section>
    );
}
