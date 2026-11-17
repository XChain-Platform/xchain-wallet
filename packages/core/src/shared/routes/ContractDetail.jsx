// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AddressText, Button, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    extractSingle,
    contractBalanceRows,
    contractAddressFor,
    contractDisplayLabel,
    contractMetaOf,
    contractOwnerWithdraw,
    OWNER_WITHDRAW_DISABLED_REASON,
} from './contractResponseShape.js';
import { OwnerWithdrawWarning } from '../components/OwnerWithdrawWarning.jsx';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { listDetailStyles } from '../components/PanelSplit.jsx';
import tableStyles from '../components/DataTable.module.css';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { revealHiddenText } from '../utils/textHardening.js';
import styles from './ActionsMenu.module.css';
// The white identity card (G16): name, address, What It Does, holdings,
// publisher, block and calls. No chart.
import { ContractHero } from './ContractHero.jsx';
import { contractFunctions, matchesQuery, newestFirst, whatItDoesText } from './contractDetailModel.js';
import betStyles from './BetFeedDetail.module.css';
import local from './ContractDetail.module.css';

/** What the header search looks through on each tab. */
const SEARCH_LABELS = {
    actions: 'Search actions',
    activity: 'Search activity',
    details: 'Search details',
};

/**
 * Contract detail page (§42.3), laid out as the screen walk's layout 3
 * (2026-11-14).
 *
 * The white identity card (ContractHero), then three tabs on the shared
 * ActionsDetailsToggle: Actions, Details and Activity (G102). Actions holds the
 * contract's standard actions (Deposit, Withdraw, Stake here, View code, View state) and, under a
 * Contract Functions heading, one row per function, each opening its own call
 * form page, then Call by name for a method the list does not name. Details
 * holds the facts card. View code and View state are Actions rows, each opening its own
 * page. Activity is every call on the loaded history page, by anyone, newest
 * first. A search button in the header narrows the tab on screen, in memory.
 *
 * Loads five queries in parallel on mount:
 *   1. getContractByActionIndex    - header metadata
 *   2. getActionByIndex            - originating DEPLOY action (NAME /
 *      CODE_HASH / CONSTRUCTOR_PARAMS)
 *   3. getContractState            - full state map
 *   4. getContractBalance          - full balances map
 *   5. getExecutionsForContract    - one page of executions at a time
 *   ...plus getAddressesByChain to flag "you own this" against the
 *   user's wallet addresses. Tabs, search and the Code and State pages
 *   read nothing of their own: they show what these reads returned.
 *
 * The heading name comes off the CHAIN: `meta.name` and `meta.version` are an
 * export of the contract's own source (CONTRACT_META_REQUIRED), extracted by
 * the indexer, so every viewer of this contract reads the same heading. It is
 * printed with the derived address because names are not unique. The
 * description is 512 bytes and shows here only, never on a list row. A contract
 * deployed before the flag day exports none and reads "Unnamed contract".
 *
 * Owner withdraw (OWNER_WITHDRAW_OPT_IN) comes off the explorer's derived
 * `owner_withdraw`: false dims the Withdraw row and shows the reason, because
 * consensus refuses the action; true shows the deployer-can-withdraw warning;
 * an explorer that omits the field leaves the page as it was, with no warning.
 *
 * The function, Call by name, Deposit and Withdraw rows run the `onExecute /
 * onDeposit / onWithdraw` props, which are optional. When omitted, the
 * rows render disabled so the detail page ships complete without a
 * half-baked signing path.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {(ref: { chainId: string, contractActionIndex: string, method?: string }) => void} [props.onExecute]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onDeposit]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onWithdraw]
 * @param {(ref: { chainId: string, contractActionIndex: string }) => void} [props.onStakeToContract]
 * @param {() => void} props.onBack
 * @param {boolean} [props.embedded] draw inside Contracts' wide detail panel
 * @param {HTMLElement | null} [props.headerSlot] embedded detail tools target
 * @param {(el: HTMLElement | null) => void} [props.measureRef] standalone detail width target
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
    embedded = false,
    headerSlot = null,
    measureRef,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [contract, setContract] = useState(/** @type {any} */ (undefined));
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
    const [executionsLoading, setExecutionsLoading] = useState(true);
    // The explorer's page size, learnt from the fullest page read for this
    // contract. The last page is short, so the row count of the page on screen
    // is not the page size: dividing the total by it invents pages and keeps
    // Next live on the final one.
    const [pageSizeSeen, setPageSizeSeen] = useState({ key: '', size: 0 });
    const [executionsCursor, setExecutionsCursor] = useState(() => ({
        chainId,
        contractActionIndex,
        page: 1,
    }));
    const [walletAddresses, setWalletAddresses] = useState(/** @type {string[]} */ ([]));
    // The first history page and its total, kept apart from the page on
    // screen so paging Activity does not change the card's call count or the
    // function list a contract without an abi takes from its calls.
    const [firstPage, setFirstPage] = useState(/** @type {{ key: string, rows: any[], total: number | null }} */ ({ key: '', rows: [], total: null }));
    const firstPageReady = firstPage.key === `${chainId}:${contractActionIndex}`;
    const firstRows = firstPageReady ? firstPage.rows : null;
    // Actions opens first (G102). The page owns the pick so the search knows
    // which tab it narrows and a page opened from a row returns to its tab.
    const [tab, setTab] = useState(/** @type {'actions' | 'details' | 'activity'} */ ('actions'));
    const [query, setQuery] = useState('');
    // View code and State open as pages of their own; Back returns to Details.
    const [subPage, setSubPage] = useState(/** @type {'code' | 'state' | null} */ (null));
    const fnHeadingId = useId();
    const executionsPage = executionsCursor.chainId === chainId
        && executionsCursor.contractActionIndex === contractActionIndex
        ? executionsCursor.page
        : 1;

    useEffect(() => {
        let cancelled = false;
        setContract(undefined);
        setContractError(null);
        setDeployAction(null);
        setDeployError(null);
        setState(null);
        setStateError(null);
        setBalances(null);
        setBalancesError(null);
        setWalletAddresses([]);
        setSubPage(null);
        setQuery('');
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = extractSingle(resp);
                setContract(row);
                const deployIdx = row?.action_index ?? row?.deploy_action_index ?? contractActionIndex;
                if (deployIdx) {
                    messaging.getActionByIndex({ chainId, actionIndex: String(deployIdx) })
                        .then((a) => { if (!cancelled) setDeployAction(extractSingle(a)); })
                        .catch((e) => { if (!cancelled) setDeployError(readFailureMessage(e, 'load the publication details')); });
                }
            })
            .catch((e) => { if (!cancelled) setContractError(readFailureMessage(e, 'load this contract')); });

        messaging.getContractState({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setState(resp); })
            .catch((e) => { if (!cancelled) setStateError(readFailureMessage(e, 'load the contract state')); });

        messaging.getContractBalance({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setBalances(resp); })
            .catch((e) => { if (!cancelled) setBalancesError(readFailureMessage(e, 'load the contract balances')); });

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
        setExecutions([]);
        setExecutionsTotal(null);
        setExecutionsError(null);
        setExecutionsLoading(true);
        messaging.getExecutionsForContract({ chainId, contractActionIndex, opts: { page: executionsPage } })
            .then((resp) => {
                if (cancelled) return;
                const pageRows = extractRows(resp);
                const total = typeof resp?.total === 'number' ? resp.total : null;
                setExecutions(pageRows);
                if (executionsPage === 1) setFirstPage({ key: `${chainId}:${contractActionIndex}`, rows: pageRows, total });
                setPageSizeSeen((prev) => {
                    const key = `${chainId}:${contractActionIndex}`;
                    return { key, size: Math.max(prev.key === key ? prev.size : 0, pageRows.length) };
                });
                setExecutionsTotal(total);
                setExecutionsLoading(false);
            })
            .catch((e) => {
                if (!cancelled) {
                    setExecutionsError(readFailureMessage(e, 'load the execution history'));
                    if (executionsPage === 1) setFirstPage({ key: `${chainId}:${contractActionIndex}`, rows: [], total: null });
                    setExecutionsLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [chainId, contractActionIndex, executionsPage, messaging]);

    const executionsPageSize = pageSizeSeen.key === `${chainId}:${contractActionIndex}` ? pageSizeSeen.size : 0;
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
    const constructorParams = deployAction?.params?.CONSTRUCTOR_PARAMS ?? null;
    // Contract-staking metadata (DEPLOY v1+): null on non-stakeable contracts
    const cooldownBlocks = contract?.cooldown_blocks ?? contract?.COOLDOWN_BLOCKS ?? null;
    const slashDestinationAddr = contract?.slash_destination ?? contract?.SLASH_DESTINATION
        ?? contract?.slash_destination_address ?? null;
    const isStakeable = cooldownBlocks !== null && cooldownBlocks !== undefined;
    const ownerWithdraw = contractOwnerWithdraw(contract);

    const chooseTab = (next) => {
        setTab(next);
        setQuery('');
    };
    // The header search: one button at the top right that narrows the tab on
    // screen. It shows only once the contract has loaded, and never on the
    // Code and State pages, which have nothing to narrow.
    const searchLabel = SEARCH_LABELS[tab] || SEARCH_LABELS.actions;
    const filterMenu = contract ? (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            label={searchLabel}
            searchPlaceholder="Search"
            searchLabel={searchLabel}
        />
    ) : null;
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to contracts list"
            title="Contract Detail"
            trailing={filterMenu}
        />
    );
    const wrap = (children, { notices, pageHeader = header, showTools = true } = {}) => {
        const page = <ListPage notices={notices}>{children}</ListPage>;
        if (embedded) {
            return (
                <>
                    {headerSlot && showTools && filterMenu ? createPortal(filterMenu, headerSlot) : null}
                    {pageHeader !== header ? pageHeader : null}
                    {page}
                </>
            );
        }
        return (
            <Screen variant={variant} header={pageHeader}>
                {measureRef ? (
                    <div ref={measureRef} className={listDetailStyles.layoutRoot} data-list-detail="page">
                        {page}
                    </div>
                ) : page}
            </Screen>
        );
    };
    if (contractError) {
        return wrap(<StatusMessage variant="error" className={styles.entryDescription}>{contractError}</StatusMessage>);
    }
    if (contract === undefined) {
        return wrap(<StatusMessage variant="status">Loading contract…</StatusMessage>);
    }
    if (contract === null) {
        return wrap(<EmptyState title="Contract not found" body="It may have been removed or not indexed yet." />);
    }

    const balanceRows = balances === null || balancesError ? null : contractBalanceRows(balances);
    const fns = contractFunctions(contract?.abi, firstRows || executions);
    const stateEntries = state === null || stateError ? [] : toKeyValueEntries(state);

    // The Code and State pages: the facts Code and State tabs used to hold,
    // each on its own page with Back to the contract.
    if (subPage) {
        const subHeader = (
            <PageHeader
                nested
                onBack={() => setSubPage(null)}
                backLabel="Back to contract"
                title={subPage === 'code' ? 'Contract Code' : 'Contract State'}
            />
        );
        return wrap(
            <>
                    {subPage === 'code' ? (
                        <dl className={betStyles.facts} aria-label="Contract code">
                            {factRow('Code hash', <code className={local.mono}>{String(codeHash)}</code>)}
                            {factRow('Gas limit', String(gasLimit))}
                            {constructorParams !== null && constructorParams !== '' ? factRow(
                                'Constructor arguments',
                                <code className={local.mono}>{renderStateValue(constructorParams)}</code>,
                            ) : null}
                            {factRow('Functions', fns.source === 'abi'
                                ? `${fns.functions.length} in its published list`
                                : 'No published list')}
                        </dl>
                    ) : stateError ? (
                        <StatusMessage variant="error" className={styles.entryDescription}>
                            {stateError}
                        </StatusMessage>
                    ) : state === null ? (
                        <StatusMessage variant="status">Loading state…</StatusMessage>
                    ) : (
                        <StateTable state={state} />
                    )}
            </>,
            { pageHeader: subHeader, showTools: false },
        );
    }

    // The deployer warning and a failed publication read are about the whole
    // page, so they lead its content instead of sitting under the identity block.
    const notices = deployError || ownerWithdraw === true ? (
        <>
            <OwnerWithdrawWarning ownerWithdraw={ownerWithdraw} />
            {deployError ? (
                <StatusMessage variant="error" className={styles.entryDescription}>
                    {deployError}
                </StatusMessage>
            ) : null}
        </>
    ) : null;

    // The card shows the chain-recorded name and version; the rest of
    // the display label (the address) stays in the heading for screen readers.
    const meta = contractMetaOf(contract);
    const visibleName = meta.name ? `${meta.name}${meta.version ? ` v${meta.version}` : ''}` : 'Unnamed contract';
    const headingRest = heading.startsWith(visibleName) ? heading.slice(visibleName.length) : '';
    const aboutText = whatItDoesText(description, fns);
    // Only the explorer's own total is a count of every call: a failed read
    // or a page with no total says nothing about the rest, so the card then
    // shows no count rather than a wrong one.
    const callsTotal = firstPageReady ? firstPage.total : null;
    const searching = query.trim() !== '';
    const match = (...texts) => matchesQuery(query, ...texts);

    // ---- Actions: the standard actions, then the contract's functions ----
    const stakeText = `Stake tokens, ${String(cooldownBlocks)}-block cooldown`;
    const showDeposit = match('Deposit');
    const showWithdraw = match('Withdraw');
    const showStake = isStakeable && match('Stake here');
    const fnRows = fns.functions.filter((fn) => match(fn.name));
    const showCallByName = match('Call by name');
    const stateKeysText = stateError
        ? 'Its stored keys and values'
        : state === null ? 'Loading state…'
            : stateEntries.length === 0 ? 'No keys stored yet'
                : `${stateEntries.length} key${stateEntries.length === 1 ? '' : 's'}: ${stateEntries.slice(0, 3).map(([k]) => revealHiddenText(k)).join(', ')}${stateEntries.length > 3 ? ', and more' : ''}`;
    const showCode = match('View code');
    const showState = match('View state');
    const anyStandard = showDeposit || showWithdraw || showStake || showCode || showState;
    const anyFunction = fnRows.length > 0 || showCallByName;

    const actionsPanel = (
        <div className={local.panel}>
            {anyStandard ? (
                // The action list (G101): a row per action. A refused owner
                // withdraw stays as a dimmed row that says why.
                <ActionList label="Contract actions">
                    {showDeposit ? (
                        <ActionListItem
                            icon={<Icon.DownloadIcon />}
                            title="Deposit"
                            description="Send tokens into this contract"
                            onClick={onDeposit ? () => onDeposit({ chainId, contractActionIndex }) : undefined}
                            disabled={!onDeposit}
                        />
                    ) : null}
                    {showWithdraw ? (
                        <ActionListItem
                            icon={<Icon.UploadIcon />}
                            title="Withdraw"
                            description="Take tokens out of this contract"
                            onClick={onWithdraw ? () => onWithdraw({ chainId, contractActionIndex }) : undefined}
                            disabled={!onWithdraw || ownerWithdraw === false}
                            disabledReason={ownerWithdraw === false ? (
                                <span data-testid="owner-withdraw-disabled">{OWNER_WITHDRAW_DISABLED_REASON}</span>
                            ) : undefined}
                        />
                    ) : null}
                    {showStake ? (
                        <ActionListItem
                            icon={<Icon.StakeIcon />}
                            title="Stake here"
                            description={stakeText}
                            onClick={onStakeToContract ? () => onStakeToContract({ chainId, contractActionIndex }) : undefined}
                            disabled={!onStakeToContract}
                        />
                    ) : null}
                    {/* View code and View state open the same pages they always did. */}
                    {showCode ? (
                        <ActionListItem
                            icon={<Icon.DocumentIcon />}
                            title="View code"
                            description="The code hash and what it runs"
                            onClick={() => setSubPage('code')}
                        />
                    ) : null}
                    {showState ? (
                        <ActionListItem
                            icon={<Icon.ListIcon />}
                            title="View state"
                            description={stateKeysText}
                            onClick={() => setSubPage('state')}
                        />
                    ) : null}
                </ActionList>
            ) : null}

            {/* Contract Functions: one row per function, each opening its own
                call form page with that function chosen (Back returns here),
                then Call by name for a method the list does not name. The
                heading stays only while a function row is shown. */}
            {anyFunction ? (
                <section className={local.panel} aria-labelledby={fnHeadingId}>
                    <SectionHeader id={fnHeadingId} title="Contract Functions" />
                    <ActionList label="Contract functions">
                        {fnRows.map((fn) => (
                            <ActionListItem
                                key={fn.name}
                                icon={fn.kind === 'read' ? <Icon.EyeIcon /> : fn.kind === 'write' ? <Icon.PencilIcon /> : <Icon.ArrowRightIcon />}
                                title={<span className={local.fnName}>{fn.name}</span>}
                                description={fn.explanation}
                                trailing={fn.kind ? (
                                    <span
                                        className={`${local.fnTag} ${fn.kind === 'read' ? local.fnTagRead : ''}`}
                                        data-fn-kind={fn.kind}
                                    >
                                        {fn.kind === 'read' ? 'Read only' : 'Writes'}
                                    </span>
                                ) : undefined}
                                onClick={onExecute ? () => onExecute({ chainId, contractActionIndex, method: fn.name }) : undefined}
                                disabled={!onExecute}
                                data-contract-function={fn.name}
                            />
                        ))}
                        {showCallByName ? (
                            <ActionListItem
                                icon={<Icon.ArrowRightIcon />}
                                title="Call by name"
                                description={fns.functions.length > 0
                                    ? 'Type a method that is not listed'
                                    : 'This contract lists no functions; type a method by name'}
                                onClick={onExecute ? () => onExecute({ chainId, contractActionIndex }) : undefined}
                                disabled={!onExecute}
                            />
                        ) : null}
                    </ActionList>
                    {fns.source === 'history' && fnRows.length > 0 ? (
                        <p className={local.actionNote}>
                            This contract publishes no function list, so these are the methods its recent calls used.
                        </p>
                    ) : null}
                </section>
            ) : null}

            {searching && !anyStandard && !anyFunction ? (
                <EmptyState title="No matching actions" body="Change the search to see more." titleAs="p" />
            ) : null}
            {!onExecute && !onDeposit && !onWithdraw ? (
                <p className={local.actionNote}>
                    Contract call, deposit, and withdraw forms are coming in
                    an upcoming release. Viewing is available now.
                </p>
            ) : null}
        </div>
    );

    // ---- Details: the facts ----
    const holdingsValue = balancesError
        ? 'Unavailable'
        : balanceRows === null ? 'Loading…'
            : balanceRows.length === 0 ? 'None'
                : (
                    <span className={local.factLines}>
                        {balanceRows.map((r, i) => (
                            <span key={String(r.tick) + ':' + i}>{String(r.quantity)} {r.tick}</span>
                        ))}
                    </span>
                );
    const facts = [
        contractAddress ? ['Address', <AddressText key="a" address={contractAddress} truncate={false} />] : null,
        [isOwner ? 'Owner (you)' : 'Owner', owner ? <AddressText key="o" address={String(owner)} /> : 'Unknown'],
        ['Published', `block ${deployBlock}`],
        ['Status', status],
        ['Gas limit', String(gasLimit)],
        ['Holdings', holdingsValue],
        isStakeable ? ['Stakeable', `yes, ${String(cooldownBlocks)}-block cooldown`] : null,
        isStakeable ? ['Slash destination', slashDestinationAddr
            ? <AddressText key="s" address={String(slashDestinationAddr)} />
            : 'Set when published'] : null,
        ownerWithdraw !== null ? ['Owner withdraw', ownerWithdraw ? 'Allowed' : 'Not allowed'] : null,
    ].filter(Boolean).filter(([label]) => match(label));

    const detailsPanel = (
        <div className={local.panel}>
            {balancesError ? (
                <StatusMessage variant="error" className={styles.entryDescription}>
                    {balancesError}
                </StatusMessage>
            ) : null}
            {facts.length > 0 ? (
                <dl className={betStyles.facts} aria-label="Contract details">
                    {facts.map(([label, value]) => factRow(label, value))}
                </dl>
            ) : null}
            {searching && facts.length === 0 ? (
                <EmptyState title="No matching details" body="Change the search to see more." titleAs="p" />
            ) : null}
        </div>
    );

    // ---- Activity: every call on the loaded page, by anyone, newest first ----
    const activityRows = newestFirst(executions).filter((row) => match(
        executionLabel(row),
        visibleCaller(row),
        shownValue(row?.tx_hash),
        shownValue(row?.txid),
        shownValue(row?.tx_id),
    ));
    const pager = (
        <Pagination
            page={executionsPage}
            total={executionsTotal}
            pageSize={executions.length === 0 ? 0 : (executionsPageSize || executions.length)}
            onChange={(page) => setExecutionsCursor({ chainId, contractActionIndex, page })}
        />
    );
    const activityPanel = (
        <div className={local.panel}>
            {/* The Activity tab shows only the items; the list keeps an accessible name. */}
            <section aria-label="Contract activity" style={{ marginBottom: '1rem' }}>
                {executionsLoading && executions.length === 0 ? (
                    <StatusMessage variant="status">Loading execution history…</StatusMessage>
                ) : executionsError && executions.length === 0 ? (
                    <StatusMessage variant="error" className={styles.entryDescription}>
                        {executionsError}
                    </StatusMessage>
                ) : executions.length === 0 ? (
                    <>
                        <EmptyState
                            title="No contract activity yet"
                            body="Every call made to this contract, by anyone, appears here."
                            titleAs="p"
                        />
                        {/* A page past the last one is empty; Prev is the way back. */}
                        {pager}
                    </>
                ) : (
                    <>
                        {activityRows.length === 0 ? (
                            <EmptyState
                                title="No matching activity"
                                body="The search looks through the calls on this page."
                                titleAs="p"
                            />
                        ) : activityRows.map(executionRow)}
                        {pager}
                    </>
                )}
            </section>
        </div>
    );

    return wrap(
        <>
                <ContractHero
                    name={visibleName}
                    headingRest={headingRest}
                    contractAddress={contractAddress}
                    chainId={chainId}
                    owner={owner ? String(owner) : null}
                    isOwner={isOwner}
                    deployBlock={deployBlock}
                    about={aboutText}
                    holdings={balanceRows}
                    holdingsError={!!balancesError}
                    callsTotal={callsTotal}
                />

                {/* Actions | Details | Activity (G102). Only the chosen tab's
                    panel shows; every read already ran in the page above. */}
                <ActionsDetailsToggle
                    view={tab}
                    onViewChange={chooseTab}
                    label="Contract sections"
                    actions={actionsPanel}
                    details={detailsPanel}
                    extra={{
                        id: 'activity',
                        label: 'Activity',
                        icon: <Icon.HistoryIcon />,
                        after: true,
                        panel: activityPanel,
                    }}
                />
        </>,
        { notices },
    );
}

