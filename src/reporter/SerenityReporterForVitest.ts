import { Clock, Duration, Serenity, type SerenityConfig, Timestamp } from '@serenity-js/core';
import {
    type DomainEvent,
    RetryableSceneDetected,
    SceneFinished,
    SceneFinishes,
    SceneStarts,
    SceneTagged,
    TestRunFinished,
    TestRunFinishes,
    TestRunnerDetected,
    TestRunStarts,
    TestSuiteFinished,
    TestSuiteStarts,
} from '@serenity-js/core/events';
import { FileSystemLocation, Path, Version } from '@serenity-js/core/io';
import {
    ArbitraryTag,
    CorrelationId,
    ExecutionFailedWithError,
    ExecutionRetriedTag,
    ExecutionSkipped,
    ExecutionSuccessful,
    Name,
    type Outcome,
    Tags,
    TestSuiteDetails,
} from '@serenity-js/core/model';
import type { TestError } from 'vitest';
import { type Reporter, type TestCase, type TestModule, type TestSuite, type Vitest, version as vitestVersion } from 'vitest/node';

import { deserialise, type SerenityTaskMeta } from '../events/serialisation.js';
import { ScenarioMapper, type TestDescriptor } from '../mapping/ScenarioMapper.js';
import { OutcomeMapper } from './OutcomeMapper.js';

/**
 * Configuration of the {@link SerenityReporterForVitest}.
 *
 * Accepts everything [`SerenityConfig`](https://serenity-js.org/api/core/class/SerenityConfig/) does,
 * most importantly the reporting `crew`, plus Vitest-specific options.
 */
export interface SerenityReporterForVitestConfig extends SerenityConfig {
    /**
     * Root of your specifications, used to derive themes and capabilities from the directory structure.
     * Resolved relative to the Vitest `root`. Defaults to the first of `features`, `specs`, `spec`, `tests`, `test` or `src` that exists.
     */
    specDirectory?: string;
}

/**
 * Domain events the reporter emits itself, based on Vitest's view of the test run.
 * Copies of these coming from the worker are dropped to avoid duplicates.
 */
const lifecycleEvents = new Set([
    SceneStarts.name,
    SceneFinishes.name,
    SceneFinished.name,
    TestRunnerDetected.name,
    TestRunStarts.name,
    TestRunFinishes.name,
    TestRunFinished.name,
    TestSuiteStarts.name,
    TestSuiteFinished.name,
]);

/**
 * Serenity/JS reporter for Vitest.
 *
 * Translates Vitest test results into Serenity/JS domain events and passes them on to the configured
 * [stage crew members](https://serenity-js.org/api/core/interface/StageCrewMember/), such as
 * `SerenityBDDReporter`, `ConsoleReporter` or `ArtifactArchiver`.
 *
 * When `@bloom-group/serenity-vitest/setup` is registered as a setup file, the Screenplay activities your actors performed
 * in the Vitest workers (tasks, interactions, screenshots, notes, ...) are merged into the report too.
 *
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   test: {
 *     setupFiles: [ '@bloom-group/serenity-vitest/setup' ],
 *     reporters: [
 *       'default',
 *       [ '@bloom-group/serenity-vitest', {
 *         crew: [
 *           '@serenity-js/serenity-bdd',
 *           [ '@serenity-js/core:ArtifactArchiver', { outputDirectory: 'target/site/serenity' } ],
 *         ],
 *       } ],
 *     ],
 *   },
 * })
 * ```
 */
export class SerenityReporterForVitest implements Reporter {
    private readonly serenity: Serenity;
    private readonly outcomeMapper = new OutcomeMapper();
    private scenarioMapper: ScenarioMapper;
    private readonly suiteIds = new Map<string, CorrelationId>();

    constructor(private readonly config: SerenityReporterForVitestConfig = {}) {
        const { specDirectory, ...serenityConfig } = config;

        this.serenity = new Serenity(new Clock(), process.cwd());
        this.serenity.configure(serenityConfig);
        this.scenarioMapper = new ScenarioMapper(process.cwd(), specDirectory);
    }

    onInit(vitest: Vitest): void {
        this.scenarioMapper = new ScenarioMapper(vitest.config.root, this.config.specDirectory);
    }

    onTestRunStart(): void {
        this.suiteIds.clear();
        this.serenity.announce(new TestRunStarts(this.serenity.currentTime()));
    }

    onTestSuiteReady(testSuite: TestSuite): void {
        const suiteId = CorrelationId.create();
        this.suiteIds.set(testSuite.id, suiteId);

        this.serenity.announce(new TestSuiteStarts(
            this.suiteDetailsOf(testSuite, suiteId),
            this.serenity.currentTime(),
        ));
    }

    onTestSuiteResult(testSuite: TestSuite): void {
        const suiteId = this.suiteIds.get(testSuite.id);

        if (! suiteId) {
            return;
        }

        this.suiteIds.delete(testSuite.id);

        this.serenity.announce(new TestSuiteFinished(
            this.suiteDetailsOf(testSuite, suiteId),
            this.suiteOutcomeOf(testSuite),
            this.serenity.currentTime(),
        ));
    }

    onTestCaseResult(testCase: TestCase): void {
        this.serenity.announce(...this.eventsFor(testCase));
    }

