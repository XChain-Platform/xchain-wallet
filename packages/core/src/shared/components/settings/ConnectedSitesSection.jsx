// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConnectedSitesSection: §35.1 + §43.5 Connected Sites page.
//
// The page owns its screen and header, because the header carries the
// list filter and the plus (G95) and the title follows the drill-in:
//   - header: filter (search inside the panel) and block (block a site)
//   - toggle: Allowed | Blocked | Options
//   - Allowed: one list card, a row per connected site, each opening the
//     site detail (identity card, permissions, connection facts, and the
//     Disconnect and Block Site actions)
//   - Blocked: one list card, a row per blocked origin or wildcard, each
//     opening its entry detail with Unblock
//   - Options: the sign-request throttle (SignThrottlePanel): its status
//     card, inline limit rows that apply at once, and the sites using it
// Drill-ins are in-route state, as Contacts does, so Settings and the
// standalone route mount this one component. The blocklist audit log is
// still recorded by the host but is not shown here.
//
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    EmptyState,
    FormPage,
    Icon,
    Input,
    ListPage,
    ListRow,
    PageHeader,
    PageNotice as Status,
    Screen,
    SectionHeader,
    SegmentedControl,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { useBackHandler } from '../../../ui/backStack.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { useToast } from '../ToastHost.jsx';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { SiteIcon } from '../SiteIcon.jsx';
import { ActionList, ActionListItem } from '../ActionList.jsx';
import { actionDisplayLabel } from '../../utils/actionDisplayLabel.js';
import { titleCase } from '../../utils/titleCase.js';
import { normalizeBlocklistEntry, parseWildcardPattern } from '../../../flows/blocklist.js';
import { SignThrottlePanel } from './SignThrottlePanel.jsx';
import local from './ConnectedSitesSection.module.css';
import { neutralizeControlText } from '../../utils/textHardening.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/accountPicker.js';
import '../../../i18n/locales/en/extension.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';
import '../../../i18n/locales/en/firstPaint.js';

// A connected site names itself, so its name and origin are hostile input:
// bidi overrides would reorder the name, and a 240-character host would run
// past the card edge where the user cannot read the whole origin.
const siteName = (site) => neutralizeControlText(site.appName || site.origin, { maxLength: 120 });
const siteOrigin = (site) => neutralizeControlText(site.origin, { maxLength: 2048 });
const SITE_ORIGIN_STYLE = { overflowWrap: 'anywhere', unicodeBidi: 'isolate' };
const blockedEntryText = (entry) => neutralizeControlText(entry, { maxLength: 2048 });

const VIEWS = ['allowed', 'blocked', 'options'];

// Keep a plain literal so the key-coverage extractor can resolve the key.
const SAVE_CHANGE_FAILED_KEY = 'settings.connectedSites.saveChangeFailed';

/**
 * The copy for a failed Connected Sites read or action. Handler text such as
 * "sites.load: ..." names internals, so a load shows it only when it is already
 * user-facing, and a refused local action names the shared save failure.
 *
 * @param {unknown} err
 * @param {'load' | 'disconnect' | 'block' | 'unblock'} action
 * @returns {string}
 */
export function connectedSiteErrorMessage(err, action) {
    if (action === 'load') return userFacingMessage(err, t('settings.connectedSites.loadFailed'));
    return t(SAVE_CHANGE_FAILED_KEY);
}

// A Settings search lands on the part of the page that holds its match:
// the throttle rows on Options, the blocked-site rows on Blocked. Only
// those row titles (Settings' search rows) move the view, so a typed site
// name that merely contains the word block still opens on Allowed.
const SEARCH_TARGET_VIEWS = new Map([
    ['sign-request throttle', 'options'],
    ['requests per site', 'options'],
    ['window', 'options'],
    ['blocked sites', 'blocked'],
]);
function viewForSearchTarget(target) {
    return SEARCH_TARGET_VIEWS.get(String(target || '').trim().toLowerCase()) || 'allowed';
}

// A site's own icon (ConnectedSite.icon, a checked PNG data URL) or its
// initials, through the shared SiteIcon, which never fetches and never
// reads the legacy appIcon field.
function SiteAvatar({ site, context = 'list' }) {
    return (
        <SiteIcon
            origin={site.origin || ''}
            name={site.appName ? siteName(site) : ''}
            icon={site.icon ?? null}
            context={context}
        />
    );
}

