# Coding standards

## Commit messages

Use Conventional Commits for every new commit:

```text
type(scope): imperative description
```

The scope is optional. Use a lowercase type and, when present, a lowercase scope naming the affected area.

- `feat`: add a capability.
- `fix`: correct a bug.
- `docs`: change documentation.
- `refactor`: restructure code while preserving behavior.
- `test`: add or change tests.
- `perf`: improve performance.
- `build`: change dependencies or build tooling.
- `ci`: change CI configuration.
- `style`: change formatting without changing behavior.
- `chore`: perform maintenance outside the categories above.
- `revert`: revert an earlier change.

Describe the complete change in the commit, using an imperative subject such as `feat(cli): add application workflow commands` or `fix(cli): label environment restart notices`.

Mark breaking changes with `!` after the type/scope and explain the migration in a `BREAKING CHANGE:` footer.

## Pull requests

Use the same semantic format for PR titles, describing the complete change being merged. A squash merge can then use the title as its commit subject.

Before creating or updating a PR description, read and follow the [pr skill](.agents/skills/pr/SKILL.md), including its PR body template.

Write the PR description from the full diff against its target branch. Include the resulting behavior, validation evidence, and relevant migration notes; update the title and description when the scope changes.
