import fs from 'node:fs';

import type { Stage, StageCrewMember } from '@serenity-js/core';
import { type DomainEvent, TestRunFinished } from '@serenity-js/core/events';

/**
 * Test-only stage crew member: records every event the reporter emits
 * and dumps them to a JSON file once the test run finishes.
 */
export class EventRecorder implements StageCrewMember {
    private readonly events: Array<{ type: string; value: unknown }> = [];

    constructor(private readonly outputFile: string) {
    }

    assignedTo(_stage: Stage): StageCrewMember {
        return this;
    }

    notifyOf(event: DomainEvent): void {
        this.events.push({ type: event.constructor.name, value: event.toJSON() });

        if (event instanceof TestRunFinished) {
            fs.writeFileSync(this.outputFile, JSON.stringify(this.events, undefined, 2));
        }
    }
}
