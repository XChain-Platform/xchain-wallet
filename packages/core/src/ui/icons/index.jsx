// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Icon set. The wallet started with hand-rolled inline SVGs; the
// scoped migration adopts `lucide-react` (MIT licensed, vendored at
// install-time so the wallet has no runtime icon-service dependency)
// for the most prominent action icons while leaving the remaining
// hand-rolled glyphs in place. Export names stay stable so call sites
// pick up the swap transparently.
//
// Lucide defaults: 24×24 viewBox, 2px stroke, currentColor, round
// caps/joins (matches STROKE_PROPS exactly). Each migrated icon below
// passes `size={18}` to land on the wallet's 18×18 render size.
import {
    QrCode as LucideQrCode,
    Menu as LucideMenu,
    Send as LucideSend,
    ArrowDownToLine as LucideArrowDownToLine,
    DollarSign as LucideDollarSign,
    MoreHorizontal as LucideMoreHorizontal,
    Filter as LucideFilter,
    BookOpen as LucideBookOpen,
    Printer as LucidePrinter,
    Handshake as LucideHandshake,
    ShieldCheck as LucideShieldCheck,
    Save as LucideSave,
    LayoutList as LucideLayoutList,
    ThumbsUp as LucideThumbsUp,
    ThumbsDown as LucideThumbsDown,
} from 'lucide-react';

const STROKE_PROPS = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
};

// Lucide wrapper. Matches the hand-rolled icons' 18×18 render + 2px
// stroke so swapping a single icon doesn't disturb surrounding layout.
const LUCIDE_PROPS = {
    size: 18,
    strokeWidth: 2,
    'aria-hidden': 'true',
};

export function PlusIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

export function KeyIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="8" cy="15" r="4" />
            <path d="M10.85 12.15 19 4" />
            <path d="m18 5 3 3" />
            <path d="m15 8 3 3" />
        </svg>
    );
}

export function MigrateIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 12h13" />
            <path d="m13 6 7 6-7 6" />
        </svg>
    );
}

export function BackIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="m15 6-6 6 6 6" />
        </svg>
    );
}

export function CheckIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M5 12.5 10 17.5l9-11" />
        </svg>
    );
}

export function SendIcon() {
    return <LucideSend {...LUCIDE_PROPS} />;
}

export function ReceiveIcon() {
    return <LucideArrowDownToLine {...LUCIDE_PROPS} />;
}

export function CopyIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
    );
}

export function ScanIcon() {
    return <LucideQrCode {...LUCIDE_PROPS} />;
}

export function CameraIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
            <circle cx="12" cy="13" r="3" />
        </svg>
    );
}

export function BookIcon() {
    return <LucideBookOpen {...LUCIDE_PROPS} />;
}

export function SignIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 17 17 3l4 4L7 21H3v-4Z" />
            <path d="M14 6 18 10" />
        </svg>
    );
}

export function LockIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
    );
}

export function TokenIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10" />
            <path d="M9 9.5c0-1 1-1.5 3-1.5s3 .5 3 1.5-1 1.5-3 1.5-3 .5-3 1.5 1 1.5 3 1.5 3-.5 3-1.5" />
        </svg>
    );
}

export function MarketIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 20h18" />
            <rect x="5" y="11" width="3" height="9" />
            <rect x="11" y="6" width="3" height="14" />
            <rect x="17" y="14" width="3" height="6" />
        </svg>
    );
}

export function MessageIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />
        </svg>
    );
}

export function HistoryIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 8v5l3 2" />
        </svg>
    );
}

export function AddressIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M12 22s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z" />
            <circle cx="12" cy="10" r="2.5" />
        </svg>
    );
}

export function ContractIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h6" />
        </svg>
    );
}

export function StakeIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M4 21V8l8-5 8 5v13" />
            <path d="M9 21v-7h6v7" />
            <path d="m12 11 0-3" />
        </svg>
    );
}

export function MoreIcon() {
    return <LucideMoreHorizontal {...LUCIDE_PROPS} />;
}

// Rows-with-thumbnails glyph: "browse a list of items". Used as the
// token field's trailing affordance.
export function TokenListIcon() {
    return <LucideLayoutList {...LUCIDE_PROPS} />;
}

export function MenuIcon() {
    return <LucideMenu {...LUCIDE_PROPS} />;
}

export function PrinterIcon() {
    return <LucidePrinter {...LUCIDE_PROPS} />;
}

export function SaveIcon() {
    return <LucideSave {...LUCIDE_PROPS} />;
}

export function ThumbsUpIcon() {
    return <LucideThumbsUp {...LUCIDE_PROPS} />;
}

export function ThumbsDownIcon() {
    return <LucideThumbsDown {...LUCIDE_PROPS} />;
}

export function HandshakeIcon() {
    return <LucideHandshake {...LUCIDE_PROPS} />;
}

export function VerifyIcon() {
    return <LucideShieldCheck {...LUCIDE_PROPS} />;
}

