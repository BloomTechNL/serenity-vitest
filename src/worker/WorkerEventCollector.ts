import type { Serenity, Stage, StageCrewMember } from '@serenity-js/core';
import type { DomainEvent } from '@serenity-js/core/events';

const COLLECTOR_KEY = Symbol.for('serenity-vitest/worker-event-collector');

/**
 * A stage crew member registered with the worker-side Serenity instance.
 * It buffers every domain event emitted in the worker, so that the events
 * can be shipped to the main process, where the reporter lives.
 */
export class WorkerEventCollector implements StageCrewMember {
    private buffer: DomainEvent[] = [];

    /**
     * Returns the collector registered with the given Serenity instance,
     * registering one if needed. Safe to call once per test file, even when
     * Vitest reuses the same worker (`isolate: false`).
     */
    static installedOn(serenity: Serenity): WorkerEventCollector {
        const registry = globalThis as unknown as Record<symbol, WorkerEventCollector | undefined>;

        if (! registry[COLLECTOR_KEY]) {
            const collector = new WorkerEventCollector();
            register(collector, serenity);
            registry[COLLECTOR_KEY] = collector;
        }

        return registry[COLLECTOR_KEY];
    }

    assignedTo(_stage: Stage): StageCrewMember {
        return this;
    }

    notifyOf(event: DomainEvent): void {
        this.buffer.push(event);
    }

    flush(): DomainEvent[] {
        const events = this.buffer;
        this.buffer = [];
        return events;
    }
}

/**
 * `Serenity.configure()` resets actors, timeouts and the diff formatter to their defaults,
 * which would wipe out any configuration the user has already applied in their own setup file.
 * To avoid that, we assign the collector straight to the stage when we can,
 * and only fall back to `configure` if Serenity/JS internals ever change shape.
 */
function register(collector: WorkerEventCollector, serenity: Serenity): void {
    const stage = (serenity as unknown as { stage?: Partial<Stage> }).stage;

    if (stage && typeof stage.assign === 'function') {
        stage.assign(collector);
        return;
    }

    serenity.configure({ crew: [ collector ] });
}
