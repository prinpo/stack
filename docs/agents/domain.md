# Domain Docs

This repo uses a single-context layout.

## Before exploring

Read root `GLOSSARY.md` and any ADRs in `docs/adr/` relevant to the area you will work in.

If these files do not exist, proceed silently. Create domain documentation through the `domain-modeling` skill when terms or decisions are resolved.

## File structure

- `GLOSSARY.md`: shared domain vocabulary.
- `docs/adr/NNNN-decision-title.md`: architectural decisions.

## Use the glossary’s vocabulary

Use defined terms in issue titles, proposals, hypotheses, and test names.
If a needed concept is missing, reconsider whether it fits the project or note the gap for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be reopened.
