// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one collapsible section of the Wallet Form Standard. Not the
// same component as ui/FormSection.jsx (a plain titled block for settings
// pages); import this one from shared/components/formStandard.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/Button.jsx';
import { OptionalPill } from '../../../ui/OptionalPill.jsx';
import { ChevronDownIcon } from '../../../ui/icons/index.jsx';
import styles from './formStandard.module.css';

/**
 * One collapsible form section: icon, one-line title, an Optional tag when
 * the section may be left alone, a one-line summary of its values while
 * closed, and a chevron (right closed, down open). The body stays mounted
 * while closed (hidden), so its fields keep their state, refs and any notice
 * they raise.
 *
 * Open state is controlled (`open` + `onOpenChange`, see useFormSections) or
 * uncontrolled (`defaultOpen`). A host whose pickers replace the form (an
 * early return) should control it, or the section forgets it was open.
 *
 * A section opens by itself when a field inside it turns invalid
 * (aria-invalid="true" appears), and whenever `revealKey` changes to a truthy
 * value: pass the form's validation attempt counter while the section holds
 * an error, so every Send attempt reopens it even after the user closed it.
 *
 * The summary drops its trailing `summaryUnit` (" BTC") before it truncates
 * when the row is too narrow, as the standard asks at 360px.
 *
 * @param {object} props
 * @param {string} props.id                                     stable id, used for the panel id and data-form-section
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ComponentType<any>} [props.icon]     icon component
 * @param {boolean} [props.optional]                            show the Optional tag (never on a required section)
 * @param {import('react').ReactNode} [props.summary]           closed-state summary
 * @param {string} [props.summaryUnit]                          trailing unit of the summary, dropped first when narrow
 * @param {boolean} [props.open]                                controlled open state
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {boolean} [props.defaultOpen]                         uncontrolled initial state
 * @param {unknown} [props.revealKey]                           a new truthy value opens the section
 * @param {boolean} [props.autoRevealErrors]                    default true: open when a field inside turns invalid
 * @param {boolean} [props.main]                                the form's main section (data-form-main), open on load
 * @param {import('react').ReactNode} [props.tag]               a tag after the Optional tag ("Irreversible")
 * @param {import('react').ReactNode} [props.count]             a count at the trailing edge while open ("12 / 250")
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function FormSection({
    id,
    title,
    icon: SectionIcon,
    optional = false,
    main = false,
    tag = null,
    count = null,
    summary,
    summaryUnit,
    open: openProp,
    onOpenChange,
    defaultOpen = false,
    revealKey,
    autoRevealErrors = true,
    className,
    children,
}) {
    const controlled = openProp !== undefined;
    const [innerOpen, setInnerOpen] = useState(defaultOpen);
    const open = controlled ? Boolean(openProp) : innerOpen;
    const setOpen = useCallback((next) => {
        if (!controlled) setInnerOpen(next);
        onOpenChange?.(next);
    }, [controlled, onOpenChange]);

    // A new truthy reveal key opens the section (an error inside it).
    useEffect(() => {
        if (revealKey) setOpen(true);
        // Only a change of key opens it; setOpen changing identity must not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealKey]);

    // A field inside that turns invalid while closed opens the section, so an
    // inline error is never hidden behind a chevron.
    const bodyRef = useRef(null);
    const invalidCountRef = useRef(0);
    useLayoutEffect(() => {
        if (!autoRevealErrors) return;
        const body = bodyRef.current;
        if (!body) return;
        const count = body.querySelectorAll('[aria-invalid="true"]').length;
        const grew = count > invalidCountRef.current;
        invalidCountRef.current = count;
        if (grew && !open) setOpen(true);
    });

    // The unit drops before the text truncates: show it, and hide it again
    // when the summary overflows its row.
    const summaryRef = useRef(null);
    const showSummary = !open && summary != null && summary !== '';
    useLayoutEffect(() => {
        const el = summaryRef.current;
        if (!el || !summaryUnit) return undefined;
        const unit = el.querySelector('[data-summary-unit]');
        if (!unit) return undefined;
        const fit = () => {
            unit.hidden = false;
            if (el.scrollWidth > el.clientWidth + 1) unit.hidden = true;
        };
        fit();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        return () => observer.disconnect();
    }, [showSummary, summary, summaryUnit]);

    const uid = useId();
    const panelId = `form-section-${id}-${uid.replace(/:/g, '')}`;
    // No aria-label on the section: its title often equals a field's label
    // (Memo), and a second element named the same makes "the Memo field"
    // ambiguous. The header button (aria-expanded, aria-controls) names it.
    // The data-form-* attributes are the checker's hooks (form-standard HOOKS.md).
    const showCount = open && count != null && count !== '';
    return (
        <section
            className={[styles.optionalSection, className].filter(Boolean).join(' ')}
            data-form-section={id}
            data-form-main={main ? '' : undefined}
        >
            <Button
                type="button"
                variant="rowAction"
                icon={null}
                className={styles.sectionHeader}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(!open)}
                data-form-section-toggle=""
            >
                {SectionIcon ? (
                    <span className={styles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
                ) : null}
                <span className={styles.sectionTitle} data-form-section-title="">{title}</span>
                {optional ? <OptionalPill className={styles.optionalTag} /> : null}
                {/* A second tag (Irreversible) sits after Optional. */}
                {tag ? <span className={styles.tag} data-form-section-tag="">{tag}</span> : null}
                {showSummary ? (
                    <span ref={summaryRef} className={styles.summary} data-section-summary="">
                        {summary}
                        {summaryUnit ? <span data-summary-unit="">{` ${summaryUnit}`}</span> : null}
                    </span>
                ) : null}
                {/* While open the summary gives way to a count, if any. */}
                {showCount ? <span className={styles.count} data-section-count="">{count}</span> : null}
                <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`.trim()} aria-hidden="true" data-form-section-chevron="">
                    <ChevronDownIcon />
                </span>
            </Button>
            <div id={panelId} ref={bodyRef} className={styles.sectionBody} hidden={!open}>
                {children}
            </div>
        </section>
    );
}
