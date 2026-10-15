# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `prinpo/stack`. Use the `gh` CLI.

## Conventions

Run commands inside this clone so `gh` infers the repository, or pass `--repo prinpo/stack`.

- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`. Add label and state filters as needed.
- Update a body: `gh issue edit <number> --body-file <file>`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.
- Create a child: `gh issue create --parent <parent> --title "..." --body-file <file>`.
- Link an existing child: `gh issue edit <parent> --add-sub-issue <child>`.
- Add a blocker: `gh issue edit <child> --add-blocked-by <blocker>`.

For multiline text, write the exact content to a temporary file and use `--body-file`.
If sub-issues are unavailable, put `Part of #<parent>` at the top of the child body and add it to a task list in the parent.
If native dependencies are unavailable, put `Blocked by: #<number>, ...` at the top of the child body.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, use `gh pr` equivalents to read, comment, label, and close external PRs.
GitHub shares issue and PR numbers; resolve ambiguous references with `gh pr view <number>`, falling back to `gh issue view <number>`.

## Skill operations

When a skill says “publish to the issue tracker,” create a GitHub issue.
When it says “fetch the relevant ticket,” read the GitHub issue.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: a sub-issue of the map, labelled `wayfinder:<type>` where type is `research`, `prototype`, `grilling`, or `task`.
- Blocking: use native issue dependencies. A ticket is unblocked when every blocker is closed.
- Frontier: inspect the map’s open children in map order; choose the first with no open blockers and no assignee.
- Claim: `gh issue edit <number> --add-assignee @me`, the session’s first write.
- Resolve: comment with the answer, close the ticket, then append a gist and ticket link to the map’s Decisions-so-far.
