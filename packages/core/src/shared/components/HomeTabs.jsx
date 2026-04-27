import { useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import {
    BalanceList,
    buildBalanceRows,
    sortByChainThenAsset,
    coinFromChainId,
} from './BalanceList.jsx';
import { TotalBalanceHero } from './TotalBalanceHero.jsx';
import styles from './HomeTabs.module.css';

/**
 * Top-level tabbed view for Home.
 *
 *   Coins    — native rows (BTC / LTC / DOGE / …) only
 *   Tokens   — non-native, divisible (issuance tokens, stablecoins, …)
 *   NFTs     — non-native, indivisible (divisibility === 0)
 *   History  — chronological transaction stream (placeholder)
 *   DeFi     — staking, dispensers, contracts (placeholder)
 *
 * Network filter applies across every tab so flipping `BTC` filters
 * all tabs to BTC at once. Filter state owned here so it persists
 * when the user moves between tabs.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {Record<string, Array<{ balances: any | null }>>} props.balances
 * @param {string} props.networkFilter   'all' or a coin family
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {import('react').ReactNode} [props.actions]   slot rendered between the total-balance hero and the tab strip — used by Home for the Send / Receive / Swap / Buy quick-action row
 */
export function HomeTabs({ chainRegistry, balances, networkFilter, multisig, multisigChainId, actions }) {
    const [active, setActive] = useState('coins');

    const allRows = useMemo(
        () => buildBalanceRows(balances, chainRegistry),
        [balances, chainRegistry],
    );
    const filteredRows = useMemo(() => {
        if (networkFilter === 'all') return allRows;
        return allRows.filter((r) => coinFromChainId(r.chainId) === networkFilter);
    }, [allRows, networkFilter]);

    const coins = useMemo(
        () => sortByChainThenAsset(filteredRows.filter((r) => r.kind === 'native')),
        [filteredRows],
    );
    const tokens = useMemo(
        () => sortByChainThenAsset(filteredRows.filter(
            (r) => r.kind !== 'native' && r.divisibility > 0,
        )),
        [filteredRows],
    );
    const nfts = useMemo(
        () => sortByChainThenAsset(filteredRows.filter(
            (r) => r.kind !== 'native' && r.divisibility === 0,
        )),
        [filteredRows],
    );

    const tabs = [
        { id: 'coins',    label: 'Coins'    },
        { id: 'tokens',   label: 'Tokens'   },
        { id: 'nfts',     label: 'NFTs'     },
        { id: 'defi',     label: 'DeFi'     },
        { id: 'activity', label: 'Activity' },
    ];

    return (
        <div className={styles.wrap}>
            {/* Hero rolls up coins + tokens + NFTs (everything that
                lives in `filteredRows`). DeFi + Activity contribute
                their own dollar amounts via separate flows once they
                wire — for now they're not in the sum. */}
            <TotalBalanceHero
                rows={filteredRows}
                networkFilter={networkFilter}
            />

            {actions}

            <div className={styles.tabs} role="tablist" aria-label="Wallet view">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active === t.id ? 'true' : 'false'}
                        className={`${styles.tab} ${active === t.id ? styles.tabActive : ''}`}
                        onClick={() => setActive(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className={styles.panel} role="tabpanel">
                {active === 'coins' ? (
                    <BalanceList
                        rows={coins}
                        multisig={multisig}
                        multisigChainId={multisigChainId}
                        emptyMessage={networkFilter === 'all'
                            ? 'No coin balances yet.'
                            : 'No coins on this network.'}
                    />
                ) : null}

                {active === 'tokens' ? (
                    <BalanceList
                        rows={tokens}
                        emptyMessage={networkFilter === 'all'
                            ? 'No tokens yet. Browse markets or accept a token transfer to populate this view.'
                            : 'No tokens on this network.'}
                    />
                ) : null}

                {active === 'nfts' ? (
                    <BalanceList
                        rows={nfts}
                        emptyMessage={networkFilter === 'all'
                            ? 'No NFTs yet. Indivisible tokens (Rare Pepe, Ordinals, Bitcoin Stamps) appear here.'
                            : 'No NFTs on this network.'}
                    />
                ) : null}

                {active === 'activity' ? (
                    <Placeholder
                        title="Recent activity"
                        body="Sends, receives, sign events, broadcasts, multisig rounds, and approval grants surface here in reverse-chronological order. Wiring lands next — for now the Pancake → History entry shows the full chronological feed."
                    />
                ) : null}

                {active === 'defi' ? (
                    <Placeholder
                        title="DeFi positions"
                        body="Staking, dispensers, contract balances, and active orders consolidate here. Each gets its own card with a quick-action button."
                    />
                ) : null}
            </div>
        </div>
    );
}

function Placeholder({ title, body }) {
    return (
        <div className={styles.placeholder}>
            <div className={styles.placeholderTitle}>{title}</div>
            <p className={styles.placeholderBody}>{body}</p>
        </div>
    );
}