/* ------------------------------------------------------------------ *
 *  Label → icon resolver
 *  Shared by Button auto-icon + drawer/menu rendering so a route's
 *  text label maps to the same icon everywhere it shows up.
 * ------------------------------------------------------------------ */

const LABEL_MAP = [
    [/^send\b/, SendIcon],
    [/^receive\b/, ReceiveIcon],
    [/^sign\b/, SignIcon],
    [/^verify\b/, VerifyIcon],
    [/^broadcast\b/, BroadcastIcon],
    [/^lock\b/, LockIcon],
    [/^unlock\b/, UnlockIcon],
    [/^stake$|^staking$|^claim/, StakeIcon],
    [/^unstake\b/, UnlinkIcon],
    [/^swap\b|^trade\b|^exchange\b/, SwapIcon],
    [/^markets?\b/, MarketIcon],
    [/^messag/, MessageIcon],
    [/^histor/, HistoryIcon],
    [/^addresses?\b/, AddressIcon],
    [/^contracts?\b|^call method\b|^execute\b|^deploy\b/, ContractIcon],
    [/^home\b/, HomeIcon],
    [/^settings?\b/, GearIcon],
    [/^more\b/, MoreIcon],
    [/^back\b|^previous\b/, BackIcon],
    [/^next\b|^continue\b|^proceed\b|^forward\b|^onward\b|^use template\b/, ForwardIcon],
    [/^save\b/, SaveIcon],
    [/^submit\b|^confirm\b|^done\b|^ok\b|^apply\b|^accept\b|^approve\b|^yes\b|^validat/, CheckIcon],
    [/^cancel\b|^close\b|^dismiss\b|^skip\b|^not now\b|^nevermind\b|^reject\b|^deny\b|^no\b/, XIcon],
    [/^delete\b|^remove\b|^discard\b|^destroy\b|^revoke\b|^clear\b|^burn\b|^sweep\b/, TrashIcon],
    [/^edit\b|^rename\b|^modify\b|^update\b|^compose\b|^write\b|^draft\b/, PencilIcon],
    [/^mint\b/, PrinterIcon],
    [/^transfer\b/, HandshakeIcon],
    [/^new\b|^add\b|^create\b|^generate\b|^issue\b/, PlusIcon],
    [/^refresh\b|^reload\b|^sync\b|^retry\b|^reconnect\b/, RefreshIcon],
    [/^copy\b/, CopyIcon],
    [/^paste\b/, PasteIcon],
    [/^scan\b/, ScanIcon],
    [/^search\b|^find\b|^lookup\b/, SearchIcon],
    [/^filter/, FilterIcon],
    [/^show\b|^view\b|^reveal\b|^preview\b|^inspect\b|^estimate\b|^suggest\b|^check\b|^my\b|^browse\b/, EyeIcon],
    [/^hide\b/, EyeOffIcon],
    [/^connect\b|^pair\b/, UsbIcon],
    [/^disconnect\b|^unpair\b/, UnlinkIcon],
    [/^link\b/, LinkIcon],
    [/^import\b|^upload\b|^deposit\b/, UploadIcon],
    [/^export\b|^download\b|^withdraw\b/, DownloadIcon],
    [/^pause\b/, PauseIcon],
    [/^play\b|^resume\b|^start\b/, PlayIcon],
    [/^migrate\b/, MigrateIcon],
    [/^token\b|^dispens|^pay\b|^dividend\b|^airdrop\b/, TokenIcon],
    [/^multisig\b/, MultisigIcon],
    [/^contacts?\b/, AddressIcon],
    [/^advanced\b/, GearIcon],
    [/^parallel\b|^cross-chain\b/, SwapIcon],
    [/^info\b|^about\b|^help\b|^why\b/, InfoIcon],
    [/^open\b|^launch\b|^view in\b|^go to\b/, ExternalLinkIcon],
];

/**
 * Return the icon component that matches a given button/menu label,
 * or `null` when no pattern matches. Patterns trim + lowercase the
 * input first; first match wins.
 */
export function iconForLabel(label) {
    if (typeof label !== 'string') return null;
    const text = label.trim().toLowerCase();
    if (!text) return null;
    for (const [re, IconComponent] of LABEL_MAP) {
        if (re.test(text)) return IconComponent;
    }
    return null;
}

export function XIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
    );
}

export function TrashIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="m5 6 1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
        </svg>
    );
}

export function PencilIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}

export function RefreshIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
        </svg>
    );
}

export function ForwardIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    );
}

export function GearIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
    );
}

export function EyeIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

export function EyeOffIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
            <path d="M10.7 5.08A10.4 10.4 0 0 1 12 5c6.5 0 10 8 10 8a17 17 0 0 1-3.36 4.65" />
            <path d="M6.61 6.61A17 17 0 0 0 2 13s3.5 8 10 8a10.5 10.5 0 0 0 5.39-1.61" />
            <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
    );
}

export function LineChartIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 3 3 5-6" />
        </svg>
    );
}

