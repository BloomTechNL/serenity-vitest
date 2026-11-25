import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { type FixtureRun, type RecordedEvent, runFixture } from './support/runFixture.js';

describe('SerenityReporterForVitest', () => {

    describe('with Screenplay tests', () => {
        let run: FixtureRun;

        beforeAll(() => {
            run = runFixture('screenplay');
        });

        const scene = (name: string): RecordedEvent[] => {
            const starts = run.events.find(e => e.type === 'SceneStarts' && e.value.details.name === name);
            expect(starts, `scene "${ name }" in:\n${ run.output }`).toBeDefined();
            return run.events.filter(e => e.value.sceneId === starts!.value.sceneId);
        };

        const finalOutcomeOf = (name: string) =>
            scene(name).find(e => e.type === 'SceneFinished')!.value.outcome;

        const tagsOf = (name: string) =>
            scene(name).filter(e => e.type === 'SceneTagged').map(e => `${ e.value.tag.type }:${ e.value.tag.name }`);

        it('wraps the run in TestRunStarts and TestRunFinished events', () => {
            expect(run.events.at(0)?.type).toBe('TestRunStarts');
            expect(run.events.at(-1)?.type).toBe('TestRunFinished');
        });

        it('reports one scene per test, with the outermost describe as the feature', () => {
            const scenes = run.events.filter(e => e.type === 'SceneFinished').map(e => e.value.details);

            expect(scenes.map(s => `${ s.category } / ${ s.name }`)).toEqual([
                'Basket / passes with Screenplay activities',
                'Basket / when empty fails a Screenplay assertion',
                'Basket / fails a plain expect',
                'Basket / fails with an error',
                'Basket / is skipped',
                'Basket / is not implemented yet',
                'Basket / passes on retry',
                'Basket / lives outside any describe block',
                'Basket / carries native Vitest tags',
            ]);
        });

        it('identifies Vitest as the test runner', () => {
            const detected = scene('passes with Screenplay activities').find(e => e.type === 'TestRunnerDetected');
            expect(detected?.value.name).toBe('Vitest');
        });

        it('includes the Screenplay activities performed in the worker', () => {
            const activities = scene('passes with Screenplay activities')
                .filter(e => [ 'TaskStarts', 'InteractionStarts', 'InteractionFinished', 'TaskFinished' ].includes(e.type))
                .map(e => `${ e.type }: ${ e.value.details.name }`);

            expect(activities).toEqual([
                'TaskStarts: Alice adds 2 items to the basket',
                'InteractionStarts: Alice ensures that 2 does equal 2',
                'InteractionFinished: Alice ensures that 2 does equal 2',
                'TaskFinished: Alice adds 2 items to the basket',
            ]);
        });

        it('emits worker events between the scene starting and finishing', () => {
            const types = scene('passes with Screenplay activities').map(e => e.type);

            expect(types.at(0)).toBe('SceneStarts');
            expect(types.at(-1)).toBe('SceneFinished');
            expect(types.filter(t => t === 'SceneStarts')).toHaveLength(1);
            expect(types.filter(t => t === 'SceneFinished')).toHaveLength(1);
        });

        it('derives tags from the directory structure, the titles and the issue references', () => {
            expect(tagsOf('when empty fails a Screenplay assertion')).toEqual([
                'capability:Checkout',
                'feature:Basket',
                'tag:checkout',
                'issue:BASKET-1',
            ]);
        });

        it('maps native Vitest tags to Serenity/JS tags', () => {
            expect(tagsOf('carries native Vitest tags')).toEqual(expect.arrayContaining([
                'tag:smoke',
                'issue:BASKET-2',
            ]));
        });

        it('strips tags from suite names', () => {
            const suites = run.events.filter(e => e.type === 'TestSuiteStarts').map(e => e.value.details.name);
            expect(suites).toEqual([ 'Basket', 'when empty' ]);
        });

        it.each([
            [ 'passes with Screenplay activities', 'ExecutionSuccessful' ],
            [ 'when empty fails a Screenplay assertion', 'ExecutionFailedWithAssertionError' ],
            [ 'fails a plain expect', 'ExecutionFailedWithAssertionError' ],
            [ 'fails with an error', 'ExecutionFailedWithError' ],
            [ 'is skipped', 'ExecutionSkipped' ],
            [ 'is not implemented yet', 'ImplementationPending' ],
            [ 'passes on retry', 'ExecutionSuccessful' ],
        ])('maps the outcome of "%s" to %s', (name, expectedOutcome) => {
            expect(outcomeName(finalOutcomeOf(name).code)).toBe(expectedOutcome);
        });

        it('keeps the error details of failed tests', () => {
            const error = JSON.parse(finalOutcomeOf('fails with an error').error);

            expect(error.name).toBe('TypeError');
            expect(error.message).toBe('boom');
            expect(error.stack).toContain('basket.spec.ts');
        });

        it('marks retried tests', () => {
            const events = scene('passes on retry');

            expect(events.some(e => e.type === 'RetryableSceneDetected')).toBe(true);
            expect(tagsOf('passes on retry')).toContain('retry:1st retry');
        });
    });

    describe('configured by module name, the way a consumer would', () => {
        let run: FixtureRun;

        beforeAll(() => {
            run = runFixture('serenity-bdd');
        });

        it('produces Serenity BDD JSON reports including the Screenplay steps', () => {
            const reportDir = path.join(run.outputDir, 'serenity');
            const reports = fs.readdirSync(reportDir)
                .filter(file => file.endsWith('.json'))
                .map(file => JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8')))
                .sort((a, b) => a.title.localeCompare(b.title));

            expect(reports.map(r => [ r.title, r.result, r.userStory.storyName ])).toEqual([
                [ 'greets the world', 'SUCCESS', 'Greeting' ],
                [ 'refuses to greet the moon', 'FAILURE', 'Greeting' ],
            ]);

            expect(reports[0].testSteps[0].description).toBe('Alice greets World');
            expect(reports[0].testSteps[0].children[0].description).toContain('Alice ensures that');
        });

        it('works alongside the console reporter', () => {
            expect(run.output).toContain('Execution Summary');
            expect(run.output).toMatch(/Greeting:\s+1 failed, 1 successful, 2 total/);
        });
    });
});

// Serenity/JS outcome codes, see @serenity-js/core/model/outcomes
function outcomeName(code: number): string {
    return ({
        1: 'ExecutionCompromised',
        2: 'ExecutionFailedWithError',
        4: 'ExecutionFailedWithAssertionError',
        8: 'ImplementationPending',
        16: 'ExecutionIgnored',
        32: 'ExecutionSkipped',
        64: 'ExecutionSuccessful',
    } as Record<number, string>)[code] ?? `unknown (${ code })`;
}
