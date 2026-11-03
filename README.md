# MCSRdiscordBot

discord.js bot for the Brazilian Minecraft Speedrun (MCSR) community. Provides player profiles, ranked match notifications, daily questions, donation alerts, and ranked score comparisons.

## Requirements

- Node.js 18+
- A Discord bot token and application ID: https://discord.com/developers/applications

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the project root. See [Configuration](#configuration) for the full list.

3. Register slash commands to your test guild:
```bash
npm run register
```

4. Start the bot:
```bash
npm run dev   # auto-restarts with nodemon
# or
npm start     # plain node
```

## Project structure

```
src/
  commands/      # Slash commands; auto-loaded
  events/        # Discord.js event handlers; auto-loaded
  jobs/          # Background polling jobs
  lib/           # Shared helpers, caches, and API clients
  data/          # JSON state files
  .cache/        # Runtime caches (created automatically)
index.js
register-commands.js
```

## Commands

- `/compare <player_one> <player_two> [season]` — Ranked score comparison.
- `/daily` — Daily question with streak tracking.
- `/dailygoals` — View and manage daily quiz answer goals.
- `/setup-cores` — (admin) Cria os cargos de cor definidos em `config/colors.json` e salva os IDs de volta no arquivo.
- `/painel-cores` — (admin) Posta o painel permanente de escolha de cor no canal atual.

## Painel de cores (português)

Cada membro pode ter apenas **um** cargo de cor por vez. A lista de cores fica em `config/colors.json` (até 24 entradas: `key`, `name`, `hex`, `emoji`, `description`, `roleId`).

1. Edite `config/colors.json` com as cores desejadas (`roleId` começa `null`).
2. Rode `npm run register` para registrar os comandos.
3. Inicie o bot e use `/setup-cores` — ele cria os cargos e preenche os `roleId`s automaticamente.
4. Use `/painel-cores` no canal desejado — o botão abre um modal com as cores.

O bot precisa da permissão **Gerenciar Cargos** e seu cargo mais alto deve ficar **acima** dos cargos de cor.

O painel é exclusivo para **Nitro Boosters**: defina `BOOSTER_ROLE_ID` no `.env` e ative a intent **Server Members** no Developer Portal. Um job diário (~01:00, horário de Brasília) remove as cores de quem deixou de ser booster.

## Adding things

### New slash command

Drop a file into `src/commands/`. Export `{ data: SlashCommandBuilder, execute }`. Optionally export `autocomplete` for autocomplete interactions.

The loader skips files listed in `DISABLED_COMMAND_FILES` inside `src/lib/loader.js`.

### New event handler

Drop a file into `src/events/`. Export `{ name: Events.X, once?: boolean, execute(client, ...args) }`.

### New background job

Drop a file into `src/jobs/`. Export a `register({ register, client })` function that uses `register(jobObject)` and return a job object with `{ name, start(client) }`. Use `createIntervalJob` from `src/lib/jobs.js` for interval polling.

The loader skips files listed in `DISABLED_JOB_FILES` inside `src/lib/jobs.js`.

### New lib helper

Create a file in `src/lib/`. Use `module.exports` to expose functions. For persistent state, prefer `src/data/` via `src/lib/store.js`.

## Configuration

Environment variables used by the bot:

- `TOKEN` — Discord bot token.
- `CLIENT_ID` — Discord application ID.
- `GUILD_ID` — Test guild ID for command registration.
- `GOOGLE_RUNS_API_URL` — Google Apps Script endpoint for runners/rsg/ssg/earnings data.
- `PROFILE_FETCH_TIMEOUT_MS` — Timeout for profile/earnings cache fetches (default: 15000).
- `LIVEPIX_CLIENT_ID`, `LIVEPIX_CLIENT_SECRET` — For the livepix donation watcher.
- `LIVEPIX_CHANNEL_ID` — Channel ID where donation alerts are posted.
- `RANKED_CHANNEL_ID` — Channel ID where ranked match notifications are posted.
- Emoji overrides: `LOGO_EMOJI`, `TROPHY_EMOJI`, `RANKED_EMOJI`, `COIN_EMOJI`, `CLOCK_EMOJI`, `WIN_EMOJI`, `LOSE_EMOJI`, etc.

## Notes

- Commands are registered to the guild defined by `GUILD_ID` for instant availability.
- `src/lib/loader.js` skips files listed in `DISABLED_COMMAND_FILES` and `src/lib/jobs.js` skips `DISABLED_JOB_FILES`.
- `npm run register` only registers commands that are not disabled.
- Jobs and profile/earnings caches are loaded once at startup from `src/events/ready.js`.
