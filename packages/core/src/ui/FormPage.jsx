// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Children, cloneElement, forwardRef, Fragment, isValidElement, useContext, useMemo, useRef, useState } from 'react';
import { ShellReachabilityNoticeContext } from '../shared/components/noticesRoute.js';
import { useHideReachabilityNotice } from '../shared/components/hideReachabilityNotice.js';
import { ReachabilityLine } from '../shared/components/ReachabilityLine.jsx';
import { FormNotices } from './formNoticeSlot.js';
import { EmptyStateAsLineContext } from './Screen.jsx';
import { NoticeLines } from './FormNotice.jsx';
import { StatusMessage, StatusMessageGroup } from './StatusMessage.jsx';
import { submitOnlyFromLastField } from './formEnter.js';
import styles from './FormPage.module.css';

/**
 * Disable every submit button in an action row. Used by the demo guard so a
 * demo wallet can browse the form but never reach a compose.
 */
function disableSubmits(node) {
    return Children.map(node, (child) => {
        if (!isValidElement(child)) return child;
        if (child.props?.type === 'submit') return cloneElement(child, { disabled: true });
        if (child.props?.children != null && typeof child.type === 'symbol') {
            return cloneElement(child, undefined, disableSubmits(child.props.children));
        }
        return child;
    });
}

/**
 * The props of a StatusMessage element as one line of a StatusMessageGroup,
 * or null for any other node (an error summary), which keeps its own place.
 */
function noticeEntry(node, key) {
    if (!isValidElement(node) || node.type !== StatusMessage) return null;
    const { children, variant, lead, recovery, details, role, testId, id } = node.props;
    if (children === null || children === undefined || children === '') return null;
    return { key, id, children, variant, lead, recovery, details, role, testId };
}