// A blocked entry has no record behind it, so it shows initials taken from
// its host; a wildcard reads as the domain it covers.
function BlockedAvatar({ entry, context = 'list' }) {
    const wildcardDomain = parseWildcardPattern(entry);
    return <SiteIcon origin={wildcardDomain ? `https://${wildcardDomain}` : String(entry)} context={context} />;
}

/**
 * @param {object} [props]
 * @param {() => void} [props.onBack]        leaves the page (Settings or the shell route)
 * @param {string} [props.backLabel]         the back control's name on the list view
 * @param {boolean} [props.nested]           the list view is itself a sub-screen (Settings)
 * @param {'small' | 'full'} [props.variant] the shell's screen variant
 * @param {string | null} [props.searchTarget] a Settings search match, which picks the opening view
 */
export function ConnectedSitesSection({
    onBack,
    backLabel,
    nested = false,
    variant = 'full',
    searchTarget = null,
} = {}) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const confirmDialog = useConfirmModal();
    const [sites, setSites] = useState(/** @type {any[] | null} */ (null));
    const [blocked, setBlocked] = useState(/** @type {string[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // A refused action on an otherwise usable page: shown above the content,
    // never in place of it, and cleared when the visitor moves to another view.
    const [actionError, setActionError] = useState(/** @type {string | null} */ (null));
    const [view, setView] = useState(() => viewForSearchTarget(searchTarget));
    // The drill-in shown over the list: a site, a blocked entry, or the
    // Block Site form. Null is the list itself.
    const [page, setPage] = useState(/** @type {{ kind: 'site', id: string } | { kind: 'blocked', entry: string } | { kind: 'block' } | null} */ (null));
    const [query, setQuery] = useState('');
    const [manualBlock, setManualBlock] = useState('');
    const blockFormErrors = useFormErrors();
    const [pendingAction, setPendingAction] = useState(/** @type {string | null} */ (null));
    const loadSequence = useRef(0);
    const loadedFrom = useRef(null);

    const blocklistWired = typeof messaging?.listBlockedOrigins === 'function'
        && typeof messaging?.blockOrigin === 'function'
        && typeof messaging?.unblockOrigin === 'function';

    const reload = useCallback(async () => {
        const sequence = ++loadSequence.current;
        if (typeof messaging?.listConnectedSites !== 'function') {
            loadedFrom.current = messaging;
            setError('Connected sites are unavailable in this app.');
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const [siteList, blockedList] = await Promise.all([
                messaging.listConnectedSites(),
                blocklistWired ? messaging.listBlockedOrigins() : Promise.resolve([]),
            ]);
            if (sequence !== loadSequence.current) return;
            loadedFrom.current = messaging;
            setSites(Array.isArray(siteList) ? siteList : []);
            setBlocked(Array.isArray(blockedList) ? blockedList : []);
            setError(null);
        } catch (err) {
            if (sequence !== loadSequence.current) return;
            loadedFrom.current = messaging;
            setError(connectedSiteErrorMessage(err, 'load'));
        } finally {
            if (sequence === loadSequence.current) setLoading(false);
        }
    }, [blocklistWired, messaging]);

    useEffect(() => {
        reload();
        return () => { loadSequence.current += 1; };
    }, [reload]);

    const onDisconnect = async (id) => {
        if (pendingAction) return;
        // §37.2 / Cluster D FOLLOWUP 1: snapshot the full ConnectedSite
        // record before tearing it down so the Undo toast can re-create
        // it with the same permissions / lastUsedAt / appName instead
        // of forcing the dApp to re-prompt.
        const snapshot = sites ? sites.find((s) => s.id === id) : null;
        if (!snapshot) return;
        const confirmed = await confirmDialog.confirm({
            title: t('settings.connectedSites.disconnectTitle', { name: siteName(snapshot) }),
            message: t('settings.connectedSites.disconnectMessage', { origin: siteOrigin(snapshot) }),
            confirmLabel: t('settings.connectedSites.disconnectSite'),
            danger: true,
        });
        if (!confirmed) return;
        setActionError(null);
        setPendingAction(`disconnect:${id}`);
        try {
            await messaging.deleteConnectedSite({ id });
            await reload();
            if (snapshot && typeof messaging.restoreConnectedSite === 'function') {
                showToast({
                    message: t('settings.connectedSites.disconnectedToast', { name: siteName(snapshot) }),
                    actionLabel: t('settings.connectedSites.undo'),
                    onAction: async () => {
                        try {
                            await messaging.restoreConnectedSite({ site: snapshot });
                            await reload();
                        } catch (err) {
                            // Keep the loaded list usable after a failed reconnect;
                            // the notice belongs above the page instead of replacing
                            // content that still reflects the saved wallet state.
                            setActionError(t(err?.code === 'BLOCKED_BY_USER'
                                ? 'settings.connectedSites.undoBlocked'
                                : SAVE_CHANGE_FAILED_KEY));
                        }
                    },
                });
            }
        } catch {
            // Keep the loaded list usable after a failed disconnect;
            // the notice belongs above the page instead of replacing
            // content that still reflects the saved wallet state.
            setActionError(connectedSiteErrorMessage(null, 'disconnect'));
        } finally {
            setPendingAction(null);
        }
    };

    const onBlock = async (origin, pendingKey = `block:${origin}`) => {
        if (pendingAction) return false;
        const confirmed = await confirmDialog.confirm({
            title: t('settings.connectedSites.blockTitle', { origin: neutralizeControlText(origin, { maxLength: 2048 }) }),
            message: t('settings.connectedSites.blockMessage'),
            confirmLabel: t('settings.connectedSites.blockSite'),
            danger: true,
        });
        if (!confirmed) return false;
        setActionError(null);
        setPendingAction(pendingKey);
        try {
            await messaging.blockOrigin({ origin });
            await reload();
            return true;
        } catch {
            setActionError(connectedSiteErrorMessage(null, 'block'));
            return false;
        } finally {
            setPendingAction(null);
        }
    };

    const onUnblock = async (origin) => {
        if (pendingAction) return;
        setActionError(null);
        setPendingAction(`unblock:${origin}`);
        try {
            await messaging.unblockOrigin({ origin });
            await reload();
        } catch {
            setActionError(connectedSiteErrorMessage(null, 'unblock'));
        } finally {
            setPendingAction(null);
        }
    };

    // The Block Site form checks the entry with the same normalizer the
    // host applies, so a malformed origin is refused at the field and never
    // reaches the confirm dialog or the blocklist write.
    const onManualBlockSubmit = async (e) => {
        e.preventDefault();
        if (pendingAction) return;
        const trimmed = manualBlock.trim();
        const validationMessage = !trimmed
            ? t('settings.connectedSites.enterOriginToBlock')
            : !normalizeBlocklistEntry(trimmed)
                ? t('settings.connectedSites.invalidBlockEntry')
                : null;
        if (!blockFormErrors.validate({ 'block-site-origin': validationMessage })) return;
        const blockedOrigin = await onBlock(trimmed, 'block:manual');
        if (blockedOrigin) {
            setManualBlock('');
            blockFormErrors.reset();
            setPage(null);
            setView('blocked');
        }
    };

    const ready = !loading && loadedFrom.current === messaging && !error;
    const openSite = page?.kind === 'site' && sites ? sites.find((s) => s.id === page.id) || null : null;
    const openEntry = page?.kind === 'blocked' && blocked.includes(page.entry) ? page.entry : null;

    // A drill-in whose record went away (disconnected, blocked, unblocked,
    // or removed by another window) returns to the list.
    useEffect(() => {
        if (!ready || !page) return;
        if (page.kind === 'site' && !openSite) setPage(null);
        if (page.kind === 'blocked' && !openEntry) setPage(null);
    }, [ready, page, openSite, openEntry]);

    // System Back and Escape close a drill-in before they leave the page.
    useBackHandler(page ? () => setPage(null) : undefined, pendingAction !== null, 'screen');

    const filterText = query.trim().toLowerCase();
    const shownSites = useMemo(() => (sites || []).filter((site) => !filterText
        || String(site.appName || '').toLowerCase().includes(filterText)
        || String(site.origin || '').toLowerCase().includes(filterText)), [sites, filterText]);
    const shownBlocked = useMemo(() => blocked.filter((entry) => !filterText
        || String(entry).toLowerCase().includes(filterText)), [blocked, filterText]);

    const title = openSite
        ? titleCase(t('settings.connectedSites.siteIdentity'))
        : openEntry
            ? titleCase(t('settings.connectedSites.blockedEntry'))
            : page?.kind === 'block'
                ? t('settings.connectedSites.blockSiteAction')
                : t('settings.connectedSites.pageTitle');

    const header = (
        <PageHeader
            nested={page ? true : nested}
            onBack={page ? () => setPage(null) : onBack}
            backLabel={page ? undefined : backLabel}
            backDisabled={Boolean(page) && pendingAction !== null}
            title={title}
            trailing={!page && ready ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        label={t('settings.connectedSites.filterSites')}
                        searchPlaceholder={t('routes.addressList.search')}
                        searchLabel={t('settings.connectedSites.searchSites')}
                    />
                    {blocklistWired ? (
                        <Button
                            type="button"
                            variant="secondary"
                            icon={<Icon.PlusIcon />}
                            aria-label={t('settings.connectedSites.blockASite')}
                            title={t('settings.connectedSites.blockASite')}
                            onClick={() => {
                                setManualBlock('');
                                blockFormErrors.reset();
                                setPage({ kind: 'block' });
                            }}
                        >
                            {null}
                        </Button>
                    ) : null}
                </>
            ) : null}
        />
    );

    useEffect(() => { setActionError(null); }, [page, view]);

    let body;
    if (loading || loadedFrom.current !== messaging) {
        body = <Status text={t('common.loading')} />;
    } else if (error) {
        body = <Status text={t('settings.connectedSites.connectedSitesUnavailable', { error })} tone="error" />;
    } else if (openSite) {
        body = (
            <SiteDetail
                site={openSite}
                blocklistWired={blocklistWired}
                pendingAction={pendingAction}
                onDisconnect={() => onDisconnect(openSite.id)}
                onBlock={() => onBlock(openSite.origin)}
            />
        );
    } else if (openEntry) {
        body = (
            <BlockedEntryDetail
                entry={openEntry}
                pendingAction={pendingAction}
                onUnblock={() => onUnblock(openEntry)}
            />
        );
    } else if (page?.kind === 'block') {
        body = (
            <BlockSiteForm
                value={manualBlock}
                errors={blockFormErrors}
                onChange={setManualBlock}
                onSubmit={onManualBlockSubmit}
                pendingAction={pendingAction}
            />
        );
    } else {
        const views = VIEWS.filter((id) => id !== 'blocked' || blocklistWired);
        const shownView = views.includes(view) ? view : 'allowed';
        body = (
            <ListPage role="group" aria-label={t('settings.connectedSites.connectedSitesAndDappPermissions')}>
                <SegmentedControl
                    aria-label={t('settings.connectedSites.viewToggle')}
                    value={shownView}
                    onChange={setView}
                    items={[
                        { id: 'allowed', label: <><Icon.LinkIcon aria-hidden="true" /><span>{t('send.advanced.allowed')}</span></> },
                        ...(blocklistWired
                            ? [{ id: 'blocked', label: <><Icon.LockIcon aria-hidden="true" /><span>{t('settings.connectedSites.viewBlocked')}</span></> }]
                            : []),
                        { id: 'options', label: <><Icon.GearIcon aria-hidden="true" /><span>{t('ui.iconSelect.options')}</span></> },
                    ]}
                />
                {shownView === 'allowed' ? (
                    <AllowedList
                        sites={sites || []}
                        shown={shownSites}
                        onOpen={(id) => setPage({ kind: 'site', id })}
                    />
                ) : null}
                {shownView === 'blocked' ? (
                    <BlockedList
                        blocked={blocked}
                        shown={shownBlocked}
                        onOpen={(entry) => setPage({ kind: 'blocked', entry })}
                    />
                ) : null}
                {shownView === 'options' ? <SignThrottlePanel /> : null}
            </ListPage>
        );
    }

    // Each view keeps its own scroll offset: the short detail would
    // otherwise clamp the list's offset, and Back would land at the top.
    return (
        <Screen
            variant={variant}
            header={header}
            scrollKey={page ? page.kind : `list-${view}`}
            restoreScroll={!page}
        >
            {actionError ? <Status text={actionError} tone="error" /> : null}
            {body}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </Screen>
    );
}

