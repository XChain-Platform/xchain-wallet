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

/**
 * Contract detail page — §42.3.
 *
 * Layout (per spec):
 *
 *   Contract #42 — "MyMarket"                      [chain badge: BTC]
 *     Owner / Deployed / Gas limit / Status / Code hash
 *     State (expandable)
 *     Balances (tokens held by the contract)
 *     Execution history (paginated)
 *     [Call method]  [Deposit]  [Withdraw]
 *
 * Loads five queries in parallel on mount:
 *   1. getContractByActionIndex    — header metadata
 *   2. getActionByIndex            — originating DEPLOY action (NAME /
 *      CODE_HASH / CONSTRUCTOR_PARAMS)
 *   3. getContractState            — full state map
 *   4. getContractBalance          — full balances map
 *   5. getExecutionsForContract    — first page of executions
 *   …plus getAddressesByChain to flag "you own this" against the
 *   user's wallet addresses.
 *
 * EXECUTE / DEPOSIT / WITHDRAW buttons are rendered but are no-ops
 * until Steps 5 + 6 land the authoring forms. The `onExecute /
 * onDeposit / onWithdraw` props are optional — when omitted, the
 * buttons render disabled so the detail page ships complete in
 * Step 3 without a half-baked signing path.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onExecute]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onDeposit]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onWithdraw]
 * @param {() => void} props.onBack
 */
