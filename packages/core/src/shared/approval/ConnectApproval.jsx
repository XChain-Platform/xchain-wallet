// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    ChainBadge,
    FormPage,
    Icon,
    InfoTip,
    ListPage,
    Notice,
    NoticeList,
    OptionSwitch,
    OptionSwitchList,
    PageHeader,
    Screen,
} from '@xchain-wallet/core/ui';
import { useBackHandler } from '@xchain-wallet/core/ui/backStack.js';
import { i18n, registry as registryLib } from '@xchain-wallet/core';
import '@xchain-wallet/core/i18n/locales/en/extension.js';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { IdentityAvatar } from '@xchain-wallet/core/shared/components/WalletIdentity.jsx';
import { OriginIdentity } from '@xchain-wallet/core/shared/components/OriginIdentity.jsx';
import { useSupportedChains } from '@xchain-wallet/core/shared/hooks/useSupportedChains.js';
import { neutralizeControlText } from '@xchain-wallet/core/shared/utils/textHardening.js';
import { SiteIcon } from '@xchain-wallet/core/shared/components/SiteIcon.jsx';
import { userFacingMessage } from '@xchain-wallet/core/shared/utils/userFacingMessage.js';
import {
    linkAnswerOrigin,
    linkAppName,
} from '../../site_request/linkIdentity.js';
import { getSettings, resolveApproval } from './index.js';
import { ApprovalHeader } from './ApprovalHeader.jsx';
import shared from './approval.module.css';
import styles from './ConnectApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();
const { t } = i18n;
const INVALID_REQUEST_MESSAGE = 'This connection request is missing or invalid.';
const EXPIRED_REQUEST_MESSAGE = 'This connection request has expired.';
const ACCOUNT_MISSING_MESSAGE = 'Pick at least one account to share.';
const NETWORK_MISSING_MESSAGE = 'Pick at least one network.';
const PERMISSION_ACCOUNTS = 'See the addresses and balances of the accounts you share';
const PERMISSION_SIGNATURES = 'Ask you each time it wants a signature';
const NETWORKS_FIELD_LABEL = 'Networks it can see';
const ACCOUNTS_FIELD_LABEL = 'Accounts it can see';
const NETWORKS_FIELD_HELP = 'The coins this site can see. Turning a coin on shares its addresses on every network for that coin.';
const ACCOUNTS_FIELD_HELP = 'The accounts whose addresses and balances this site can see. It can never sign or spend without asking you.';
const NETWORKS_PICKER_TITLE = 'Choose Networks';
const ACCOUNTS_PICKER_TITLE = 'Choose Accounts';
const NETWORKS_PLACEHOLDER = 'Pick networks';
const ACCOUNTS_PLACEHOLDER = 'Pick accounts';
const PRIMARY_ACCOUNT_PLACEHOLDER = 'Primary account';
const PERMISSIONS_TITLE = 'Permissions';
const REQUESTING_SITE_LABEL = 'Requesting site';
const PICKER_NAMES_BUDGET = 32;
const CANONICAL_COIN_ORDER = ['bitcoin', 'litecoin', 'dogecoin'];
export const CONNECT_PICKER_MAX_ICONS = 5;

function isValidConnectPayload(payload, origin = payload?.origin) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (typeof origin !== 'string' || !origin) return false;
    try {
        if (new URL(origin).origin === 'null') return false;
    } catch {
        return false;
    }
    if (payload.requestedChains !== undefined
        && (!Array.isArray(payload.requestedChains)
            || payload.requestedChains.some((chainId) => typeof chainId !== 'string' || !chainId))) {
        return false;
    }
    return payload.accountOptions === undefined
        || (Array.isArray(payload.accountOptions)
            && payload.accountOptions.every(
                (account) => account && typeof account.id === 'string' && account.id,
            ));
}

export function connectPickerPresentation(names) {
    const values = Array.isArray(names) ? names : [];
    const joined = values.join(', ');
    const namesFit = joined.length <= PICKER_NAMES_BUDGET;
    const shown = Math.min(
        namesFit || values.length <= 1 ? values.length : values.length - 1,
        CONNECT_PICKER_MAX_ICONS,
    );
    const more = Math.max(0, values.length - shown);
    return {
        shown,
        more,
        text: namesFit ? joined : (more > 0 ? `+${more} more` : `${values.length} selected`),
    };
}

