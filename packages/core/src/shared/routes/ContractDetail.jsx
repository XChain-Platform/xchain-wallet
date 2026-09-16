// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    extractSingle,
    contractBalanceRows,
    contractAddressFor,
    contractDisplayLabel,
    contractMetaOf,
} from './contractResponseShape.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Contract detail page (§42.3).
 *
 * Layout (per spec):
 *
 *   Escrow v1.0.0 (C:BTC:42)      [chain badge: BTC]
 *     <description>
 *     Owner / Deployed / Gas limit / Status / Code hash
 *     State (expandable)
 *     Balances (tokens held by the contract)
 *     Execution history (paginated)
 *     [Call method]  [Deposit]  [Withdraw]
 *
 * Loads five queries in parallel on mount:
 *   1. getContractByActionIndex    - header metadata
 *   2. getActionByIndex            - originating DEPLOY action (NAME /
 *      CODE_HASH / CONSTRUCTOR_PARAMS)
 *   3. getContractState            - full state map
 *   4. getContractBalance          - full balances map
 *   5. getExecutionsForContract    - first page of executions
 *   ...plus getAddressesByChain to flag "you own this" against the
 *   user's wallet addresses.
 *
 * The heading name comes off the CHAIN: `meta.name` and `meta.version` are an
 * export of the contract's own source (CONTRACT_META_REQUIRED), extracted by
 * the indexer, so every viewer of this contract reads the same heading. It is
 * printed with the derived address because names are not unique. The
 * description is 512 bytes and shows here only, never on a list row. A contract
 * deployed before the flag day exports none and reads "Unnamed contract".
 *
 * EXECUTE / DEPOSIT / WITHDRAW buttons are rendered but are no-ops
 * until Steps 5 + 6 land the authoring forms. The `onExecute /
 * onDeposit / onWithdraw` props are optional. When omitted, the
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
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onStakeToContract]
 * @param {() => void} props.onBack
 */