// The Allowed card: a row per connected site with its icon or initials,
// its name (or origin), and "origin · last used", each opening the detail.
function AllowedList({ sites, shown, onOpen }) {
    if (sites.length === 0) {
        return (
            <EmptyState
                title={t('settings.connectedSites.noSitesConnectedYet')}
                body={t('settings.connectedSites.whenAWebsiteAsksTo')}
                titleAs="p"
            />
        );
    }
    if (shown.length === 0) {
        return (
            <EmptyState
                title={t('settings.connectedSites.noMatchingSites')}
                body={t('settings.connectedSites.noMatchingSitesBody')}
                titleAs="p"
            />
        );
    }
    return (
        <ul className={local.list} aria-label={t('settings.connectedSites.allowedSites')}>
            {shown.map((site) => (
                <li key={site.id}>
                    <ListRow
                        type="button"
                        onClick={() => onOpen(site.id)}
                        chevron
                        leading={<SiteAvatar site={site} />}
                        title={siteName(site)}
                        subtitle={(
                            <>
                                {/* A site with no app name is titled by its
                                    origin, so the origin is not repeated. */}
                                {site.appName && site.appName !== site.origin ? (
                                    <>
                                        <span dir="ltr" style={SITE_ORIGIN_STYLE}>{siteOrigin(site)}</span>
                                        {' · '}
                                    </>
                                ) : null}
                                {formatLastUsed(site.lastUsedAt)}
                            </>
                        )}
                    />
                </li>
            ))}
        </ul>
    );
}

