function tokenize(text) {
    const tokens = [];
    let index = 0;

    while (index < text.length) {
        const character = text[index];

        if (/\s/.test(character)) {
            index += 1;
            continue;
        }
        if (text.startsWith('//', index)) {
            const end = text.indexOf('\n', index + 2);
            index = end === -1 ? text.length : end + 1;
            continue;
        }
        if (text.startsWith('/*', index)) {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) {
                throw new SyntaxError('Unterminated comment');
            }
            index = end + 2;
            continue;
        }
        if ('{}()=;,'.includes(character)) {
            tokens.push(character);
            index += 1;
            continue;
        }
        if (character === '"') {
            let value = '';
            index += 1;
            while (index < text.length && text[index] !== '"') {
                if (text[index] !== '\\') {
                    value += text[index];
                    index += 1;
                    continue;
                }

                index += 1;
                if (index >= text.length) {
                    throw new SyntaxError('Unterminated quoted string');
                }
                const escaped = text[index];
                value += {
                    n: '\n',
                    r: '\r',
                    t: '\t',
                }[escaped] ?? escaped;
                index += 1;
            }
            if (text[index] !== '"') {
                throw new SyntaxError('Unterminated quoted string');
            }
            tokens.push(value);
            index += 1;
            continue;
        }

        const start = index;
        while (
            index < text.length
            && !/\s/.test(text[index])
            && !'{}()=;,"'.includes(text[index])
            && !text.startsWith('//', index)
            && !text.startsWith('/*', index)
        ) {
            index += 1;
        }
        if (index === start) {
            throw new SyntaxError(`Unexpected character at offset ${index}`);
        }
        tokens.push(text.slice(start, index));
    }

    return tokens;
}

function parsePbxproj(text) {
    const tokens = tokenize(text);
    let index = 0;

    function take(expected) {
        const token = tokens[index];
        if (expected !== undefined && token !== expected) {
            throw new SyntaxError(`Expected ${expected}, received ${token ?? 'end of input'}`);
        }
        index += 1;
        return token;
    }

    function value() {
        if (tokens[index] === '{') {
            return dictionary();
        }
        if (tokens[index] === '(') {
            return array();
        }
        const scalar = take();
        if (scalar === undefined) {
            throw new SyntaxError('Unexpected end of input');
        }
        return scalar;
    }

    function dictionary() {
        const result = {};
        take('{');
        while (tokens[index] !== '}') {
            const key = take();
            if (key === undefined) {
                throw new SyntaxError('Unterminated dictionary');
            }
            take('=');
            result[key] = value();
            take(';');
        }
        take('}');
        return result;
    }

    function array() {
        const result = [];
        take('(');
        while (tokens[index] !== ')') {
            result.push(value());
            if (tokens[index] === ',') {
                take(',');
            }
        }
        take(')');
        return result;
    }

    const result = value();
    if (index !== tokens.length) {
        throw new SyntaxError(`Unexpected token ${tokens[index]}`);
    }
    return result;
}

