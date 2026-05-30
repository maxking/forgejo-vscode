# Issue 20 follow-up notes

The immediate fix changes the Pull Requests view to fetch only open PRs by default, with `forgejo.pullRequestState` available for users who need `closed` or `all`.

Potential future improvement: lazy-load closed/merged PR groups or add a paged "Load more" tree item so users can browse historical PRs without forcing the extension to fetch every PR up front.
