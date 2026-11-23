// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Confirm Standard (G127, revised 2026-11-16: the operator's round 5
// layout 1, "Centred 64, One Card"): the one body every confirmation renders,
// whatever it signs. Top to bottom, 8px apart and with no outer card:
//   1. the status notice (G120): red when the network did not fully check the
//      action, green "Checked" only on the indexer's own approval;
//   2. one centred 64px icon of the token or coin it is about, its network pip
//      in the lower-right corner the only network mark (no action badge);
//   3. a user-chosen name on its own line when the kind has one (a list's, a
//      file's), then the action in one short centred sentence;
//   4. one facts card holding every detail: the labelled address first, then
//      the action's own rows, signing wallet, network and each fee;
//   5. the short warning (a title plus one line) after the details;
// then whatever the signer needs (the verbatim message, the PSBT's inputs and
// outputs, the password or device). Reject and Approve are docked in Screen's
// footer, half the width each, 8px between and around them, always in full
// colour (G130). There is no Total block.
//
// It draws only; shared/utils/confirmStandardModel.js decides what it says,
// and ConfirmActionModal owns the gates, the focus and the two exits.

import { AddressText, Button, Checkbox, Icon, Notice, NoticeList } from '@xchain-wallet/core/ui';
import factStyles from '../routes/FactRows.module.css';
import { preflightFindingKey } from '../utils/preflightFindingKey.js';
import { errorText } from '../utils/preflightFindingCopy.js';
import { unknownActionStatus, withAddressFact, withNetworkFact } from '../utils/confirmStandardModel.js';
import { TickerIcon } from './TickerIcon.jsx';
import styles from './ConfirmStandard.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/extension.js';

// The icon each kind shows when there is no token mark (confirmStandardModel's
// CONFIRM_KINDS names them).
const KIND_ICON = Object.freeze({
    send: Icon.SendIcon,
    sweep: Icon.SweepIcon,
    mint: Icon.MintIcon,
    token: Icon.TokenIcon,
    trash: Icon.TrashIcon,
    market: Icon.MarketIcon,
    coins: Icon.CoinsIcon,
    users: Icon.UsersIcon,
    list: Icon.ListIcon,
    share: Icon.ShareIcon,
    stake: Icon.StakeIcon,
    contract: Icon.ContractIcon,
    message: Icon.MessageIcon,
    broadcast: Icon.BroadcastIcon,
    document: Icon.DocumentIcon,
    link: Icon.LinkIcon,
    lock: Icon.LockIcon,
    address: Icon.AddressIcon,
    chart: Icon.LineChartIcon,
    target: Icon.TargetIcon,
    migrate: Icon.MigrateIcon,
    grid: Icon.GridIcon,
    sign: Icon.SignIcon,
    action: Icon.ZapIcon,
    check: Icon.CheckIcon,
});

/**
 * The one centred 64px icon: the token's own mark (with its network pip) when
 * there is one, else the kind's icon in a muted disc.
 *
 * @param {{ mark?: import('react').ReactNode, icon?: string }} props
 */
function ConfirmIcon({ mark, icon }) {
    if (mark) return <span className={styles.mark} data-testid="confirm-icon">{mark}</span>;
    const Glyph = KIND_ICON[icon] || Icon.CheckIcon;
    return (
        <span className={styles.disc} data-testid="confirm-icon" aria-hidden="true">
            <Glyph />
        </span>
    );
}

/**
 * The read-only facts card (G121): each label and value on one line, a long
 * value cut with an ellipsis and its full text as the title; an address is
 * cut in the middle instead, so both ends stay readable. A row of chips (a
 * token's locks) spans the card under its label.
 *
 * @param {{ facts: import('../utils/confirmStandardModel.js').ConfirmFact[] }} props
 */
