import { Ensure, equals } from '@serenity-js/assertions';
import { actorCalled, Answerable, Task } from '@serenity-js/core';
import { describe, it } from 'vitest';

const Greets = (name: Answerable<string>) =>
    Task.where(`#actor greets ${ name }`,
        Ensure.that(name, equals('World')),
    );

describe('Greeting', () => {
    it('greets the world', async () => {
        await actorCalled('Alice').attemptsTo(Greets('World'));
    });

    it('refuses to greet the moon', async () => {
        await actorCalled('Alice').attemptsTo(Greets('Moon'));
    });
});
