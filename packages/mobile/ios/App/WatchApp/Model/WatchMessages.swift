// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Foundation

enum RequestKind: String, Codable {
    case request
    case paydue
}

struct Request: Codable {
    let id: String
    let kind: RequestKind
    let iconHash: String
    let sentence: String
    let amountText: String
    let expiresAt: Int64?
}

struct Detail: Codable {
    let v: Int
    let tokenId: String
    let artworkHash: String?
    let changeText: String?
    let priceSourceText: String?
    let chart: DetailChart?
    let facts: [DetailFact]?
    let description: String?
}

struct DetailChart: Codable {
    let points: [Double]
    let up: Bool
}

struct DetailFact: Codable {
    let label: String
    let value: String
}

struct RefreshIntent: Codable {}

struct DetailRequestIntent: Codable {
    let tokenId: String
}

struct OpenOnPhoneIntent: Codable {
    let route: String
}

struct MarkReadIntent: Codable {
    let id: String
}

struct WatchStateIntent: Codable {
    let appVersion: String
}
