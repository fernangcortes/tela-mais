/* scripts/lib/smoke.mjs — as partes puras do teste de fumaça no navegador (scripts/smoke-navegador.mjs): onde achar o
 * Playwright, os argumentos do `wrangler dev`, e o que conta como ERRO DE CONSOLE. Testadas sem navegador
 * (tests/smoke-navegador.test.js). */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* O Playwright é opcional (o projeto não tem dependências): fica instalado globalmente, e o script o importa do
 * `npm root -g`. `PLAYWRIGHT_IMPORT` troca o caminho (CI, testes). Devolve a URL do módulo, ou null. */
export function caminhoDoPlaywright({ env = process.env, raizGlobal = null, existe = existsSync } = {}) {
  const candidatos = [];
  if (env.PLAYWRIGHT_IMPORT) candidatos.push(env.PLAYWRIGHT_IMPORT);
  let raiz = raizGlobal;
  if (raiz === null) { try { raiz = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { raiz = ''; } }
  if (raiz) candidatos.push(path.join(raiz, 'playwright', 'index.mjs'));
  const achado = candidatos.find((c) => existe(c));
  return achado ? pathToFileURL(achado).href : null;
}

/* wrangler dev LOCAL, em porta própria, com o armazenamento fora do projeto e segredos descartáveis só desta execução
 * (passados por --var, vivem na memória do processo local; não há .dev.vars nem arquivo com segredo). */
export function argumentosDoWrangler({ porta, persistirEm, senha, segredoDeSessao }) {
  return [
    '--yes', 'wrangler@4', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(porta), '--persist-to', persistirEm,
    '--var', `ADMIN_PASSWORD:${senha}`, '--var', `SESSION_SECRET:${segredoDeSessao}`,
    '--var', 'SENHA_ITERACOES:1000'
  ];
}

/* Um erro de console/rede importa? Importa o que sai do NOSSO site. Falha de carregar algo de fora (capa e vídeo do provedor,
 * que não existem num teste local, fontes, analytics) não é defeito do produto.
 *   - exceção não tratada na página (`pageerror`): sempre importa;
 *   - `console.error` / falha de requisição / resposta >= 400 do MESMO endereço: importa, salvo o que `ignorar` listar. */
export function importa({ tipo, url = '', texto = '', status = 0 }, origem, ignorar = []) {
  if (tipo === 'pageerror') return true;
  let mesma = false;
  try { mesma = new URL(url).origin === origem; } catch { mesma = !url; }
  if (url && !mesma) return false;
  if (tipo === 'resposta' && !(status >= 400)) return false;
  return !ignorar.some((r) => r.test(`${tipo} ${status} ${url} ${texto}`));
}

/* O que se espera que dê erro de propósito: o catálogo/privado ANTES do login (401) e o service worker no teste local. */
export const IGNORAR_PADRAO = Object.freeze([
  /resposta 401 \S*\/api\/(me|auth|sessao|quem|catalogo)/i,
  /favicon\.ico/i,
  /\/sw\.js/i
]);

export function resumirProblemas(problemas, max = 10) {
  const linhas = problemas.slice(0, max).map((p) => `  - [${p.tipo}${p.status ? ' ' + p.status : ''}] ${p.url ? p.url + ' ' : ''}${String(p.texto || '').slice(0, 200)}`);
  if (problemas.length > max) linhas.push(`  ... e mais ${problemas.length - max}`);
  return linhas.join('\n');
}
