import { AssertionError, ImplementationPendingError, TestCompromisedError } from '@serenity-js/core';
import type { DomainEvent } from '@serenity-js/core/events';
import { InteractionFinished } from '@serenity-js/core/events';
import {
    ExecutionCompromised,
    ExecutionFailedWithAssertionError,
    ExecutionFailedWithError,
    ExecutionSkipped,
    ExecutionSuccessful,
    ImplementationPending,
    type Outcome,
} from '@serenity-js/core/model';
import type { TestError } from 'vitest';
import type { TestCase } from 'vitest/node';

export class OutcomeMapper {
    outcomeOf(testCase: TestCase, workerEvents: DomainEvent[]): Outcome {
        const runnerOutcome = this.runnerOutcomeOf(testCase);
        const worstInteractionOutcome = this.worstInteractionOutcomeIn(workerEvents);

        // An interaction that failed an assertion or was skipped carries
        // richer information than the error Vitest serialised for us
        if (worstInteractionOutcome instanceof ExecutionFailedWithAssertionError
            || worstInteractionOutcome instanceof ExecutionSkipped
        ) {
            return worstInteractionOutcome;
        }

        return worstInteractionOutcome.isWorseThan(runnerOutcome)
            ? worstInteractionOutcome
            : runnerOutcome;
    }

    runnerOutcomeOf(testCase: TestCase): Outcome {
        const result = testCase.result();

        switch (result.state) {
            case 'passed':
                return new ExecutionSuccessful();

            case 'skipped':
                return testCase.options.mode === 'todo'
                    ? new ImplementationPending(new ImplementationPendingError('Scenario not implemented'))
                    : new ExecutionSkipped();

            case 'failed': {
                const error = this.errorFrom(result.errors?.[0]);

                if (error instanceof AssertionError) {
                    return new ExecutionFailedWithAssertionError(error);
                }
                if (error instanceof TestCompromisedError) {
                    return new ExecutionCompromised(error);
                }
                return new ExecutionFailedWithError(error);
            }

            default:
                return new ExecutionSkipped();
        }
    }

    errorFrom(serialised: TestError | undefined): Error {
        const name = serialised?.name ?? 'Error';
        const message = serialised?.message ?? 'Test failed';

        const error = this.looksLikeAnAssertionError(serialised)
            ? new AssertionError(message)
            : (name === 'TestCompromisedError' ? new TestCompromisedError(message) : new Error(message));

        error.name = name;
        error.stack = serialised?.stack ?? `${ name }: ${ message }`;

        return error;
    }

    private looksLikeAnAssertionError(serialised: TestError | undefined): boolean {
        if (! serialised) {
            return false;
        }

        return /AssertionError/.test(serialised.name ?? '')
            || (Object.prototype.hasOwnProperty.call(serialised, 'expected')
                && Object.prototype.hasOwnProperty.call(serialised, 'actual'));
    }

    private worstInteractionOutcomeIn(events: DomainEvent[]): Outcome {
        let worst: Outcome = new ExecutionSuccessful();

        for (const event of events) {
            if (event instanceof InteractionFinished && event.outcome.isWorseThan(worst)) {
                worst = event.outcome;
            }
        }

        return worst;
    }
}