export function ConfirmFacts({ facts }) {
    const orderedFacts = facts;
    if (orderedFacts.length === 0) return null;
    return (
        <dl
            className={`${factStyles.list} ${styles.facts}`}
            data-testid="confirm-facts"
            aria-label={t('confirmStandard.facts')}
        >
            {orderedFacts.map((fact) => (Array.isArray(fact.chips) && fact.chips.length > 0 ? [
                <dt key={`${fact.key}-l`} className={`${factStyles.label} ${styles.wideLabel}`}>
                    {fact.label}
                </dt>,
                <dd
                    key={`${fact.key}-v`}
                    className={`${factStyles.value} ${styles.wideValue}`}
                    data-testid={fact.testId || undefined}
                >
                    <span className={styles.chips}>
                        {fact.chips.map((chip) => (
                            <span key={chip} className={styles.chip} data-testid="confirm-lock-chip">
                                <Icon.LockIcon />
                                {chip}
                            </span>
                        ))}
                    </span>
                </dd>,
            ] : [
                <dt key={`${fact.key}-l`} className={`${factStyles.label} ${styles.oneLine}`} title={fact.label}>
                    {fact.assetTick ? (
                        <span className={styles.assetLabel}>
                            <span data-testid="confirm-asset-icon">
                                <TickerIcon chainId={fact.chainId || ''} tick={fact.assetTick} context="header" />
                            </span>
                            <span data-testid="confirm-asset-label">{fact.label}</span>
                        </span>
                    ) : fact.label}
                </dt>,
                <dd
                    key={`${fact.key}-v`}
                    className={`${factStyles.value} ${styles.oneLine}`}
                    title={fact.value}
                    data-testid={fact.testId || undefined}
                >
                    {fact.node || (fact.address ? <AddressText address={fact.value} /> : <bdi>{fact.value}</bdi>)}
                </dd>,
            ]))}
        </dl>
    );
}

function pointContent(point) {
    return (
        <>
            {point.text}
            {point.detail ? <span className={styles.pointDetail}>{point.detail}</span> : null}
        </>
    );
}

/**
 * A notice's points: its issues as one bulleted list when there are several
 * (U101), a single issue as a plain line, with a `lead` sentence above them
 * and an `after` line under them kept plain.
 *
 * @param {{ points: Array<{ key: string, text: string, detail?: string|null, place?: 'lead'|'after' }>, testId?: string, bulleted?: boolean }} props
 */
function Points({ points, testId, bulleted = false }) {
    if (points.length === 0 && !testId) return null;
    const line = (point) => (
        <p key={point.key} data-testid="confirm-warning-point">{pointContent(point)}</p>
    );
    const issues = points.filter((point) => point.place !== 'lead' && point.place !== 'after');
    return (
        <div className={styles.points} data-testid={testId || undefined}>
            {points.filter((point) => point.place === 'lead').map(line)}
            <NoticeList
                forceList={bulleted}
                items={issues.map((point) => ({
                    key: point.key,
                    content: pointContent(point),
                    attrs: { 'data-testid': 'confirm-warning-point' },
                }))}
            />
            {points.filter((point) => point.place === 'after').map(line)}
        </div>
    );
}

/**
 * The status notice, first on the page: the network check's verdict. A
 * failure the producer lets the user override carries a Sign anyway box per
 * finding (the Approve gate reads the same acknowledgements).
 *
 * @param {{
 *   status: import('../utils/confirmStandardModel.js').ConfirmStatus | null,
 *   acknowledged?: Set<string>,
 *   onAcknowledge?: (key: string) => void,
 *   statusRef?: import('react').Ref<HTMLDivElement>,
 * }} props
 */
export function ConfirmStatusNotice({ status, acknowledged, onAcknowledge, statusRef }) {
    if (!status) return null;
    return (
        <div ref={statusRef} tabIndex={-1} className={styles.statusSlot} data-testid="confirm-status-slot">
            <Notice
                // A screen reader registers a live region's politeness when it
                // first sees the node, so a polite notice that turns into a
                // failure at the Approve re-check remounts as an alert.
                key={`${status.role || 'static'}-${status.tone}`}
                tone={status.tone}
                role={status.role}
                flush
                busy={status.state === 'checking'}
                icon={status.tone === 'success' ? <Icon.CircleCheckIcon /> : undefined}
                title={status.state === 'checking'
                    ? <span data-testid="confirm-checking">{status.title}</span>
                    : status.title}
                testId="confirm-status"
                data-state={status.state}
            >
                {status.points.length > 0 ? <Points points={status.points} bulleted={status.state === 'fail'} /> : null}
                {status.overrides.map((finding, index) => {
                    const key = preflightFindingKey(finding);
                    return (
                        <Checkbox
                            key={`${key}-${index}`}
                            label={t('components.preflightPanel.signAnyway')}
                            help={status.overrides.length > 1
                                ? errorText(finding).headline
                                : t('components.preflightPanel.signAnywayHelp')}
                            checked={Boolean(acknowledged?.has(key))}
                            onChange={() => onAcknowledge?.(key)}
                            data-testid={`ack-${key}`}
                        />
                    );
                })}
            </Notice>
        </div>
    );
}

