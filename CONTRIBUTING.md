# Delivery process

It’s a Plan project `technowide-software.IPM` is the source of truth for work, decisions, and progress. GitHub holds code, PR review, and CI evidence.

1. Describe work and acceptance criteria in an IPM issue.
2. Set its status and initiative in It’s a Plan. Do not maintain a duplicate GitHub Projects backlog.
3. Implement changes on a branch and reference the IPM issue identifier in the pull request.
4. Include the resulting behavior, relevant screenshots, verification, and known limitations in the PR.
5. Record design decisions in `docs/decisions/` and link the issue and PR.
6. Merge after review. Update the IPM task and attach the merged PR and successful CI run.

## Project statuses

- **Backlog:** proposed work.
- **Ready:** defined and ready to implement.
- **In progress:** active implementation.
- **In review:** a PR or a design proposal needs review.
- **Done:** accepted and merged.

Design approval precedes native screen implementation. Screenshots and CI artifacts are review aids; they are not proof of a working native build.

Never commit credentials, device push tokens, session data, private server addresses, or real user data. Use GitHub Actions secrets for later provider credentials.