export function SwapIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M16 3 21 8l-5 5" />
            <path d="M21 8H8" />
            <path d="M8 21 3 16l5-5" />
            <path d="M3 16h13" />
        </svg>
    );
}

export function DocumentIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
    );
}

const FILE_TYPE_STYLES = {
    pdf: { label: 'PDF', color: '#dc2626' },
    doc: { label: 'DOC', color: '#2563eb' },
    docx: { label: 'DOC', color: '#2563eb' },
    rtf: { label: 'RTF', color: '#2563eb' },
    odt: { label: 'ODT', color: '#2563eb' },
    xls: { label: 'XLS', color: '#16a34a' },
    xlsx: { label: 'XLS', color: '#16a34a' },
    ods: { label: 'ODS', color: '#16a34a' },
    csv: { label: 'CSV', color: '#16a34a' },
    tsv: { label: 'TSV', color: '#16a34a' },
    ppt: { label: 'PPT', color: '#ea580c' },
    pptx: { label: 'PPT', color: '#ea580c' },
    odp: { label: 'ODP', color: '#ea580c' },
    key: { label: 'KEY', color: '#ea580c' },
    zip: { label: 'ZIP', color: '#6b7280' },
    rar: { label: 'RAR', color: '#6b7280' },
    '7z': { label: '7Z', color: '#6b7280' },
    tar: { label: 'TAR', color: '#6b7280' },
    gz: { label: 'GZ', color: '#6b7280' },
    txt: { label: 'TXT', color: '#6b7280' },
    md: { label: 'MD', color: '#6b7280' },
    json: { label: 'JSON', color: '#7c3aed' },
    xml: { label: 'XML', color: '#7c3aed' },
    yaml: { label: 'YAML', color: '#7c3aed' },
    yml: { label: 'YAML', color: '#7c3aed' },
    html: { label: 'HTML', color: '#ea580c' },
    htm: { label: 'HTML', color: '#ea580c' },
    epub: { label: 'EPUB', color: '#0891b2' },
    mobi: { label: 'MOBI', color: '#0891b2' },
};

export function FileTypeIcon({ type }) {
    const key = type ? String(type).toLowerCase().replace(/^\./, '') : '';
    const meta = FILE_TYPE_STYLES[key] || null;
    const label = meta
        ? meta.label
        : (key ? key.slice(0, 4).toUpperCase() : 'FILE');
    const color = meta ? meta.color : '#6b7280';
    const fontSize = label.length >= 4 ? 4 : 5;
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
                fill="white"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            <path
                d="M14 3v5h5"
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            <rect x="5" y="13.5" width="14" height="5" fill={color} />
            <text
                x="12"
                y="16"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight="700"
                fill="white"
                fontFamily="system-ui, -apple-system, sans-serif"
            >
                {label}
            </text>
        </svg>
    );
}

export function LinkIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
    );
}

export function UnlinkIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M9 17H7a5 5 0 0 1 0-10h2" />
            <path d="M15 7h2a5 5 0 0 1 4 8" />
            <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
    );
}

export function UsbIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="12" cy="3" r="1.5" />
            <path d="M12 4.5V15" />
            <path d="m8 9 4-4 4 4" />
            <rect x="9" y="15" width="6" height="6" rx="1" />
        </svg>
    );
}

export function DownloadIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

export function UploadIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
    );
}

export function HomeIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="m3 12 9-9 9 9" />
            <path d="M5 10v10a1 1 0 0 0 1 1h4v-7h4v7h4a1 1 0 0 0 1-1V10" />
        </svg>
    );
}

export function PauseIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
        </svg>
    );
}

export function PlayIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M5 3v18l16-9Z" />
        </svg>
    );
}

export function BroadcastIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="12" cy="12" r="2" />
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
            <path d="M7.76 16.24a6 6 0 0 1 0-8.48" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
        </svg>
    );
}

export function PasteIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1Z" />
            <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
        </svg>
    );
}

export function SearchIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
    );
}

export function FilterIcon() {
    return <LucideFilter {...LUCIDE_PROPS} />;
}

export function InfoIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16" />
            <circle cx="12" cy="8" r="0.5" fill="currentColor" />
        </svg>
    );
}

export function DollarIcon() {
    return <LucideDollarSign {...LUCIDE_PROPS} />;
}

export function UsersIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}

export function UserIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}

export function ExternalLinkIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <path d="M14 4h6v6" />
            <path d="m20 4-9 9" />
            <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </svg>
    );
}

export function MultisigIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <circle cx="7.5" cy="15.5" r="3.5" />
            <path d="M9.85 13.15 18 5" />
            <path d="m16 4 3 3" />
            <circle cx="13.5" cy="9.5" r="3.5" fill="currentColor" fillOpacity="0.15" />
        </svg>
    );
}

export function UnlockIcon() {
    return (
        <svg {...STROKE_PROPS}>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 7-2.5" />
        </svg>
    );
}
