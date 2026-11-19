// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const iconProps = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
};

export function BranchIcon() {
    return (
        <svg {...iconProps}>
            <circle cx="6" cy="5" r="2" />
            <circle cx="18" cy="7" r="2" />
            <circle cx="18" cy="19" r="2" />
            <path d="M6 7v5a5 5 0 0 0 5 5h5" />
            <path d="M8 6h4a6 6 0 0 1 6 6v5" />
        </svg>
    );
}

export function StorefrontIcon() {
    return (
        <svg {...iconProps}>
            <path d="M4 10v10h16V10" />
            <path d="M3 10l2-6h14l2 6" />
            <path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2" />
            <path d="M9 20v-5h6v5" />
        </svg>
    );
}

export function TagIcon() {
    return (
        <svg {...iconProps}>
            <path d="M20 13 11 22l-9-9V4h9l9 9Z" />
            <circle cx="7" cy="9" r="1.5" />
        </svg>
    );
}

export function PictureIcon() {
    return (
        <svg {...iconProps}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path d="m4 18 5-5 4 4 2-2 5 4" />
        </svg>
    );
}

export function LightningIcon() {
    return (
        <svg {...iconProps}>
            <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />
        </svg>
    );
}

export function BridgeIcon() {
    return (
        <svg {...iconProps}>
            <path d="M3 20h18" />
            <path d="M5 20V9M19 20V9" />
            <path d="M5 11c4 0 4-5 7-5s3 5 7 5" />
            <path d="M8 13v7M12 11v9M16 13v7" />
        </svg>
    );
}