export function connectCoinFamilies(descriptors) {
    const families = new Map();
    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
        if (!descriptor?.coin || !descriptor?.id) continue;
        const existing = families.get(descriptor.coin);
        if (existing) {
            existing.chainIds.push(descriptor.id);
            if (descriptor.networkKind === 'mainnet') {
                existing.descriptor = descriptor;
                existing.name = descriptor.displayName || descriptor.coin;
            }
            continue;
        }
        families.set(descriptor.coin, {
            coin: descriptor.coin,
            name: descriptor.displayName || descriptor.coin,
            descriptor,
            chainIds: [descriptor.id],
        });
    }
    const order = new Map(CANONICAL_COIN_ORDER.map((coin, index) => [coin, index]));
    return Array.from(families.values()).sort((left, right) => (
        (order.get(left.coin) ?? CANONICAL_COIN_ORDER.length)
        - (order.get(right.coin) ?? CANONICAL_COIN_ORDER.length)
    ));
}

function PickerField({ id, label, help, items, placeholder, error, onOpen }) {
    const errorId = error ? `${id}-error` : undefined;
    const presentation = connectPickerPresentation(items.map((item) => item.name));
    const value = items.length > 0 ? presentation.text : placeholder;
    return (
        <div className={styles.pickerField} data-picker-field={id}>
            <div className={styles.fieldLabelRow}>
                <span id={`${id}-label`} className={styles.fieldLabel}>{label}</span>
                <InfoTip
                    className={styles.fieldHelp}
                    label={help}
                    aria={t('extension.connect.aboutField', { label })}
                />
            </div>
            <Button
                type="button"
                variant="secondary"
                block
                icon={null}
                id={id}
                className={`${styles.fieldControl} ${error ? styles.fieldInvalid : ''}`.trim()}
                onClick={onOpen}
                aria-labelledby={`${id}-label ${id}-value`}
                aria-describedby={errorId}
                aria-invalid={error ? 'true' : undefined}
            >
                {items.length > 0 ? (
                    <span className={styles.iconStack} aria-hidden="true">
                        {items.slice(0, presentation.shown).map((item) => (
                            <span key={item.key} className={styles.stackedIcon} data-picker-icon="">
                                {item.icon}
                            </span>
                        ))}
                    </span>
                ) : (
                    <span className={styles.emptyIcon} aria-hidden="true"><Icon.UserIcon /></span>
                )}
                <span
                    id={`${id}-value`}
                    className={items.length > 0 ? styles.fieldValue : styles.fieldPlaceholder}
                    data-picker-more={presentation.more > 0 ? presentation.more : undefined}
                >
                    {value}
                </span>
                <span className={styles.fieldCaret} aria-hidden="true"><Icon.TokenListIcon /></span>
            </Button>
            {error ? <div id={errorId} className={styles.fieldError} role="alert">{error}</div> : null}
        </div>
    );
}

function PickerHeader({ title, onBack }) {
    return (
        <>
            <div className={styles.appBarBleed}><AppHeader showMenu={false} /></div>
            <PageHeader nested onBack={onBack} title={title} />
        </>
    );
}

/**
 * Connect approval (§43.3 / §43.4): grants a dApp the right to call
 * `getAccounts` / `getBalances` / etc. against the permitted chains.
 *
 * Defaults favour the user:
 *   - Coin families pre-select from the dApp's requested chains if present;
 *     otherwise the user must opt in to each family.
 *   - Accounts come from the wallet, never the page: only the primary
 *     account starts ticked, and the grant is exactly what the user ticks.
 *   - Message-signing permission starts OFF. A site must show the message
 *     in a later approval before the user can remember that choice.
 *   - `canSignAction` starts empty. Action-kind permissions are gated
 *     inside the signAction flow with its own "always allow" toggle.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {any} props.payload  ConnectApprovalRequest
 * @param {() => void} props.onReject
 */