function blockedEntryType(entry) {
    return parseWildcardPattern(entry)
        ? t('settings.connectedSites.wildcardAllSubdomains')
        : t('settings.connectedSites.singleOrigin');
}

// The Blocked card: a row per blocked origin or wildcard. The blocklist
// stores only the entry itself, so the row says the entry and its kind.
function BlockedList({ blocked, shown, onOpen }) {
    if (blocked.length === 0) {
        return (
            <EmptyState
                title={t('settings.connectedSites.noBlockedSites')}
                body={t('settings.connectedSites.sitesYouBlockAppearHere')}
                titleAs="p"
            />
        );
    }
    if (shown.length === 0) {
        return (
            <EmptyState
                title={t('settings.connectedSites.noMatchingSites')}
                body={t('settings.connectedSites.noMatchingSitesBody')}
                titleAs="p"
            />
        );
    }
    return (
        <ul className={local.list} aria-label={t('settings.connectedSites.blockedSites')}>
            {shown.map((entry) => (
                <li key={entry}>
                    <ListRow
                        type="button"
                        onClick={() => onOpen(entry)}
                        chevron
                        leading={<BlockedAvatar entry={entry} />}
                        title={<span dir="ltr" style={SITE_ORIGIN_STYLE}>{blockedEntryText(entry)}</span>}
                        subtitle={blockedEntryType(entry)}
                    />
                </li>
            ))}
        </ul>
    );
}

