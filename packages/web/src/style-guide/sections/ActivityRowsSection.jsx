// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { RelativeTime } from '@xchain-wallet/core/shared/components/RelativeTime.jsx';
import { ActivityRow, actionIconForAction } from '@xchain-wallet/core/shared/components/ActivityRow.jsx';
import { EntryRow } from '@xchain-wallet/core/shared/routes/HistoryEntryRow.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import {
    PartsExampleProvider,
    PART_ADDRESS,
    PART_CHAIN_ID,
    PART_WALLET_ID,
} from './partsExamples.jsx';

const noop = () => {};
const FIVE_MINUTES_AGO = () => Date.now() - 5 * 60 * 1000;

export function ActivityRowsSection() {
    return (
        <Section
            id="activity-rows"
            title="Activity rows"
            tag="CANONICAL · ActivityRow / HistoryEntryRow / RelativeTime"
            kicker="One row for one thing that happened: the asset mark, action and status, amount, block and time. History and the Home activity tab draw it from the same component."
        >
            <Guidance
                what={<><code>ActivityRow</code> is a full-width button with three lines: action and status, amount, then block and relative time. Pending rows omit the block. <code>EntryRow</code> (HistoryEntryRow) maps a history entry onto it. <code>ActivityEntryRow</code> is the Home variant of the activity row. <code>RelativeTime</code> renders the age as a live <code>time</code> element.</>}
                when={<>Any list of past activity.</>}
                whenNot={<>Balances (BalanceList) · people and addresses (ListRow).</>}
                doRule={<>✓ Map every status to its label through <code>statusLabels</code></>}
                dontRule={<>✗ Format the age by hand</>}
                supersedes={<>Source: <code>ActivityRow.jsx</code>, <code>RelativeTime.jsx</code>, <code>routes/HistoryEntryRow.jsx</code>.</>}
            />
            <Markup>
{`<ActivityRow chainId="bitcoin-mainnet" tick="BTC" isNative label="Sent" actionIcon={actionIconForAction('send')} amount="-0.01 BTC" status="confirmed" block="Block 123,456" timestamp={ts} onClick={open} />`}
            </Markup>
            <LiveExample label="ActivityRow: confirmed and pending">
                <PartsExampleProvider>
                    <ActivityRow chainId={PART_CHAIN_ID} tick="BTC" isNative label="Sent" actionIcon={actionIconForAction('send')} subtitle="To Savings" amount="-0.01 BTC" status="confirmed" block="Block 123,456" timestamp={FIVE_MINUTES_AGO()} onClick={noop} />
                    <ActivityRow chainId={PART_CHAIN_ID} tick="BTC" isNative label="Received" actionIcon={actionIconForAction('receive')} amount="+0.002 BTC" status="pending" timestamp={FIVE_MINUTES_AGO()} onClick={noop} />
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="HistoryEntryRow (EntryRow)">
                <PartsExampleProvider>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        <EntryRow
                            entry={{
                                key: 'example-entry',
                                chainId: PART_CHAIN_ID,
                                action: 'send',
                                txHash: 'ab'.repeat(32),
                                source: PART_ADDRESS,
                                blockIndex: 123456,
                                timestamp: FIVE_MINUTES_AGO(),
                                status: 'confirmed',
                                raw: {},
                            }}
                            selected={false}
                            onClick={noop}
                            peerCache={{}}
                            chainTip={0}
                            walletId={PART_WALLET_ID}
                            walletAddresses={new Set([PART_ADDRESS])}
                        />
                    </ul>
                </PartsExampleProvider>
            </LiveExample>
            <LiveExample label="RelativeTime">
                <RelativeTime timestamp={FIVE_MINUTES_AGO()} />
            </LiveExample>
        </Section>
    );
}
