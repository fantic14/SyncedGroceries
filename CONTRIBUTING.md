# Development workflow

- Keep `master` as the integration branch. Implement work on named feature branches and push those branches for review.
- Use focused commits that separate database/schema work, data rules, synchronization, UI, and documentation when those changes can be reviewed independently.
- Include meaningful tests with the behaviour they verify. Run `npm run check` and platform exports before pushing a completed milestone.
- Do not merge feature work into `master` or force-push shared history without an explicit request.
- Stacked branches are appropriate when a later milestone depends on an earlier one. Review the later branch against its predecessor until the predecessor is merged.

Current stack:

```text
master
  └─ feat/milestone-2-shared-groceries
       └─ feat/milestone-3-offline-sync
```

Milestone 2's five commits cover its database, repository, synchronization, UI, and setup documentation. Hosted and physical-device acceptance remain separate from local automated checks.
