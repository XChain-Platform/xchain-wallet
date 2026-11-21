// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct SnapshotRow: Codable {
    let id: String
    let chainId: String
    let tick: String
    let displayName: String
    let amountText: String
    let fiatText: String
    let noPrice: Bool
    let pendingText: String
    let unavailable: Bool
    let iconHash: String
    let tickerColor: String
    let hasDetail: Bool
}

struct SnapshotReceive: Codable {
    let chainId: String
    let label: String
    let address: String
    let qr: SnapshotQr
}

struct SnapshotQr: Codable {
    let size: Int
    let bits: String
}

struct SnapshotInboxItem: Codable {
    let id: String
    let family: String
    let kind: String
    let title: String
    let body: String
    let at: Int64
    let read: Bool
}

struct SnapshotSettings: Codable {
    let showTotal: Bool
    let enabled: Bool
}
