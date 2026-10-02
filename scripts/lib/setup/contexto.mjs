/* scripts/lib/setup/contexto.mjs — o "ambiente" que os comandos recebem. Tudo que toca o mundo de fora entra aqui,
 * para os testes trocarem por falsos (wrangler simulado, fetch falso, perguntas respondidas) sem rede e sem terminal.
 *
 *   ctx = { raiz, env, exec, fetch, perguntar, interativo, flags, rel, aplicarConfig, lerStdin, agora }
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarPerguntador, lerStdinInteiro } from './entrada.mjs';

export const RAIZ_DO_PROJETO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Executor real: sem shell (nada de injeção por nome de arquivo), saída capturada, tempo máximo. No Windows o
 * `npx` é um .cmd e precisa do shell; os argumentos que passamos não vêm de texto digitado pela pessoa. */
export function executorReal({ env = process.env } = {}) {
  return (comando, args = [], { cwd, input, env: envExtra, timeoutMs = 600000 } = {}) => new Promise((resolve) => {
    let filho;
    try {
      filho = spawn(comando, args, { cwd, env: { ...env, ...(envExtra || {}) }, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ codigo: 127, saida: '', erro: String(e.message) }); }
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => { try { filho.kill(); } catch { /* já saiu */ } }, timeoutMs);
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { erro += d; });
    filho.on('error', (e) => { clearTimeout(relogio); resolve({ codigo: 127, saida, erro: erro + String(e.message) }); });
    filho.on('close', (codigo) => { clearTimeout(relogio); resolve({ codigo: codigo ?? 1, saida, erro }); });
    if (input !== undefined) filho.stdin.end(input); else filho.stdin.end();
  });
}

export async function criarContextoReal(extra = {}) {
  const { aplicarConfig } = await import('../../aplicar-config.mjs');
  const perguntar = criarPerguntador();
  return {
    raiz: RAIZ_DO_PROJETO,
    env: process.env,
    exec: executorReal(),
    fetch: globalThis.fetch,
    perguntar,
    interativo: perguntar.interativo,
    aplicarConfig,
    lerStdin: () => lerStdinInteiro(),
    agora: () => new Date(),
    ...extra
  };
}
