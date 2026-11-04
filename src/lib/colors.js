const fs = require('fs');
const path = require('path');

// Caminho do arquivo de configuração de cores (editável; roleId é preenchido pelo /setup-cores)
const COLORS_PATH = path.join(__dirname, '..', '..', 'config', 'colors.json');

// Custom IDs centralizados (sem IDs hardcoded espalhados pelo código)
const IDS = {
  PANEL_BUTTON: 'cores:painel:abrir', // botão no painel permanente
  MODAL: 'cores:modal',               // modal de escolha
  SELECT: 'cores:select',             // select dentro do Label do modal
};

// Valor especial da opção "remover cor" no select
const REMOVE_VALUE = 'remover';

function loadColors() {
  try {
    const data = JSON.parse(fs.readFileSync(COLORS_PATH, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveColors(colors) {
  fs.writeFileSync(COLORS_PATH, JSON.stringify(colors, null, 2) + '\n', 'utf8');
}

// Retorna a cor configurada que o membro possui atualmente (ou null)
function currentColorOf(member, colors) {
  return colors.find(c => c.roleId && member.roles.cache.has(c.roleId)) || null;
}

function canUseColors(member) {
  const { additionalRoleIds } = require('../../config/colorAccess.json');
  return [process.env.BOOSTER_ROLE_ID, ...additionalRoleIds]
    .some(id => id && member.roles.cache.has(id));
}

module.exports = { COLORS_PATH, IDS, REMOVE_VALUE, loadColors, saveColors, currentColorOf, canUseColors };
