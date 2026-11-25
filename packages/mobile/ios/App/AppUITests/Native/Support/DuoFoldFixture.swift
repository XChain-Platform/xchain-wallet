import Foundation

enum DuoFoldFixture {
    static let relativePath = "test/fixtures/duo/measured-widths.json"

    static func fixtureURL(sourceFile: String = #filePath) -> URL? {
        let currentDirectory = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
        let sourceURL = URL(fileURLWithPath: sourceFile, relativeTo: currentDirectory).standardizedFileURL
        var ancestor = sourceURL.deletingLastPathComponent()

        for _ in 0..<12 {
            let candidate = ancestor.appendingPathComponent(relativePath)
            let values = try? candidate.resourceValues(forKeys: [.isRegularFileKey])
            if values?.isRegularFile == true {
                return candidate
            }
            let parent = ancestor.deletingLastPathComponent()
            guard parent != ancestor else {
                break
            }
            ancestor = parent
        }
        return nil
    }

    static func load(sourceFile: String = #filePath) -> [DuoFoldPlan.Entry]? {
        guard let url = fixtureURL(sourceFile: sourceFile), let data = try? Data(contentsOf: url) else {
            return nil
        }
        return DuoFoldPlan.entries(data)
    }

    static func drivable(_ entries: [DuoFoldPlan.Entry]) -> [String] {
        entries.compactMap { entry in
            guard case let .measured(name, _, _, _) = entry else { return nil }
            return name
        }
    }

    static func unreachableNotes(_ entries: [DuoFoldPlan.Entry]) -> [String] {
        entries.compactMap { entry in
            guard case let .unreachable(name, reason) = entry else { return nil }
            return "\(name): \(reason)"
        }
    }
}
