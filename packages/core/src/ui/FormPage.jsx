// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Children, cloneElement, forwardRef, isValidElement, useCallback, useMemo, useState } from 'react';
import { FormNotices } from './formNoticeSlot.js';
import { StatusMessage } from './StatusMessage.jsx';
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
 * @param {import('react').ReactNode} [props.status]    a StatusMessage or error summary, the first item of the form content: above the first field, below the form's own logo or title when it draws one
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
        if (Root === 'form') submitOnlyFromLastField(event);
    };
    // Notices raised by controls inside the form (the fee selector) join the
    // form's own status at the top instead of sitting under their field.
    const [controlNotices, setControlNotices] = useState(/** @type {Record<string, string>} */ ({}));
    const noticeApi = useMemo(() => ({
        report: (id, text) => setControlNotices((prev) => {
            if ((prev[id] ?? null) === text) return prev;
            const next = { ...prev };
            if (text) next[id] = text; else delete next[id];
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
    const statusNode = demoBlocked || status || controlNoticeList.length > 0
        ? (
            <div className={styles.status}>
                {demoBlocked ? demoGuard.note : status}
                {!demoBlocked ? controlNoticeList.map(([id, text]) => (
                    <StatusMessage key={id} variant="warning">{text}</StatusMessage>
                )) : null}
            </div>
        )
        : null;
    return (
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
            {!ownsHeading ? statusNode : null}
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
                    <div className={styles.body} data-form-stack="">{children}</div>
                </FormNotices.Provider>
            ) : null}
            {actions ? <div className={actionClassName}>{demoBlocked ? disableSubmits(actions) : actions}</div> : null}
            {demoBlocked ? demoGuard.dialog : null}
        </Root>
    );
});
