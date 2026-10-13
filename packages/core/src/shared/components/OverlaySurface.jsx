// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isValidElement } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './OverlaySurface.module.css';

/**
 * Shared geometry for blocking dialogs, bottom sheets, and anchored popovers.
 * Behavior such as focus trapping and Back handling stays with the owning
 * feature because popovers and modal dialogs have different dismissal rules.
 *
 * @param {object} props
 * @param {'dialog'|'sheet'|'popover'} [props.variant]
 * @param {import('react').RefObject<HTMLElement>} [props.rootRef]
 * @param {import('react').RefObject<HTMLElement>} [props.surfaceRef]
 * @param {import('react').ReactNode} [props.title]
 * @param {string} [props.titleId]
 * @param {'h2'|'p'} [props.titleAs]
 * @param {string} [props.closeLabel]
 * @param {boolean} [props.closeDisabled]
 * @param {() => void} [props.onClose]
 * @param {() => void} [props.onBackdrop]
 * @param {import('react').ReactNode} [props.footer]
 * @param {string} [props.className]
 * @param {import('react').CSSProperties} [props.style]
 * @param {import('react').ReactNode} props.children
 */
export function OverlaySurface({
    variant = 'dialog',
    rootRef,
    surfaceRef,
    title,
    titleId,
    titleAs: Title = 'h2',
    closeLabel,
    closeDisabled = false,
    onClose,
    onBackdrop,
    footer,
    className,
    style,
    children,
    ...dialogProps
}) {
    const isPopover = variant === 'popover';
    const surfaceClassName = [
        styles.surface,
        styles[variant],
        className,
    ].filter(Boolean).join(' ');
    const header = title || closeLabel ? (
        <header className={styles.header}>
            {variant === 'sheet' ? <span className={styles.handle} aria-hidden="true" /> : null}
            {title ? (
                isValidElement(title)
                    ? <div id={titleId} className={styles.title}>{title}</div>
                    : <Title id={titleId} className={styles.title}>{title}</Title>
            ) : <span />}
            {closeLabel ? (
                <button
                    type="button"
                    className={styles.close}
                    onClick={onClose}
                    disabled={closeDisabled}
                    aria-label={closeLabel}
                >
                    <Icon.XIcon />
                </button>
            ) : <span />}
        </header>
    ) : null;
    const content = (
        <>
            {header}
            <div className={styles.body}>{children}</div>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </>
    );

    if (isPopover) {
        return (
            <div
                ref={surfaceRef}
                className={surfaceClassName}
                style={style}
                data-overlay-surface={variant}
                role="dialog"
                aria-modal="false"
                {...dialogProps}
            >
                {content}
            </div>
        );
    }

    return (
        <div
            ref={rootRef}
            className={`${styles.overlay} ${styles[`${variant}Overlay`]}`}
            role="dialog"
            aria-modal="true"
            onClick={onBackdrop}
            {...dialogProps}
        >
            <div
                ref={surfaceRef}
                className={surfaceClassName}
                style={style}
                data-overlay-surface={variant}
                onClick={(event) => event.stopPropagation()}
                role="presentation"
                tabIndex={-1}
            >
                {content}
            </div>
        </div>
    );
}
