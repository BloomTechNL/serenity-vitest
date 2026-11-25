import { FileSystem, FileSystemLocation, Path, RequirementsHierarchy } from '@serenity-js/core/io';
import { Category, FeatureTag, Name, ScenarioDetails, type Tag, Tags } from '@serenity-js/core/model';

/**
 * Minimal, runner-agnostic description of a test,
 * so the same mapping can be used both in the worker and in the reporter.
 */
export interface TestDescriptor {
    /** Absolute path to the test file */
    file: string;
    /** Titles of the enclosing `describe` blocks, outermost first */
    suiteTitles: string[];
    /** Title of the test itself */
    title: string;
    /** Native Vitest tags, if any */
    tags?: readonly string[];
    line?: number;
    column?: number;
}

export interface MappedScenario {
    details: ScenarioDetails;
    tags: Tag[];
}

/**
 * Maps Vitest tests to Serenity/JS scenarios, following the same conventions
 * as the official Serenity/JS Mocha and Playwright Test adapters:
 *
 * - the outermost `describe` block is the **feature**,
 * - nested `describe` titles plus the test title form the **scenario name**,
 * - a test outside any `describe` block belongs to a feature named after its file,
 * - `@tags` in titles become Serenity/JS tags and are stripped from the names,
 * - the directory structure under the spec directory becomes themes and capabilities.
 */
export class ScenarioMapper {
    private readonly requirementsHierarchy: RequirementsHierarchy;

    constructor(rootDirectory: string, specDirectory?: string) {
        const root = Path.from(rootDirectory);
        this.requirementsHierarchy = new RequirementsHierarchy(
            new FileSystem(root),
            specDirectory ? root.resolve(Path.from(specDirectory)) : undefined,
        );
    }

    map(test: TestDescriptor): MappedScenario {
        const path = Path.from(test.file);
        const [ outermostSuite, ...nestedSuites ] = test.suiteTitles.filter(title => title.trim() !== '');

        const rawFeatureName = outermostSuite;
        const rawScenarioName = [ ...nestedSuites, test.title ].join(' ').trim();

        const requirementTags = this.requirementsHierarchy.requirementTagsFor(
            path,
            rawFeatureName ? Tags.stripFrom(rawFeatureName) : undefined,
        );

        const featureName = rawFeatureName
            ? Tags.stripFrom(rawFeatureName)
            : requirementTags.find(tag => tag instanceof FeatureTag)?.name ?? path.basename();

        const details = new ScenarioDetails(
            new Name(Tags.stripFrom(rawScenarioName)),
            new Category(featureName),
            new FileSystemLocation(path, test.line, test.column),
        );

        const tagsFromTitles = Tags.from(`${ rawFeatureName ?? '' } ${ rawScenarioName }`);
        const nativeTags = (test.tags ?? [])
            .filter(tag => typeof tag === 'string' && tag.trim() !== '')
            .flatMap(tag => Tags.from(tag.startsWith('@') ? tag : `@${ tag }`));

        return {
            details,
            tags: uniqueTags(...requirementTags, ...tagsFromTitles, ...nativeTags),
        };
    }
}

function uniqueTags(...tags: Tag[]): Tag[] {
    const unique = new Map<string, Tag>();

    for (const tag of tags) {
        unique.set(`${ tag.type }:${ tag.name }`, tag);
    }

    return [ ...unique.values() ];
}
