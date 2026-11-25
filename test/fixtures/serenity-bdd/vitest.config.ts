import { defineConfig } from 'vitest/config';

// Configured exactly the way a consumer of the published package would.
export default defineConfig({
    test: {
        root: import.meta.dirname,
        include: [ 'specs/**/*.spec.ts' ],
        setupFiles: [ '@bloom-group/serenity-vitest/setup' ],
        reporters: [
            'default',
            [ '@bloom-group/serenity-vitest', {
                crew: [
                    '@serenity-js/console-reporter',
                    '@serenity-js/serenity-bdd',
                    [ '@serenity-js/core:ArtifactArchiver', { outputDirectory: process.env.SERENITY_OUTPUT_DIR ?? 'target/site/serenity' } ],
                ],
            } ],
        ],
    },
});
