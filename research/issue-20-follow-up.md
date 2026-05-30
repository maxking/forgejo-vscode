# Issue 20 follow-up notes

Implemented lazy historical PR loading: the Pull Requests view fetches only open-state PRs initially, then fetches closed-state PRs only when the Merged or Closed group is expanded. The closed-state result is cached and split into Merged vs Closed locally.

Potential future improvement: add a paged "Load more" tree item for very large historical PR lists so expanding Merged/Closed does not need to fetch every closed PR at once.
