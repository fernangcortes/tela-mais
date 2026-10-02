/* index.js — o Worker: roteador próprio, sem dependências.
 *
 *   fetch -> (estático? entrega) -> config/modo -> middleware (tabela) -> handler
 *
 * O wrangler.jsonc manda para cá só `/api/*` e `/` (`run_worker_first`); o
 * resto dos arquivos de core/site sai direto do Static Assets, sem custo de
 * Worker. Cabeçalhos de segurança vão em TODA resposta daqui e, para o que não
 * passa por aqui, em core/site/_headers.
 *
 * MODO DE ACESSO. `obterConfig(env)` (config.js) já devolve a config mesclada
 * e validada. Se ela lançar, ou vier sem `acesso.modo` válido, o modo é
 * `privado`: falha fechada. Quem tem sessão nesses modos: a equipe/admin (token
 * Bearer) e o espectador (cookie, D1): ver _lib/sessoes.js. */
import { obterConfig as obterConfigPadrao } from './_lib/config.js';
import { comCabecalhos } from './_lib/seguranca.js';
import { json, erro } from './_lib/sessao.js';
import { autorizar, normalizarCaminho } from './middleware.js';
import { handlerDe } from './rotas.js';
import { modoSeguro } from './permissoes.js';
import { origemConfiavel } from './_lib/sessoes.js';
import { onRequestGet as homeGet } from './home.js';
import { localizarResposta } from './_lib/mensagens.js';
import { limparExpirados } from './_lib/contas.js';

/* As páginas que desenham o desafio anti-robô: só elas levam a Cloudflare na CSP. */
const PAGINAS_COM_TURNSTILE = ['/entrar', '/entrar.html', '/cadastro', '/cadastro.html'];

async function modoDoAcesso(env, obterConfig) {
  try {
    const config = await obterConfig(env);
    return { modo: modoSeguro(config && config.acesso && config.acesso.modo), config };
  } catch (e) {
    return { modo: modoSeguro(null), config: null };
  }
}

export function criarWorker({ obterConfig = obterConfigPadrao } = {}) {
  async function responder(request, env, ctx, lugar) {
    const url = new URL(request.url);
    const caminho = normalizarCaminho(url.pathname);
    /* HEAD é um GET sem corpo: o handler não precisa saber. */
    const metodo = request.method === 'HEAD' ? 'GET' : request.method;
    const ehApi = caminho === '/api' || caminho.startsWith('/api/');

    if (!ehApi && caminho !== '/') {
      /* Chegou aqui sem ser rota do Worker (dev local, ou run_worker_first
       * mais largo): arquivo estático, sem tabela. */
      return env.ASSETS ? env.ASSETS.fetch(request) : erro(404, 'nao-encontrado');
    }

    /* CSRF de login: toda rota que muda estado em /api/auth/* (com cookie ou sem) só vale
     * vinda do próprio site. Sem isto, um form `text/plain` de outro site entregaria ao
     * navegador da vítima uma sessão do atacante (login CSRF). */
    if (caminho.startsWith('/api/auth/') && !origemConfiavel(request)) return erro(403, 'origem-invalida');

    const { modo, config } = await modoDoAcesso(env, obterConfig);
    lugar.config = config;
    const waitUntil = (p) => { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); };
    const decisao = await autorizar({ request, env, caminho, metodo, modo, config, waitUntil });
    if (!decisao.permitido) return decisao.resposta;

    const { data } = decisao;
    const contexto = { request, env, data, waitUntil, modo, config };

    if (caminho === '/') return homeGet(contexto);

    const handler = handlerDe(caminho, metodo);
    if (!handler) return erro(405, 'metodo-nao-permitido');
    const resposta = await handler(contexto);

    /* `no-store` em tudo, menos nas leituras da busca que dizem o próprio
     * cache (ETag + no-cache devolvem 304 sem corpo; um `no-store` por cima
     * faria baixar ~430 KB a cada visita). Fora do modo público, `private`
     * impede cache compartilhado do conteúdo. */
    const saida = new Response(resposta.body, resposta);
    const proprio = saida.headers.get('cache-control');
    const leituraDaBusca = caminho.startsWith('/api/busca/') && metodo === 'GET' && proprio;
    if (!leituraDaBusca) saida.headers.set('cache-control', 'no-store');
    else if (modo !== 'publico') saida.headers.set('cache-control', proprio + ', private');
    return saida;
  }

  return {
    /* O cron diário (wrangler.jsonc, `triggers.crons`): RETENÇÃO. Apaga sessões, links
     * mágicos, convites e contadores de tentativa vencidos. Sem D1, não há o que limpar. */
    async scheduled(event, env, ctx) {
      const limpeza = limparExpirados(env).catch((e) => {
        console.error('retenção falhou:', e && e.message); /* i18n-ignorar: log técnico, não vai à tela */
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(limpeza);
      else await limpeza;
    },

    async fetch(request, env, ctx) {
      const caminho = normalizarCaminho(new URL(request.url).pathname);
      const ehApi = caminho === '/api' || caminho.startsWith('/api/');
      const lugar = { config: null };
      let resposta;
      try {
        resposta = await responder(request, env, ctx, lugar);
      } catch (e) {
        console.error('erro não tratado:', e && e.message); /* i18n-ignorar: log técnico, não vai à tela */
        resposta = erro(500, 'erro-interno');
      }
      if (ehApi) resposta = await localizarResposta(resposta, request, lugar.config);
      return comCabecalhos(resposta, env, { api: ehApi, config: lugar.config, turnstile: PAGINAS_COM_TURNSTILE.indexOf(caminho) >= 0 });
    }
  };
}

export default criarWorker();
