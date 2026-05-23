import { useEffect, useMemo, useState } from 'react';
import { Screen, ScreenHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import {
    BalanceList,
    buildBalanceRows,
    buildNativeRow,
    sortByChainThenAsset,
    coinFromChainId,
} from '../components/BalanceList.jsx';
import { HeaderNetworkButton } from '../components/HeaderNetworkButton.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import sendPickerStyles from './SendPicker.module.css';
import styles from './ReceivePicker.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Receive picker — landing screen for the Receive quick-action. Mirrors
 * SendPicker structure: same balance-row list, same network filter, same
 * token search. Selecting a row hands {chainId, tick} to the host so the
 * Receive view opens with the chain pre-selected and (when a token row
 * was chosen) the Token field pre-filled so the QR encodes that asset.
 *
 * Receive is conceptually chain-scoped — the visible address is the
 * wallet's HD address on the selected chain — but listing balances lets
 * the user say "I want more of THIS asset" in one tap, which is a
 * common case.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {string} [props.tokenQuery]
 * @param {(query: string) => void} [props.onTokenQueryChange]
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 * @param {boolean} [props.hideOwnFilter]
 * @param {() => void} [props.onBack]
 * @param {(sel: { chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }) => void} props.onSelect
 */
export function ReceivePicker({
    walletId,
    accountId,
    networkFilter: networkFilterProp,
    onNetworkFilterChange: onNetworkFilterChangeProp,
    tokenQuery: tokenQueryProp,
    onTokenQueryChange: onTokenQueryChangeProp,
    kindFilter: kindFilterProp,
    onKindFilterChange: onKindFilterChangeProp,
    hideOwnFilter = false,
    onBack,
    onSelect,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [networkFilterLocal, setNetworkFilterLocal] = useState('all');
    const networkFilter = networkFilterProp ?? networkFilterLocal;
    const setNetworkFilter = onNetworkFilterChangeProp ?? setNetworkFilterLocal;

    const [tokenQueryLocal, setTokenQueryLocal] = useState('');
    const tokenQuery = tokenQueryProp ?? tokenQueryLocal;
    const setTokenQuery = onTokenQueryChangeProp ?? setTokenQueryLocal;

    const [kindFilterLocal, setKindFilterLocal] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    const kindFilter = kindFilterProp ?? kindFilterLocal;
    const setKindFilter = onKindFilterChangeProp ?? setKindFilterLocal;

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        messaging.getSettings()
            .then((s) => {
                if (cancelled) return;
                const hides = Array.isArray(s?.hiddenTokens)
                    ? s.hiddenTokens.filter((k) => typeof k === 'string')
                    : [];
                const pins = Array.isArray(s?.pinnedTokens)
                    ? s.pinnedTokens.filter((k) => typeof k === 'string')
                    : [];
                setHiddenTokens(hides);
                setPinnedTokens(pins);
            })
            .catch(() => { /* empty hide/pin lists are fine defaults */ });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => {
        if (!walletId) return undefined;
        let cancelled = false;
        setBalances(null);
        setAddressesByChain(null);
        setLoadError(null);
        (async () => {
            try {
                // Always pull addresses-by-chain too — receive needs to
                // surface every chain the wallet has addresses on, even
                // zero-balance ones, so the Coins tab is the full picker.
                const byChainPromise = typeof messaging.getAddressesByChain === 'function'
                    ? messaging.getAddressesByChain(walletId, accountId)
                    : Promise.resolve({});
                let b;
                if (flowsLib.isDemoWallet(walletId)
                    && typeof messaging.getAddressesByChain === 'function') {
                    const byChain = await byChainPromise;
                    if (!cancelled) setAddressesByChain(byChain);
                    b = flowsLib.synthesizeDemoBalances(byChain);
                } else {
                    const [byChain, walletBalances] = await Promise.all([
                        byChainPromise,
                        messaging.getWalletBalances(walletId, accountId),
                    ]);
                    if (!cancelled) setAddressesByChain(byChain);
                    b = walletBalances;
                }
                if (!cancelled) setBalances(b);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load balances.');
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    const allRows = useMemo(() => {
        const rowsFromBalances = buildBalanceRows(balances, chainRegistry);
        // Ensure every chain with an address contributes a native row,
        // even when it has zero balance — receive is meaningful at
        // zero balance.
        if (!addressesByChain) return rowsFromBalances;
        const seenChains = new Set();
        for (const r of rowsFromBalances) {
            if (r.kind === 'native') seenChains.add(r.chainId);
        }
        const synthesized = [];
        for (const chainId of Object.keys(addressesByChain)) {
            if (seenChains.has(chainId)) continue;
            const row = buildNativeRow(chainId, chainRegistry);
            if (row) synthesized.push(row);
        }
        return synthesized.length > 0 ? [...rowsFromBalances, ...synthesized] : rowsFromBalances;
    }, [balances, addressesByChain]);

    const coinFamilies = useMemo(() => {
        const seen = new Set();
        for (const r of allRows) {
            const coin = coinFromChainId(r.chainId);
            if (coin) seen.add(coin);
        }
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    }, [allRows]);

    const tokenQueryTrim = tokenQuery.trim().toLowerCase();
    const rows = useMemo(() => {
        let next = allRows;
        if (networkFilter !== 'all') {
            next = next.filter((r) => coinFromChainId(r.chainId) === networkFilter);
        }
        if (kindFilter === 'coins') {
            next = next.filter((r) => r.kind === 'native');
        } else if (kindFilter === 'tokens') {
            next = next.filter((r) => r.kind !== 'native');
        }
        if (tokenQueryTrim) {
            next = next.filter((r) => {
                const tick = String(r.tick || '').toLowerCase();
                const name = String(r.displayName || '').toLowerCase();
                return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
            });
        }
        return sortByChainThenAsset(next);
    }, [allRows, networkFilter, kindFilter, tokenQueryTrim]);

    const hiddenSet = useMemo(() => new Set(hiddenTokens), [hiddenTokens]);
    const pinnedSet = useMemo(() => new Set(pinnedTokens), [pinnedTokens]);

    const filterButton = !hideOwnFilter ? (
        <HeaderNetworkButton
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={networkFilter}
            onNetworkFilterChange={setNetworkFilter}
            tokenQuery={tokenQuery}
            onTokenQueryChange={setTokenQuery}
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
        />
    ) : null;

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Receive"
            trailing={filterButton}
        />
    );

    const emptyTitle = tokenQueryTrim
        ? 'No matching balances'
        : (networkFilter === 'all'
            ? 'No balances to receive against yet'
            : 'No balances on this network');
    const emptyBody = tokenQueryTrim
        ? `Nothing matches "${tokenQuery.trim()}". Clear the filter to see everything.`
        : (networkFilter === 'all'
            ? 'Pick a chain to display a fresh receive address. Tokens you have not held before can be received on whichever chain they belong to.'
            : undefined);

    const KIND_OPTIONS = [
        { id: 'all',    label: 'All' },
        { id: 'coins',  label: 'Coins' },
        { id: 'tokens', label: 'Tokens' },
    ];

    const body = (
        <>
            {loadError ? (
                <div role="alert" className={styles.error}>{loadError}</div>
            ) : null}
            <div className={styles.toolbar}>
                <div className={styles.kindSegments} role="tablist" aria-label="Asset kind">
                    {KIND_OPTIONS.map((opt) => {
                        const active = (kindFilter || 'all') === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                className={`${styles.kindSegment} ${active ? styles.kindSegmentActive : ''}`}
                                onClick={() => setKindFilter(opt.id)}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
                <input
                    type="text"
                    className={styles.search}
                    placeholder="Search coins or tokens"
                    value={tokenQuery}
                    onChange={(e) => setTokenQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-label="Search coins or tokens"
                />
            </div>
            {balances === null && !loadError ? (
                <div role="status" aria-label="Loading balances">
                    <Skeleton.List rows={5} />
                </div>
            ) : null}
            {balances ? (
                <BalanceList
                    rows={rows}
                    emptyTitle={emptyTitle}
                    emptyBody={emptyBody}
                    onSelectToken={(tok) => onSelect?.({
                        chainId: tok.chainId,
                        tick: tok.tick,
                        kind: tok.kind,
                        displayName: tok.displayName,
                        imageUrl: tok.imageUrl,
                    })}
                    hiddenKeys={hiddenSet}
                    pinnedKeys={pinnedSet}
                />
            ) : null}
        </>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={sendPickerStyles.card}>{body}</div> : body}
        </Screen>
    );
}