export function ContractDetail({
    walletId,
    chainId,
    contractActionIndex,
    onExecute,
    onDeposit,
    onWithdraw,
    onStakeToContract,
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
    // Identity off the chain: "Escrow v1.0.0 (C:BTC:42)", with the description
    // beneath it. `contractActionIndex` is the address's own index, so the
    // heading is correct even before the contract row answers.
    const heading = contractDisplayLabel(contract, { chainId, actionIndex: contractActionIndex });
    const description = contractMetaOf(contract).description;
    const contractAddress = contractAddressFor(chainId, contractActionIndex);
    const deployBlock = contract?.block_index || contract?.BLOCK_INDEX || '?';
    const gasLimit = contract?.gas_limit || contract?.GAS_LIMIT
        || deployAction?.params?.GAS_LIMIT || '?';
    const status = String(contract?.status || contract?.STATUS || 'Active');
    const codeHash = contract?.code_hash || contract?.CODE_HASH
        || deployAction?.params?.CODE_HASH || '?';
    // Contract-staking metadata (DEPLOY v1+): null on non-stakeable contracts
    const cooldownBlocks = contract?.cooldown_blocks ?? contract?.COOLDOWN_BLOCKS ?? null;
    const slashDestinationAddr = contract?.slash_destination ?? contract?.SLASH_DESTINATION
        ?? contract?.slash_destination_address ?? null;
    const isStakeable = cooldownBlocks !== null && cooldownBlocks !== undefined;

        const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to contracts list"
            title={contractAddress || `Contract #${contractActionIndex}`}
        />
    );
    if (contractError) {
        return (
            <Screen variant={variant} header={header}>
                <StatusMessage variant="error" className={styles.entryDescription}>{contractError}</StatusMessage>
            </Screen>
        );
    }
    if (!contract) {
        return (
            <Screen variant={variant} header={header}>
                <p className={styles.entryDescription}>Loading contract…</p>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                <section>
                    <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <h2 style={{ fontSize: '1rem', margin: 0 }}>{heading}</h2>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="md" /> : null}
                    </header>
                    {/* 512 bytes: this is the one surface wide enough for it, so
                        the list rows carry the name and version alone. */}
                    {description ? (
                        <p className={styles.entryDescription} style={{ marginTop: 0 }}>{description}</p>
                    ) : null}
                    <dl className={styles.entryDescription} style={{ margin: 0 }}>
                        {contractAddress ? (
                            <div><strong>Address:</strong> {contractAddress}</div>
                        ) : null}
                        <div><strong>Owner:</strong>{' '}
                            {owner
                                ? <><AddressText address={String(owner)} />{isOwner ? ' (you)' : ''}</>
                                : '(unknown)'}
                        </div>
                        <div><strong>Deployed:</strong> block {deployBlock}</div>
                        <div><strong>Gas limit:</strong> {gasLimit}</div>
                        <div><strong>Status:</strong> {status}</div>
                        <div><strong>Code hash:</strong> {String(codeHash)}</div>
                        {isStakeable ? (
                            <>
                                <div><strong>Stakeable:</strong> yes, {String(cooldownBlocks)}-block cooldown</div>
                                <div><strong>Slash destination:</strong>{' '}
                                    {slashDestinationAddr
                                        ? <AddressText address={String(slashDestinationAddr)} />
                                        : '(set at deploy)'}
                                </div>
                            </>
                        ) : null}
                    </dl>
                    {deployError ? (
                        <StatusMessage variant="error" className={styles.entryDescription}>
                            Couldn't load deploy details: {deployError}
                        </StatusMessage>
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
                        <StatusMessage variant="error" className={styles.entryDescription}>
                            Couldn't load contract state: {stateError}
                        </StatusMessage>
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
                        <StatusMessage variant="error" className={styles.entryDescription}>
                            Couldn't load balances: {balancesError}
                        </StatusMessage>
                    ) : balances === null ? (
                        <p className={styles.entryDescription}>Loading balances…</p>
                    ) : (
                        <BalancesTable balances={balances} />
                    )}
                </Section>

                <Section title="Execution history">
                    {executionsError && executions.length === 0 ? (
                        <StatusMessage variant="error" className={styles.entryDescription}>
                            Couldn't load executions: {executionsError}
                        </StatusMessage>
                    ) : executions.length === 0 ? (
                        <p className={styles.entryDescription}>
                            No contract calls recorded against this contract yet.
                        </p>
                    ) : (
                        <>
                            {executions.map((row, i) => (
                                <div key={String(row.action_index ?? i) + ':' + i} className={styles.entry}>
                                    <span className={styles.entryLabel}>
                                        {row.method || row.METHOD || row.method_name || row.action || '(method)'} #{row.action_index ?? '?'}
                                        {' '}<ExecutionStatusPill status={row.status} />
                                    </span>
                                    <span className={styles.entryDescription}>
                                        {row.gas_used !== undefined && row.gas_used !== null ? (
                                            <>gas {row.gas_used} · </>
                                        ) : null}
                                        block {row.block_index || '?'}
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
                    {isStakeable ? (
                        <Button
                            variant="secondary"
                            onClick={onStakeToContract ? () => onStakeToContract({ chainId, contractActionIndex }) : undefined}
                            disabled={!onStakeToContract}
                        >
                            Stake here
                        </Button>
                    ) : null}
                </div>
                {!onExecute && !onDeposit && !onWithdraw ? (
                    <p className={styles.entryDescription}>
                        Contract call, deposit, and withdraw forms are coming in
                        an upcoming release. Viewing is available now.
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
    const rows = contractBalanceRows(balances);
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

// Execution status -> pill class, reusing the statusPill idiom shared with
// History.module.css: valid = succeeded, reverted = ran but rolled back,
// invalid = malformed action. An unknown or missing status renders no pill
// rather than implying success.
function executionStatusPillClass(status) {
    if (status === 'valid') return styles.statusPillSuccess;
    if (status === 'reverted') return styles.statusPillError;
    if (status === 'invalid') return styles.statusPillPending;
    return null;
}

function ExecutionStatusPill({ status }) {
    const pillClass = executionStatusPillClass(status);
    if (!pillClass) return null;
    return (
        <span className={`${styles.statusPill} ${pillClass}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
    );
}

function Pagination({ page, total, pageSize, onChange }) {
    const hasNext = total === null
        ? pageSize >= 25  // heuristic when total is absent: a full page implies more
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
    // Shape A: { data: [{ key, value }, ...] } is the SDK's declared shape.
    // { data: [{ state_key, state_value }, ...] } is what GET /contract/{idx}/state
    // actually returns; state_value is a JSON-encoded scalar there, so it gets
    // parsed once rather than passed through as raw escaped text.
    if (Array.isArray(state.data)) {
        return state.data.map((row) => {
            const key = String(row.key ?? row.KEY ?? row.state_key ?? '');
            if (row.value !== undefined) return [key, row.value];
            if (row.VALUE !== undefined) return [key, row.VALUE];
            return [key, parseStateValue(row.state_value ?? null)];
        });
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

function parseStateValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v;
    try {
        return JSON.parse(v);
    } catch {
        return v;
    }
}

function renderStateValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return String(v); }
}