export function ConnectApproval({ id, payload, onReject }) {
    const linkRequest = payload?.linkRequest;
    const linkMode = linkRequest !== null
        && typeof linkRequest === 'object'
        && !Array.isArray(linkRequest);
    const answerOrigin = linkMode ? linkAnswerOrigin(linkRequest) : null;
    const origin = linkMode ? answerOrigin || '' : payload?.origin || '';
    const payloadValid = isValidConnectPayload(payload, origin);
    const appName = linkMode
        ? linkAppName(linkRequest) || ''
        : neutralizeControlText(payload?.appName || '', { maxLength: 80 });
    const requestedChains = useMemo(
        () => (Array.isArray(payload?.requestedChains) ? payload.requestedChains : []),
        [payload],
    );
    const accountOptions = useMemo(
        () => (Array.isArray(payload?.accountOptions)
            ? payload.accountOptions.filter((a) => a && typeof a.id === 'string' && a.id)
            : []),
        [payload],
    );

    // §9.7 Developer Mode: user-added chains live in settings.customChains
    // and the background host seeds only ITS registry instance, so this
    // realm installs them itself, the same way SignApproval does. The boot
    // read in main.jsx races this window's own request fetch and returns
    // nothing at all against a locked vault, so the connect prompt asks
    // again on mount. Idempotent under the registry has() guard.
    useEffect(() => {
        getSettings()
            .then((s) => {
                try { registryLib.hydrateCustomChainsFromSettings(chainRegistry, s); } catch { /* bundled descriptors keep serving */ }
            })
            .catch(() => { /* locked vault or read failure; bundled descriptors keep serving */ });
    }, []);

    // Live descriptor list. Hydration lands after this component mounts, so
    // a body-level supportedChains() read offers bundled chains only for the
    // life of the window; the hook re-renders on the registry's version bump.
    const supported = useSupportedChains(chainRegistry);
    const coinFamilies = useMemo(() => connectCoinFamilies(supported), [supported]);

    // The UI selects coin families while the grant remains a list of chain ids.
    // Track requested ids as hydration reveals them, and do not reselect a
    // family the user has explicitly switched off.
    const seenRequestedChains = useRef(/** @type {Set<string> | null} */ (null));
    const touchedCoins = useRef(new Set());
    if (seenRequestedChains.current === null) {
        seenRequestedChains.current = new Set(
            chainRegistry.supportedChains()
                .filter((d) => requestedChains.includes(d.id))
                .map((d) => d.id),
        );
    }

    const [approvedCoins, setApprovedCoins] = useState(
        /** @type {() => string[]} */ (() => Array.from(new Set(
            chainRegistry.supportedChains()
                .filter((d) => seenRequestedChains.current.has(d.id))
                .map((d) => d.coin),
        ))),
    );
    useEffect(() => {
        const fresh = supported
            .filter((d) => requestedChains.includes(d.id) && !seenRequestedChains.current.has(d.id));
        if (fresh.length === 0) return;
        for (const descriptor of fresh) seenRequestedChains.current.add(descriptor.id);
        const freshCoins = fresh.map((d) => d.coin).filter((coin) => !touchedCoins.current.has(coin));
        setApprovedCoins((prev) => [...prev, ...freshCoins.filter((coin) => !prev.includes(coin))]);
    }, [supported, requestedChains]);
    const approvedChains = supported
        .filter((descriptor) => approvedCoins.includes(descriptor.coin))
        .map((descriptor) => descriptor.id);
    const [approvedAccounts, setApprovedAccounts] = useState(
        /** @type {() => string[]} */ (() => (accountOptions[0] ? [accountOptions[0].id] : [])),
    );
    const [picker, setPicker] = useState(/** @type {'networks' | 'accounts' | null} */ (null));
    const [fieldErrors, setFieldErrors] = useState({});
    const [busy, setBusy] = useState(false);
    const [submissionError, setSubmissionError] = useState(/** @type {string | null} */ (null));
    const [requestExpired, setRequestExpired] = useState(false);
    const rootRef = useRef(null);
    const summaryRef = useRef(null);
    const closePicker = () => setPicker(null);
    useBackHandler(picker ? closePicker : onReject, busy);

    function clearFieldError(field) {
        setFieldErrors((current) => (current[field]
            ? { ...current, [field]: undefined }
            : current));
    }

    function toggleCoin(coin, on) {
        touchedCoins.current.add(coin);
        setApprovedCoins((prev) => (on
            ? [...prev, ...(!prev.includes(coin) ? [coin] : [])]
            : prev.filter((value) => value !== coin)));
        clearFieldError('networks');
    }

    function toggleAccount(accountId, on) {
        setApprovedAccounts((prev) => (on
            ? [...prev, ...(!prev.includes(accountId) ? [accountId] : [])]
            : prev.filter((value) => value !== accountId)));
        clearFieldError('accounts');
    }

    // With options on screen the user must share at least one account. With no
    // options, the background narrows to a primary account or refuses an empty vault.
    const accountsMissing = accountOptions.length > 0 && approvedAccounts.length === 0;
    const requestError = !payloadValid
        ? INVALID_REQUEST_MESSAGE
        : (requestExpired ? EXPIRED_REQUEST_MESSAGE : null);

    function revealValidationSummary() {
        const reveal = () => {
            const scrollArea = rootRef.current?.querySelector('main');
            if (scrollArea) {
                if (typeof scrollArea.scrollTo === 'function') scrollArea.scrollTo({ top: 0 });
                scrollArea.scrollTop = 0;
            }
            summaryRef.current?.focus({ preventScroll: true });
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
        else reveal();
    }

    async function handleApprove() {
        if (busy || requestError) return;
        const nextErrors = {};
        if (approvedChains.length === 0) nextErrors.networks = NETWORK_MISSING_MESSAGE;
        if (accountsMissing) nextErrors.accounts = ACCOUNT_MISSING_MESSAGE;
        if (Object.keys(nextErrors).length > 0) {
            setFieldErrors(nextErrors);
            revealValidationSummary();
            return;
        }
        setBusy(true);
        setSubmissionError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                chains: approvedChains,
                accounts: approvedAccounts,
                canSignMessage: false,
                canSignAction: {},
            });
            window.close();
        } catch (err) {
            if (err?.name === 'ApprovalInterruptedError' || err?.name === 'ApprovalNotFoundError') {
                setRequestExpired(true);
            } else {
                setSubmissionError(userFacingMessage(err, 'Could not connect this site.'));
            }
            setBusy(false);
        }
    }

    const selectedFamilies = coinFamilies.filter((family) => approvedCoins.includes(family.coin));
    const selectedAccounts = accountOptions.filter((account) => approvedAccounts.includes(account.id));
    const networkFieldItems = selectedFamilies.map((family) => ({
        key: family.coin,
        name: family.name,
        icon: <ChainBadge descriptor={family.descriptor} size="md" />,
    }));
    const accountFieldItems = selectedAccounts.map((account) => {
        const name = neutralizeControlText(account.name || account.id, { maxLength: 80 });
        return {
            key: account.id,
            name,
            icon: <IdentityAvatar name={name} seed={account.id} context="list" />,
        };
    });

    if (picker === 'networks') {
        return (
            <Screen variant="small" header={<PickerHeader title={NETWORKS_PICKER_TITLE} onBack={closePicker} />}>
                <ListPage className={styles.pickerPage}>
                    <OptionSwitchList role="group" aria-label={NETWORKS_PICKER_TITLE} data-connect-network-picker="">
                        {coinFamilies.map((family) => (
                            <OptionSwitch
                                key={family.coin}
                                id={`connect-network-${family.coin}`}
                                icon={<ChainBadge descriptor={family.descriptor} size="md" />}
                                label={family.name}
                                checked={approvedCoins.includes(family.coin)}
                                onChange={(event) => toggleCoin(family.coin, event.target.checked)}
                                aria-label={t('extension.connect.allowCoin', { coin: family.name })}
                            />
                        ))}
                    </OptionSwitchList>
                </ListPage>
            </Screen>
        );
    }

    if (picker === 'accounts') {
        return (
            <Screen variant="small" header={<PickerHeader title={ACCOUNTS_PICKER_TITLE} onBack={closePicker} />}>
                <ListPage className={styles.pickerPage}>
                    <OptionSwitchList role="group" aria-label={ACCOUNTS_PICKER_TITLE} data-connect-account-picker="">
                        {accountOptions.map((account) => {
                            const name = neutralizeControlText(account.name || account.id, { maxLength: 80 });
                            return (
                                <OptionSwitch
                                    key={account.id}
                                    id={`connect-account-${account.id}`}
                                    icon={<IdentityAvatar name={name} seed={account.id} context="list" />}
                                    label={name}
                                    description={account.id}
                                    checked={approvedAccounts.includes(account.id)}
                                    onChange={(event) => toggleAccount(account.id, event.target.checked)}
                                    aria-label={t('extension.connect.accounts.share', { name })}
                                />
                            );
                        })}
                    </OptionSwitchList>
                </ListPage>
            </Screen>
        );
    }

    const problems = Object.values(fieldErrors).filter(Boolean);
    const summaryTitle = `Fix ${problems.length} thing${problems.length === 1 ? '' : 's'} to continue`;
    let siteName = appName;
    if (!siteName && payloadValid) {
        try { siteName = new URL(origin).hostname; } catch { siteName = ''; }
    }
    const linkLabel = linkMode && origin
        ? t('extension.approval.linkAnswer', { origin })
        : REQUESTING_SITE_LABEL;

    return (
        <Screen
            variant="small"
            rootRef={rootRef}
            header={<ApprovalHeader title={t('extension.connect.title')} />}
            footer={(
                <div className={`${shared.footer} ${shared.formFooter} ${shared.connectFooter}`} data-connect-actions="">
                    <Button
                        variant="danger"
                        block
                        icon={<Icon.ThumbsDownIcon />}
                        onClick={() => { if (!busy) onReject(); }}
                        aria-busy={busy ? 'true' : 'false'}
                    >
                        {t('extension.approval.reject')}
                    </Button>
                    <Button
                        variant="success"
                        block
                        icon={<Icon.ThumbsUpIcon />}
                        onClick={handleApprove}
                        aria-busy={busy ? 'true' : 'false'}
                    >
                        {t('extension.connect.approve')}
                    </Button>
                </div>
            )}
        >
            <FormPage as="div" label={t('extension.connect.title')} className={styles.page}>
                {problems.length > 0 ? (
                    <div ref={summaryRef} className={styles.errorSummary} tabIndex={-1}>
                        <Notice
                            tone="danger"
                            title={summaryTitle}
                            testId="connect-error-summary"
                        >
                            <NoticeList items={problems.map((problem) => ({ key: problem, content: problem }))} />
                        </Notice>
                    </div>
                ) : null}
                {requestError ? <Notice tone="danger">{requestError}</Notice> : null}
                {payloadValid ? (
                    <section className={styles.siteIdentity} aria-label={linkLabel}>
                        <SiteIcon
                            origin={origin}
                            name={linkMode ? new URL(origin).hostname : siteName}
                            icon={linkMode ? null : payload.icon}
                            context="hero"
                        />
                        <strong className={styles.siteName}>
                            {linkMode ? new URL(origin).hostname : siteName}
                        </strong>
                        <div className={styles.originDetails}>
                            <OriginIdentity
                                origin={origin}
                                label={linkLabel}
                                originClassName={styles.siteOrigin}
                                embedded
                                as="div"
                            >
                                {linkMode && appName ? (
                                    <p>{t('extension.sign.declaredName', { name: appName })}</p>
                                ) : null}
                            </OriginIdentity>
                        </div>
                    </section>
                ) : null}
                <PickerField
                    id="connect-networks"
                    label={NETWORKS_FIELD_LABEL}
                    help={NETWORKS_FIELD_HELP}
                    items={networkFieldItems}
                    placeholder={NETWORKS_PLACEHOLDER}
                    error={fieldErrors.networks}
                    onOpen={() => setPicker('networks')}
                />
                <PickerField
                    id="connect-accounts"
                    label={ACCOUNTS_FIELD_LABEL}
                    help={ACCOUNTS_FIELD_HELP}
                    items={accountFieldItems}
                    placeholder={accountOptions.length > 0 ? ACCOUNTS_PLACEHOLDER : PRIMARY_ACCOUNT_PLACEHOLDER}
                    error={fieldErrors.accounts}
                    onOpen={() => setPicker('accounts')}
                />
                <Notice tone="info" role="note" title={PERMISSIONS_TITLE} data-connect-permissions="">
                    <ul className={styles.permissionsList}>
                        <li>{PERMISSION_ACCOUNTS}</li>
                        <li>{PERMISSION_SIGNATURES}</li>
                    </ul>
                </Notice>
                {submissionError ? <Notice tone="danger">{submissionError}</Notice> : null}
            </FormPage>
        </Screen>
    );
}
