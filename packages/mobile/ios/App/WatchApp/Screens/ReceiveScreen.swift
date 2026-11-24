// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
#if os(watchOS)
import SwiftUI
#endif

enum ReceivePresentation {
    static let emptyKey = ReceivePages.emptyKey

    static func pages(_ receive: [SnapshotReceive]?) -> [SnapshotReceive] {
        ReceivePages.pages(receive)
    }

    static func groupedAddress(_ address: String) -> String {
        let compact = address.filter { !$0.isWhitespace }
        return stride(from: 0, to: compact.count, by: 4).map { offset in
            let start = compact.index(compact.startIndex, offsetBy: offset)
            let end = compact.index(start, offsetBy: min(4, compact.distance(from: start, to: compact.endIndex)))
            return String(compact[start..<end])
        }.joined(separator: " ")
    }

    static func modules(for entry: SnapshotReceive) -> [Bool]? {
        QRModules.unpack(size: entry.qr.size, bits: entry.qr.bits)
    }

    static func chainIconName(for chainId: String) -> String {
        switch chainId.split(separator: "-").first {
        case "bitcoin": "bitcoinsign.circle"
        case "litecoin": "l.circle"
        case "dogecoin": "d.circle"
        default: "link"
        }
    }
}

#if os(watchOS)
struct ReceiveScreen: View {
    let receive: [SnapshotReceive]?
    var pages: [SnapshotReceive] { ReceivePresentation.pages(receive) }

    var body: some View {
        if pages.isEmpty {
            Text(LocalizedStringKey(ReceivePresentation.emptyKey)).multilineTextAlignment(.center)
        } else {
            TabView {
                ForEach(pages, id: \.chainId) { ReceivePage(entry: $0) }
            }
            .tabViewStyle(.verticalPage)
        }
    }
}

struct ReceivePage: View {
    let entry: SnapshotReceive
    var modules: [Bool]? { ReceivePresentation.modules(for: entry) }
    var iconName: String { ReceivePresentation.chainIconName(for: entry.chainId) }
    var addressText: String { ReceivePresentation.groupedAddress(entry.address) }

    var body: some View {
        VStack(spacing: 5) {
            Label(entry.label, systemImage: iconName)
                .font(.headline)
            if let modules {
                ReceiveQRMatrix(size: entry.qr.size, modules: modules)
                    .frame(width: 112, height: 112)
                    .accessibilityHidden(true)
            }
            Text(addressText)
                .font(.caption2.monospaced())
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.75)
        }
        .padding(.horizontal, 4)
    }
}

struct ReceiveQRMatrix: View {
    let size: Int
    let modules: [Bool]

    var body: some View {
        Canvas { context, canvas in
            context.fill(Path(CGRect(origin: .zero, size: canvas)), with: .color(.white))
            let width = floor(min(canvas.width, canvas.height) / CGFloat(size + 8))
            let origin = CGPoint(
                x: (canvas.width - width * CGFloat(size)) / 2,
                y: (canvas.height - width * CGFloat(size)) / 2
            )
            for index in modules.indices where modules[index] {
                let rect = CGRect(
                    x: origin.x + CGFloat(index % size) * width,
                    y: origin.y + CGFloat(index / size) * width,
                    width: width,
                    height: width
                )
                context.fill(Path(rect), with: .color(.black))
            }
        }
    }
}
#endif
