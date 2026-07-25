# Core

- Static feedback form in `public/`; Cloudflare Pages endpoint is `functions/api/feedback.js`.
- Function validates feedback, optionally verifies Turnstile, uploads annotated screenshots to the public assets repository, then emits a `repository_dispatch` to `GITHUB_REPO`.
- Issue creation and roadmap project insertion are owned by `../lotus/.github/workflows/seeds-feedback-issue.yml`; keep its payload contract synchronized with the function.
- The public client must never receive GitHub credentials.