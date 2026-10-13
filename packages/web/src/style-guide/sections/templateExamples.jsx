// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whole example screens for the page-template sections: a real Screen,
// PageHeader and template, so each frame shows exactly what a route renders.

import { useState } from 'react';
import {
    Button, EmptyState, FormPage, FormSection, Icon, Input, ListPage, PageHeader,
    Screen, SectionHeader, StatusMessage, Textarea,
} from '@xchain-wallet/core/ui';
import styles from './templateExamples.module.css';

const noop = () => {};

const GUTTER_GUIDE_STYLE = {
    position: 'fixed',
    insetBlock: 0,
    insetInline: 'var(--xc-page-gutter)',
    borderInline: '1px dashed var(--xc-accent-primary)',
    pointerEvents: 'none',
    zIndex: 'var(--xc-z-sticky)',
};

function PageGutterGuide() {
    return <div data-page-gutter-guide aria-hidden="true" style={GUTTER_GUIDE_STYLE} />;
}

/** A one-section form: Verify signature, as the app renders it. */
export function ExampleFormScreen({ withError = false }) {
    const [address, setAddress] = useState('');
    return (
        <Screen variant="full" header={<PageHeader onBack={noop} title="Verify signature" />}>
            <PageGutterGuide />
            <FormPage
                label="Verify signature"
                onSubmit={(e) => e.preventDefault()}
                intro="Check that a message was signed by the owner of an address."
                status={withError ? <StatusMessage variant="error">Enter the signature.</StatusMessage> : null}
                actions={(
                    <>
                        <Button variant="ghost" onClick={noop}>Cancel</Button>
                        <Button type="submit" variant="primary">Verify signature</Button>
                    </>
                )}
            >
                <Input
                    label="Address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="The address that produced the signature"
                    autoComplete="off"
                />
                <Textarea label="Message" rows={3} placeholder="The exact text that was signed" />
                <Textarea label="Signature" rows={2} placeholder="Base64 signature blob" />
            </FormPage>
        </Screen>
    );
}

/** A long form split into titled sections: Issue token. */
export function ExampleSectionedFormScreen() {
    return (
        <Screen variant="full" header={<PageHeader onBack={noop} title="Issue token" />}>
            <PageGutterGuide />
            <FormPage
                sectioned
                label="Issue token"
                onSubmit={(e) => e.preventDefault()}
                actions={(
                    <>
                        <Button variant="ghost" onClick={noop}>Save draft</Button>
                        <Button type="submit" variant="primary">Review</Button>
                    </>
                )}
            >
                <FormSection title="Token" description="The name and supply holders will see.">
                    <Input label="Ticker" placeholder="PEPECASH" />
                    <Input label="Supply" inputMode="decimal" placeholder="1000000" />
                </FormSection>
                <FormSection title="Settings">
                    <label className={styles.check}>
                        <input type="checkbox" defaultChecked /> Divisible (8 decimal places)
                    </label>
                    <label className={styles.check}>
                        <input type="checkbox" /> Lock supply after issuance
                    </label>
                </FormSection>
                <FormSection title="Description">
                    <Textarea label="Description" optional rows={2} placeholder="Shown on explorers" />
                </FormSection>
            </FormPage>
        </Screen>
    );
}

const ROWS = [
    { id: 1, title: 'Order #1042 · PEPECASH', sub: 'Pay 0.0021 BTC to bc1q9h…x7d4', due: '41 min left' },
    { id: 2, title: 'Order #1047 · RAREPEPE', sub: 'Pay 0.15 LTC to ltc1qz…8k2m', due: '2 h 10 min left' },
    { id: 3, title: 'Order #1051 · FLDC', sub: 'Pay 120 DOGE to D8x…q4Zr', due: '5 h left' },
];

/** A list with a toolbar and a titled group: Payments due. */
export function ExampleListScreen() {
    return (
        <Screen variant="full" header={<PageHeader onBack={noop} title="Payments due" />}>
            <PageGutterGuide />
            <ListPage
                intro="Coin payments your matched DEX orders are waiting on."
                toolbar={(
                    <>
                        <input type="search" className={styles.search} aria-label="Search payments" placeholder="Search" />
                        <select className={styles.select} aria-label="Filter by chain" defaultValue="all">
                            <option value="all">All chains</option>
                            <option value="btc">Bitcoin</option>
                        </select>
                        <Button size="sm" variant="secondary" onClick={noop}>Refresh</Button>
                    </>
                )}
            >
                <ul className={styles.list} aria-label="Pending payments">
                    {ROWS.map((r) => (
                        <li key={r.id} className={styles.row}>
                            <span className={styles.rowMain}>
                                <strong className={styles.rowTitle}>{r.title}</strong>
                                <span className={styles.rowSub}>{r.sub}</span>
                            </span>
                            <span className={styles.rowDue}>{r.due}</span>
                        </li>
                    ))}
                </ul>
                <SectionHeader title="Expired, awaiting settlement" description="Do not pay these: the window has closed." />
                <ul className={styles.list} aria-label="Expired payments">
                    <li className={styles.row}>
                        <span className={styles.rowMain}>
                            <strong className={styles.rowTitle}>Order #1013 · XCP</strong>
                            <span className={styles.rowSub}>Settles at the next block</span>
                        </span>
                        <span className={styles.rowDue}>Expired</span>
                    </li>
                </ul>
            </ListPage>
        </Screen>
    );
}

/** The same list screen with nothing to show. */
export function ExampleEmptyScreen() {
    return (
        <Screen variant="full" header={<PageHeader onBack={noop} title="Governance" />}>
            <PageGutterGuide />
            <ListPage>
                <EmptyState
                    icon={<Icon.HandshakeIcon />}
                    title="No polls yet"
                    body="Create the first poll on this chain."
                    actionLabel="Create poll"
                    onAction={noop}
                />
            </ListPage>
        </Screen>
    );
}
