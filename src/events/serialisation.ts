import * as events from '@serenity-js/core/events';
import type { DomainEvent } from '@serenity-js/core/events';

/**
 * A JSON-friendly representation of a Serenity/JS domain event,
 * small enough to travel from a Vitest worker to the main process
 * as part of the test's `task.meta`.
 */
export interface SerialisedDomainEvent {
    type: string;
    value: Record<string, unknown>;
}

/**
 * Payload a worker attaches to each test (`task.meta.serenity`).
 */
export interface SerenityTaskMeta {
    /** Version of the payload format, so the reporter can reject anything it doesn't understand */
    version: 1;
    /** Scene id the worker-side Serenity instance used for this test */
    sceneId: string;
    /** Events emitted while the test (and its hooks) ran */
    events: SerialisedDomainEvent[];
}

export const META_KEY = 'serenity' as const;

declare module 'vitest' {
    interface TaskMeta {
        serenity?: SerenityTaskMeta;
    }
}

type DeserialisableEvent = { fromJSON(value: unknown): DomainEvent };

export function serialise(event: DomainEvent): SerialisedDomainEvent {
    return {
        type: event.constructor.name,
        value: JSON.parse(JSON.stringify(event.toJSON())),
    };
}

/**
 * Re-hydrates a serialised event, re-attaching it to `sceneId` when it carries one.
 * Returns `undefined` for event types the installed `@serenity-js/core` doesn't know about.
 */
export function deserialise(serialised: SerialisedDomainEvent, sceneId?: string): DomainEvent | undefined {
    const eventType = (events as unknown as Record<string, DeserialisableEvent | undefined>)[serialised.type];

    if (! eventType || typeof eventType.fromJSON !== 'function') {
        return undefined;
    }

    const value = sceneId !== undefined && typeof serialised.value['sceneId'] === 'string'
        ? { ...serialised.value, sceneId }
        : serialised.value;

    return eventType.fromJSON(value);
}
