#!/usr/bin/env node
/* scripts/aplicar-config.mjs — gera os arquivos do site a partir do config/site.json.
 *
 *   node scripts/aplicar-config.mjs              grava os arquivos
 *   node scripts/aplicar-config.mjs --verificar  não grava; sai com 1 se algo estiver desatualizado
 *
 * Gera: core/site/theme.css, manifest.webmanifest, robots.txt, config.public.json
 * e o bloco entre <!-- config:inicio --> e <!-- config:fim --> de index.html e
 * admin.html. É IDEMPOTENTE: rodar duas vezes não muda nada (só reescreve o que
 * de fato difere), o que deixa o `git diff` limpo e a verificação possível.
 * Config inválida: não escreve NADA e sai com 1.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { carregarConfig, RAIZ_PADRAO } from './lib/config-carregar.mjs';
import { formatarErros } from '../core/worker/_lib/config-validar.mjs';
import {
  gerarThemeCss, gerarManifest, gerarRobots, gerarPublico, gerarBlocoHead, trocarBloco,
  MARCADOR_INICIO, MARCADOR_FIM
} from './lib/config-gerar.mjs';

async function lerOuNada(arquivo) {
  try { return await readFile(arquivo, 'utf8'); } catch (e) { return null; }
}

/* Devolve { ok, erros, alterados[] }. Com `verificar`, `alterados` lista o que estaria desatualizado. */
export async function aplicarConfig({ raiz = RAIZ_PADRAO, verificar = false } = {}) {
  const r = await carregarConfig({ raiz });
  if (!r.ok) return { ok: false, erros: r.erros, alterados: [] };
  const config = r.config;
  const site = path.join(raiz, 'core', 'site');

  const saidas = new Map([
    ['theme.css', gerarThemeCss(config)],
    ['manifest.webmanifest', gerarManifest(config)],
    ['robots.txt', gerarRobots(config)],
    ['config.public.json', gerarPublico(config)]
  ]);
  const erros = [];
  for (const [arquivo, pagina] of [['index.html', 'index'], ['admin.html', 'admin']]) {
    const atual = await lerOuNada(path.join(site, arquivo));
    if (atual === null) { erros.push({ caminho: `core/site/${arquivo}`, mensagem: 'arquivo não encontrado.' }); continue; }
    const novo = trocarBloco(atual, gerarBlocoHead(config, pagina));
    if (novo === null) {
      erros.push({ caminho: `core/site/${arquivo}`, mensagem: `faltam os marcadores ${MARCADOR_INICIO} e ${MARCADOR_FIM} no <head>.` });
      continue;
    }
    saidas.set(arquivo, novo);
  }
  if (erros.length) return { ok: false, erros, alterados: [] };

  const alterados = [];
  for (const [nome, conteudo] of saidas) {
    const destino = path.join(site, nome);
    if ((await lerOuNada(destino)) === conteudo) continue;
    alterados.push(`core/site/${nome}`);
    if (!verificar) {
      await mkdir(path.dirname(destino), { recursive: true });
      await writeFile(destino, conteudo, 'utf8');
    }
  }
  return { ok: true, erros: [], alterados };
}

export async function principal(argv = process.argv.slice(2), saida = console) {
  const verificar = argv.includes('--verificar');
  const r = await aplicarConfig({ verificar });
  if (!r.ok) {
    saida.error('Não apliquei a configuração porque há problemas:\n');
    saida.error(formatarErros(r.erros));
    return 1;
  }
  if (!r.alterados.length) { saida.log('Tudo em dia: nenhum arquivo precisou mudar.'); return 0; }
  if (verificar) {
    saida.error('Arquivos desatualizados em relação ao config/site.json:\n  - ' + r.alterados.join('\n  - '));
    saida.error('\nRode: node scripts/aplicar-config.mjs');
    return 1;
  }
  saida.log('Arquivos atualizados:\n  - ' + r.alterados.join('\n  - '));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal();
}
