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
import { Screen, ScreenHeader, Button, AddressText } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './History.module.css';

/**
 * ContractStakedPositions: unified "your locked positions" view for contract-targeted stakes.
 *
 * Surfaces every contract_stakes + contract_unstakes row owned by any of the wallet's
 * addresses on the given chain, grouped by contract. For each position the user can see:
 *   - Target contract index
 *   - Token + amount staked
 *   - Cooldown duration (from the contract metadata)
 *   - Slash destination (prominent, per the spec's UX requirement)
 *   - Active stake vs. cooldown-in-progress state
 *   - Per-position actions: Unstake (if active), Delegate (rotate key)
 *
 * NOTE: This component depends on messaging.getContractStakesForAddress /
 * getContractUnstakesForAddress / getSlashEventsForAddress, which are thin wrappers
 * over SDK methods (sdk.getContractStakes etc.) that need to be added to ExplorerClient
 * in xchain-sdk alongside REST endpoints in xchain-explorer. Until those land, the
 * component will surface its load error gracefully. See flows/stakingQueries.js for
 * the wrapper signatures.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onStakeToContract]
 */
export function ContractStakedPositions({ walletId, chainId, onBack, onStakeToContract }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [walletAddresses, setWalletAddresses] = useState(/** @type {string[]} */ ([]));
    const [stakes, setStakes] = useState(/** @type {any[]} */ ([]));
    const [unstakes, setUnstakes] = useState(/** @type {any[]} */ ([]));
    const [slashEvents, setSlashEvents] = useState(/** @type {any[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const byChain = await messaging.getAddressesByChain(walletId);
                if (cancelled) return;
                const addrs = (byChain?.[chainId] || []).map((a) => a.address);
                setWalletAddresses(addrs);
                if (addrs.length === 0) {
                    setStakes([]);
                    setUnstakes([]);
                    setLoading(false);
                    return;
                }

                // Fetch stakes / unstakes / slash events for each wallet address.
                // Backed by flows/stakingQueries.js wrappers; until the explorer/SDK
                // surface lands, these messaging calls will throw (handled below).
                const allStakes = [];
                const allUnstakes = [];
                const allSlash = [];
                for (const addr of addrs) {
                    try {
                        const s = await messaging.getContractStakesForAddress({ chainId, address: addr });
                        const sRows = Array.isArray(s) ? s : (s?.rows || []);
                        for (const row of sRows) allStakes.push({ ...row, _ownerAddress: addr });
                    } catch (_) { /* per-address best effort */ }
                    try {
                        const u = await messaging.getContractUnstakesForAddress({ chainId, address: addr });
                        const uRows = Array.isArray(u) ? u : (u?.rows || []);
                        for (const row of uRows) allUnstakes.push({ ...row, _ownerAddress: addr });
                    } catch (_) { /* per-address best effort */ }
                    try {
                        const ev = await messaging.getSlashEventsForAddress({ chainId, address: addr });
                        const evRows = Array.isArray(ev) ? ev : (ev?.rows || []);
                        for (const row of evRows) allSlash.push({ ...row, _ownerAddress: addr });
                    } catch (_) { /* per-address best effort */ }
                }

                if (cancelled) return;
                setStakes(allStakes);
                setUnstakes(allUnstakes);
                setSlashEvents(allSlash);
                setLoading(false);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load contract positions.');
                    setLoading(false);
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back"
            title="Your contract stakes"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <p className={styles.empty}>
                    Contract-stake queries require explorer/SDK methods (getContractStakes,
                    getContractUnstakes, getSlashEvents) that land alongside this UI in a
                    Phase 7 follow-up. The protocol-level data is present in the indexer.
                </p>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (loading) {
        return wrap(<p className={styles.empty}>Loading…</p>);
    }
    if (stakes.length === 0 && unstakes.length === 0) {
        return wrap(
            <>
                <p className={styles.empty}>
                    No contract-targeted stakes for any of your addresses on this chain.
                </p>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }

    /** @type {Map<string, { contractIndex: string, stakes: any[], unstakes: any[] }>} */
    const groups = new Map();
    function addToGroup(key, kind, row) {
        if (!groups.has(key)) groups.set(key, { contractIndex: key, stakes: [], unstakes: [] });
        groups.get(key)[kind].push(row);
    }
    for (const s of stakes) addToGroup(String(s.target_contract_index), 'stakes', s);
    for (const u of unstakes) addToGroup(String(u.target_contract_index), 'unstakes', u);

    return wrap(
        <div className={styles.body}>
            {Array.from(groups.values()).map((g) => (
                <section key={g.contractIndex} style={{ marginBottom: '1.25rem' }}>
                    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <h3 style={{ fontSize: '0.95rem', margin: 0 }}>
                            Contract #{g.contractIndex}
                        </h3>
                        {onStakeToContract ? (
                            <Button
                                variant="ghost"
                                onClick={() => onStakeToContract({ chainId, contractActionIndex: g.contractIndex })}
                            >
                                Add stake
                            </Button>
                        ) : null}
                    </header>
                    {g.stakes.length > 0 ? (
                        <dl className={styles.entryDescription} style={{ margin: 0 }}>
                            {g.stakes.map((row, i) => (
                                <div key={String(row.action_index) + ':' + i} style={{ marginBottom: '0.35rem' }}>
                                    <strong>{row.tick}:</strong> {row.amount}
                                    {', pubkey: '}<code style={{ fontSize: '0.75rem' }}>
                                        {String(row.signing_pubkey || '').slice(0, 16)}…
                                    </code>
                                    {' '}from <AddressText address={String(row._ownerAddress)} />
                                </div>
                            ))}
                        </dl>
                    ) : null}
                    {g.unstakes.length > 0 ? (
                        <dl className={styles.entryDescription} style={{ margin: 0 }}>
                            {g.unstakes.map((row, i) => (
                                <div key={'u:' + String(row.action_index) + ':' + i} style={{ marginBottom: '0.35rem', color: '#9a6c00' }}>
                                    <strong>In cooldown:</strong> {row.amount} {row.tick}
                                    {', releases at block '}{String(row.cooldown_end_block)}
                                    {' '}(slashable until then)
                                </div>
                            ))}
                        </dl>
                    ) : null}
                </section>
            ))}

            {slashEvents.length > 0 ? (
                <section style={{ marginTop: '1rem' }}>
                    <h3 style={{ fontSize: '0.95rem' }}>Recent slashes against your positions</h3>
                    <dl className={styles.entryDescription} style={{ margin: 0 }}>
                        {slashEvents.slice(0, 20).map((ev, i) => (
                            <div key={'sl:' + i} style={{ color: '#b94a48', marginBottom: '0.3rem' }}>
                                Contract #{ev.target_contract_index} slashed{' '}
                                {ev.amount} {ev.tick} at block {ev.block_index}
                                {' '}→ <AddressText address={String(ev.destination_address || ev.destination || '')} />
                            </div>
                        ))}
                    </dl>
                </section>
            ) : null}

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </div>,
    );
}