/** One label-left, value-right fact in a detail card. */
function FactRow({ label, children }) {
    return (
        <li>
            <ListRow title={label} trailing={<span className={local.factValue}>{children}</span>} />
        </li>
    );
}

// A connected site: identity card, the permissions its record holds (the
// wallet has no call that edits them, so they read only), when it
// connected and was last used, and Disconnect and Block Site.
function SiteDetail({ site, blocklistWired, pendingAction, onDisconnect, onBlock }) {
    const permissions = site.permissions || null;
    const chains = permissions?.chains || [];
    const accounts = permissions?.accounts || [];
    const actions = permissions?.canSignAction || {};
    return (
        <ListPage>
            <section className={local.identityCard} aria-label={t('settings.connectedSites.siteIdentity')}>
                <SiteAvatar site={site} context="hero" />
                <h2 className={local.identityName}>{siteName(site)}</h2>
                <p className={local.identityLine}>
                    <span dir="ltr" style={SITE_ORIGIN_STYLE}>{siteOrigin(site)}</span>
                </p>
            </section>
            <SectionHeader as="h3" title={t('settings.connectedSites.permissions')} />
            {permissions ? (
                <ul className={local.list} aria-label={t('settings.connectedSites.permissions')}>
                    <FactRow label={t('extension.connect.chains')}>
                        {chains.length ? chains.join(', ') : t('common.allNetworks')}
                    </FactRow>
                    <FactRow label={t('accountPicker.title')}>
                        {accounts.length ? accounts.join(', ') : t('settings.connectedSites.allAccounts')}
                    </FactRow>
                    <FactRow label={t('settings.connectedSites.signMessages')}>
                        {permissions.canSignMessage ? t('settings.connectedSites.alwaysAllow') : t('settings.connectedSites.askEveryTime')}
                    </FactRow>
                    {Object.keys(actions).length === 0 ? (
                        <FactRow label={t('settings.connectedSites.signActions')}>{t('settings.connectedSites.askEveryTime')}</FactRow>
                    ) : Object.entries(actions).map(([action, perm]) => (
                        <FactRow key={action} label={actionDisplayLabel(action)}>
                            <span style={{ color: permColor(perm) }}>{permissionLabel(perm)}</span>
                        </FactRow>
                    ))}
                </ul>
            ) : (
                <EmptyState
                    title={t('settings.connectedSites.noPermissionRecord')}
                    body={t('settings.connectedSites.noPermissionRecordBody')}
                    titleAs="p"
                />
            )}
            <ul className={local.list} aria-label={t('settings.connectedSites.connection')}>
                <FactRow label={t('settings.connectedSites.connectedSince')}>{formatDate(site.connectedAt)}</FactRow>
                <FactRow label={t('settings.connectedSites.lastUsed')}>{formatLastUsed(site.lastUsedAt)}</FactRow>
            </ul>
            <ActionList label={t('settings.connectedSites.siteActions')}>
                <ActionListItem
                    icon={<Icon.UnlinkIcon />}
                    title={t('settings.connectedSites.disconnect')}
                    description={t('settings.connectedSites.disconnectMessage', { origin: siteOrigin(site) })}
                    aria-label={t('settings.connectedSites.disconnect')}
                    onClick={onDisconnect}
                    disabled={pendingAction !== null}
                    disabledReason={pendingAction !== null ? t('common.loading') : undefined}
                />
                {blocklistWired ? (
                    <ActionListItem
                        icon={<Icon.LockIcon />}
                        title={t('settings.connectedSites.blockSite')}
                        description={t('settings.connectedSites.blockMessage')}
                        aria-label={t('settings.connectedSites.blockSiteAction')}
                        onClick={onBlock}
                        disabled={pendingAction !== null}
                        disabledReason={pendingAction !== null ? t('common.loading') : undefined}
                    />
                ) : null}
            </ActionList>
        </ListPage>
    );
}