function factRow(label, value) {
    return (
        <div key={label} className={betStyles.factRow}>
            <dt className={betStyles.factLabel}>{label}</dt>
            <dd className={betStyles.factValue}>{value}</dd>
        </div>
    );
}

/** The method a row called, or its action's display label for a non-call row. */
function executionLabel(row) {
    return row.method || row.METHOD || row.method_name || actionDisplayLabel(row.action) || '(method)';
}

/**
 * An explorer field as the page may show or search it: null when the
 * explorer hides it behind a placeholder such as "[obfuscated]", so a search
 * never matches text the user cannot see.
 */
function shownValue(value) {
    if (typeof value !== 'string' || value === '' || value.startsWith('[')) return null;
    return value;
}

/** The caller's address, or null when the explorer hides it. */
function visibleCaller(row) {
    return shownValue(row?.caller ?? row?.source ?? row?.SOURCE);
}

function executionRow(row, i) {
    const caller = visibleCaller(row);
    return (
        <div key={String(row.action_index ?? i) + ':' + i} className={styles.entry}>
            <span className={styles.entryLabel}>
                {executionLabel(row)} #{row.action_index ?? '?'}
                {' '}<ExecutionStatusPill status={row.status} />
            </span>
            <span className={styles.entryDescription}>
                {caller ? (
                    <>by <AddressText address={caller} size="sm" /> · </>
                ) : null}
                {row.gas_used !== undefined && row.gas_used !== null ? (
                    <>gas {row.gas_used} · </>
                ) : null}
                block {row.block_index || '?'}
            </span>
        </div>
    );
}

