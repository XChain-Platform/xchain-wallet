// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Wallet Form Standard shows a form's errors and notices in one slot just
// above the action button. FormPage alone hoists them to the page top;
// FormStatusScope reroutes notices raised inside the form body into this slot.

import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, useMemo, useRef, useState } from 'react';
import { ShellReachabilityNoticeContext } from '../noticesRoute.js';
import { useHideReachabilityNotice } from '../hideReachabilityNotice.js';
import { ReachabilityLine } from '../ReachabilityLine.jsx';
import { FormNotices } from '../../../ui/formNoticeSlot.js';
import { NoticeLines } from '../../../ui/FormNotice.jsx';
import { StatusMessage, StatusMessageGroup } from '../../../ui/StatusMessage.jsx';
import pageStyles from '../../../ui/FormPage.module.css';
import styles from './formStandard.module.css';

const RaisedNotices = createContext(/** @type {Array<[string, any]>} */ ([]));

/**
 * Wrap the form body (sections and the slot) in this, so notices raised from
 * inside it reach the FormStatusSlot rather than the top of the page.
 * FormFrame does it for you.
 */
export function FormStatusScope({ children }) {
    const [raised, setRaised] = useState(/** @type {Record<string, any>} */ ({}));
    const api = useMemo(() => ({
        report: (id, entry) => setRaised((prev) => {
            const had = prev[id];
            if (!entry && !had) return prev;
            if (entry && had && had.text === entry.text && had.variant === entry.variant
                && had.role === entry.role && had.lead === entry.lead && had.testId === entry.testId) return prev;
            const next = { ...prev };
            if (entry) next[id] = entry; else delete next[id];
            return next;
        }),
    }), []);
    const list = useMemo(() => Object.entries(raised), [raised]);
    return (
        <FormNotices.Provider value={api}>
            <RaisedNotices.Provider value={list}>{children}</RaisedNotices.Provider>
        </FormNotices.Provider>
    );
}

/** A StatusMessage element as one line of the group, or null for any other node. */
function noticeEntry(node, key) {
    if (!isValidElement(node) || node.type !== StatusMessage) return null;
    const { children, variant, lead, recovery, details, role, testId, id } = node.props;
    if (children === null || children === undefined || children === '') return null;
    return { key, id, children, variant, lead, recovery, details, role, testId };
}

/**
 * The one notice and error slot, placed just above the action. Pass the
 * form's own notices as `status` (a node or a list; empty entries dropped),
 * in the order FormPage's `status` took them. StatusMessages merge into one
 * box with a line each, joined by the notices raised inside the form; any
 * other node (FormErrorSummary) keeps its own place above that box.
 *
 * It carries data-form-status, so useFocusNoticeOnAttempt and the tests that
 * look for the form's status region find it.
 *
 * @param {object} props
 * @param {import('react').ReactNode | import('react').ReactNode[]} [props.status]
 */
export function FormStatusSlot({ status }) {
    const raised = useContext(RaisedNotices);
    const own = Array.isArray(status) ? Children.toArray(status.filter(Boolean)) : (status ? [status] : []);
    const entries = [];
    const others = [];
    // A fragment (a notice beside the hook that hides the shell's) is read
    // through, so its notice still joins the box.
    const collect = (node, key) => {
        if (isValidElement(node) && node.type === Fragment) {
            Children.toArray(node.props.children).forEach((child, i) => collect(child, `${key}.${child?.key ?? i}`));
            return;
        }
        const entry = noticeEntry(node, key);
        if (entry) entries.push(entry);
        else if (node) others.push(isValidElement(node) && node.key == null ? cloneElement(node, { key }) : node);
    };
    own.forEach((node, index) => collect(node, `status-${node?.key ?? index}`));
    for (const [id, entry] of raised) {
        entries.push({
            key: id,
            variant: entry.variant,
            role: entry.role,
            lead: entry.lines ? undefined : entry.lead,
            testId: entry.testId,
            children: entry.lines ? <NoticeLines lead={entry.lead} lines={entry.lines} /> : entry.text,
        });
    }
    // The shell's reachability sentence joins a form that has a notice of its
    // own, and the shell's notice steps aside, so the page shows one box. A
    // screen that already states the outage hides the shell's notice itself;
    // its sentence is then not repeated here. The count includes this slot's
    // own hide, so that one is taken off.
    const shellNotice = useContext(ShellReachabilityNoticeContext);
    const carriedRef = useRef(false);
    const hiddenElsewhere = (shellNotice?.hiddenCount ?? 0) - (carriedRef.current ? 1 : 0) > 0;
    const carriesShellNotice = Boolean(shellNotice) && !hiddenElsewhere && entries.length > 0;
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
    const empty = others.length === 0 && entries.length === 0;
    // Always rendered, so a notice arriving or leaving never remounts the
    // others or moves focus.
    return (
        <div
            className={`${pageStyles.status} ${empty ? styles.slotEmpty : ''}`.trim()}
            data-form-status=""
            data-form-status-slot=""
            tabIndex={-1}
        >
            {others}
            {entries.length > 0 ? <StatusMessageGroup entries={entries} /> : null}
        </div>
    );
}
