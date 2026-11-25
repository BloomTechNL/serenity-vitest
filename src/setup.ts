/**
 * Worker-side half of the Serenity/JS Vitest adapter.
 *
 * Add it to `test.setupFiles` in your Vitest config, **before** your own setup files:
 *
 * ```ts
 * setupFiles: [ '@bloom-group/serenity-vitest/setup', './test/serenity.setup.ts' ]
 * ```
 *
 * For every test, it announces the scene lifecycle to the worker's Serenity/JS instance
 * (so that actors are created and dismissed per test, just like with the Mocha or Jasmine adapters),
 * collects all the domain events emitted while the test runs, and attaches them to the test's `task.meta`.
 * The `SerenityReporterForVitest`, running in the main process, picks them up from there.
 */
import { serenity } from '@serenity-js/core';
import { SceneFinishes, SceneStarts } from '@serenity-js/core/events';
import { ExecutionFailedWithError, ExecutionSuccessful, type Outcome } from '@serenity-js/core/model';
import { afterEach, beforeEach, type RunnerTestCase } from 'vitest';

import { serialise } from './events/serialisation.js';
import { ScenarioMapper, type TestDescriptor } from './mapping/ScenarioMapper.js';
import { WorkerEventCollector } from './worker/WorkerEventCollector.js';

const collector = WorkerEventCollector.installedOn(serenity);
const mapper = new ScenarioMapper(process.cwd());

beforeEach(({ task }) => {
    const sceneId = serenity.assignNewSceneId();

    serenity.announce(
        new SceneStarts(sceneId, mapper.map(descriptorOf(task)).details, serenity.currentTime()),
    );
});

afterEach(async ({ task }) => {
    const sceneId = serenity.currentSceneId();

    try {
        serenity.announce(new SceneFinishes(sceneId, workerSideOutcomeOf(task), serenity.currentTime()));

        // wait for the Photographer to finish and for actors to be dismissed
        await serenity.waitForNextCue();
    }
    finally {
        task.meta.serenity = {
            version: 1,
            sceneId: sceneId.value,
            events: collector.flush().map(serialise),
        };
    }
});

function descriptorOf(task: RunnerTestCase): TestDescriptor {
    const suiteTitles: string[] = [];

    for (let suite = task.suite; suite && suite !== task.file; suite = suite.suite) {
        suiteTitles.unshift(suite.name);
    }

    return {
        file: task.file.filepath,
        suiteTitles,
        title: task.name,
        tags: task.tags,
        line: task.location?.line,
        column: task.location?.column,
    };
}

/**
 * The outcome as far as the worker can tell. It's only used by stage crew members
 * running in the worker; the reporter determines the final outcome independently.
 */
function workerSideOutcomeOf(task: RunnerTestCase): Outcome {
    const [ error ] = task.result?.errors ?? [];

    if (! error) {
        return new ExecutionSuccessful();
    }

    const cause = new Error(error.message ?? 'Test failed');
    cause.name = error.name ?? 'Error';
    if (error.stack) {
        cause.stack = error.stack;
    }

    return new ExecutionFailedWithError(cause);
}
