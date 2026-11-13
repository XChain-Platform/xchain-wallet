// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { registry as registryLib } from '../../../index.js';
import { InfoTip } from '../../../ui/InfoTip.jsx';
import { BookIcon, ChevronDownIcon, FilterIcon, KeyIcon, SwapIcon } from '../../../ui/icons/index.jsx';
import { TickerIcon } from '../TickerIcon.jsx';
import { GiveGetSection, GiveGetStaticSection } from './GiveGetSection.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/components.js';
import '../../../i18n/locales/en/issue.js';
import '../../../i18n/locales/en/ui.js';
import styles from './GiveGet.module.css';

/**
 * The Quick view of the shared Give/Get standard. A big You give card, a round flip button, a You get card,
 * then the host's rate line, one Ownership group with both switches, and a
 * single terms row that switches to the Full form. Pickers stay pages: the
 * asset chip calls the host's onOpenAsset, the same callback TokenField uses.
 * Returns siblings so the form body spaces them like the Full view.
 *
 * @typedef {object} QuickSide
 * @property {string} [label]                      'You give' / 'You get'
 * @property {import('react').ReactNode} [help]
 * @property {{ chainId: string, tick: string } | null} asset   its icon's network badge is the only place the network shows
 * @property {string} [assetPlaceholder]           empty-chip text: 'Select an asset' where coins can be picked
 * @property {string} assetLabel                   accessible field name, e.g. 'Give token'
 * @property {() => void} onOpenAsset
 * @property {string} amount
 * @property {(raw: string) => void} onAmountChange
 * @property {string} amountLabel                  accessible field name, e.g. 'Give amount'
 * @property {boolean} [ownership]                 ownership mode: the amount gives way to the name
 * @property {import('react').ReactNode} [ownershipHint]
 * @property {import('react').ReactNode} [balanceText]
 * @property {() => void} [onMax]                  omit for no Max button (get side)
 * @property {boolean} [maxDisabled]
 * @property {import('react').ReactNode} [footNote] left foot text (fiat preview, per-fill note)
 * @property {import('react').ReactNode} [address] a QuickAddressRow (From, Receive at)
 * @property {import('react').ReactNode} [extra]   anything else the form needs inside the card
 * @property {boolean} [disabled]
 *
 * @param {object} props
 * @param {QuickSide} props.give
 * @param {QuickSide} props.get
 * @param {() => void} [props.onFlip]              omit to hide the flip button (Dispenser)
 * @param {string} [props.flipLabel]
 * @param {import('react').ReactNode} [props.notice]  under the cards (gated content, coin-for-coin)
 * @param {import('react').ReactNode} [props.rate]    a RateLine, or a price line
 * @param {{ title?: string, summary?: import('react').ReactNode, children: import('react').ReactNode } | null} [props.ownership]
 * @param {{ title?: string, summary: import('react').ReactNode, children?: import('react').ReactNode, open?: boolean, onToggle?: () => void, onEdit?: () => void, editLabel?: string } | null} [props.terms]
 *   With `children`, an in-place collapsible section (open / onToggle).
 * @param {import('react').ReactNode} [props.after]
 */
export function GiveGetQuick({ give, get, onFlip, flipLabel = 'Flip give and get', notice, rate, ownership, terms, after }) {
    return (
        <>
            <div className={styles.pair}>
                <QuickSideCard side={give} fallbackLabel={t('components.giveGet.youGive')} />
                {onFlip ? (
                    <div className={styles.flipRow}>
                        <button
                            type="button"
                            className={styles.flip}
                            onClick={onFlip}
                            aria-label={flipLabel}
                            title={flipLabel}
                            disabled={give.disabled || get.disabled}
                        >
                            <SwapIcon />
                        </button>
                    </div>
                ) : null}
                <QuickSideCard side={get} fallbackLabel={t('components.giveGet.youGet')} />
            </div>
            {notice}
            {rate}
            {ownership ? (
                <GiveGetStaticSection
                    title={ownership.title || t('components.giveGet.ownership')}
                    icon={KeyIcon}
                    summary={ownership.summary}
                >
                    <div className={styles.toggleList}>{ownership.children}</div>
                </GiveGetStaticSection>
            ) : null}
            {/* A terms entry with children expands in place as a collapsible
                section (only the Quick | Full switch changes views); onEdit
                alone renders a plain row. */}
            {terms && terms.children !== undefined ? (
                <GiveGetSection
                    id="terms"
                    title={terms.title || t('components.giveGet.termsAndFees')}
                    icon={FilterIcon}
                    summary={terms.summary}
                    open={!!terms.open}
                    onToggle={terms.onToggle}
                >
                    {terms.children}
                </GiveGetSection>
            ) : terms ? <TermsRow {...terms} /> : null}
            {after}
        </>
    );
}

