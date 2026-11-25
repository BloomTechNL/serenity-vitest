import path from 'node:path';

import { defineConfig } from 'vitest/config';

import { SerenityReporterForVitest } from '../../../src/index.js';
import { EventRecorder } from '../../support/EventRecorder.js';

export default defineConfig({
    test: {
        root: import.meta.dirname,
        include: [ 'specs/**/*.spec.ts' ],
        tags: [ { name: 'smoke' }, { name: 'issue:BASKET-2' } ],
        setupFiles: [ '../../../src/setup.ts', './serenity.setup.ts' ],
        reporters: [
            new SerenityReporterForVitest({
                crew: [
                    new EventRecorder(process.env.EVENTS_FILE ?? path.join(import.meta.dirname, 'events.json')),
                ],
            }),
        ],
    },
});
