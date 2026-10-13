// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from './WalletIdentity.module.css';

const WALLET_TONES = [
    'var(--xc-accent-primary)',
    'var(--xc-success)',
    'var(--xc-warning)',
    'var(--xc-danger)',
];

export function walletIdentityTone(walletId = '') {
    let hash = 0;
    for (const character of String(walletId)) {
        hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    }
    return hash % WALLET_TONES.length;
}

function initialsFor(name) {
    const words = String(name || 'Wallet').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'W';
}

/**
 * Stable visual identity for a wallet. The wallet ID selects a semantic theme
 * token, while the initials keep wallets recognizable without relying on color.
 *
 * @param {object} props
 * @param {{ id: string, name?: string } | null} props.wallet
 * @param {string} [props.label]
 * @param {string} [props.namePrefix]
 * @param {boolean} [props.active]
 */
export function WalletIdentity({ wallet, label = '', namePrefix = '', active = false }) {
    if (!wallet) return null;
    const name = wallet.name || 'Unnamed wallet';
    const tone = walletIdentityTone(wallet.id);

    return (
        <span
            className={`${styles.identity} ${label ? styles.context : ''}`.trim()}
            style={{ '--xc-wallet-identity': WALLET_TONES[tone] }}
            data-wallet-tone={tone}
            data-testid="wallet-identity"
            title={name}
        >
            {label ? <span className={styles.label}>{label}</span> : null}
            <span className={`${styles.avatar} ${active ? styles.active : ''}`.trim()} aria-hidden="true">
                {initialsFor(name)}
            </span>
            <span className={styles.name}>{namePrefix}{name}</span>
        </span>
    );
}
