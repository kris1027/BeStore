# GitHub setup

BeStore is maintained by one developer with AI agents. This record explains the GitHub settings paired with the repository files. GitHub labels, the About section, and branch rules are stored by GitHub, so changing this document alone does not apply them.

## Issue and pull request flow

- `.github/ISSUE_TEMPLATE/bug_report.yml` applies `bug` and asks for observed behavior, reproduction, and the expected result.
- `.github/ISSUE_TEMPLATE/feature_request.yml` applies `feature` and asks for a goal and observable acceptance criteria.
- Blank issues remain available for maintenance, documentation, and other work.
- `.github/pull_request_template.md` asks what changed, what was verified, and what needs attention.

## Labels

Labels have no prefixes. Each name has the same color as the approved BeStats label set:

| Label | Color |
| --- | --- |
| `bug` | `E57373` |
| `feature` | `66BB8A` |
| `improvement` | `5DBAB4` |
| `docs` | `6EA8DE` |
| `refactor` | `A78BDA` |
| `maintenance` | `94A3B8` |
| `test` | `91B86B` |
| `performance` | `E9B55A` |
| `accessibility` | `D990BC` |
| `ui` | `DF9B78` |
| `auth` | `A293D6` |
| `database` | `7398C5` |
| `security` | `CD8292` |

GitHub's unused default labels are removed. Existing `documentation` and `enhancement` are renamed to `docs` and `feature` so any assignments would survive.

## About section

- Description: `Single-brand online store in development: Next.js storefront, admin panel, and Supabase-backed data.`
- Topics: `nextjs`, `typescript`, `supabase`, `prisma`, `ecommerce`, `online-store`, `tailwindcss`, `vercel`.
- Website URL stays empty until there is a real deployment.

## Main branch rules

The active `Protect main` ruleset targets `refs/heads/main`. It requires a pull request and the GitHub Actions `check` job, with the PR branch up to date with `main`. It blocks force pushes and deletion. Required approving reviews: zero, so the solo developer can merge after CI. CodeRabbit is advisory. No bypass actors are configured.

## README

`README.md` replaces the Next.js starter text with BeStore's purpose, current status, local setup, test commands, and honest screenshots from the two development style guides. The admin screenshot uses sample figures; it is not a live sales dashboard.
