/* scripts/lib/setup/estado.mjs — leituras do estado do projeto, com cache por execução (um comando consulta o
 * wrangler uma vez só, mesmo que várias checagens precisem da resposta). */
import path from 'node:path';
import { carregarConfig } from '../config-carregar.mjs';
import { lerArquivoEnv } from './segredos.mjs';
import { criarWrangler, lerWrangler, recursosDoWrangler } from './cloudflare.mjs';

export function criarEstado(ctx) {
  const cache = new Map();
  const uma = (chave, fn) => { if (!cache.has(chave)) cache.set(chave, Promise.resolve().then(fn)); return cache.get(chave); };
  const wr = criarWrangler(ctx);
  const estado = {
    wr,
    config: () => uma('config', () => carregarConfig({ raiz: ctx.raiz })),
    wrangler: () => uma('wrangler', async () => { const w = await lerWrangler(ctx.raiz); return { ...w, recursos: recursosDoWrangler(w.dados) }; }),
    quem: () => uma('quem', () => wr.quemSou()),
    segredosRemotos: () => uma('segredos', async () => {
      const q = await estado.quem();
      if (!q.logado) return { existeWorker: false, nomes: [], consultado: false };
      return { ...(await wr.listarSegredos()), consultado: true };
    }),
    /* Variáveis deste computador: .env (padrão) e ambiente (ganha), como os scripts de carga leem. */
    envLocal: () => uma('env', async () => {
      const doArquivo = await lerArquivoEnv(path.join(ctx.raiz, '.env'));
      const vars = await lerArquivoEnv(path.join(ctx.raiz, '.dev.vars'));
      const env = { ...vars, ...doArquivo };
      for (const [k, v] of Object.entries(ctx.env)) if (typeof v === 'string' && v !== '') env[k] = v;
      return env;
    }),
    limpar: () => cache.clear()
  };
  return estado;
}

export const URL_DO_ULTIMO_DEPLOY = (raiz) => path.join(raiz, '.wrangler', 'tela-mais-deploy.json');