export function ContractDetail({
    walletId,
    chainId,
    contractActionIndex,
    onExecute,
    onDeposit,
    onWithdraw,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const descriptor = chainRegistry.get(chainId);

    const [contract, setContract] = useState(/** @type {any} */ (null));
    const [contractError, setContractError] = useState(/** @type {string | null} */ (null));
    const [deployAction, setDeployAction] = useState(/** @type {any} */ (null));
    const [deployError, setDeployError] = useState(/** @type {string | null} */ (null));
    const [state, setState] = useState(/** @type {any} */ (null));
    const [stateError, setStateError] = useState(/** @type {string | null} */ (null));
    const [balances, setBalances] = useState(/** @type {any} */ (null));
    const [balancesError, setBalancesError] = useState(/** @type {string | null} */ (null));
    const [executions, setExecutions] = useState(/** @type {any[]} */ ([]));
    const [executionsTotal, setExecutionsTotal] = useState(/** @type {number | null} */ (null));
    const [executionsError, setExecutionsError] = useState(/** @type {string | null} */ (null));
    const [executionsPage, setExecutionsPage] = useState(1);
    const [stateExpanded, setStateExpanded] = useState(false);
    const [walletAddresses, setWalletAddresses] = useState(/** @type {string[]} */ ([]));

    useEffect(() => {
        let cancelled = false;
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = extractSingle(resp);
                setContract(row);
                const deployIdx = row?.action_index ?? row?.deploy_action_index ?? contractActionIndex;
                if (deployIdx) {
                    messaging.getActionByIndex({ chainId, actionIndex: String(deployIdx) })
                        .then((a) => { if (!cancelled) setDeployAction(extractSingle(a)); })
                        .catch((e) => { if (!cancelled) setDeployError(e?.message || String(e)); });
                }
            })
            .catch((e) => { if (!cancelled) setContractError(e?.message || String(e)); });

        messaging.getContractState({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setState(resp); })
            .catch((e) => { if (!cancelled) setStateError(e?.message || String(e)); });

        messaging.getContractBalance({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setBalances(resp); })
            .catch((e) => { if (!cancelled) setBalancesError(e?.message || String(e)); });

        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const rows = Array.isArray(byChain?.[chainId]) ? byChain[chainId] : [];
                setWalletAddresses(rows.map((r) => r.address));
            })
            .catch(() => { /* ownership flag degrades silently */ });

        return () => { cancelled = true; };
    }, [walletId, chainId, contractActionIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        messaging.getExecutionsForContract({ chainId, contractActionIndex, opts: { page: executionsPage } })
            .then((resp) => {
                if (cancelled) return;
                setExecutions(extractRows(resp));
                setExecutionsTotal(typeof resp?.total === 'number' ? resp.total : null);
            })
            .catch((e) => { if (!cancelled) setExecutionsError(e?.message || String(e)); });
        return () => { cancelled = true; };
    }, [chainId, contractActionIndex, executionsPage, messaging]);

    const owner = contract?.source || contract?.SOURCE || contract?.owner || contract?.OWNER;
    const isOwner = useMemo(
        () => !!owner && walletAddresses.some((a) => a === String(owner)),
        [owner, walletAddresses],
    );
    const name = deployAction?.params?.NAME || contract?.name || contract?.NAME || '(unnamed)';
    const deployBlock = contract?.block_index || contract?.BLOCK_INDEX || '—';
    const gasLimit = contract?.gas_limit || contract?.GAS_LIMIT
        || deployAction?.params?.GAS_LIMIT || '—';
    const status = String(contract?.status || contract?.STATUS || 'Active');
    const codeHash = contract?.code_hash || contract?.CODE_HASH
        || deployAction?.params?.CODE_HASH || '—';

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to contracts list"
            title="Contract #{contractActionIndex}"
        />
    );
    if (contractError) {
        return (
            <Screen variant={variant} header={header}>
                <div role="alert" className={styles.entryDescription}>{contractError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </Screen>
        );
    }
    if (!contract) {
        return (
            <Screen variant={variant} header={header}>
                <p className={styles.entryDescription}>Loading contract…</p>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                <section>
                    <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <h2 style={{ fontSize: '1rem', margin: 0 }}>
                            Contract #{contractActionIndex} — &quot;{name}&quot;
                        </h2>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="md" /> : null}
                    </header>
                    <dl className={styles.entryDescription} style={{ margin: 0 }}>
                        <div><strong>Owner:</strong>{' '}
                            {owner
                                ? <><AddressText address={String(owner)} />{isOwner ? ' (you)' : ''}</>
                                : '—'}
                        </div>
                        <div><strong>Deployed:</strong> block {deployBlock}</div>
                        <div><strong>Gas limit:</strong> {gasLimit}</div>
                        <div><strong>Status:</strong> {status}</div>
                        <div><strong>Code hash:</strong> {String(codeHash)}</div>
                    </dl>
                    {deployError ? (
                        <p role="alert" className={styles.entryDescription}>
                            Couldn't load DEPLOY action metadata: {deployError}
                        </p>
                    ) : null}
                </section>

                <Section
                    title="State (expandable)"
                    rightSlot={
                        <button
                            type="button"
                            className={styles.entry}
                            style={{ padding: '0.25rem 0.5rem' }}
                            onClick={() => setStateExpanded((x) => !x)}
                            aria-expanded={stateExpanded}
                        >
                            {stateExpanded ? 'Collapse' : 'Expand'}
                        </button>
                    }
                >
                    {stateError ? (
                        <p role="alert" className={styles.entryDescription}>
                            Couldn't load contract state: {stateError}
                        </p>
                    ) : state === null ? (
                        <p className={styles.entryDescription}>Loading state…</p>
                    ) : stateExpanded ? (
                        <StateTable state={state} />
                    ) : (
                        <p className={styles.entryDescription}>
                            {stateKeyCount(state)} state key(s). Tap Expand to view.
                        </p>
                    )}
                </Section>

                <Section title="Balances (tokens held by the contract)">
                    {balancesError ? (
                        <p role="alert" className={styles.entryDescription}>
                            Couldn't load balances: {balancesError}
                        </p>
                    ) : balances === null ? (
                        <p className={styles.entryDescription}>Loading balances…</p>
                    ) : (
                        <BalancesTable balances={balances} />
                    )}
                </Section>

                <Section title="Execution history">
                    {executionsError && executions.length === 0 ? (
                        <p role="alert" className={styles.entryDescription}>
                            Couldn't load executions: {executionsError}
                        </p>
                    ) : executions.length === 0 ? (
                        <p className={styles.entryDescription}>
                            No EXECUTE calls recorded against this contract yet.
                        </p>
                    ) : (
                        <>
                            {executions.map((row, i) => (
                                <div key={String(row.action_index ?? i) + ':' + i} className={styles.entry}>
                                    <span className={styles.entryLabel}>
                                        {row.method || row.METHOD || '(method)'} — #{row.action_index ?? '?'}
                                    </span>
                                    <span className={styles.entryDescription}>
                                        {row.source ? (
                                            <>caller <AddressText address={String(row.source)} /> · </>
                                        ) : null}
                                        block {row.block_index || '—'}
                                    </span>
                                </div>
                            ))}
                            <Pagination
                                page={executionsPage}
                                total={executionsTotal}
                                pageSize={executions.length}
                                onChange={setExecutionsPage}
                            />
                        </>
                    )}
                </Section>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                    <Button
                        variant="primary"
                        onClick={onExecute ? () => onExecute({ chainId, contractActionIndex }) : undefined}
                        disabled={!onExecute}
                    >
                        Call method
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={onDeposit ? () => onDeposit({ chainId, contractActionIndex }) : undefined}
                        disabled={!onDeposit}
                    >
                        Deposit
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={onWithdraw ? () => onWithdraw({ chainId, contractActionIndex }) : undefined}
                        disabled={!onWithdraw}
                    >
                        Withdraw
                    </Button>
                </div>
                {!onExecute && !onDeposit && !onWithdraw ? (
                    <p className={styles.entryDescription}>
                        EXECUTE / DEPOSIT / WITHDRAW forms land in upcoming Phase 4
                        steps (§42.4 / §42.5). Viewing is available now.
                    </p>
                ) : null}
            </div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );
}