/**
 * The short warning after the details: one static danger notice, a title and
 * its short lines. It is part of the page from first paint, so it is no live
 * region.
 *
 * @param {{ warning: import('../utils/confirmStandardModel.js').ConfirmWarning | null }} props
 */
export function ConfirmWarningSlot({ warning }) {
    if (!warning) return null;
    return (
        <Notice
            tone="danger"
            role={warning.role ?? null}
            flush
            title={warning.title}
            testId="confirm-warning"
            data-state={warning.state}
        >
            <Points points={warning.points} testId={warning.testId} />
        </Notice>
    );
}

/**
 * Reject (red, thumbs down) and Approve (green, thumbs up), each half the
 * width and 8px apart, at every width. A blocking pre-flight finding disables
 * Approve; other incomplete steps continue to answer a tap with their reason.
 *
 * @param {{
 *   onReject: (e?: any) => void,
 *   onApprove: (e?: any) => void,
 *   rejectDisabled?: boolean,     both exits lock while a signature is in flight
 *   approveDisabled?: boolean,    a blocking pre-flight finding holds approval
 *   approveLoading?: boolean,
 *   approveLabel?: string,
 * }} props
 */
export function ConfirmButtons({
    onReject, onApprove, rejectDisabled = false, approveDisabled = false, approveLoading = false, approveLabel,
}) {
    const approve = approveLabel || t('extension.connect.approve');
    return (
        <div className={styles.buttons} data-testid="confirm-buttons">
            <Button
                variant="danger"
                className={styles.button}
                icon={<Icon.ThumbsDownIcon />}
                onClick={onReject}
                disabled={rejectDisabled}
                data-testid="confirm-reject"
            >
                {t('extension.approval.reject')}
            </Button>
            <Button
                variant="success"
                className={[styles.button, approveDisabled ? styles.disabled : null].filter(Boolean).join(' ')}
                icon={<Icon.ThumbsUpIcon />}
                onClick={onApprove}
                disabled={approveDisabled}
                disabledAppearance={approveDisabled}
                loading={approveLoading}
                data-testid="confirm-approve"
                aria-label={approve}
            >
                {approve}
            </Button>
        </div>
    );
}

/**
 * The docked decision footer: every confirm passes it as Screen's footer,
 * which stays at the bottom of the screen while the details scroll above it,
 * so Reject and Approve are always visible without scrolling. The footer that
 * holds it pads 8px all round (ConfirmStandard.module.css), the extension sign
 * window's footer included, since that one holds ConfirmButtons too.
 */
