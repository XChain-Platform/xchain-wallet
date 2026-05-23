import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Staking is BTC-only at launch per §10.3 (SDK staking actions are
// bitcoin-exclusive). Nav item is gated on BTC address presence.
const STAKING_COIN = 'bitcoin';

/**
 * Staking dashboard — §42.7.4.
 *
 * Read-only central view for stakers. Shows (per BTC chain the wallet
 * has an address on):
 *   - Your stake (amount + tier)
 *   - Delegated signing pubkey (if DELEGATE has been issued)
 *   - Chains the signing key validates (Tier 2 only)
 *   - Pending rewards + Claim button
 *   - Lifetime rewards
 *   - Action buttons: Unstake / Delegate new key / Revoke delegation
 *   - Recent reward events
 *
 * The four write-side action buttons (Unstake / Delegate / Revoke /
 * Claim) render disabled when their respective `on*` props are absent
 * — Steps 8–10 thread real handlers through as their forms land,
 * following the pattern established in Step 3's ContractDetail.
 *
 * Multiple BTC chains (mainnet / testnet / regtest) each render as
 * their own section.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(ref: { chainId: string, address: string }) => void} [props.onStake]
 * @param {(ref: { chainId: string, address: string }) => void} [props.onUnstake]
 * @param {(ref: { chainId: string, address: string }) => void} [props.onDelegate]
 * @param {(ref: { chainId: string, address: string }) => void} [props.onRevokeDelegation]
 * @param {(ref: { chainId: string, address: string }) => void} [props.onClaimRewards]
 * @param {(ref: { chainId: string, address: string }) => void} [props.onOpenOperatorDashboard]
 * @param {() => void} props.onBack
 */
export function StakingDashboard({
    walletId,
    onStake,
    onUnstake,
    onDelegate,
    onRevokeDelegation,
    onClaimRewards,
    onOpenOperatorDashboard,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const btcChainIds = useMemo(
        () => chainRegistry.byCoin(STAKING_COIN).map((d) => d.id),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );

    /** @typedef {{ loading: boolean, stakes: any[], delegations: any[], rewards: any[], error: string | null }} ChainState */
    const [stateByChain, setStateByChain] = useState(
        /** @type {Record<string, ChainState>} */ ({}),
    );

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) setAddressesError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const btcChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return btcChainIds.filter((cid) =>
            Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0,
        );
    }, [btcChainIds, addressesByChain]);

    // For each active BTC chain, fan out per-address stakes +
    // delegations + rewards. Merge per address; the dashboard shows
    // the aggregate across the wallet's addresses on that chain.
    useEffect(() => {
        if (btcChainsWithAddresses.length === 0) {
            setStateByChain({});
            return;
        }
        const initial = {};
        for (const cid of btcChainsWithAddresses) {
            initial[cid] = { loading: true, stakes: [], delegations: [], rewards: [], error: null };
        }
        setStateByChain(initial);

        let cancelled = false;
        for (const cid of btcChainsWithAddresses) {
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
            const ops = addrs.flatMap((addr) => [
                messaging.getStakesForAddress({ chainId: cid, address: addr })
                    .then((r) => ({ k: 'stakes', rows: extractRows(r) }))
                    .catch((e) => ({ k: 'stakes', error: e?.message || String(e) })),
                messaging.getDelegationsForAddress({ chainId: cid, address: addr })
                    .then((r) => ({ k: 'delegations', rows: extractRows(r) }))
                    .catch((e) => ({ k: 'delegations', error: e?.message || String(e) })),
                messaging.getRewardsForAddress({ chainId: cid, address: addr })
                    .then((r) => ({ k: 'rewards', rows: extractRows(r) }))
                    .catch((e) => ({ k: 'rewards', error: e?.message || String(e) })),
            ]);
            Promise.all(ops).then((results) => {
                if (cancelled) return;
                const merged = { stakes: [], delegations: [], rewards: [] };
                const errs = [];
                for (const r of results) {
                    if (r.error) errs.push(r.error);
                    else merged[r.k].push(...r.rows);
                }
                for (const key of Object.keys(merged)) {
                    merged[key].sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                }
                setStateByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        stakes: merged.stakes,
                        delegations: merged.delegations,
                        rewards: merged.rewards,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [btcChainsWithAddresses, addressesByChain, messaging]);

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Staking"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {children}
            </div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (addressesError) {
        return wrap(<div role="alert" className={styles.entryDescription}>{addressesError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (btcChainsWithAddresses.length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                Staking is available on Bitcoin only at launch. Use Receive
                on a Bitcoin network to generate an address first.
            </p>,
        );
    }

    return wrap(
        btcChainsWithAddresses.map((cid) => {
            const d = chainRegistry.get(cid);
            const state = stateByChain[cid] || { loading: true, stakes: [], delegations: [], rewards: [], error: null };
            const primaryStake = state.stakes[0];
            const primaryDelegation = state.delegations[0];
            const { pending, lifetime } = splitRewards(state.rewards);
            const primaryAddress = (addressesByChain[cid] || [])[0]?.address;

            return (
                <section key={cid} style={{ marginBottom: '1rem' }}>
                    <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {d ? <ChainBadge descriptor={d} size="md" /> : <span>{cid}</span>}
                    </header>
                    {state.loading ? (
                        <p className={styles.entryDescription}>Loading stake, delegation, rewards…</p>
                    ) : (
                        <>
                            {state.error && !primaryStake ? (
                                <p role="alert" className={styles.entryDescription}>
                                    Couldn't load staking data: {state.error}
                                </p>
                            ) : null}
                            <dl className={styles.entryDescription} style={{ margin: 0 }}>
                                <div>
                                    <strong>Your stake:</strong>{' '}
                                    {primaryStake
                                        ? <>{formatAmount(primaryStake)} {formatTier(primaryStake)}</>
                                        : '— (not staked on this chain)'}
                                </div>
                                <div>
                                    <strong>Delegated pubkey:</strong>{' '}
                                    {primaryDelegation
                                        ? <>{shortPubkey(primaryDelegation.signing_pubkey || primaryDelegation.SIGNING_PUBKEY)}{' '}{ageLabel(primaryDelegation.block_index)}</>
                                        : '— (none)'}
                                </div>
                                {primaryStake?.chains || primaryStake?.CHAINS ? (
                                    <div>
                                        <strong>Chains:</strong> {primaryStake.chains || primaryStake.CHAINS}
                                    </div>
                                ) : null}
                                <div>
                                    <strong>Pending rewards:</strong>{' '}
                                    {pending > 0 ? `${pending} XCP` : '0'}
                                    {' '}
                                    <Button
                                        variant="primary"
                                        onClick={
                                            onClaimRewards && primaryAddress && pending > 0
                                                ? () => onClaimRewards({ chainId: cid, address: primaryAddress })
                                                : undefined
                                        }
                                        disabled={!onClaimRewards || !primaryAddress || pending <= 0}
                                    >
                                        Claim
                                    </Button>
                                </div>
                                <div>
                                    <strong>Lifetime rewards:</strong> {lifetime} XCP
                                </div>
                            </dl>

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                {primaryStake ? null : (
                                    <Button
                                        variant="primary"
                                        onClick={onStake && primaryAddress
                                            ? () => onStake({ chainId: cid, address: primaryAddress })
                                            : undefined}
                                        disabled={!onStake || !primaryAddress}
                                    >
                                        Stake
                                    </Button>
                                )}
                                <Button
                                    variant="secondary"
                                    onClick={onUnstake && primaryStake && primaryAddress
                                        ? () => onUnstake({ chainId: cid, address: primaryAddress })
                                        : undefined}
                                    disabled={!onUnstake || !primaryStake || !primaryAddress}
                                >
                                    Unstake
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={onDelegate && primaryStake && primaryAddress
                                        ? () => onDelegate({ chainId: cid, address: primaryAddress })
                                        : undefined}
                                    disabled={!onDelegate || !primaryStake || !primaryAddress}
                                >
                                    Delegate new key
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={onRevokeDelegation && primaryDelegation && primaryAddress
                                        ? () => onRevokeDelegation({ chainId: cid, address: primaryAddress })
                                        : undefined}
                                    disabled={!onRevokeDelegation || !primaryDelegation || !primaryAddress}
                                >
                                    Revoke delegation
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={onOpenOperatorDashboard && primaryStake && primaryAddress
                                        ? () => onOpenOperatorDashboard({ chainId: cid, address: primaryAddress })
                                        : undefined}
                                    disabled={!onOpenOperatorDashboard || !primaryStake || !primaryAddress}
                                >
                                    Operator view
                                </Button>
                            </div>

                            {state.rewards.length > 0 ? (
                                <>
                                    <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.25rem' }}>
                                        Recent reward events
                                    </h3>
                                    <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                                        {state.rewards.slice(0, 10).map((r, i) => (
                                            <li key={String(r.action_index ?? i) + ':' + i} className={styles.entryDescription}>
                                                {formatRewardAmount(r)} XCP
                                                {' '}at block {r.block_index || '—'}
                                                {r.status ? ` · ${r.status}` : ''}
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : null}
                        </>
                    )}

                    {!onStake && !onUnstake && !onDelegate && !onRevokeDelegation && !onClaimRewards ? (
                        <p className={styles.entryDescription}>
                            STAKE / UNSTAKE / DELEGATE / REVOKE / CLAIM forms land in
                            upcoming Phase 4 steps. Viewing is available now.
                        </p>
                    ) : null}
                </section>
            );
        }),
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function formatAmount(stake) {
    const amt = stake?.amount ?? stake?.AMOUNT ?? stake?.quantity ?? '—';
    return `${amt} XCP`;
}

function formatTier(stake) {
    const tier = stake?.tier ?? stake?.TIER;
    if (tier === 1 || tier === '1') return '(Tier 1 — Oracle)';
    if (tier === 2 || tier === '2') return '(Tier 2 — Cross-chain validator)';
    if (tier === 3 || tier === '3') return '(Tier 3 — Publisher)';
    return tier ? `(Tier ${tier})` : '';
}

function splitRewards(rows) {
    let pending = 0;
    let lifetime = 0;
    for (const r of rows) {
        const amt = Number(r.amount ?? r.AMOUNT ?? r.reward ?? 0);
        if (!Number.isFinite(amt)) continue;
        const status = String(r.status || '').toLowerCase();
        if (status === 'pending' || status === 'unclaimed') pending += amt;
        lifetime += amt;
    }
    return { pending, lifetime };
}

function formatRewardAmount(row) {
    return row?.amount ?? row?.AMOUNT ?? row?.reward ?? '—';
}

function shortPubkey(pk) {
    if (!pk || typeof pk !== 'string') return '—';
    return pk.length > 16 ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : pk;
}

function ageLabel(blockIndex) {
    if (!blockIndex) return '';
    // Block-based rough age: bitcoin averages ~144 blocks/day.
    // We don't know the current tip here, so render "block N" only.
    return `(delegated at block ${blockIndex})`;
}
