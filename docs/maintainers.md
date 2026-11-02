# Maintainer notes

## Publishing measurements

1. Someone opens a PR that adds files to `data/inbox/` (any CSV: raw logger output, Excel exports,
   one file for a whole patrol, or one file per site). Clean files can also go straight to `data/clean/`.
2. Approve the PR checks (`pr-check`). `Check CSV` test-cleans the inbox files and shows what would come out.
3. Comment `/report` on the PR. The bot cleans the inbox files into `data/clean/`, checks them, writes the
   reports, moves the originals to `data/raw/`, and adds all of it to the same PR.
4. Read the bot's comment, then merge. The data and reports go live together.

How the bot reads inbox files:

- Site: a `site` column (P3, 3, 3번, or the site name), else the folder (`data/inbox/P3/`), the file name
  (`..._P3.csv`), or the `.json` file water_logger.py writes next to the CSV.
- Sessions: a new session starts after a 20-minute gap; each becomes one clean file.
- Cleaning: board flags, DS18B20 fault values (-127, 85), zero conductivity and impossible values are dropped;
  rows are sorted, duplicate times removed, and readings averaged per minute.
- Reading: UTF-8 or CP949, comma / semicolon / tab, decimal commas, Korean or English column names with units,
  ISO / `YYYY/MM/DD` / `오후 3:20` / Excel serial times, separate date and time columns, repeated headers.

For PRs from forks the bot cannot push, so it opens a copy of the PR with the results; merge that one.
To rebuild every report (for example after changing the criteria), run Actions → Generate reports with "Rebuild every report".

## Usage

Requires Node 22.18 or later (runs the TypeScript files directly; no install step).

**Clean inbox files locally** (same as the bot does):

```bash
node scripts/ingest.ts --check    # show what would happen
node scripts/ingest.ts            # write data/clean/ and move originals to data/raw/
```

**Check it** before opening a pull request:

```bash
node scripts/validate.ts data/clean
```

**Preview the site locally:**

```bash
node scripts/build.ts     # creates _site/
node scripts/serve.ts     # http://localhost:8080/
```

**Generate reports locally** (uses the template text unless an AI is configured):

```bash
node scripts/report.ts            # new CSVs only
node scripts/report.ts --all      # rebuild everything
```

## Setup on GitHub

One-time settings for the repository:

| Setting | Value |
|:--------|:------|
| Pages → Source | GitHub Actions |
| Actions → General → Workflow permissions | Read and write, and allow Actions to create pull requests |
| Environments → `pr-check` | Add the maintainers as **Required reviewers** (without this, PR checks run immediately) |
| Actions → General → Fork pull request workflows | Require approval for all external contributors |
| Collaborators | Invite other maintainers (they can merge and generate reports) |

Optional variables and secrets:

| Name | Kind | Purpose |
|:-----|:-----|:--------|
| `GITHUB_MODEL` | variable | Model for the report text (default `openai/gpt-4.1-mini`) |
| `AI_PROVIDER` + `GEMINI_API_KEY` | variable + secret | Use Gemini instead (`AI_PROVIDER=gemini`) |
| `MAINTAINER_ROLES` | variable | Who may generate reports (default `admin,maintain,write`; `admin` = owner only) |

## Permissions

| Who | Can do |
|:----|:-------|
| Anyone | Open issues and pull requests |
| Maintainers (owner + collaborators) | Approve PR checks, merge, generate reports, everything else |

Pull requests from non-maintainers that touch `reports/`, `scripts/`, `.github/` or `config/criteria.json` fail the protected-path check. To add a maintainer, invite them as a collaborator, add them to the `pr-check` reviewers, and add their username to `.github/CODEOWNERS`.

## Data Details

Clean CSV file names follow `date_site_start-time`, for example `2026-11-06_P1_1030.csv`.

| Column | Required | Meaning |
|:-------|:--------:|:--------|
| `time` | yes | Timestamp such as `2026-11-06T10:30:00`, ascending |
| `site` | yes | Site id (letters and digits), must match the file name |
| `temp_c` | yes | Water temperature, °C (DS18B20) |
| `turb_ntu` | yes | Turbidity, NTU (SEN0189) |
| `ec_uS_cm` | yes | Conductivity, µS/cm, compensated to 25 °C (SEN0244) |
| `tds_ppm` | no | EC × 0.5 |
| `level_mm` | no | Water level, mm (needs a calibration table) |
| `ph` | no | Empty until the pH sensor is connected and calibrated |
| `lat`, `lon` | no | GPS position |

| Limit | Value | Source |
|:------|:------|:-------|
| pH | 6.5 – 8.5 | Hardware improvement plan |
| Turbidity | ≤ 15 NTU | Hardware improvement plan |
| Others | Reference only | — |

A metric is **good** when no sample is out of limits, **warn** when under 10% are, and **bad** otherwise.

## Repository Layout

```
.github/workflows/   Check CSV, Check protected paths, Generate reports, Deploy site
config/              criteria, sites, live relay URL, site text, activities
data/clean/          submitted clean CSVs
reports/             reports written by the bot (merged = published)
samples/             raw + clean example, shown only while there are no real reports
scripts/             TypeScript: validate, report, clean-logger, build, serve
site/                the website (plain HTML, CSS, JS)
img/                 README screenshots
```

The live page expects a WebSocket relay (URL in `config/live.json`) that sends `{"type":"sensor",...}` and `{"type":"objects",...}` as text and JPEG frames as binary. Sensor keys and flag bits match `water_logger.ino`.

