# @bloom-group/serenity-vitest

[Serenity/JS](https://serenity-js.org) test runner adapter for [Vitest](https://vitest.dev).

If you already use the Screenplay Pattern in Vitest, your tests run fine, but you get no Serenity/JS reports. This package adds them back. Your Vitest test results, plus every task, interaction, screenshot and note your actors produce, go to the Serenity/JS [stage crew](https://serenity-js.org/handbook/reporting/): the [Serenity BDD reporter](https://serenity-js.org/handbook/reporting/serenity-bdd-reporter/), the [console reporter](https://serenity-js.org/handbook/reporting/console-reporter/), the `ArtifactArchiver`, or your own.

## Installation

```bash
npm install --save-dev @bloom-group/serenity-vitest @serenity-js/core
```

For Serenity BDD reports, also install the reporters you want:

```bash
npm install --save-dev @serenity-js/serenity-bdd @serenity-js/console-reporter
```

Requires Node.js 22+, Vitest 5, and Serenity/JS 3.45+.

## Configuration

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        setupFiles: [
            '@bloom-group/serenity-vitest/setup',          // 1. must come before your own setup files
            './test/serenity.setup.ts',       // 2. your actors, as before
        ],
        reporters: [
            'default',
            [ '@bloom-group/serenity-vitest', {            // 3. the Serenity/JS reporter
                crew: [
                    '@serenity-js/console-reporter',
                    '@serenity-js/serenity-bdd',
                    [ '@serenity-js/core:ArtifactArchiver', { outputDirectory: 'target/site/serenity' } ],
                ],
            } ],
        ],
    },
})
```

```ts
// test/serenity.setup.ts
import { Cast, configure, TakeNotes } from '@serenity-js/core'

configure({
    actors: Cast.where(actor => actor.whoCan(TakeNotes.usingAnEmptyNotepad())),
})
```

Your tests stay the same:

```ts
import { Ensure, equals } from '@serenity-js/assertions'
import { actorCalled } from '@serenity-js/core'
import { describe, it } from 'vitest'

describe('Checkout', () => {
    it('adds items to the basket @smoke', async () => {
        await actorCalled('Alice').attemptsTo(
            Ensure.that(2, equals(2)),
        )
    })
})
```

Generate the HTML report with the [Serenity BDD CLI](https://serenity-js.org/handbook/reporting/serenity-bdd-reporter/) as usual: `npx serenity-bdd run`.

### Reporter options

The reporter accepts every [`SerenityConfig`](https://serenity-js.org/api/core/class/SerenityConfig/) option (`crew`, `cueTimeout`, `outputStream`, ...), plus:

| Option          | Description                                                                                                                                                                   |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `specDirectory` | Root of your specs, relative to the Vitest `root`. Used to turn folders into themes and capabilities. Defaults to the first of `features`, `specs`, `spec`, `tests`, `test` or `src` that exists. |

You can also pass an instance instead of a module name:

```ts
import { SerenityReporterForVitest } from '@bloom-group/serenity-vitest'
import { SerenityBDDReporter } from '@serenity-js/serenity-bdd'

reporters: [ 'default', new SerenityReporterForVitest({ crew: [ SerenityBDDReporter.fromJSON({}) ] }) ]
```

## How it maps Vitest to Serenity/JS

| Vitest                                          | Serenity/JS                                           |
|-------------------------------------------------|-------------------------------------------------------|
| outermost `describe`                            | feature (category)                                    |
| nested `describe` titles + test title           | scenario name                                         |
| test outside any `describe`                     | feature named after the file                          |
| folders under the spec directory                | themes and capabilities                               |
| `@tag`, `@issue:ABC-123` in titles              | tags (removed from the displayed names)               |
| native Vitest `tags`                            | tags                                                  |
| passed / failed / `skip` / `todo`               | successful / failed / skipped / implementation pending |
| `expect` and Serenity/JS `Ensure` failures      | assertion failures                                    |
| `retry`                                         | retryable scene, with `retried` and retry-count tags  |

These follow the conventions of the official Serenity/JS Mocha and Playwright Test adapters, so reports look the same as for other runners.

## How it works

Vitest runs tests in worker processes, but reporters run in the main process. That means the adapter has two parts:

1. **`@bloom-group/serenity-vitest/setup`** runs in each worker. For every test it announces the scene start and finish to the worker's Serenity/JS instance, so actors are created and dismissed per test. It also collects all domain events the test emits and attaches them to the test's [`task.meta`](https://vitest.dev/advanced/metadata).
2. **`SerenityReporterForVitest`** runs in the main process. It builds the scene lifecycle from Vitest's results, replays the worker's events into it, and sends everything to your crew.

Without the setup file, the reporter still reports every test, but not the Screenplay activities inside them.

### Migrating an existing setup

If your setup files configure reporting crew members (like `SerenityBDDReporter`, `ConsoleReporter` or `ArtifactArchiver`) in the worker, move them to the reporter's `crew` option. In the worker they would each write their own partial report. Crew members that need to run next to the actors, like the `Photographer`, belong in the worker:

```ts
// test/serenity.setup.ts — worker side
configure({
    actors: ...,
    crew: [ Photographer.whoWill(TakePhotosOfFailures) ],   // photos are forwarded to the reporter
})
```

## Limitations

- `test.concurrent` tests in the same file share one worker-side Serenity/JS instance. Their activities may end up in the wrong scenario. Sequential tests (the default) are not affected.
- For retried tests, only the final attempt's activities are reported.
- Activities performed in `beforeAll` are attributed to the first test of the file. Activities in `afterAll` are not reported.

## Development

```bash
npm install
npm test          # builds, then runs end-to-end tests against fixture projects in test/fixtures
npm run typecheck
```

## License

MIT