// A blocked origin or wildcard: what it is, and the green Unblock.
function BlockedEntryDetail({ entry, pendingAction, onUnblock }) {
    return (
        <ListPage>
            <section className={local.identityCard} aria-label={t('settings.connectedSites.blockedEntry')}>
                <BlockedAvatar entry={entry} context="hero" />
                <h2 className={local.identityName}>
                    <span dir="ltr" style={SITE_ORIGIN_STYLE}>{blockedEntryText(entry)}</span>
                </h2>
                <p className={local.identityLine}>{blockedEntryType(entry)}</p>
            </section>
            <ActionList label={t('settings.connectedSites.siteActions')}>
                <ActionListItem
                    icon={<Icon.UnlockIcon />}
                    title={t('settings.connectedSites.unblock')}
                    onClick={onUnblock}
                    disabled={pendingAction !== null}
                    disabledReason={pendingAction !== null ? t('common.loading') : undefined}
                />
            </ActionList>
        </ListPage>
    );
}

// The plus's Block Site form: one origin-or-wildcard field whose help
// gives the wildcard syntax, and the green Block Site.
function BlockSiteForm({ value, errors, onChange, onSubmit, pendingAction }) {
    return (
        <FormPage
            onSubmit={onSubmit}
            submitFromAnyField
            label={t('settings.connectedSites.blockSite')}
            errors={errors}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.LockIcon />}
                    loading={pendingAction === 'block:manual'}
                    disabled={pendingAction !== null}
                >
                    {t('settings.connectedSites.blockSiteAction')}
                </Button>
            )}
        >
            <Input
                id="block-site-origin"
                type="text"
                enterKeyHint="go"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                label={t('settings.connectedSites.originOrWildcardToBlock')}
                help={t('settings.connectedSites.siteToBlockHelp')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={t('settings.connectedSites.httpsExampleComOrExample')}
            />
        </FormPage>
    );
}

function permColor(perm) {
    if (perm === 'always') return 'var(--xc-success, #2a8)';
    if (perm === 'never') return 'var(--xc-danger-fg)';
    return 'var(--xc-text-muted)';
}

function permissionLabel(perm) {
    if (perm === 'always') return t('settings.connectedSites.alwaysAllow');
    if (perm === 'never') return t('settings.connectedSites.permNever');
    return t('settings.connectedSites.askEveryTime');
}

function formatLastUsed(iso) {
    if (!iso) return 'never';
    try {
        const d = new Date(iso);
        const now = Date.now();
        const diff = (now - d.getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d ago`;
        return d.toISOString().slice(0, 10);
    } catch {
        return iso;
    }
}

// The calendar day a site connected, as the list's older dates read.
function formatDate(iso) {
    if (!iso) return t('send.advanced.none');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}
