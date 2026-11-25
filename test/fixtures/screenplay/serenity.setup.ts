import { Cast, configure, TakeNotes } from '@serenity-js/core';

configure({
    actors: Cast.where(actor => actor.whoCan(TakeNotes.usingAnEmptyNotepad())),
});
