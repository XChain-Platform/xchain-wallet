// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct QRView: View {
    private static let quietZoneModules = 4

    let qr: SnapshotQr

    var body: some View {
        Canvas { context, size in
            guard let modules = QRModules.unpack(size: qr.size, bits: qr.bits) else {
                return
            }

            let diameter = min(size.width, size.height)
            let side = diameter / sqrt(2)
            let origin = CGPoint(
                x: (size.width - side) / 2,
                y: (size.height - side) / 2
            )
            context.fill(
                Path(CGRect(origin: origin, size: CGSize(width: side, height: side))),
                with: .color(.white)
            )

            let moduleSide = side / CGFloat(qr.size + Self.quietZoneModules * 2)
            for (index, filled) in modules.enumerated() where filled {
                let column = index % qr.size + Self.quietZoneModules
                let row = index / qr.size + Self.quietZoneModules
                let rect = CGRect(
                    x: origin.x + CGFloat(column) * moduleSide,
                    y: origin.y + CGFloat(row) * moduleSide,
                    width: moduleSide,
                    height: moduleSide
                )
                context.fill(Path(rect), with: .color(.black))
            }
        }
    }
}