    async onTestRunEnd(
        _testModules: ReadonlyArray<TestModule>,
        unhandledErrors: ReadonlyArray<TestError>,
    ): Promise<void> {
        this.serenity.announce(new TestRunFinishes(this.serenity.currentTime()));

        try {
            await this.serenity.waitForNextCue();

            const outcome = unhandledErrors.length > 0
                ? new ExecutionFailedWithError(this.outcomeMapper.errorFrom(unhandledErrors[0]))
                : new ExecutionSuccessful();

            this.serenity.announce(new TestRunFinished(outcome, this.serenity.currentTime()));
        }
        catch (error) {
            this.serenity.announce(new TestRunFinished(
                new ExecutionFailedWithError(error as Error),
                this.serenity.currentTime(),
            ));

            throw error;
        }
    }

    /**
     * Builds the complete event stream for a single test: the scene lifecycle as seen by Vitest,
     * with the activities recorded in the worker spliced in between.
     */
    private eventsFor(testCase: TestCase): DomainEvent[] {
        const sceneId = sceneIdFor(testCase);
        const { details, tags } = this.scenarioMapper.map(this.descriptorOf(testCase));

        const diagnostic = testCase.diagnostic();
        const startTime = diagnostic
            ? new Timestamp(new Date(diagnostic.startTime))
            : this.serenity.currentTime();
        const endTime = diagnostic
            ? startTime.plus(Duration.ofMilliseconds(Math.max(0, Math.round(diagnostic.duration))))
            : startTime;

        const workerEvents = this.workerEventsFor(testCase, sceneId);
        const outcome = this.outcomeMapper.outcomeOf(testCase, workerEvents);

        return [
            new SceneStarts(sceneId, details, startTime),
            new TestRunnerDetected(sceneId, new Name('Vitest'), new Version(vitestVersion), startTime),
            ...tags.map(tag => new SceneTagged(sceneId, tag, startTime)),
            ...this.retryEventsFor(testCase, sceneId, startTime),
            ...workerEvents,
            new SceneFinishes(sceneId, outcome, endTime),
            new SceneFinished(sceneId, details, outcome, endTime),
        ];
    }

    private workerEventsFor(testCase: TestCase, sceneId: CorrelationId): DomainEvent[] {
        const payload: SerenityTaskMeta | undefined = testCase.meta().serenity;

        if (! payload || payload.version !== 1 || ! Array.isArray(payload.events)) {
            return [];
        }

        return payload.events
            .filter(event => ! lifecycleEvents.has(event.type))
            .map(event => deserialise(event, sceneId.value))
            .filter((event): event is DomainEvent => event !== undefined);
    }

    private retryEventsFor(testCase: TestCase, sceneId: CorrelationId, timestamp: Timestamp): DomainEvent[] {
        const maxRetries = retriesConfiguredFor(testCase);
        const retryCount = testCase.diagnostic()?.retryCount ?? 0;

        if (maxRetries <= 0) {
            return [];
        }

        const events: DomainEvent[] = [ new RetryableSceneDetected(sceneId, timestamp) ];

        if (retryCount > 0) {
            events.push(
                new SceneTagged(sceneId, new ArbitraryTag('retried'), timestamp),
                new SceneTagged(sceneId, new ExecutionRetriedTag(retryCount), timestamp),
            );
        }

        return events;
    }

    private descriptorOf(testCase: TestCase): TestDescriptor {
        const suiteTitles: string[] = [];

        for (let parent = testCase.parent; parent.type === 'suite'; parent = parent.parent) {
            suiteTitles.unshift(parent.name);
        }

        return {
            file: testCase.module.moduleId,
            suiteTitles,
            title: testCase.name,
            tags: testCase.tags,
            line: testCase.location?.line,
            column: testCase.location?.column,
        };
    }

    private suiteDetailsOf(testSuite: TestSuite, suiteId: CorrelationId): TestSuiteDetails {
        return new TestSuiteDetails(
            new Name(Tags.stripFrom(testSuite.name)),
            new FileSystemLocation(
                Path.from(testSuite.module.moduleId),
                testSuite.location?.line,
                testSuite.location?.column,
            ),
            suiteId,
        );
    }

    private suiteOutcomeOf(testSuite: TestSuite): Outcome {
        const [ error ] = testSuite.errors();

        if (error) {
            return new ExecutionFailedWithError(this.outcomeMapper.errorFrom(error));
        }

        let worst: Outcome = new ExecutionSuccessful();

        for (const testCase of testSuite.children.allTests()) {
            const outcome = this.outcomeMapper.runnerOutcomeOf(testCase);
            if (outcome.isWorseThan(worst)) {
                worst = outcome;
            }
        }

        return testSuite.state() === 'skipped' && worst instanceof ExecutionSuccessful
            ? new ExecutionSkipped()
            : worst;
    }
}

/**
 * Vitest test ids (e.g. `1223128da3_0_1`) are stable and unique within a run,
 * but contain characters Serenity/JS doesn't allow in a `CorrelationId`.
 */
function sceneIdFor(testCase: TestCase): CorrelationId {
    return new CorrelationId(`vitest-${ testCase.id.replaceAll(/[^\d.A-Za-z-]/g, '-') }`);
}

function retriesConfiguredFor(testCase: TestCase): number {
    const retry = testCase.options.retry;

    return typeof retry === 'number'
        ? retry
        : retry?.count ?? 0;
}