export function pbxprojTargetLinks(text) {
    const project = parsePbxproj(text);
    const objects = project.objects ?? {};

    return Object.values(objects)
        .filter((object) => object.isa === 'PBXNativeTarget')
        .map((target) => ({
            name: target.name,
            synchronizedGroups: (target.fileSystemSynchronizedGroups ?? [])
                .map((reference) => objects[reference])
                .filter((group) => group?.isa === 'PBXFileSystemSynchronizedRootGroup')
                .map((group) => group.path)
                .sort(),
            dependencies: (target.dependencies ?? [])
                .map((reference) => objects[reference])
                .filter((dependency) => dependency?.isa === 'PBXTargetDependency')
                .map((dependency) => dependency.target === undefined
                    ? dependency.name
                    : objects[dependency.target]?.name ?? dependency.name)
                .filter((name) => name !== undefined)
                .sort(),
            copyPhases: (target.buildPhases ?? [])
                .map((reference) => objects[reference])
                .filter((phase) => phase?.isa === 'PBXCopyFilesBuildPhase')
                .map((phase) => ({
                    name: phase.name,
                    dstSubfolderSpec: phase.dstSubfolderSpec === undefined
                        ? undefined
                        : Number(phase.dstSubfolderSpec),
                    dstPath: phase.dstPath,
                    files: (phase.files ?? []).map((reference) => {
                        const buildFile = objects[reference];
                        return objects[buildFile?.fileRef]?.path;
                    }),
                })),
        }))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function pbxprojFacts(text) {
    const project = parsePbxproj(text);
    const objects = project.objects ?? {};
    const objectsOfType = (type) => Object.values(objects)
        .filter((object) => object.isa === type);
    const numberValue = (value) => value === undefined ? undefined : Number(value);

    const targets = objectsOfType('PBXNativeTarget').map((target) => {
        const configurationList = objects[target.buildConfigurationList];
        const bundleIds = (configurationList?.buildConfigurations ?? [])
            .map((reference) => objects[reference]?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER)
            .filter((bundleId) => bundleId !== undefined);

        return {
            name: target.name,
            productType: target.productType,
            bundleIds: [...new Set(bundleIds)].sort(),
        };
    }).sort((left, right) => String(left.name).localeCompare(String(right.name)));

    const synchronizedGroups = objectsOfType('PBXFileSystemSynchronizedRootGroup')
        .map((group) => group.path)
        .sort();

    const copyPhases = objectsOfType('PBXCopyFilesBuildPhase').map((phase) => ({
        name: phase.name,
        dstSubfolderSpec: numberValue(phase.dstSubfolderSpec),
        dstPath: phase.dstPath,
    }));

    return {
        objectVersion: numberValue(project.objectVersion),
        preferredProjectObjectVersion: numberValue(project.preferredProjectObjectVersion),
        targets,
        synchronizedGroups,
        copyPhases,
    };
}

export function watchTargetsStableFailures(firstText, secondText, options) {
    const watchTargets = options?.watchTargets;
    if (
        !Array.isArray(watchTargets)
        || watchTargets.length === 0
        || watchTargets.some((name) => typeof name !== 'string' || name.length === 0)
    ) {
        throw new TypeError('watchTargets must be a non-empty array of non-empty names');
    }

    const firstProject = parsePbxproj(firstText);
    const secondProject = parsePbxproj(secondText);
    const firstObjects = firstProject.objects ?? {};
    const secondObjects = secondProject.objects ?? {};
    const secondTargets = Object.values(secondObjects)
        .filter((object) => object.isa === 'PBXNativeTarget');
    const secondTargetNames = new Set(secondTargets.map((target) => target.name));
    const groupPaths = (objects) => Object.values(objects)
        .filter((object) => object.isa === 'PBXFileSystemSynchronizedRootGroup')
        .map((group) => group.path);
    const firstGroupPaths = groupPaths(firstObjects).sort();
    const secondGroupPaths = groupPaths(secondObjects);
    const secondGroupPathSet = new Set(secondGroupPaths);
    const hasCopyPhase = (targetName, matchesPhase, embeddedPath) => {
        const target = secondTargets.find((candidate) => candidate.name === targetName);
        return (target?.buildPhases ?? []).some((reference) => {
            const phase = secondObjects[reference];
            return phase?.isa === 'PBXCopyFilesBuildPhase'
                && matchesPhase(phase)
                && (phase.files ?? []).some((fileReference) => {
                    const buildFile = secondObjects[fileReference];
                    return secondObjects[buildFile?.fileRef]?.path === embeddedPath;
                });
        });
    };

    const failures = [];
    if (secondText !== firstText) failures.push('bytes');
    if (Number(secondProject.objectVersion) !== 77) failures.push('objectVersion');
    failures.push(...watchTargets
        .filter((name) => !secondTargetNames.has(name))
        .map((name) => `target:${name}`));
    failures.push(...firstGroupPaths
        .filter((path) => !secondGroupPathSet.has(path))
        .map((path) => `group:${path}`));
    if (secondGroupPaths.length === 0) failures.push('groups');
    if (!hasCopyPhase('App', (phase) => Number(phase.dstSubfolderSpec) === 16
        && phase.dstPath === '$(CONTENTS_FOLDER_PATH)/Watch', 'WatchApp.app')) failures.push('embed');
    if (!hasCopyPhase('WatchApp', (phase) => Number(phase.dstSubfolderSpec) === 13,
        'WatchWidgets.appex')) failures.push('widgets-embed');
    return failures;
}
