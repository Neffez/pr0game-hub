# Contributing

Thanks for helping with pr0game Hub! Changes go in through pull requests, which need a review by the maintainer
([CODEOWNERS](.github/CODEOWNERS)) and a green CI before they can be merged.

## Workflow

1. Fork the repository and create a branch from `main`.
2. Set up the project as described in the [README](README.md#development).
3. Make your change, then run:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```
4. Add an entry to [CHANGELOG.md](CHANGELOG.md) in the same commit: a bullet at the top of today's section
   (`## YYYY-MM-DD`, create it if missing), in English, describing what changed.
5. Open a pull request against `main` and describe what it changes and why. CI on pull requests from forks runs after
   the maintainer has approved it.

## Guidelines

- **Copy and paste only.** pr0game's rules forbid automation. Pull requests that add code running on game pages
  (userscripts, bookmarklets, browser extensions) or endpoints for automated submission will not be accepted.
- **Keep data within its group.** Every game-data query goes through the group context (`apps/server/src/context.ts`).
- **Tests for parsers.** New or changed parsers come with a fixture (a saved game page, without personal data you do
  not want to publish) and a test in `packages/parser/test/`.
- **Migrations.** Schema changes go into a new numbered SQL file in `apps/server/migrations/`; never edit an existing one.
- **Both languages.** UI texts go into `apps/web/src/locales/de.ts` and `en.ts`.
- **English** for code, comments, commit messages and the changelog. Match the style of the surrounding code.

## Reporting bugs

Open an issue with the page type, the game language and, if possible, the copied page source (`Ctrl+U`) that fails to
parse. Remove anything you do not want to publish.

## License

By contributing you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE).
