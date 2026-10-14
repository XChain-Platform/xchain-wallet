// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { BalanceList } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SAMPLE_BALANCE_ROWS } from './sharedComponentExamples.jsx';

export function BalanceListSection() {
    return (
        <Section
            id="balance-list"
            title="Balance / search-result list"
            tag="CANONICAL token + coin row"
            kicker="The standard list shape used everywhere the wallet shows a list of held or selectable assets: Home's Balances tab, Send picker, Receive picker, Address book token chips. Stacked asset icon on the left, name + tick in the middle, monospaced quantity + fiat on the right."
        >
            <Guidance
                what={<>A bordered card with rows separated by hairlines. Each row is a flex layout: 48×48 stacked icon → flex-1 body (name + tick subtitle) → right-aligned amount stack (mono qty + muted fiat). Rows are clickable buttons when an <code>onSelectToken</code> handler is wired through; they hover with <code>--xc-bg-muted</code>.</>}
                when={<>Any list of assets the user can act on: balances, search results, token pickers, contact-row tokens. The card surface (<code>--xc-surface</code>) wraps the row stack; rows themselves are transparent so the hover/focus rings read against the card.</>}
                whenNot={<>For history rows (more metadata, different right-side shape) → use the History entry pattern. For a single asset hero → use the asset hero pattern. For a horizontal asset selector (one currently-chosen asset) → use the asset card pattern.</>}
                sizing={<>Row padding <code>var(--xc-space-3)</code>, gap <code>var(--xc-space-3)</code> between icon/body/amounts. Icon wrap 48×48 (the row variant of the stacked asset icon). Name: weight 600 default size. Subtitle (tick): <code>--xc-text-xs</code> muted. Quantity: <code>--xc-font-mono</code>, <code>--xc-text-md</code>, weight 700. Fiat: mono, <code>--xc-text-xs</code>, muted, weight 600.</>}
                doRule={<>✓ Always pair quantity with a tick label (in the subtitle) so a number alone never sits next to a different asset's icon · use mono for both quantity AND fiat so digits line up vertically across rows · render fiat ONLY when a rate is available (don't show "$0" or empty placeholders) · hide the chain pip on native rows (the icon IS the chain)</>}
                dontRule={<>✗ Add a third row of metadata (the row gets cramped) · right-align text or use mono for the name (only quantity/fiat use mono) · paint the row's background (the card's surface is enough; hover the row, not the card)</>}
                supersedes={<>The <code>.list</code> / <code>.row</code> / <code>.rowClickable</code> / <code>.iconWrap</code> / <code>.body</code> / <code>.amounts</code> rules in BalanceList.module.css and their JSX in <code>BalanceList.jsx</code>. The canonical implementation already lives there. Extract no further until a list with materially different cell needs arrives.</>}
            />

            <Markup>
{`import { BalanceList } from '@xchain-wallet/core/shared/components/BalanceList.jsx';

<BalanceList
    rows={rows}
    onSelectToken={openTokenDetail}
    pinnedKeys={pinnedSet}
    onTogglePin={togglePin}
    hiddenKeys={hiddenSet}
    onToggleHide={toggleHide}
    emptyTitle="No balances yet"
    onReceive={openReceive}
/>`}
            </Markup>

            <LiveExample label="Mixed list: natives + tokens with chain pip + letter-chip fallback">
                <BalanceList
                    rows={SAMPLE_BALANCE_ROWS}
                    fiatCurrency="USD"
                    showChain
                    onSelectToken={() => {}}
                />
            </LiveExample>

            <LiveExample label="Compact 2-row list (picker preview style)">
                <BalanceList
                    rows={SAMPLE_BALANCE_ROWS.filter(({ kind }) => kind === 'native').slice(0, 2)}
                    getRowActionLabel={(row) => `Select ${row.displayName}`}
                    onSelectToken={() => {}}
                />
            </LiveExample>
        </Section>
    );
}
