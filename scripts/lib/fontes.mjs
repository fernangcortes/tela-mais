/* scripts/lib/fontes.mjs — leva os woff2 do cliente de config/fontes/ para core/site/fontes/.
 *
 * Por que copiar: o cliente edita `config/` (que sobrevive às atualizações do core),
 * mas o site só serve o que está em `core/site/`. E por que de arquivo e não de CDN:
 * fonte de terceiro entrega o IP de cada espectador a esse terceiro (LGPD) e exigiria
 * abrir a CSP; `font-src 'self'` basta com a fonte servida daqui.
 *
 * core/site/fontes/ é INTEIRAMENTE gerada: o que lá não for pedido pelo tema é
 * removido, para trocar de fonte não deixar resíduo da anterior.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { planejarFontes, PASTA_FONTES_SITE } from './config-gerar.mjs';

export const PASTA_FONTES_CONFIG = path.join('config', 'fontes');

/* Devolve { erros, binarios: Map('fontes/X.woff2' -> Buffer), obsoletos: ['fontes/Y.woff2'] }.
 * Os caminhos são relativos a core/site/. */
export async function prepararFontes({ raiz, config }) {
  const erros = [];
  const binarios = new Map();
  for (const f of planejarFontes(config)) {
    const destino = `${PASTA_FONTES_SITE}/${f.arquivo}`;
    if (binarios.has(destino)) continue;
    let dados;
    try {
      dados = await readFile(path.join(raiz, PASTA_FONTES_CONFIG, f.arquivo));
    } catch (e) {
      erros.push({ caminho: `tema.tipografia.${f.slot}.arquivos`, mensagem: `não encontrei config/fontes/${f.arquivo}. Coloque o arquivo woff2 nessa pasta (ou use origem "sistema").` });
      continue;
    }
    /* woff2 de verdade começa com "wOF2"; pegar um .ttf renomeado agora evita a fonte
     * "não carregar" sem explicação no navegador. */
    if (dados.length < 4 || dados.toString('latin1', 0, 4) !== 'wOF2') {
      erros.push({ caminho: `tema.tipografia.${f.slot}.arquivos`, mensagem: `config/fontes/${f.arquivo} não é um woff2 (o arquivo precisa começar com a assinatura wOF2). Converta a fonte para woff2.` });
      continue;
    }
    binarios.set(destino, dados);
  }

  const obsoletos = [];
  try {
    for (const nome of await readdir(path.join(raiz, 'core', 'site', PASTA_FONTES_SITE))) {
      const rel = `${PASTA_FONTES_SITE}/${nome}`;
      if (!binarios.has(rel)) obsoletos.push(rel);
    }
  } catch (e) { /* pasta ainda não existe: nada a limpar */ }
  return { erros, binarios, obsoletos };
}
