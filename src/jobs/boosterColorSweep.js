const logger = require('../lib/logger');
const { loadColors, canUseColors } = require('../lib/colors');

// Cargo de Nitro Booster — vem do .env
const BOOSTER_ROLE_ID = process.env.BOOSTER_ROLE_ID;
const { GUILD_ID } = process.env;

// Pequena pausa entre remoções para não bater em rate limit
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Job diário ~01:00 (horário de Brasília, UTC-3 → 04:00 UTC):
// remove os cargos de cor de quem não é mais Nitro Booster.
async function sweep(client) {
  if (!GUILD_ID || !BOOSTER_ROLE_ID) {
    logger.warn('boosterColorSweep: GUILD_ID ou BOOSTER_ROLE_ID não definidos; pulando.');
    return;
  }

  const colors = loadColors();
  const colorRoleIds = new Set(colors.filter(c => c.roleId).map(c => c.roleId));
  if (colorRoleIds.size === 0) return;

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) return logger.warn('boosterColorSweep: guild não encontrada.');

  // Busca todos os membros (necessário: roles só listam membros em cache)
  await guild.members.fetch();

  let removed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const memberColorRoles = member.roles.cache.filter(r => colorRoleIds.has(r.id));
    if (memberColorRoles.size === 0) continue;
    if (canUseColors(member)) continue; // ainda é booster

    try {
      await member.roles.remove(
        [...memberColorRoles.keys()],
        'Remoção automática: membro não é mais Nitro Booster'
      );
      removed++;
      await sleep(1200); // devagar, evita rate limit
    } catch (error) {
      logger.error(`boosterColorSweep: falha ao remover cor de ${member.user.tag}:`, error);
    }
  }

  logger.info(`boosterColorSweep: varredura concluída, ${removed} cor(es) removida(s).`);
}

// Milissegundos até o próximo 01:00 em Brasília (04:00 UTC)
function msUntilNextRun(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(4, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

module.exports = {
  async register({ register }) {
    register({
      name: 'boosterColorSweep',
      async start(client) {
        let timer = null;
        const tick = async () => {
          await sweep(client).catch(e => logger.error('boosterColorSweep run error:', e));
          timer = setTimeout(tick, msUntilNextRun());
        };
        timer = setTimeout(tick, msUntilNextRun());
        return async () => clearTimeout(timer);
      },
    });
  },
};