function StateTable({ state }) {
    const entries = toKeyValueEntries(state);
    if (entries.length === 0) {
        return <EmptyState title="No state keys yet" body="Published contract state appears here." titleAs="p" />;
    }
    return (
        <table className={tableStyles.table}>
            <caption className={tableStyles.visuallyHiddenCaption}>Contract state</caption>
            <thead>
                <tr>
                    <th className={tableStyles.headerCell} scope="col">Key</th>
                    <th className={tableStyles.headerCell} scope="col">Value</th>
                </tr>
            </thead>
            <tbody>
                {entries.map(([k, v]) => (
                    <tr key={k}>
                        <td className={`${tableStyles.cell} ${tableStyles.mono}`} data-label="Key" style={{ verticalAlign: 'top' }}>{revealHiddenText(k, { keepLayout: true })}</td>
                        <td className={`${tableStyles.cell} ${tableStyles.mono}`} data-label="Value">{renderStateValue(v)}</td>
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
    const hasNext = pageSize > 0 && (total === null
        ? pageSize >= 25  // heuristic when total is absent: a full page implies more
        : total > page * pageSize);
    const hasPrev = page > 1;
    if (!hasPrev && !hasNext) return null;
    return (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <Button
                variant="ghost"
                onClick={() => onChange(page - 1)}
                disabled={!hasPrev}
            >
                <Icon.BackIcon /> Prev
            </Button>
            <span className={styles.entryDescription}>Page {page}{total !== null && pageSize > 0 ? ` of ${Math.ceil(total / pageSize)}` : ''}</span>
            <Button
                variant="ghost"
                onClick={() => onChange(page + 1)}
                disabled={!hasNext}
            >
                Next <Icon.ForwardIcon />
            </Button>
        </div>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    const rows = Array.isArray(resp)
        ? resp
        : (Array.isArray(resp.data) ? resp.data : (Array.isArray(resp.rows) ? resp.rows : []));
    return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

function toKeyValueEntries(state) {
    if (!state) return [];
    // Shape A: { data: [{ key, value }, ...] } is the SDK's declared shape.
    // { data: [{ state_key, state_value }, ...] } is what GET /contract/{idx}/state
    // actually returns; state_value is a JSON-encoded scalar there, so it gets
    // parsed once rather than passed through as raw escaped text.
    if (Array.isArray(state)) return stateRowsToEntries(state);
    if (Array.isArray(state.data)) return stateRowsToEntries(state.data);
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

function isStateRow(row) {
    return !!row && typeof row === 'object' && !Array.isArray(row);
}

function stateRowsToEntries(rows) {
    return rows.filter(isStateRow).map((row) => {
        const key = String(row.key ?? row.KEY ?? row.state_key ?? '');
        if (row.value !== undefined) return [key, row.value];
        if (row.VALUE !== undefined) return [key, row.VALUE];
        return [key, parseStateValue(row.state_value ?? null)];
    });
}

// state_value is the JSON text the contract stored. A JSON string is shown
// unquoted; every other value is shown as the stored text, because a parsed
// number cannot say what was stored (12345678901234567890 reads back as
// 12345678901234567000, 1.50 as 1.5, 1e21 as 1e+21) and a parsed object loses
// the same digits inside it.
function parseStateValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v;
    try {
        const parsed = JSON.parse(v);
        return typeof parsed === 'string' ? parsed : v.trim();
    } catch {
        return v;
    }
}

// Contract-controlled text: a bidi override or a zero-width character is
// spelled out so a stored value cannot read as something else.
function renderStateValue(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return revealHiddenText(v, { keepLayout: true });
    }
    try { return revealHiddenText(JSON.stringify(v), { keepLayout: true }); } catch { return String(v); }
}
