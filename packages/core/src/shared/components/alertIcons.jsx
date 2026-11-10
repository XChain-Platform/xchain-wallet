// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

function Svg({ children }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export const DoubleCheckIcon = () => <Svg><path d="m3 12 4 4L17 6" /><path d="m11 15 2 2 8-9" /></Svg>;
export const SecurityShieldIcon = () => <Svg><path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const PriceTrendIcon = () => <Svg><path d="m4 16 5-5 4 4 7-8" /><path d="M15 7h5v5" /></Svg>;
export const BillIcon = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></Svg>;
export const ActivityIcon = () => <Svg><path d="m3 11 18-8-8 18-2-8-8-2Z" /><path d="m11 13 4-4" /></Svg>;
export const MessageIcon = () => <Svg><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" /></Svg>;
export const WalletAlertIcon = () => <Svg><path d="M4 7h16v12H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h13v4" /><path d="M16 12h4" /></Svg>;
export const SearchIcon = () => <Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Svg>;
export const FunnelIcon = () => <Svg><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" /></Svg>;