/**
 * Page template for every screen whose job is a form the user fills in and
 * submits. One rule on every platform, decided by viewport width alone
 * (FormPage.module.css, breakpoint 600px):
 *
 *   narrow (< 600px)  fields sit bare on the page gutter, no card
 *   wide  (>= 600px)  the form sits in one card, a centred 560px column
 *
 * Screen owns the page gutter and top spacing. The wide card centres within
 * that content box without adding its own top margin.
 *
 * Notices (`status`, the demo-wallet note and any FormNotice raised from the
 * body) lead the page content, as one box with a line per notice: a page
 * carries one message per state. When the shell says balances may be out of
 * date and the form has a notice of its own, the shell's sentence and its
 * Try again join that box as its first line instead of a second box above. A plain form draws them just above itself, so
 * on a wide screen they sit above the card at the full content width instead
 * of a box inside it, and on a narrow screen, where the form is bare, they
 * lead the fields exactly as before. A form that owns its title puts them
 * under that title instead.
 *
 * Pass `sectioned` when the children are FormSections. The sections share
 * the form's wide card and are divided from one another at every width.
 * The action row always closes the form, below the last field or section,
 * and its buttons wrap rather than overflow.
 *
 * The width decision is pure CSS, never the shell or a JS width check, so a
 * phone browser gets the bare form and the first paint is already right.
 *
 * @param {object} props
 * @param {(e: import('react').FormEvent<HTMLFormElement>) => void} [props.onSubmit]
 * @param {import('react').ReactNode} [props.actions]   the action row: primary last, so it ends up on the right
 * @param {import('react').ReactNode | import('react').ReactNode[]} [props.status]    a StatusMessage or error summary, or a list of them (empty entries dropped), the first item of the page content: above the form (its card, when wide) at the full content width on a plain form, below the form's own logo or title when it draws one
 * @param {import('react').ReactNode} [props.intro]     one muted paragraph above the first field
 * @param {import('react').ReactNode} [props.title]     centred page title for onboarding and other focused forms
 * @param {import('react').ReactNode} [props.description] supporting copy below `title`
 * @param {import('react').ReactNode} [props.visual]    optional illustration above `title`
 * @param {import('react').ReactNode} [props.progress]  step indicator in the page's top row
 * @param {import('react').ReactNode} [props.topAction] action aligned opposite the progress indicator
 * @param {'h1' | 'h2'} [props.headingAs]               title heading level; defaults to h1
 * @param {import('react').Ref<HTMLHeadingElement>} [props.titleRef]
 * @param {boolean} [props.stackedActions]              stack equal-width actions instead of sharing a row
 * @param {boolean} [props.sectioned]                   children are divider-separated FormSections
 * @param {boolean} [props.fill]                        the form fills the screen height so a scrolling panel can take the free space and the actions sit at the bottom
 * @param {boolean} [props.fullWidth]                   wide screens use the whole content width with no card, for reading pages such as the license terms
 * @param {{ blocked: boolean, note: import('react').ReactNode, dialog: import('react').ReactNode }} [props.demoGuard] from useDemoGuard: in a demo wallet the note replaces `status`, submit buttons are disabled and submission is ignored
 * @param {string} [props.label]                        accessible name, which makes the form a landmark
 * @param {boolean} [props.noValidate]                  default true: the route validates and reports through `status`
 * @param {boolean} [props.submitFromAnyField]          keep native Enter submission for a migrated form that previously allowed it
 * @param {'form' | 'div'} [props.as]                   use div for a reusable form fragment already inside a parent form
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export const FormPage = forwardRef(function FormPage(
    {
        onSubmit,
        actions,
        status,
        intro,
        title,
        description,
        visual,
        progress,
        topAction,
        headingAs: Heading = 'h1',
        titleRef,
        stackedActions = false,
        sectioned = false,
        fill = false,
        fullWidth = false,
        label,
        demoGuard,
        noValidate = true,
        submitFromAnyField = false,
        as: Root = 'form',
        className,
        children,
        onKeyDown,
        ...rest
    },
    ref,
) {
    const classNames = [
        styles.form,
        sectioned ? styles.sectioned : null,
        fill ? styles.fill : null,
        fullWidth ? styles.fullWidth : null,
        fullWidth ? styles.cardlessSections : null,
        className,
    ].filter(Boolean).join(' ');
    const demoBlocked = !!demoGuard?.blocked;
    const guardedSubmit = demoBlocked
        ? (event) => { event?.preventDefault?.(); }
        : onSubmit;
    const semanticProps = Root === 'form'
        ? { onSubmit: guardedSubmit, noValidate, 'aria-label': label }
        : { role: 'group', 'aria-label': label };
    const handleKeyDown = (event) => {
        onKeyDown?.(event);
        if (Root === 'form' && !submitFromAnyField) submitOnlyFromLastField(event);
    };
    // Notices raised by controls inside the form (the fee selector) join the
    // form's own status at the top instead of sitting under their field.
    const [controlNotices, setControlNotices] = useState(/** @type {Record<string, { text: string, variant: string, role?: any }>} */ ({}));
    const noticeApi = useMemo(() => ({
        report: (id, entry) => setControlNotices((prev) => {
            const had = prev[id];
            if (!entry && !had) return prev;
            if (entry && had && had.text === entry.text && had.variant === entry.variant && had.role === entry.role && had.lead === entry.lead && had.testId === entry.testId) return prev;
            const next = { ...prev };
            if (entry) next[id] = entry; else delete next[id];
            return next;
        }),
    }), []);
    const controlNoticeList = Object.entries(controlNotices);
    const hasHeader = title != null || description != null || visual != null;
    const actionClassName = [
        styles.actions,
        stackedActions ? styles.stackedActions : null,
    ].filter(Boolean).join(' ');
    // A form that draws its own logo or title is the page header; any other form
    // sits under the screen's PageHeader and its notice leads the content.
    const ownsHeading = title != null || visual != null;
    // A list of notices drops its empty entries, so a form can pass each
    // state's notice in one place and an all-empty list shows nothing.
    const statusContent = Array.isArray(status) ? Children.toArray(status.filter(Boolean)) : status;
    const hasStatus = Array.isArray(statusContent) ? statusContent.length > 0 : !!statusContent;
    // Every notice the form shows, in order: its own status (or the demo
    // note), then the ones raised from inside the body. StatusMessages merge
    // into one box; any other node (an error summary) keeps its own place.
    // A page that leads with the demo note itself passes the guard without it:
    // the form is still blocked and still hides its own notices, but draws none.
    const ownNodes = demoBlocked
        ? (demoGuard.note ? [demoGuard.note] : [])
        : (hasStatus ? (Array.isArray(statusContent) ? statusContent : [statusContent]) : []);
    const otherNodes = [];
    const entries = [];
    // A fragment (a notice beside the hook that hides the shell's) is read
    // through, so its notice still joins the box.
    const collect = (node, key) => {
        if (isValidElement(node) && node.type === Fragment) {
            Children.toArray(node.props.children).forEach((child, i) => collect(child, `${key}.${child?.key ?? i}`));
            return;
        }
        const entry = noticeEntry(node, key);
        if (entry) entries.push(entry);
        else if (node) otherNodes.push(isValidElement(node) && node.key == null && ownNodes.length > 1 ? cloneElement(node, { key }) : node);
    };
    ownNodes.forEach((node, index) => collect(node, `status-${node?.key ?? index}`));
    if (!demoBlocked) {
        for (const [id, entry] of controlNoticeList) {
            entries.push({
                key: id,
                variant: entry.variant,
                role: entry.role,
                lead: entry.lines ? undefined : entry.lead,
                testId: entry.testId,
                children: entry.lines ? <NoticeLines lead={entry.lead} lines={entry.lines} /> : entry.text,
            });
        }
    }
    // The shell's reachability sentence joins a form that has a notice of its
    // own, and the shell's notice steps aside, so the page shows one box.
    // A screen that already states the outage hides the shell's notice
    // itself; its sentence is then not repeated here. The count includes
    // this form's own hide, so that one is taken off.
    const shellNotice = useContext(ShellReachabilityNoticeContext);
    const carriedRef = useRef(false);
    const hiddenElsewhere = (shellNotice?.hiddenCount ?? 0) - (carriedRef.current ? 1 : 0) > 0;
    const carriesShellNotice = Root === 'form' && Boolean(shellNotice) && !hiddenElsewhere && entries.length > 0;
    carriedRef.current = carriesShellNotice;
    useHideReachabilityNotice(carriesShellNotice);
    if (carriesShellNotice) {
        entries.unshift({
            key: 'shell-reachability',
            variant: shellNotice.variant,
            role: null,
            // The same Details control the shell's notice carries.
            children: (
                <ReachabilityLine
                    text={shellNotice.text}
                    coins={shellNotice.coins ?? []}
                    lastChecked={shellNotice.lastChecked ?? null}
                />
            ),
            recovery: { label: shellNotice.retryLabel, onAction: shellNotice.retry, disabled: shellNotice.retrying },
        });
    }
    // Always the same box, so a notice that arrives later (a fee note) or
    // leaves (a restored draft) never remounts the others or their buttons.
    const noticeBox = entries.length > 0 ? <StatusMessageGroup entries={entries} /> : null;
    const statusNode = otherNodes.length > 0 || noticeBox
        ? (
            <div className={styles.status} data-form-status="" tabIndex={-1}>
                {/* A lone node keeps its place unkeyed, as it was passed. */}
                {otherNodes.length === 1 ? otherNodes[0] : otherNodes}
                {noticeBox}
            </div>
        )
        : null;
    // On a wide screen the form is a card, and a notice drawn inside it would be a
    // box in a box. A plain form therefore draws its notices just above itself, at
    // the full content width, as the first item of the page content. A form that
    // owns its title, fills the screen or is a nested fragment keeps them inside.
    // The wrapper is there whether or not a notice shows, so a notice coming or
    // going never remounts the form and the field being typed in keeps its focus.
    const noticeAboveCard = !ownsHeading && !fill && Root === 'form';
    const form = (
        <Root
            ref={ref}
            className={classNames}
            {...semanticProps}
            {...rest}
            onKeyDown={handleKeyDown}
        >
            {/* A notice is the first item of the page content, at the top where it
                is seen, never below the fields or beside the submit button. A form
                that owns its title (onboarding) puts it under that title instead. */}
            {!ownsHeading && !noticeAboveCard ? statusNode : null}
            {intro ? <p className={styles.intro}>{intro}</p> : null}
            {progress != null || topAction != null ? (
                <div className={styles.topRow}>
                    <span aria-hidden="true" />
                    <div className={styles.progress}>{progress}</div>
                    <div className={styles.topAction}>{topAction}</div>
                </div>
            ) : null}
            {hasHeader ? (
                <header className={styles.pageHeader}>
                    {visual != null ? <div className={styles.visual}>{visual}</div> : null}
                    {title != null ? (
                        <Heading ref={titleRef} tabIndex={-1} className={styles.title}>
                            {title}
                        </Heading>
                    ) : null}
                    {description != null ? <p className={styles.description}>{description}</p> : null}
                </header>
            ) : null}
            {ownsHeading ? statusNode : null}
            {/* data-form-stack marks a column the form gap spaces, so a shared row
                class (an action row, a notice) can drop its own margin inside it. */}
            {children != null ? (
                <FormNotices.Provider value={noticeApi}>
                    <EmptyStateAsLineContext.Provider value={Root === 'form'}>
                        <div className={styles.body} data-form-stack="">{children}</div>
                    </EmptyStateAsLineContext.Provider>
                </FormNotices.Provider>
            ) : null}
            {actions ? <div className={actionClassName}>{demoBlocked ? disableSubmits(actions) : actions}</div> : null}
            {demoBlocked ? demoGuard.dialog : null}
        </Root>
    );
    if (!noticeAboveCard) return form;
    return (
        <div className={styles.page}>
            {statusNode}
            {form}
        </div>
    );
});
