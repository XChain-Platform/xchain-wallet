// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { useFilterPanelTop } from './useFilterPanelTop.js';
import { Button, Icon } from '@xchain-wallet/core/ui';
import styles from './ListFilterPopover.module.css';

/**
 * One filter icon button that opens a panel of list controls, the same
 * trigger and panel Home uses. The host owns the filter values; this owns
 * only the open state, outside-click and Escape handling, and the dot that
 * shows a filter is applied.
 *
 * @param {object} props
 * @param {string} props.label                    accessible name of the button and panel
 * @param {boolean} [props.active]                true when a filter is applied
 * @param {'sm' | 'md'} [props.size]              button size; 'sm' matches a header action
 * @param {boolean} [props.closeOnSubmit]         close the panel when a form inside it submits (a search box), so the results show
 * @param {import('react').ReactNode} props.children  the panel controls
 */
export function ListFilterPopover({ label, active = false, size = 'md', closeOnSubmit = false, children }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const panelTop = useFilterPanelTop(open, triggerRef);

    useEffect(() => {
        if (!open) return undefined;
        // The Network choice opens a full-screen list portaled outside the
        // panel; a press, Escape or focus inside it belongs to that list, so
        // the panel stays open under it and the pick reaches its handler.
        const inPickerLayer = (event) => Boolean(event.target?.closest?.('[data-picker-layer]'));
        const onPointerDown = (event) => {
            if (inPickerLayer(event)) return;
            if (!wrapRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            if (inPickerLayer(event)) return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        };
        const onFocusIn = (event) => {
            if (inPickerLayer(event)) return;
            if (!wrapRef.current?.contains(event.target)) setOpen(false);
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('focusin', onFocusIn);
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (open) wrapRef.current?.querySelector('input')?.focus();
    }, [open]);

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <Button
                ref={triggerRef}
                type="button"
                size={size}
                variant="secondary"
                className={`${size === 'sm' ? styles.triggerSm : styles.trigger} ${active ? styles.triggerActive : ''}`}
                icon={<Icon.FilterIcon />}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                title={label}
                data-active={active ? 'true' : undefined}
                onClick={() => setOpen((value) => !value)}
            >
                {null}
            </Button>
            {open ? (
                <div className={styles.panel} role="dialog" aria-label={label} onSubmit={closeOnSubmit ? () => setOpen(false) : undefined} style={panelTop == null ? undefined : { '--xc-filter-panel-top': `${panelTop}px` }}>
                    {children}
                </div>
            ) : null}
        </div>
    );
}
