# Components: the first-visit guide

## What it does

A new visitor sees a welcome card once the map is ready. It says what the site is in one sentence and what a dot means, then offers two choices: **Show me around** starts a tour, **Explore on my own** closes it. Either choice is remembered in `localStorage` (`breachscope.guide.v1`), so the card never comes back. The **Guide** button in the top bar replays the tour any time.

## How the tour finds things

Each control the tour talks about carries a `data-tour` attribute (`map`, `feed`, `filters`, `search`, `timeline`, `guide`). The same name sits on a different element at each screen size: on a desktop `feed` is the feed rail, on a tablet the Feed button, on a phone the bottom sheet. When the tour starts it keeps only the steps whose target is on screen, so one list of steps works everywhere.

The tour measures its target every 250 ms instead of once, because panels open and close while it runs. The card goes below the target, above it if there is no room, or beside a tall narrow target like the feed rail. A target bigger than 40% of the screen (the map) gets no outline, because outlining the whole screen says nothing.

## Why these choices

- **Not modal.** The welcome card does not block the map, so someone who ignores it can still use the site.
- **Storage can fail.** Private windows can block `localStorage`. Every read and write is wrapped in `try`, and the worst case is seeing the welcome again.
- **Links skip it.** A visitor who opens `/?event=<uid>` from Reports or a shared link came for that record, so the welcome stays away.
- **The arrival toast waits.** It is quiet while the guide or a record panel is open, so it never covers them.
- **Tests.** Playwright's config starts every spec with the guide marked as seen; `e2e/onboarding.spec.ts` clears that and walks the full tour at all four sizes.
