# Deploying to production (SFTP)
IMPORTANT, IT TAKES A LONG TIME, MAKE SURE TO LET IT RUN



The production server is **SFTP-only** — no shell access, so no `git pull`,
`npm`, or process restarts can be run remotely. Deployment = file upload.

Server: `bl_5630.d0752c29 @ 78.154.103.2:2022` (bot root is `/` of the account).

## One-time setup

```powershell
pip install paramiko
```

The stock `sftp`/`ssh` clients can't pass a password non-interactively, which
is why the deploy script uses Python + paramiko.

## Deploy

```powershell
python deploy.py
```

Credentials are read from `.env` (`SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`,
`SFTP_PASS`), which is git-ignored. Shell env vars take precedence if both
are set. `.env` is **never uploaded** by the script.

Then **restart the bot** via your hosting panel — uploads take effect only
after the process restarts.

## What the script does

- Uploads every file in the repo **except**:
  - `node_modules/`, `.git/`, `.cache/`, `__pycache__/`
  - `.env` (secrets live on the server only)
  - `src/data/*.json` — runtime data: `daily.json`, `twitch_streamers.json`,
    `daily_goals.json`, `ranked_daily_stats.json`, `twitch_live.json`,
    `paceman_whitelist.json`, etc. Production data is never overwritten.
    (`src/data/images/` and `src/data/rag/` content *is* deployed.)
  - `data/cache/`, `data/logs/`, `data/events/`, `*.zip`, `*.log`
- Deletes server files listed in `DELETE_ON_SERVER` (code removed in this
  version: old commands and the event-signup system).

## Keeping the list in sync

These runtime data files are also **git-ignored** (see `.gitignore`), so a
`git pull` on the server won't wipe them either. If you add a new runtime
JSON under `src/data/`, it's automatically skipped — no changes needed.
If you permanently remove a source file, add its path to `DELETE_ON_SERVER`
in `deploy.py` so it gets cleaned up on deploy.

## Gotchas discovered

- `exec_command`/shell channels are refused — SFTP subsystem only.
- Server had extra files not in the repo (`logCleanup.js`, `messageLogger.js`,
  `messageLog.js`, `messageDeleteLog.js`). They were left in place; decide
  separately whether to keep or delete them.
- Do not hardcode the password in `deploy.py` — it's a repo file.
