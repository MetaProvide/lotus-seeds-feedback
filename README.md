# Lotus — public intake forms

Two public webpages, one Cloudflare Pages project. Both turn a form submission into a
**labeled GitHub issue** in the private `MetaProvide/lotus` repo, on the roadmap board
for triage. No GitHub account needed to submit.

| Route | Page | Who it is for | Issue labels |
|-------|------|---------------|--------------|
| `/` | `public/index.html` | Seeds reporting a bug, improvement or feature request | `seeds` + `request`/`enhancement`/`bug` |
| `/centres` | `public/centres.html` | Centres that want to offer their programme through Lotus | `centre-signup`, `lead`, + centre-type label |

```
public/index.html ──POST /api/feedback──────▶ functions/api/feedback.js
 (form + annotator)      (same origin)        (Cloudflare Pages Function)
                                               │        │ repository_dispatch (holds token)
                    screenshot → commit to     │        ▼
                    assets repo (uploads       │   GitHub Action in MetaProvide/lotus
                    branch) → raw URL ─────────┘   (.github/workflows/seeds-feedback-issue.yml)
                                                        │ creates issue (label: seeds, embeds image)
                                                        ▼
                                       Projects auto-add ▶ "Incoming" column

public/centres.html ─POST /api/centre-signup▶ functions/api/centre-signup.js
 (lead capture form)     (same origin)         │ repository_dispatch "centre-signup"
                                               ▼
                                          GitHub Action in MetaProvide/lotus
                                          (.github/workflows/centre-signup-issue.yml)
                                               │ creates lead issue + triage checklist
                                               ▼
                              Projects auto-add ▶ "Incoming" column
```

**Why a Function and not a direct call?** The repo is private, so creating an issue
needs a token. A token in a public webpage would be visible to everyone and let anyone
spam or read the repo. The Pages Function keeps the token server-side; the page only
talks to its own origin.