export function ConfirmDecisionFooter({
    onReject, onApprove, rejectDisabled = false, approveDisabled = false, approveLoading = false, approveLabel,
}) {
    return (
        <div className={styles.decision} data-testid="confirm-decision">
            <ConfirmButtons
                onReject={onReject}
                onApprove={onApprove}
                rejectDisabled={rejectDisabled}
                approveDisabled={approveDisabled}
                approveLoading={approveLoading}
                approveLabel={approveLabel}
            />
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../utils/confirmStandardModel.js').ConfirmStatus | null} [props.status]   the network check's verdict, first on the page
 * @param {import('react').RefObject<HTMLDivElement>} [props.statusRef]   focus target when a tap on Approve is answered at the top
 * @param {import('react').ReactNode} [props.top]       an in-page error or a blocked-Approve notice, under the status
 * @param {import('react').ReactNode} [props.mark]      the token mark, when the action has one
 * @param {string} [props.icon]                         the kind's icon name otherwise
 * @param {string} [props.name]                         a user-chosen name on its own line above the sentence
 * @param {string} [props.actionCode]                   raw code for an action the wallet cannot explain
 * @param {string} props.sentence
 * @param {string|null} [props.address]
 * @param {string} [props.chainName]                   the chain display name, always a Network fact
 * @param {boolean} [props.addressIsSource]            the address is the spender's own (#40), not where the action goes
 * @param {string} [props.addressLabel]                 the first fact's address label ("From", "To", "New owner")
 * @param {import('react').ReactNode} [props.afterAddress]   the requesting site, after the sentence
 * @param {import('../utils/confirmStandardModel.js').ConfirmFact[]} [props.facts]
 * @param {boolean} [props.preserveFactOrder]             facts already include the address and network in their required order
 * @param {string} [props.note]                         a fact the form moved off its page, one plain line
 * @param {string} [props.messageText]                  the signed message, verbatim
 * @param {import('react').ReactNode} [props.children]  what the signer needs: the PSBT panel, the password, the device
 * @param {boolean} [props.checking]                    the network check is still running (when no status is passed)
 * @param {import('../utils/confirmStandardModel.js').ConfirmWarning | null} [props.warning]
 * @param {Set<string>} [props.acknowledged]
 * @param {(key: string) => void} [props.onAcknowledge]
 * @param {string} [props.label]                        the page's accessible name
 */
export function ConfirmStandard({
    status = null, statusRef, top = null, mark = null, icon = 'check', name = '', sentence, address = null, chainName = '',
    actionCode = '',
    addressIsSource = false, addressLabel = '', afterAddress = null,
    facts = [], preserveFactOrder = false, note = '', messageText, children = null,
    checking = false, warning = null, acknowledged, onAcknowledge, label,
}) {
    const noteText = String(note || '').trim();
    const nameText = String(name || '').trim();
    const unknownCode = String(actionCode || '').trim().toUpperCase();
    const actionFacts = unknownCode ? [{
        key: 'action-code',
        label: t('confirmStandard.fact.actionCode'),
        value: unknownCode,
        testId: 'confirm-action-code',
    }, ...facts.filter((fact) => String(fact?.label || '').trim().toLowerCase() !== 'action code')] : facts;
    const addressFacts = withAddressFact({ facts: actionFacts, address, addressIsSource, addressLabel });
    const shownFacts = preserveFactOrder ? actionFacts : withNetworkFact({
        facts: addressFacts,
        chainName,
    });
    const shownStatus = unknownCode
        ? unknownActionStatus(status)
        : status || (checking
            ? { tone: 'info', title: t('confirmStandard.checking'), points: [], overrides: [], role: 'status', state: 'checking' }
            : null);
    return (
        <div className={styles.stack} data-testid="confirm-modal" aria-label={label}>
            <ConfirmStatusNotice
                status={shownStatus}
                acknowledged={acknowledged}
                onAcknowledge={onAcknowledge}
                statusRef={statusRef}
            />
            {top}
            <ConfirmIcon mark={mark} icon={icon} />
            {nameText ? <p className={styles.name} data-testid="confirm-name" dir="auto">{nameText}</p> : null}
            <p className={styles.sentence} data-testid="confirm-sentence">{sentence}</p>
            {afterAddress}
            <ConfirmFacts facts={shownFacts} preserveOrder={preserveFactOrder} />
            {noteText ? <p className={styles.note} data-testid="confirm-summary-notice">{noteText}</p> : null}
            {messageText !== undefined ? (
                <section className={styles.messageBox} aria-label={t('components.confirmActionModal.messageToSign')}>
                    <p className={styles.messageLabel}>{t('components.confirmActionModal.messageToSign')}</p>
                    <p className={styles.messageText} data-testid="confirm-message-text" dir="auto">{messageText}</p>
                </section>
            ) : null}
            <ConfirmWarningSlot warning={warning} />
            {children}
        </div>
    );
}

export { styles as confirmStandardStyles };
