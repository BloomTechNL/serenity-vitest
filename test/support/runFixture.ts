import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const vitestBin = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

export interface RecordedEvent {
    type: string;
    value: any;
}

export interface FixtureRun {
    exitCode: number | null;
    output: string;
    outputDir: string;
    events: RecordedEvent[];
}

/**
 * Runs Vitest on one of the fixture projects in a child process,
 * the same way a user would from the command line.
 */
export function runFixture(name: string, ...args: string[]): FixtureRun {
    const fixtureDir = path.join(projectRoot, 'test', 'fixtures', name);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `serenity-vitest-${ name }-`));
    const eventsFile = path.join(outputDir, 'events.json');

    const result = spawnSync(process.execPath, [ vitestBin, 'run', ...args ], {
        cwd: fixtureDir,
        encoding: 'utf8',
        env: {
            ...process.env,
            EVENTS_FILE: eventsFile,
            SERENITY_OUTPUT_DIR: path.join(outputDir, 'serenity'),
            FORCE_COLOR: '0',
            NO_COLOR: '1',
        },
    });

    return {
        exitCode: result.status,
        output: `${ result.stdout }\n${ result.stderr }`,
        outputDir,
        events: fs.existsSync(eventsFile)
            ? JSON.parse(fs.readFileSync(eventsFile, 'utf8'))
            : [],
    };
}
