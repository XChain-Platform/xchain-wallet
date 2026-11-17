// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccountDetail (§22, P4 passive co-signer, management UI).
//
// Shows one agent account: the aggregate address to fund, its policy, the
// current rolling-window usage, and an enable/disable toggle. Editing the
// policy reuses CoSignerPolicyEditor (the same authoring surface as the
// provision wizard), so there is one place that knows the policy shape.
//
// A disabled account is refused by the daemon and treated as unknown by the
// bridge resolver, so the toggle is the safe kill-switch.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
    EmptyState,
    FormPage,
    Icon,
    Notice,
    StatusMessage,
    ListPage,
    Tabs,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { balanceSummary, formatHolding } from './CoSignerAccountList.jsx';
import { allowedTokensText } from '../utils/coSignerPolicyLimit.js';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { normalizeAllowedTicks, nativeTickForChain } from '../../cosigner/allowedTicks.js';
import { describePolicyReason } from '../components/coSignPolicyReasons.js';
import { formatRelativeTime } from '../utils/dateTime.js';
import { copyText } from '../clipboard.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/extension.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/renameAccount.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/walletDetails.js';
import {
    CoSignerPolicyEditor,
    draftFromAccount,
    buildPolicyDraft,
    declarePolicyTokenIds,
} from './CoSignerPolicyEditor.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { listDetailStyles } from '../components/PanelSplit.jsx';
// The agent's tile and its Edit look page share the wallet and account look:
// the same initials tile, the same TileLookFields, the same per-device store.
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { TileLookFields, TILE_COLOURS } from '../components/TileLookFields.jsx';
import { FormAction, FormFrame } from '../components/formStandard/index.js';
import { readWalletTile, writeWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameLength } from '../../util/display_name.js';
import styles from './IssueTokenForm.module.css';
// The token page's identity card, details card and icon tabs.
import tokenPageStyles from './ManageToken.module.css';
import tokenDetailStyles from './TokenDetail.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import local from './CoSignerAccountDetail.module.css';
// The Fund page: the Receive page's QR look over the standard Send form,
// whose destination is this agent's address.
import { Send } from './Send.jsx';
import { KeyQR } from '../components/KeyQR.jsx';
import { InPageScreen } from '../../ui/navHistory.js';
import qrStyles from '../../ui/QrDisplay.module.css';
import '../../i18n/locales/en/receive.js';

const chainRegistry = registryLib.defaultRegistry();

// How often the page asks for requests waiting on the owner.
const PENDING_REFRESH_MS = 10_000;
const COSIGNER_CHAIN_IDS = new Set(chainRegistry.byCoin('bitcoin').map((descriptor) => descriptor.id));

function accountMatchesScope(account, accountId, walletId) {
    return Boolean(account
        && account.id === accountId
        && (walletId == null || account.walletId === walletId)
        && COSIGNER_CHAIN_IDS.has(account.chainId));
}

function policyAddressError(built, descriptor) {
    for (const [index, address] of (built.policy.allowedDestinations || []).entries()) {
        const error = addressValidationError(address, descriptor);
        if (error) return `Allowed recipient ${index + 1}: ${error}`;
    }
    for (const [index, output] of built.allowedOutputs.entries()) {
        const error = addressValidationError(output.address, descriptor);
        if (error) return `Allowed output ${index + 1}: ${error}`;
    }
    return null;
}

/**
 * @param {object} props
 * @param {string} props.accountId
 * @param {string} [props.walletId]
 * @param {() => void} props.onBack
 * @param {boolean} [props.embedded]
 * @param {(el: HTMLElement | null) => void} [props.measureRef]
 */
