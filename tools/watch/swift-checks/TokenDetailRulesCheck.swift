import Foundation

@main
enum TokenDetailRulesCheck {
    static func main() {
        let fixtures: [(name: String, expected: TokenDetailState)] = [
            ("detail-cached", .full),
            ("detail-noart", .full),
            ("detail-native", .full),
            ("detail-loaderror", .unavailable),
        ]

        for fixture in fixtures {
            let detail = decodeDetail(fixture.name)
            for phoneReachable in [true, false] {
                require(
                    TokenDetailRules.state(
                        rowId: detail.tokenId,
                        detail: detail,
                        phoneReachable: phoneReachable
                    ) == fixture.expected,
                    fixture.name
                )
            }
        }

        require(
            TokenDetailRules.state(
                rowId: "bitcoin-mainnet:XC",
                detail: nil,
                phoneReachable: false
            ) == .awayNotCached,
            "no detail away"
        )
        require(
            TokenDetailRules.state(
                rowId: "bitcoin-mainnet:XC",
                detail: nil,
                phoneReachable: true
            ) == .waiting,
            "no detail reachable"
        )

        let cached = decodeDetail("detail-cached")
        for phoneReachable in [true, false] {
            let expected: TokenDetailState = phoneReachable ? .waiting : .awayNotCached
            require(
                TokenDetailRules.state(
                    rowId: "bitcoin-mainnet:OTHER",
                    detail: cached,
                    phoneReachable: phoneReachable
                ) == expected,
                "detail-cached other row"
            )
        }

        let strings = decodeStrings()
        let notices: [(state: TokenDetailState, expected: String?)] = [
            (.awayNotCached, "w2.moreDetails"),
            (.unavailable, "w2.detailsUnavailable"),
            (.full, nil),
            (.waiting, nil),
        ]
        for notice in notices {
            let actual = TokenDetailRules.noticeKey(notice.state)
            require(actual == notice.expected, "notice \(notice.state.rawValue)")
            if let actual {
                require(strings[actual] != nil, "notice key \(actual)")
            }
        }

        require(
            TokenDetailRules.artwork(
                artworkHash: cached.artworkHash,
                imageCached: true
            ) == .image(hash: "xc-artwork-cache"),
            "detail-cached artwork cached"
        )
        require(
            TokenDetailRules.artwork(
                artworkHash: cached.artworkHash,
                imageCached: false
            ) == .glyph,
            "detail-cached artwork missing"
        )
        require(
            TokenDetailRules.artwork(
                artworkHash: decodeDetail("detail-noart").artworkHash,
                imageCached: true
            ) == .glyph,
            "detail-noart artwork"
        )
        require(
            TokenDetailRules.artwork(artworkHash: "", imageCached: true) == .glyph,
            "empty artwork hash"
        )
        require(
            TokenDetailRules.artwork(artworkHash: nil, imageCached: true) == .glyph,
            "nil artwork hash"
        )
    }

    private static func decodeDetail(_ name: String) -> Detail {
        decode(
            Detail.self,
            at: "test/fixtures/watch/\(name).json",
            caseName: name
        )
    }

    private static func decodeStrings() -> [String: String] {
        decode(
            [String: String].self,
            at: "packages/core/src/watch/contract/strings-balances.json",
            caseName: "strings-balances"
        )
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        at path: String,
        caseName: String
    ) -> Value {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try JSONDecoder().decode(type, from: data)
        } catch {
            fail("\(caseName): \(error)")
        }
    }

    private static func require(
        _ condition: @autoclosure () -> Bool,
        _ caseName: String
    ) {
        guard condition() else {
            fail(caseName)
        }
    }

    private static func fail(_ caseName: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(caseName)\n".utf8))
        exit(1)
    }
}
