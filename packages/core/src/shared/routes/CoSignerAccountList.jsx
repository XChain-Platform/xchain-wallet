// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccountList (§22, P4 passive co-signer, management UI).
//
// Lists the agent accounts this wallet co-signs for, newest first. Entry
// point to create a new account (the provision wizard) or open one for
// detail / policy edit / enable-disable.

import { useEffect, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { allowedTokensText, agentNetworkName } from '../utils/coSignerPolicyLimit.js';
import { formatAtomicAmount, formatTokenQuantity } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/send.js';
import styles from './IssueTokenForm.module.css';
import listStyles from './CoSignerAccountList.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} props.onProvision              open the new-account wizard
 * @param {(accountId: string) => void} props.onOpen  open an account's detail
 */
// One rule line, e.g. "2-of-2 · Send, Order · up to 0.05 BTC each", built from
// the account and its spending policy.
function agentRuleLine(a) {
    const kind = a.recoveryPublicKey ? '2-of-3 with recovery' : '2-of-2';
    const actions = (a.policy?.allowedActions || []).map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(', ');
    const per = a.policy?.maxPerAction ? Object.values(a.policy.maxPerAction)[0] : null;
    const perText = per ? Object.entries(per).map(([tick, cap]) => `up to ${cap} ${tick === '*' ? '' : tick} each`.replace('  ', ' ')).join(', ') : '';
    const win = a.policy?.maxPerWindow;
    const winText = !perText && win ? (win.maxActions ? `${win.maxActions} per ${win.hours} h` : win.perTick ? Object.entries(win.perTick).map(([tick, cap]) => `${cap} ${tick} per ${Math.round(win.hours / 24)} days`).join(', ') : '') : '';
    const tokens = a.policy && Array.isArray(a.policy.allowedTicks) ? allowedTokensText(a.policy) : '';
    return [kind, actions, tokens, perText || winText].filter(Boolean).join(' · ');
}

/**
 * A balance row's amount for reading: the atomic quantity at its
 * divisibility, grouped, with trailing zeros dropped (0.4821, 12,000).
 *
 * @param {{ quantity: string, divisibility: number }} row
 * @returns {string}
 */
export function formatHolding(row) {
    const raw = String(row?.quantity ?? '');
    const scale = Number(row?.divisibility);
    if (!/^\d+$/.test(raw) || !Number.isInteger(scale) || scale <= 0) return formatAtomicAmount(raw, 0);
    const padded = raw.padStart(scale + 1, '0');
    return formatTokenQuantity(`${padded.slice(0, -scale)}.${padded.slice(-scale)}`, scale);
}

/**
 * One account's holdings as one line, "0.4821 BTC · 2 tokens", from the
 * balances read for every row at once.
 *
 * @param {Record<string, { balances: any, error: string | null }> | null} byId  null while loading
 * @param {string} accountId
 * @returns {string}
 */
export function balanceSummary(byId, accountId) {
    if (byId === null) return t('coSigner.balanceLoading');
    const entry = byId[accountId];
    const shape = entry && entry.balances;
    if (!shape || !shape.native) return t('send.balance.unknown');
    const native = `${formatHolding(shape.native)} ${shape.native.tick}`;
    const held = Array.isArray(shape.tokens) ? shape.tokens.filter((row) => row && row.quantity !== '0').length : 0;
    return held > 0 ? `${native} · ${t('coSigner.tokenCount', { count: held })}` : native;
}

export function CoSignerAccountList({ walletId, onBack, onProvision, onOpen }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Balances keyed by account id, from one read for every row; null while loading.
    const [balances, setBalances] = useState(/** @type {Record<string, any> | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setAccounts(null);
        setError(null);
        setBalances(null);
        Promise.resolve()
            .then(() => messaging.listCoSignerAccounts({ walletId }))
            .then((list) => { if (!cancelled) setAccounts(Array.isArray(list) ? list : []); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load agent accounts.'); });
        // A shell without the balances route shows each row's balance as unavailable.
        Promise.resolve()
            .then(() => (typeof messaging.getCoSignerAccountBalances === 'function'
                ? messaging.getCoSignerAccountBalances({ walletId })
                : {}))
            .then((byId) => { if (!cancelled) setBalances(byId && typeof byId === 'object' ? byId : {}); })
            .catch(() => { if (!cancelled) setBalances({}); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // A plus at the far right of the title line creates an account.
    const header = (
        <PageHeader
            onBack={onBack}
            title="Agent Accounts"
            trailing={(
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon.PlusIcon />}
                    onClick={onProvision}
                    aria-label="New agent account"
                    title="New agent account"
                />
            )}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (error) return wrap(<ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage>);
    if (!accounts) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    return wrap(
        <ListPage
            // The screen's one green main action, in the empty and the filled
            // state alike (U63); the shared EmptyState would draw a blue one.
        >
            {accounts.length === 0 ? (
                <EmptyState
                    title="No agent accounts yet"
                    body="Create one to let an agent share a 2-of-2 address with this wallet."
                />
            ) : (
                // One flush list card with divider lines, rows never boxed apart (U41, U58).
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul aria-label="Agent accounts" className={listStyles.list} role="list">
                    {accounts.map((a) => {
                        const descriptor = chainRegistry.get(a.chainId);
                        return (
                            <li key={a.id}>
                                <ListRow
                                    type="button"
                                    onClick={() => onOpen(a.id)}
                                    leading={<span className={listStyles.rowIcon} aria-hidden="true"><Icon.UsersIcon /></span>}
                                    title={a.name}
                                    chevron
                                    // The type and the main rule under the name, then the
                                    // network and what the account holds, then the address.
                                    subtitle={(
                                        <>
                                            <span style={{ display: 'block' }}>{agentRuleLine(a)}</span>
                                            <span className={listStyles.rowFacts}>
                                                {descriptor ? <span>{t('coSigner.network', { network: agentNetworkName(descriptor) })}</span> : null}
                                                <span data-testid="agent-balance">{balanceSummary(balances, a.id)}</span>
                                            </span>
                                            <AddressText address={a.aggregateAddress} truncate />
                                        </>
                                    )}
                                    trailing={(
                                        <span style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexShrink: 0 }}>
                                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : null}
                                            <span style={{
                                                fontSize: '0.8em',
                                                color: a.enabled ? 'var(--xc-success, green)' : 'var(--xc-text-muted)',
                                            }}>
                                                {a.enabled ? 'Active' : 'Turned off'}
                                            </span>
                                        </span>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </ListPage>,
    );
}
