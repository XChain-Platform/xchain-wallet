import Foundation
import CoreGraphics
import ImageIO
import CryptoKit

enum WatchRisk8Payload {
    static func snapshotJSON(builtAt: Int64) -> Data {
        let rows: [[String: Any]] = (1...50).map { index in
            let suffix = String(format: "%02d", index)
            let name = "Risk eight token R\(suffix)".padding(
                toLength: 64,
                withPad: ".",
                startingAt: 0
            )

            return [
                "amountText": "\(index) R\(suffix)",
                "chainId": "bitcoin-mainnet",
                "displayName": name,
                "fiatText": "$\(index).00",
                "hasDetail": false,
                "iconHash": "",
                "id": "bitcoin-mainnet:R\(suffix)",
                "noPrice": false,
                "pendingText": "",
                "tick": "R\(suffix)",
                "tickerColor": "#3B82F6",
                "unavailable": false,
            ]
        }

        let inbox: [[String: Any]] = (1...20).map { index in
            let suffix = String(format: "%02d", index)
            let title = "Received R\(suffix)".padding(
                toLength: 60,
                withPad: ".",
                startingAt: 0
            )
            let body = "Risk eight alert \(suffix)".padding(
                toLength: 160,
                withPad: ".",
                startingAt: 0
            )

            return [
                "at": builtAt - Int64(index) * 60_000,
                "body": body,
                "family": "incomingReceipts",
                "id": "alert-\(suffix)",
                "kind": "incoming",
                "read": false,
                "title": title,
            ]
        }

        let snapshot: [String: Any] = [
            "balancesAt": builtAt,
            "builtAt": builtAt,
            "capped": false,
            "fiatCode": "USD",
            "hidden": false,
            "inbox": inbox,
            "network": [
                "isTest": false,
                "kind": "mainnet",
            ],
            "pricesAt": builtAt,
            "receive": [],
            "request": [
                "amountText": "0.50 BTC",
                "iconHash": "",
                "id": "0123456789abcdef0123456789abcdef",
                "kind": "request",
                "sentence": "Review this request on your phone",
            ],
            "rows": rows,
            "session": "unlocked",
            "settings": [
                "enabled": true,
                "showTotal": true,
            ],
            "totals": [
                "fiatText": "$1,275.00",
                "unitsText": "Balances",
            ],
            "unitDefault": "fiat",
            "v": 1,
            "walletName": "Risk eight wallet",
        ]

        return try! JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
    }

    static func image(side: Int) -> (png: Data, hash: String, base64: String)? {
        guard (1...1024).contains(side),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
            return nil
        }

        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        for y in 0..<side {
            for x in 0..<side {
                let offset = (y * side + x) * 4
                pixels[offset] = UInt8(x % 256)
                pixels[offset + 1] = UInt8(y % 256)
                pixels[offset + 2] = 128
                pixels[offset + 3] = 255
            }
        }

        let pixelData = Data(pixels)
        guard let provider = CGDataProvider(data: pixelData as CFData),
              let image = CGImage(
                  width: side,
                  height: side,
                  bitsPerComponent: 8,
                  bitsPerPixel: 32,
                  bytesPerRow: side * 4,
                  space: colorSpace,
                  bitmapInfo: CGBitmapInfo(
                      rawValue: CGImageAlphaInfo.noneSkipLast.rawValue
                  ).union(.byteOrder32Big),
                  provider: provider,
                  decode: nil,
                  shouldInterpolate: false,
                  intent: .defaultIntent
              ) else {
            return nil
        }

        let encoded = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            encoded,
            "public.png" as CFString,
            1,
            nil
        ) else {
            return nil
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            return nil
        }

        let png = encoded as Data
        let hash = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        return (png, hash, png.base64EncodedString())
    }
}
