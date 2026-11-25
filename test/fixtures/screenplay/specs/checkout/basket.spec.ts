import { Ensure, equals } from '@serenity-js/assertions';
import { actorCalled, Task } from '@serenity-js/core';
import { describe, expect, it } from 'vitest';

const AddsItemsToBasket = (count: number) =>
    Task.where(`#actor adds ${ count } items to the basket`,
        Ensure.that(count, equals(count)),
    );

describe('Basket @checkout', () => {

    it('passes with Screenplay activities', async () => {
        await actorCalled('Alice').attemptsTo(
            AddsItemsToBasket(2),
        );
    });

    describe('when empty', () => {
        it('fails a Screenplay assertion @issue:BASKET-1', async () => {
            await actorCalled('Bob').attemptsTo(
                Ensure.that(1, equals(2)),
            );
        });
    });

    it('fails a plain expect', () => {
        expect(1).toBe(2);
    });

    it('fails with an error', () => {
        throw new TypeError('boom');
    });

    it.skip('is skipped', () => {});

    it.todo('is not implemented yet');

    let attempts = 0;
    it('passes on retry', { retry: 2 }, () => {
        attempts++;
        expect(attempts).toBe(2);
    });
});

it('lives outside any describe block', () => {
    expect(true).toBe(true);
});

it('carries native Vitest tags', { tags: [ 'smoke', 'issue:BASKET-2' ] }, () => {
    expect(true).toBe(true);
});