function Section({ title, rightSlot, children }) {
    return (
        <section style={{ marginBottom: '1rem' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <h2 style={{ fontSize: '1rem', margin: '0.5rem 0' }}>{title}</h2>
                {rightSlot}
            </header>
            {children}
        </section>
    );
}

function StateTable({ state }) {
    const entries = toKeyValueEntries(state);
    if (entries.length === 0) {
        return <p className={styles.entryDescription}>No state keys set yet.</p>;
    }
    return (
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
            <thead>
                <tr><th align="left">Key</th><th align="left">Value</th></tr>
            </thead>
            <tbody>
                {entries.map(([k, v]) => (
                    <tr key={k}>
                        <td style={{ verticalAlign: 'top', paddingRight: '0.5rem', fontFamily: 'monospace' }}>{k}</td>
                        <td style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{renderStateValue(v)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function BalancesTable({ balances }) {
    const rows = toBalanceRows(balances);
    if (rows.length === 0) {
        return <p className={styles.entryDescription}>Contract holds no tokens.</p>;
    }
    return (
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
            <thead>
                <tr><th align="left">Token</th><th align="right">Amount</th></tr>
            </thead>
            <tbody>
                {rows.map((r, i) => (
                    <tr key={String(r.tick) + ':' + i}>
                        <td style={{ fontFamily: 'monospace' }}>{r.tick}</td>
                        <td align="right" style={{ fontFamily: 'monospace' }}>{String(r.quantity)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Pagination({ page, total, pageSize, onChange }) {
    const hasNext = total === null
        ? pageSize >= 25  // heuristic when total is absent — a full page implies more
        : total > page * pageSize;
    const hasPrev = page > 1;
    if (!hasPrev && !hasNext) return null;
    return (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <Button
                variant="ghost"
                onClick={() => onChange(page - 1)}
                disabled={!hasPrev}
            >
                ← Prev
            </Button>
            <span className={styles.entryDescription}>Page {page}{total !== null ? ` of ${Math.ceil(total / pageSize)}` : ''}</span>
            <Button
                variant="ghost"
                onClick={() => onChange(page + 1)}
                disabled={!hasNext}
            >
                Next →
            </Button>
        </div>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function extractSingle(resp) {
    if (!resp) return null;
    if (resp.data && !Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    if (Array.isArray(resp) && resp.length > 0) return resp[0];
    return resp;
}

function stateKeyCount(state) {
    if (!state) return 0;
    if (Array.isArray(state)) return state.length;
    if (Array.isArray(state.data)) return state.data.length;
    if (state.state && typeof state.state === 'object') return Object.keys(state.state).length;
    if (typeof state === 'object') return Object.keys(state).length;
    return 0;
}

function toKeyValueEntries(state) {
    if (!state) return [];
    // Shape A: { data: [{ key, value }, ...] }
    if (Array.isArray(state.data)) {
        return state.data.map((row) => [String(row.key ?? row.KEY ?? ''), row.value ?? row.VALUE]);
    }
    // Shape B: { state: { k: v, ... } }
    if (state.state && typeof state.state === 'object') {
        return Object.entries(state.state);
    }
    // Shape C: flat { k: v, ... }
    if (typeof state === 'object' && !Array.isArray(state)) {
        return Object.entries(state);
    }
    return [];
}

function toBalanceRows(balances) {
    if (!balances) return [];
    if (Array.isArray(balances)) return balances.map(normalizeBalance);
    if (Array.isArray(balances.data)) return balances.data.map(normalizeBalance);
    if (Array.isArray(balances.balances)) return balances.balances.map(normalizeBalance);
    // Shape: { TICK: amount, ... }
    if (typeof balances === 'object') {
        return Object.entries(balances)
            .filter(([k]) => k !== 'data' && k !== 'total')
            .map(([tick, quantity]) => ({ tick, quantity }));
    }
    return [];
}

function normalizeBalance(row) {
    return {
        tick: row.tick || row.TICK || row.ticker || '?',
        quantity: row.quantity ?? row.amount ?? row.AMOUNT ?? '?',
    };
}

function renderStateValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return String(v); }
}