**Why an Action instead of creating the issue in the Function?** So the issue logic
(labels, body format, triage rules) lives in the product repo, version-controlled, and
the team can change it without touching Cloudflare. Trade-off: triggering a dispatch
needs a token with **Contents: write** on `lotus`, which is broader than the
**Issues: write** a direct call would need. If you prefer the tighter token, the Function
can create the issue itself instead (ask and it's a small change).

## Structure

```
lotus-seeds-feedback/
├── public/
│   ├── index.html            # feedback form (served at /)
│   ├── centres.html          # centre sign-up form (served at /centres)
│   └── annotator.js          # Fabric.js screenshot annotator (box/arrow/text/pen)
├── functions/
│   └── api/
│       ├── feedback.js       # Pages Function → POST /api/feedback
│       └── centre-signup.js  # Pages Function → POST /api/centre-signup
├── .gitignore
└── README.md
```

Cloudflare Pages serves `centres.html` at both `/centres` and `/centres.html`. Share the
clean `/centres` URL.

> This folder currently sits inside the `lotus` working tree. Move it out to its own
> location before `git init`, so it isn't tracked by the `lotus` repo, then push it to a
> new repo (e.g. `MetaProvide/lotus-seeds-feedback`).

## Deploy on Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - **Build output directory: `public`**
   - Pages auto-detects the `functions/` directory, no config needed.
4. **Settings → Variables and Secrets** on the Pages project:
   | Name | Type | Value |
   |------|------|-------|
   | `GITHUB_TOKEN` | Secret | fine-grained PAT with **Contents: Read and write** on **both** `lotus` and this repo |
   | `GITHUB_REPO` | Plaintext | `MetaProvide/lotus` (dispatch target) |
   | `ASSETS_REPO` | Plaintext | `MetaProvide/lotus-seeds-feedback` (public repo storing screenshots) |
   | `ASSETS_BRANCH` | Plaintext | `uploads` (branch for images; keep it off the Pages build branch) |
   | `TURNSTILE_SECRET` | Secret | Turnstile secret key (optional) |
   | `DISPATCH_EVENT_TYPE` | Plaintext | `seeds-feedback` (optional, this is the default) |
   | `SIGNUP_DISPATCH_EVENT_TYPE` | Plaintext | `centre-signup` (optional, this is the default) |

   The centre sign-up Function reuses `LOTUS_TOKEN`, `GITHUB_REPO` and
   `TURNSTILE_SECRET`. No new secrets are needed for it.
5. Redeploy so the variables apply. Your form is live at `https://<project>.pages.dev`
   (add a custom domain if you like). Because form and Function share an origin, there's
   no CORS to configure.

### GitHub token
GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
- Resource owner **MetaProvide**, Repository access **Only select repositories** →
  select **both** `lotus` and `lotus-seeds-feedback`
- Repository permissions → **Contents: Read and write**
  (needed to trigger `repository_dispatch` on `lotus` and to commit screenshots to this repo)

### Screenshots (image storage)
Users can attach and annotate a screenshot (box, arrow, text, pen). The Function commits
the flattened PNG to this repo and passes its raw URL to the issue. Two requirements:

- **This repo must be public.** The image is embedded in the private `lotus` issue via a
  `raw.githubusercontent.com` URL, which only renders without auth on a public repo.
  (The URL is unguessable but public — a screenshot may show centre data, so this is a
  conscious trade-off. If that's not acceptable, move image storage to Cloudflare R2 with
  signed URLs instead; ask and I'll switch it.)
- **Create the `uploads` branch** so images don't trigger a Pages rebuild on every submit:
  ```bash
  git checkout --orphan uploads
  git rm -rf . && git commit --allow-empty -m "init uploads branch"
  git push origin uploads
  git checkout main
  ```
  In the Cloudflare Pages project, set the **production branch to `main`** so only `main`
  builds. Images (max 6 MB) land under `uploads/YYYY/MM/`.

### Spam protection (recommended)
A honeypot field is built in. To add Cloudflare Turnstile: create a widget in the
Cloudflare dashboard, put the **site key** in `public/index.html` (`data-sitekey`), and the
**secret key** in `TURNSTILE_SECRET`. To skip it, remove the `<script>` and `.cf-turnstile`
div from the HTML and leave `TURNSTILE_SECRET` unset; the honeypot still runs.

## The GitHub Actions (live in the lotus repo)

Both workflows create issues with the built-in `GITHUB_TOKEN` (no extra secret on the
Action side) and add the issue to the Project board with `SEEDS_PROJECT_TOKEN`.

| Workflow | Dispatch type | Creates |
|----------|---------------|---------|
| `.github/workflows/seeds-feedback-issue.yml` | `seeds-feedback` | feedback issue |
| `.github/workflows/centre-signup-issue.yml` | `centre-signup` | centre lead issue with a triage checklist |

Create these labels in the repo so they get nice colours:
`seeds`, `request`, `enhancement`, `bug`, `centre-signup`, `lead`,
`centre-residential`, `centre-urban`, `centre-retreat`, `centre-online`.

Both workflows add the issue to the board directly, so the Projects **Auto-add** workflow
below is a belt-and-braces fallback rather than the primary path.

## Wire it to the roadmap board (the "Incoming" column)

Use GitHub Projects' built-in automation, no code:
1. Open the roadmap **Project**, add a status column **Incoming** (or **Triage**).
2. Project → **⋯ → Workflows**:
   - **Auto-add to project** → filter `is:issue label:seeds,centre-signup` on `MetaProvide/lotus`.
   - **Item added to project** → set **Status = Incoming**.

Centre leads are not product work. Either give them their own **Leads** column or filter
them out of the delivery view with `-label:centre-signup`.

## Centre sign-up form (`/centres`)

Light lead capture, deliberately short to keep completion high. Qualification happens on
the follow-up call, not in the form.

**Required:** centre type (residential / urban / retreat-only / online), centre name,
country, contact name, email, consent checkbox.
**Optional:** network or tradition, website, role, size band, needs (multi-select),
current tools, timeline, free-text notes.

The consent checkbox is enforced both in the browser and in the Function, since the form
collects personal data under GDPR. The Function also records the Cloudflare-reported
country (`source_country`) for spam triage, and drops any website URL that is not
`http(s)` so nothing odd renders as a link in the issue.

**To customise:**
- **Contact email in the thank-you panel** — change `lotus@metaprovide.org` in
  `public/centres.html` (appears twice: the done panel and the error copy).
- **Centre-type wording or a fifth type** — edit the `.types` radio block in the HTML,
  then add the key to `VALID_CENTRE_TYPES` in `centre-signup.js` **and** to `typeLabels`
  in the Action. All three must agree or the submission is rejected.
- **Needs checkboxes** — HTML only; the Function passes any values through (max 12).

## Local development

```bash
npm install -g wrangler
# put secrets in .dev.vars (gitignored): GITHUB_TOKEN=..., GITHUB_REPO=MetaProvide/lotus
wrangler pages dev public
```

## Notes
- `repository_dispatch` is fire-and-forget: a submitter always sees success. If the Action
  fails, it shows only in the repo's **Actions** tab, not to the user. Watch it after launch.
- Field → issue mapping (built in the Action): Type → `request`, `enhancement`, or `bug`
  label;
  Summary → title; Centre / Details / Why it matters / Name / Email → issue body.
- Centre sign-up issue title is `Centre sign-up: <name> (<country>)`, so the board is
  sortable and duplicates from the same centre are obvious.
- Turnstile uses the same site key on both pages. One widget covers both forms.
