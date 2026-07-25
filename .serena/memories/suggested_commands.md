# Suggested Commands

- Local Pages development: `wrangler pages dev public` after setting `.dev.vars`.
- Validate a changed workflow syntactically: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/seeds-feedback-issue.yml")'` from the `lotus` repository.
- Check changed files for whitespace errors: `git diff --check`.