/* core/presets/temas/index.mjs — o registro dos temas prontos.
 *
 * Import estático, um por arquivo: o Worker é empacotado pelo wrangler e não lê
 * pasta em tempo de execução. Tema novo = arquivo novo + uma linha aqui + o nome
 * no enum de tema.preset do config/site.schema.json (tests/tema.test.js cobra
 * que as três coisas andem juntas). */
import cinema from './cinema.mjs';
import claro from './claro.mjs';
import altoContraste from './alto-contraste.mjs';
import institucional from './institucional.mjs';
import vibrante from './vibrante.mjs';
import aconchegante from './aconchegante.mjs';

export const PRESETS = Object.freeze({
  cinema,
  claro,
  'alto-contraste': altoContraste,
  institucional,
  vibrante,
  aconchegante
});

export const PRESET_PADRAO = 'cinema';
export const NOMES_DOS_PRESETS = Object.freeze(Object.keys(PRESETS));
