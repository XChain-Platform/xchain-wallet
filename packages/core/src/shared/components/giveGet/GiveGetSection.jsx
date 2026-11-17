// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId } from 'react';
import { Button } from '../../../ui/Button.jsx';
import { InfoTip } from '../../../ui/InfoTip.jsx';
import { ChevronDownIcon } from '../../../ui/icons/index.jsx';
import sectionStyles from '../../routes/IssueTokenForm.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/components.js';
import '../../../i18n/locales/en/ui.js';
import styles from './GiveGet.module.css';

/**
 * One collapsible Give/Get section in the shared optionalSection
 * style (Issue token, Address preferences). The host owns `open` so the
 * state outlives a picker page or a view switch. The summary shows only
 * while the section is closed; the chevron points right closed, down open.
 *
 * @param {object} props
 * @param {string} props.id                       stable id, used for the panel id
 * @param {string} props.title
 * @param {() => import('react').ReactNode} [props.icon]  icon component
 * @param {import('react').ReactNode} [props.summary]     closed-state summary
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {import('react').ReactNode} props.children
 */
export function GiveGetSection({ id, title, icon: SectionIcon, summary, open, onToggle, children }) {
    const uid = useId();
    const panelId = `givegets-${id}-${uid.replace(/:/g, '')}`;
    return (
        <section className={sectionStyles.optionalSection} aria-label={title} data-givegets={id}>
            <Button
                type="button"
                variant="rowAction"
                icon={null}
                className={sectionStyles.sectionHeader}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={onToggle}
            >
                {SectionIcon ? (
                    <span className={sectionStyles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
                ) : null}
                <span className={sectionStyles.sectionTitle}>{title}</span>
                {!open && summary ? <span className={styles.summary}>{summary}</span> : null}
                <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`.trim()} aria-hidden="true">
                    <ChevronDownIcon />
                </span>
            </Button>
            <div id={panelId} className={sectionStyles.sectionBody} hidden={!open}>
                {children}
            </div>
        </section>
    );
}

/**
 * A static (always open) section in the same card style, used by
 * the Quick view's Ownership group.
 */
export function GiveGetStaticSection({ title, icon: SectionIcon, summary, children }) {
    return (
        <section className={sectionStyles.optionalSection} aria-label={title}>
            <div className={styles.staticHeader}>
                {SectionIcon ? (
                    <span className={sectionStyles.sectionIcon} aria-hidden="true"><SectionIcon /></span>
                ) : null}
                <span className={sectionStyles.sectionTitle}>{title}</span>
                {summary ? <span className={styles.summary}>{summary}</span> : null}
            </div>
            <div className={styles.staticBody}>{children}</div>
        </section>
    );
}

/**
 * The "Rate  1 A = n B" line under the give and get blocks.
 */
export function RateLine({ label: labelProp, text, help }) {
    const label = labelProp ?? t('components.giveGet.rate');
    return (
        <div className={styles.rateRow}>
            <span className={styles.rateLabel}>
                {label}
                {help ? <> <InfoTip label={help} aria={t('ui.field.about', { label })} /></> : null}
            </span>
            <span className={styles.rateValue} title={typeof text === 'string' ? text : undefined}>{text}</span>
        </div>
    );
}
