# Issue 20 follow-up notes

Implemented lazy historical PR loading: the Pull Requests view fetches open-state PRs initially, checks the Forgejo `x-total-count` header with a `limit=1` closed-PR request to avoid showing historical placeholders when there are no closed PRs, then fetches full closed-state PRs only when Merged or Closed is expanded. The closed-state result and any in-flight closed fetch are cached and split into Merged vs Closed locally.

Potential future improvement: add a paged "Load more" tree item for very large historical PR lists so expanding Merged/Closed does not need to fetch every closed PR at once.