function QuickSideCard({ side, fallbackLabel }) {
    const label = side.label || fallbackLabel;
    const tick = side.asset?.tick ? String(side.asset.tick).toUpperCase() : '';
    const hasAsset = Boolean(side.asset?.chainId && tick);
    const chainName = hasAsset ? registryLib.defaultRegistry().get(side.asset.chainId)?.displayName : null;
    const assetName = hasAsset
        ? `${side.assetLabel}: ${tick}${chainName ? ` on ${chainName}` : ''}`
        : `${side.assetLabel}: ${side.assetPlaceholder || t('components.tokenField.selectAToken')}`; // Per-form placeholder (Asset pickers say Select an asset).
    const amountName = tick ? `${side.amountLabel} (${tick})` : side.amountLabel;
    return (
        <section className={styles.card} aria-label={label}>
            <div className={styles.cardTop}>
                <span className={styles.cardLabel}>{label}</span>
                {side.help ? <InfoTip label={side.help} aria={t('ui.field.about', { label })} /> : null}
                {/* The asset decides the network, so the card shows no network
                    control or name; the token icon's chain badge is the only cue. */}
                <span className={styles.spacer} />
            </div>
            <div className={styles.cardMid}>
                {side.ownership ? (
                    <div className={styles.bigOwnership}>
                        <KeyIcon />
                        <span>{t('components.giveGet.entireOwnership', { token: tick || t('components.giveGet.thisToken') })}</span>
                    </div>
                ) : (
                    <input
                        className={styles.bigAmount}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="0"
                        aria-label={amountName}
                        value={side.amount}
                        disabled={side.disabled}
                        onChange={(e) => side.onAmountChange(e.target.value)}
                    />
                )}
                <button
                    type="button"
                    className={`${styles.assetChip} ${hasAsset ? '' : styles.assetChipEmpty}`.trim()}
                    onClick={side.onOpenAsset}
                    disabled={side.disabled}
                    aria-label={assetName}
                >
                    {hasAsset ? (
                        <>
                            {/* The 28px header avatar, so the icon and its chain badge
                                sit inside the chip instead of filling it. */}
                            <TickerIcon chainId={side.asset.chainId} tick={tick} context="header" />
                            <span className={styles.assetTick} title={tick}>{tick}</span>
                        </>
                    ) : (
                        <span className={styles.assetTick}>{side.assetPlaceholder || t('components.tokenField.selectAToken')}</span>
                    )}
                    <span className={styles.chipCaret} aria-hidden="true"><ChevronDownIcon /></span>
                </button>
            </div>
            {side.ownership ? (
                side.ownershipHint ? <div className={styles.cardFoot}>{side.ownershipHint}</div> : null
            ) : (side.footNote || side.balanceText || side.onMax) ? (
                <div className={styles.cardFoot}>
                    {side.footNote ? <span>{side.footNote}</span> : null}
                    {side.balanceText ? <span className={styles.balance}>{side.balanceText}</span> : <span className={styles.spacer} />}
                    {side.onMax !== undefined ? (
                        <button
                            type="button"
                            className={styles.maxPill}
                            onClick={side.onMax || undefined}
                            disabled={side.disabled || side.maxDisabled || !side.onMax}
                            aria-label={t('components.giveGet.maxAmount', { label: label.toLowerCase() })}
                        >
                            {t('components.amountField.max')}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {side.extra}
            {side.address}
        </section>
    );
}

/**
 * The From / Receive at line at the foot of a Quick card, with
 * the address-book button that opens the host's own address picker page.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {import('react').ReactNode} [props.help]
 * @param {string} [props.address]
 * @param {string} [props.placeholder]
 * @param {() => void} [props.onPick]
 * @param {string} [props.pickLabel]
 */
export function QuickAddressRow({ label, help, address, placeholder, onPick, pickLabel }) {
    return (
        <div className={styles.addressRow}>
            <span className={styles.addressLabel}>
                {label}
                {help ? <InfoTip label={help} aria={t('ui.field.about', { label })} /> : null}
            </span>
            <span className={styles.addressValue} title={address || undefined}>{address || placeholder || t('issue.summary.notSet')}</span>
            {onPick ? (
                <button type="button" className={styles.iconButton} onClick={onPick} aria-label={pickLabel || t('components.giveGet.choose', { label })}>
                    <BookIcon />
                </button>
            ) : null}
        </div>
    );
}

function TermsRow({ title: titleProp, summary, onEdit, editLabel = 'Edit' }) {
    const title = titleProp ?? t('components.giveGet.termsAndFees');
    return (
        <button
            type="button"
            className={styles.termsRow}
            onClick={onEdit}
            aria-label={`${editLabel} ${title.toLowerCase()}: ${typeof summary === 'string' ? summary : ''}`.trim()}
        >
            <span className={styles.termsIcon} aria-hidden="true"><FilterIcon /></span>
            <span className={styles.termsCopy}>
                <span className={styles.termsTitle}>{title}</span>
                <span className={styles.termsSummary}>{summary}</span>
            </span>
            <span className={styles.termsEdit} aria-hidden="true">
                <span>{editLabel}</span>
                <span><ChevronDownIcon /></span>
            </span>
        </button>
    );
}