export function CoSignerAccountDetail({ accountId, walletId, onBack, embedded = false, measureRef }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const confirmDialog = useConfirmModal();

    const [account, setAccount] = useState(/** @type {any | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [policyDraft, setPolicyDraft] = useState(null);
    const [editError, setEditError] = useState(/** @type {string | null} */ (null));
    // Per-ticker messages from the last save's token number lookup.
    const [tokenErrors, setTokenErrors] = useState(/** @type {Record<string, string> | null} */ (null));
    const editBaselineRef = useRef('');
    // Edit look stands in for this page until Back or Save (no modal, G104);
    // closing it re-renders the page, which reads the stored tile again.
    const [lookOpen, setLookOpen] = useState(false);
    const viewRef = useRef(0);
    const operationRef = useRef(0);
    const busyRef = useRef(false);

    const tabsId = useId();
    const [activeTab, setActiveTab] = useState('actions');
    // The Fund page stands in for this page until its Back, like Edit rules,
    // so Back from it returns here and never to the agents list.
    const [showFund, setShowFund] = useState(false);
    const [copied, setCopied] = useState(false);
    // Balances keyed by account id (one read for the wallet's agent accounts); null while loading.
    const [balances, setBalances] = useState(/** @type {Record<string, any> | null} */ (null));
    // Co-sign requests for this account waiting on the owner; empty where the shell has none.
    const [pending, setPending] = useState(/** @type {any[]} */ ([]));
    const walletIdOfAccount = account?.walletId ?? null;

    useEffect(() => {
        if (!walletIdOfAccount) return undefined;
        let cancelled = false;
        setBalances(null);
        Promise.resolve()
            .then(() => (typeof messaging.getCoSignerAccountBalances === 'function'
                ? messaging.getCoSignerAccountBalances({ walletId: walletIdOfAccount })
                : {}))
            .then((byId) => { if (!cancelled) setBalances(byId && typeof byId === 'object' ? byId : {}); })
            .catch(() => { if (!cancelled) setBalances({}); });
        return () => { cancelled = true; };
    }, [walletIdOfAccount, messaging]);

    // Requests arrive while the page is open, so the list refreshes on a slow
    // timer; each refresh is one read for this account however many wait.
    const refreshPending = useCallback(() => {
        if (typeof messaging.listCoSignRequests !== 'function') return Promise.resolve();
        return Promise.resolve()
            .then(() => messaging.listCoSignRequests({ accountId }))
            .then((list) => setPending(Array.isArray(list) ? list : []))
            .catch(() => setPending([]));
    }, [messaging, accountId]);

    useEffect(() => {
        if (typeof messaging.listCoSignRequests !== 'function') return undefined;
        let active = true;
        const tick = () => { if (active) refreshPending(); };
        tick();
        const timer = setInterval(tick, PENDING_REFRESH_MS);
        return () => { active = false; clearInterval(timer); };
    }, [messaging, refreshPending]);

    async function refuseRequest(id) {
        try {
            await messaging.refuseCoSignRequest({ id });
        } catch (err) {
            setError(userFacingMessage(err, t('coSigner.detail.refuseFailed')));
        }
        refreshPending();
    }

    async function approveRequest(id) {
        try {
            const result = await messaging.focusCoSignRequest({ id });
            if (result && result.focused === false) {
                setError(t('coSigner.detail.windowClosed'));
                refreshPending();
            }
        } catch (err) {
            setError(userFacingMessage(err, t('coSigner.detail.openFailed')));
        }
    }

    async function copyAddress() {
        if (!account?.aggregateAddress) return;
        try {
            await copyText(account.aggregateAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            setError(userFacingMessage(err, t('coSigner.detail.copyFailed')));
        }
    }

    const activity = useMemo(() => {
        const entries = account?.window?.entries;
        return Array.isArray(entries) ? entries.slice().sort((a, b) => b.t - a.t) : [];
    }, [account]);

    function editableSnapshot(value) {
        return JSON.stringify(editableFields(value));
    }

    function editableFields(value) {
        return {
            name: value?.name,
            policy: value?.policy,
            allowedOutputs: value?.allowedOutputs,
        };
    }

    useEffect(() => {
        const view = viewRef.current + 1;
        viewRef.current = view;
        operationRef.current += 1;
        busyRef.current = false;
        let cancelled = false;
        setAccount(null);
        setError(null);
        setBusy(false);
        setEditing(false);
        setLookOpen(false);
        setShowFund(false);
        setName('');
        setPolicyDraft(null);
        setEditError(null);
        editBaselineRef.current = '';
        confirmDialog.onCancel();
        Promise.resolve()
            .then(() => messaging.getCoSignerAccount({ id: accountId }))
            .then((a) => {
                if (cancelled || viewRef.current !== view) return;
                if (!accountMatchesScope(a, accountId, walletId)) {
                    setError('Agent account not found for this wallet and network.');
                    return;
                }
                setAccount(a);
            })
            .catch((err) => {
                if (!cancelled && viewRef.current === view) {
                    setError(userFacingMessage(err, 'Failed to load the agent account.'));
                }
            });
        return () => {
            cancelled = true;
            if (viewRef.current === view) {
                viewRef.current += 1;
                operationRef.current += 1;
                busyRef.current = false;
            }
        };
    }, [accountId, walletId, messaging, confirmDialog.onCancel]);

    async function toggleEnabled() {
        if (!account || busyRef.current) return;
        const target = account;
        const view = viewRef.current;
        if (target.enabled && !(await confirmDialog.confirm({
            title: 'Turn off this agent account?',
            message: 'This revokes the agent\'s signing access until you turn the account on again. Funds already sent to the shared address are not moved.',
            confirmLabel: 'Turn Off',
            danger: true,
        }))) return;
        if (viewRef.current !== view || busyRef.current) return;
        const operation = operationRef.current + 1;
        operationRef.current = operation;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            const updated = await messaging.updateCoSignerAccount({
                id: target.id,
                patch: { enabled: !target.enabled },
            });
            if (!accountMatchesScope(updated, target.id, walletId)) {
                throw new Error('The updated agent account could not be loaded for this wallet and network.');
            }
            if (viewRef.current === view && operationRef.current === operation) setAccount(updated);
        } catch (err) {
            if (viewRef.current === view && operationRef.current === operation) {
                setError(userFacingMessage(err, 'Failed to update the agent account.'));
            }
        } finally {
            if (viewRef.current === view && operationRef.current === operation) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }

    function startEdit() {
        setName(account.name);
        setPolicyDraft(draftFromAccount(account));
        editBaselineRef.current = editableSnapshot(account);
        setEditError(null);
        setTokenErrors(null);
        setEditing(true);
    }

    async function saveEdit(event) {
        event?.preventDefault();
        if (!account || busyRef.current) return;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setEditError(built.error); return; }
        const target = account;
        const descriptor = chainRegistry.get(target.chainId);
        const addressError = policyAddressError(built, descriptor);
        if (addressError) { setEditError(addressError); return; }
        const view = viewRef.current;
        const operation = operationRef.current + 1;
        operationRef.current = operation;
        busyRef.current = true;
        setBusy(true);
        setEditError(null);
        try {
            const fresh = await messaging.getCoSignerAccount({ id: target.id });
            if (viewRef.current !== view || operationRef.current !== operation) return;
            if (!accountMatchesScope(fresh, target.id, walletId)) {
                throw new Error('This agent account no longer exists in this wallet and network.');
            }
            if (editableSnapshot(fresh) !== editBaselineRef.current) {
                setAccount(fresh);
                setName(fresh.name);
                setPolicyDraft(draftFromAccount(fresh));
                editBaselineRef.current = editableSnapshot(fresh);
                setEditError('This agent account changed after you opened the editor. Review the latest policy, then save again.');
                return;
            }
            // Record the token number of every ticker the rules name; a ticker
            // that cannot be matched keeps the old rules and marks its field.
            const declared = await declarePolicyTokenIds({ policy: built.policy, chainId: target.chainId, messaging });
            if (viewRef.current !== view || operationRef.current !== operation) return;
            if (declared.error) {
                setTokenErrors(declared.tokenErrors);
                setEditError(declared.error);
                return;
            }
            setTokenErrors(null);
            const updated = await messaging.updateCoSignerAccount({
                id: target.id,
                patch: {
                    expectedEditable: editableFields(fresh),
                    name: name.trim() || target.name,
                    policy: declared.policy,
                    allowedOutputs: built.allowedOutputs,
                },
            });
            if (!accountMatchesScope(updated, target.id, walletId)) {
                throw new Error('The updated agent account could not be loaded for this wallet and network.');
            }
            if (viewRef.current === view && operationRef.current === operation) {
                setAccount(updated);
                setEditing(false);
            }
        } catch (err) {
            if (viewRef.current === view && operationRef.current === operation) {
                setEditError(userFacingMessage(err, 'Failed to save changes.'));
            }
        } finally {
            if (viewRef.current === view && operationRef.current === operation) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }

    const windowCount = useMemo(() => {
        const entries = account?.window?.entries;
        return Array.isArray(entries) ? entries.length : 0;
    }, [account]);

    // Edit rules stands in for this page, so its Back (and the system Back)
    // closes the editor and returns here, never to the agents list.
    const header = editing && account
        ? (
            <PageHeader
                nested
                onBack={() => { if (!busyRef.current) setEditing(false); }}
                backDisabled={busy}
                title={t('coSigner.detail.title')}
            />
        )
        : <PageHeader onBack={onBack} title={t('coSigner.detail.title')} />;
    const wrap = (children) => {
        const page = (
            <>
                {children}
                {confirmDialog.request ? (
                    <ConfirmModal
                        {...confirmDialog.request}
                        onConfirm={confirmDialog.onConfirm}
                        onCancel={confirmDialog.onCancel}
                    />
                ) : null}
            </>
        );
        if (embedded) return page;
        return (
            <Screen variant={variant} header={header}>
                {measureRef ? (
                    <div ref={measureRef} className={listDetailStyles.layoutRoot} data-list-detail="page">
                        {page}
                    </div>
                ) : page}
            </Screen>
        );
    };

    if (error && !account) return wrap(<ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage>);
    if (!account) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    if (editing) {
        return wrap(
            <FormPage
                label="Edit agent account"
                onSubmit={saveEdit}
                status={editError ? <StatusMessage variant="error">{editError}</StatusMessage> : null}
                actions={(
                    <>
                        <Button type="button" variant="secondary" icon={<Icon.XIcon />} onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                        <Button type="submit" variant="primary" icon={<Icon.SaveIcon />} loading={busy} disabled={busy}>Update Policy</Button>
                    </>
                )}
            >
                <Input
                    label="Account name"
                    help="A label for this agent account that only this wallet shows. Updating changes the name and the policy rules below; the account address and keys stay the same."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <CoSignerPolicyEditor
                    value={policyDraft}
                    onChange={setPolicyDraft}
                    tokenIds={account?.policy?.tickIds || null}
                    tokenErrors={tokenErrors}
                />
            </FormPage>,
        );
    }

    if (lookOpen) {
        return (
            <AgentLookPage
                account={account}
                walletId={walletId}
                onBack={() => setLookOpen(false)}
                onSaved={(updated) => { setAccount(updated); setLookOpen(false); }}
            />
        );
    }

    if (showFund) {
        return (
            <AgentFundPage
                account={account}
                walletId={walletId || account.walletId}
                onBack={() => setShowFund(false)}
            />
        );
    }

    const tile = readWalletTile(account.id);
    const descriptor = chainRegistry.get(account.chainId);
    const p = account.policy || {};
    const allowedTicks = normalizeAllowedTicks(p.allowedTicks);
    const nativeTick = nativeTickForChain(account.chainId);
    const holdings = accountHoldings(balances, account.id);
    const panelId = `${tabsId}-panel`;
    const tabIcon = (IconComponent, label) => (
        <span className={homeTabsStyles.tabWithIcon}>
            <span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconComponent /></span>
            {label}
        </span>
    );

    return wrap(
        <ListPage className={tokenPageStyles.approvedBody}>
            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}

            {/* Whatever the agent is waiting on sits on top: what it wants,
                why it waits, Refuse and Approve. Approve opens the request's
                approval window, where the password and the signing checks are. */}
            {pending.map((request) => (
                <section key={request.id} className={local.pending} aria-label={t('coSigner.detail.pendingWhy')}>
                    <p className={local.pendingTitle}>{t('coSigner.detail.pendingTitle', { what: requestText(request) })}</p>
                    <p className={local.pendingWhy}>
                        {request.policyOk
                            ? t('coSigner.detail.pendingWhy')
                            : t('coSigner.detail.pendingOutside', { reason: describePolicyReason(request.policyReason) || request.policyReason || '' })}
                    </p>
                    <div className={local.pendingActions}>
                        <Button type="button" variant="secondary" icon={<Icon.XIcon />} onClick={() => refuseRequest(request.id)}>
                            {t('coSigner.detail.refuse')}
                        </Button>
                        <Button type="button" variant="primary" icon={<Icon.CheckIcon />} onClick={() => approveRequest(request.id)} disabled={!request.policyOk}>
                            {t('extension.connect.approve')}
                        </Button>
                    </div>
                </section>
            ))}

            {/* The identity card: name, what it holds and its status (G16). No
                network chip and no fact chips: the network and the allowed
                tokens are Details rows (G14, U12). */}
            <section className={tokenPageStyles.approvedHero} aria-label={t('extension.sign.agentAccount')}>
                {/* The agent's tile: its initials, or the look Edit look saved. */}
                <span className={tokenPageStyles.approvedHeroIcon} aria-hidden="true" data-agent-tile="" style={{ '--xc-avatar-shape': tileRadius(tile.shape) }}>
                    <IdentityAvatar name={account.name || 'Agent'} text={walletTileText(account.name)} seed={account.id} context="list" variant="asset" tone={tile.colour} src={tile.image || null} />
                </span>
                <div className={tokenPageStyles.approvedHeroText}>
                    <h2 className={tokenPageStyles.approvedHeroName}>{account.name}</h2>
                    <p className={local.summary} data-testid="agent-balance">{balanceSummary(balances, account.id)}</p>
                    <div className={local.chips}>
                        <span className={`${local.chip} ${account.enabled ? local.chipActive : ''}`}>
                            {account.enabled ? t('settings.developer.active') : t('coSigner.status.off')}
                        </span>
                    </div>
                </div>
            </section>

            <Tabs
                id={tabsId}
                className={tokenDetailStyles.detailTabs}
                items={[
                    { id: 'actions', label: tabIcon(Icon.ZapIcon, t('routes.manageToken.actions')) },
                    { id: 'activity', label: tabIcon(Icon.HistoryIcon, t('home.tabs.activity')) },
                    { id: 'details', label: tabIcon(Icon.InfoIcon, t('components.reachabilityLine.details')) },
                ]}
                value={activeTab}
                onChange={setActiveTab}
                panelId={panelId}
                aria-label={t('coSigner.detail.view')}
            />
            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${activeTab}`}
                className={local.panel}
            >
                {activeTab === 'actions' ? (
                    <>
                        {/* The one action list (G101). Fund opens the Fund page
                            (the address QR over a Send form to this address).
                            Withdraw stays a disabled row that says why on the
                            row itself: the wallet holds only its half of the
                            shared key, so only the agent can start a spend.
                            Turning off is undone by Turn on, so its row keeps
                            the default tone. */}
                        <ActionList label={t('routes.manageToken.actions')}>
                            <ActionListItem
                                icon={<Icon.ReceiveIcon />}
                                title={t('coSigner.detail.fund')}
                                description={t('coSigner.detail.fundDesc')}
                                onClick={() => setShowFund(true)}
                            />
                            <ActionListItem
                                icon={<Icon.SendIcon />}
                                title={t('coSigner.detail.withdraw')}
                                disabled
                                disabledReason={t('coSigner.detail.withdrawLocked')}
                            />
                            <ActionListItem
                                icon={<Icon.PencilIcon />}
                                title={t('coSigner.detail.editRules')}
                                description={t('coSigner.detail.editRulesDesc')}
                                onClick={startEdit}
                                disabled={busy}
                            />
                            {/* Name and tile, the same Edit look page wallets and accounts use. */}
                            <ActionListItem
                                icon={<Icon.PaletteIcon />}
                                title={t('coSigner.detail.editLook')}
                                description={t('coSigner.detail.editLookDesc')}
                                onClick={() => setLookOpen(true)}
                                disabled={busy}
                            />
                            <ActionListItem
                                icon={<Icon.CopyIcon />}
                                title={t('coSigner.detail.copyAddress')}
                                description={t('coSigner.detail.copyAddressDesc')}
                                onClick={copyAddress}
                            />
                            <ActionListItem
                                icon={account.enabled ? <Icon.PauseIcon /> : <Icon.PlayIcon />}
                                title={account.enabled ? t('coSigner.detail.turnOff') : t('coSigner.detail.turnOn')}
                                description={account.enabled ? t('coSigner.detail.turnOffDesc') : t('coSigner.detail.turnOnDesc')}
                                onClick={toggleEnabled}
                                disabled={busy}
                            />
                        </ActionList>
                        {copied ? <StatusMessage variant="success" role="status">{t('coSigner.detail.copied')}</StatusMessage> : null}
                    </>
                ) : null}

                {activeTab === 'activity' ? (
                    <>
                        {activity.length === 0 ? (
                            <EmptyState
                                title={t('coSigner.detail.activityEmptyTitle')}
                                body={p.maxPerWindow ? t('coSigner.detail.activityEmpty') : t('coSigner.detail.activityNoRecord')}
                            />
                        ) : (
                            <ul className={local.rows} aria-label={t('home.tabs.activity')}>
                                {activity.map((entry, i) => (
                                    <li key={`${entry.t}-${i}`}>
                                        <span className={local.rowMain}>
                                            <span className={local.rowTitle}>{entryText(entry)}</span>
                                            <span className={local.rowNote}>
                                                {t('coSigner.detail.activitySigned', { when: formatRelativeTime(entry.t) })}
                                            </span>
                                        </span>
                                        {entry.amount != null ? <span className={local.rowAmount}>{String(entry.amount)}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {p.maxPerWindow && activity.length > 0 ? (
                            <WarningCard data-agent-activity-note="">
                                <WarningLine>{t('coSigner.detail.activityNote')}</WarningLine>
                            </WarningCard>
                        ) : null}
                    </>
                ) : null}

                {activeTab === 'details' ? (
                    <>
                        <p className={local.sectionLabel}>{t('coSigner.detail.holdings')}</p>
                        {holdings ? (
                            <ul className={local.rows} aria-label={t('coSigner.detail.holdings')}>
                                {holdings.map((row) => {
                                    const isNative = nativeTick && row.tick === nativeTick;
                                    const allowed = isNative || allowedTicks === null || allowedTicks.includes(String(row.tick).toUpperCase());
                                    return (
                                        <li key={row.tick}>
                                            <span className={local.rowMain}>
                                                <span className={local.rowTitle}>{row.tick}</span>
                                                {isNative ? null : (
                                                    <span className={local.rowNote}>
                                                        {allowed ? t('send.advanced.allowed') : t('coSigner.detail.notAllowedTokenTag')}
                                                    </span>
                                                )}
                                            </span>
                                            <span className={local.rowAmount}>{formatHolding(row)}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <p className={local.rowNote}>{balanceSummary(balances, account.id)}</p>
                        )}
                        <section className={tokenPageStyles.approvedDetailsCard} aria-label={t('components.reachabilityLine.details')}>
                            <dl className={tokenPageStyles.approvedDetailsList}>
                                <DetailRow label={t('coSigner.detail.fundAddress')} value={(
                                    // A row of the cell's full width, so the address shows in full
                                    // when it fits beside the copy icon (G99).
                                    <span style={{ display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-end', gap: 'var(--xc-space-1)', alignItems: 'center' }}>
                                        <AddressText address={account.aggregateAddress} fit />
                                        <CopyButton value={account.aggregateAddress || ''} label="Copy Funding Address" />
                                    </span>
                                )} />
                                {descriptor ? (
                                    <DetailRow label={t('settings.network.label')} value={<ChainBadge descriptor={descriptor} size="sm" showName={false} />} />
                                ) : null}
                                {/* The allowed actions and the rolling limit rate are left off
                                    this card by ruling (2026-11-15); Edit rules still shows and
                                    sets both, and the policy is unchanged. */}
                                <DetailRow label={t('coSigner.policy.tokens.title')} value={allowedTokensText(p)} />
                                <DetailRow
                                    label={t('coSigner.detail.allowedRecipients')}
                                    value={Array.isArray(p.allowedDestinations) && p.allowedDestinations.length > 0
                                        ? t('coSigner.detail.recipientCount', { count: p.allowedDestinations.length })
                                        : t('coSigner.detail.anyRecipient')}
                                />
                                <DetailRow label={t('coSigner.detail.windowActivity')} value={t('coSigner.detail.windowCount', { count: windowCount })} />
                                <DetailRow label={t('walletDetails.type')} value={account.recoveryPublicKey ? t('coSigner.detail.kind2of3') : t('coSigner.detail.kind2of2')} />
                                <DetailRow label={t('coSigner.detail.agentKey')} value={account.agentPubkey} mono />
                                <DetailRow label={t('coSigner.detail.walletKey')} value={account.daemonPubkey} mono />
                                {account.recoveryPublicKey ? (
                                    <DetailRow label={t('coSigner.detail.recoveryKey')} value={account.recoveryPublicKey} mono />
                                ) : null}
                            </dl>
                        </section>
                        {/* The account's state as a note in the one warning card, never a loose line. */}
                        {account.enabled ? (
                            <WarningCard data-agent-state-note="">
                                <WarningLine>{t('coSigner.detail.activeHint')}</WarningLine>
                            </WarningCard>
                        ) : (
                            <Notice tone="danger" role="note" data-agent-state-note="">
                                {t('coSigner.detail.offHint')}
                            </Notice>
                        )}
                    </>
                ) : null}
            </div>
        </ListPage>,
    );
}

/**
 * Edit look for an agent account: its own page (no modal, G104), the twin of
 * Edit Account. The name saves to the agent record through
 * updateCoSignerAccount (a local vault field, nothing on chain); the tile's
 * colour, shape and image save to the same per-device store wallets and
 * accounts use, keyed by the agent's id. Back stores nothing.
 *
 * @param {object} props
 * @param {any} props.account
 * @param {string} [props.walletId]
 * @param {() => void} props.onBack
 * @param {(account: any) => void} props.onSaved   the stored record after Save
 */
function AgentLookPage({ account, walletId, onBack, onSaved }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const saved = readWalletTile(account.id);
    const [name, setName] = useState(account.name || '');
    const [colour, setColour] = useState(saved.colour || TILE_COLOURS[0]);
    const [image, setImage] = useState(/** @type {string | null} */ (saved.image || null));
    const [shape, setShape] = useState(saved.shape === 'rounded' ? 'rounded' : 'circle');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    // The name section starts open, the Look section closed, as on Edit Account.

    const tooLong = (text) => nameLength(text.trim()) > NAME_MAX_LENGTH;

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (!hasVisibleText(trimmed)) { setError(t('coSigner.look.nameRequired')); return; }
        if (tooLong(trimmed)) { setError(t('coSigner.look.nameTooLong', { max: NAME_MAX_LENGTH })); return; }
        setError(null);
        setBusy(true);
        // The tile's look is saved with the name, as Edit Account does.
        writeWalletTile(account.id, { colour, image, shape });
        if (trimmed === account.name) {
            onSaved(account);
            return;
        }
        try {
            const updated = await messaging.updateCoSignerAccount({ id: account.id, patch: { name: trimmed } });
            if (!accountMatchesScope(updated, account.id, walletId)) {
                throw new Error('The updated agent account could not be loaded for this wallet and network.');
            }
            onSaved(updated);
        } catch (err) {
            setError(userFacingMessage(err, t('coSigner.look.saveFailed')));
            setBusy(false);
        }
    }

    const saveDisabled = busy || !hasVisibleText(name) || tooLong(name);

    return (
        <Screen variant={variant} header={<PageHeader onBack={onBack} backDisabled={busy} title={t('coSigner.look.title')} />}>
            <FormFrame
                label={t('coSigner.look.title')}
                onSubmit={handleSubmit}
                action={(
                    <FormAction icon={<Icon.SaveIcon />} disabled={saveDisabled}>
                        {t('renameAccount.saveChanges')}
                    </FormAction>
                )}
            >
                {/* One flat form, no section wrappers: the look tile, name, then Icon colour, shape and image. */}
                <div data-flat-look-form="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-4)', minWidth: 0 }}>
                    {/* The agent's current look tile, centred at the top. */}
                    <div style={{ display: 'flex', justifyContent: 'center' }} aria-hidden="true">
                        <span style={{ '--xc-avatar-shape': tileRadius(shape), display: 'inline-flex' }}>
                            <IdentityAvatar name={name || 'Agent'} text={walletTileText(name)} seed={account.id} context="hero" variant="asset" tone={colour} src={image} />
                        </span>
                    </div>
                    <Input
                        label={t('renameAccount.name')}
                        help={t('coSigner.look.nameHelp')}
                        maxLength={NAME_MAX_LENGTH}
                        value={name}
                        onChange={(e) => {
                            const next = e.target.value;
                            setName(next);
                            setError(tooLong(next) ? t('coSigner.look.nameTooLong', { max: NAME_MAX_LENGTH }) : null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                        error={error || undefined}
                    />
                    <TileLookFields kind="account" colour={colour} onColour={setColour} shape={shape} onShape={setShape} image={image} onImage={setImage} />
                </div>
            </FormFrame>
        </Screen>
    );
}

/**
 * The Fund page: the agent address as a QR with its copy button (the Receive
 * page's QR look), over the standard Send form with this address as the
 * destination, so the user funds the agent from this wallet in place. Send
 * draws the page (header, review, signing); its Back returns to the agent page.
 *
 * @param {object} props
 * @param {any} props.account
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
function AgentFundPage({ account, walletId, onBack }) {
    const address = account.aggregateAddress || '';
    // A new object per render would re-run Send's prefill effects.
    const prefill = useMemo(() => ({ address, chainId: account.chainId }), [address, account.chainId]);
    const qr = address ? (
        <section className={local.fundCard} aria-label={t('coSigner.detail.fundAddress')}>
            <KeyQR value={address} alt={t('receive.qrCodeFor', { address })} />
            <span className={`${qrStyles.caption} ${local.fundAddress}`}>
                <AddressText address={address} fit />
                <CopyButton value={address} label="Copy Funding Address" />
            </span>
        </section>
    ) : null;
    return (
        <InPageScreen>
            <Send
                walletId={walletId}
                prefill={prefill}
                onBack={onBack}
                title={t('coSigner.detail.fund')}
                formLead={qr}
                presetTo={address}
                // One draft per agent, so a draft left on one agent's Fund
                // page never offers its address under another agent's QR.
                draftView={`cosigner-fund:${account.id}`}
            />
        </InPageScreen>
    );
}

function DetailRow({ label, value, mono = false }) {
    return (
        <div className={tokenPageStyles.approvedDetailRow}>
            <dt>{label}</dt>
            <dd className={mono ? tokenPageStyles.approvedMono : undefined}>{value}</dd>
        </div>
    );
}

// What a waiting request asks for, e.g. "Send 500 PEPECASH".
function requestText(request) {
    if (!request || !request.action) return t('coSigner.detail.pendingWhy');
    return [actionDisplayLabel(request.action), request.amount, request.tick].filter((part) => part != null && part !== '').join(' ');
}

// A signed request from the spending window, e.g. "Send MYTOKEN".
function entryText(entry) {
    return [entry.action ? actionDisplayLabel(String(entry.action)) : '', entry.tick || ''].filter(Boolean).join(' ');
}

// BTC first, then every token the account holds, or null when the read failed.
function accountHoldings(byId, accountId) {
    const shape = byId && byId[accountId] && byId[accountId].balances;
    if (!shape || !shape.native) return null;
    const tokens = Array.isArray(shape.tokens) ? shape.tokens.filter((row) => row && row.tick) : [];
    return [shape.native, ...tokens];
}
