import { SerenityReporterForVitest } from './reporter/SerenityReporterForVitest.js';

export type { SerenityTaskMeta, SerialisedDomainEvent } from './events/serialisation.js';
export { SerenityReporterForVitest, type SerenityReporterForVitestConfig } from './reporter/SerenityReporterForVitest.js';

/**
 * Default export, so that the reporter can be registered by module name:
 *
 * ```ts
 * reporters: [ [ '@bloom-group/serenity-vitest', { crew: [ ... ] } ] ]
 * ```
 */
export default SerenityReporterForVitest;
