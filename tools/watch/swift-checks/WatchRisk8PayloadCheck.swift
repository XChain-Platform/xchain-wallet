import Foundation

@main
struct WatchRisk8PayloadCheck {
    static func main() {
        guard CommandLine.arguments.count == 2 else {
            fail("one output path argument")
        }

        let output = WatchRisk8Payload.snapshotJSON(builtAt: 1_700_000_000_000)
        guard let object = try? JSONSerialization.jsonObject(with: output),
              let snapshot = object as? [String: Any] else {
            fail("snapshot parses to an object")
        }
        guard let rows = snapshot["rows"] as? [[String: Any]], rows.count == 50 else {
            fail("snapshot has 50 rows")
        }
        guard let inbox = snapshot["inbox"] as? [[String: Any]], inbox.count == 20 else {
            fail("snapshot has 20 inbox entries")
        }
        guard rows.allSatisfy({ ($0["displayName"] as? String)?.count == 64 }) else {
            fail("every display name has 64 characters")
        }
        guard inbox.allSatisfy({ ($0["title"] as? String)?.count == 60 }) else {
            fail("every inbox title has 60 characters")
        }
        guard inbox.allSatisfy({ ($0["body"] as? String)?.count == 160 }) else {
            fail("every inbox body has 160 characters")
        }
        guard (16_384...61_440).contains(output.count) else {
            fail("snapshot size is within the risk budget")
        }
        guard output == WatchRisk8Payload.snapshotJSON(builtAt: 1_700_000_000_000) else {
            fail("snapshot bytes are deterministic")
        }

        guard let firstImage = WatchRisk8Payload.image(side: 400) else {
            fail("400 pixel image is created")
        }
        guard firstImage.png.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) else {
            fail("image has PNG signature")
        }
        guard firstImage.png.count >= 24,
              uint32(firstImage.png, at: 16) == 400,
              uint32(firstImage.png, at: 20) == 400 else {
            fail("image IHDR is 400 by 400")
        }
        guard WatchImageArgs.decode(
            hash: firstImage.hash,
            base64: firstImage.base64
        ) == firstImage.png else {
            fail("image arguments decode to the same bytes")
        }
        guard let secondImage = WatchRisk8Payload.image(side: 400),
              secondImage.hash == firstImage.hash else {
            fail("image hash is deterministic")
        }
        guard WatchRisk8Payload.image(side: 0) == nil else {
            fail("zero side is rejected")
        }
        guard WatchRisk8Payload.image(side: 1025) == nil else {
            fail("side over 1024 is rejected")
        }

        do {
            try output.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
        } catch {
            fail("snapshot output is written")
        }
    }

    private static func uint32(_ data: Data, at offset: Int) -> UInt32 {
        data[offset..<(offset + 4)].reduce(0) { ($0 << 8) | UInt32($1) }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
