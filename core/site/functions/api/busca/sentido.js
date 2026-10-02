/* GET /api/busca/sentido?q= — a busca por SENTIDO: o que
 * fala do assunto sem usar a palavra.
 *
 * Público, e só GET, como a fala. O caminho: a pergunta vira vetor no
 * `bge-m3` do Workers AI; o Vectorize devolve os 50 mais próximos entre os
 * blocos da fala, os capítulos e as sinopses; sai só o que está NO AR e acima
 * do CORTE, como [{ videoId, tipo, inicio, nota }] — sem texto: o texto o
 * navegador já tem.
 *
 * O CORTE existe porque o sentido sempre acha alguém — até para "asdfgh". O
 * número está no `indice-core.js`, e a conta dele, no registro de medições.
 *
 * O CACHE: a mesma pergunta não passa duas vezes pelo modelo. A chave é a
 * pergunta e a versão do índice — um vídeo novo na busca muda a versão, e a
 * resposta velha deixa de ser usada. Guarda o que o Vectorize devolveu, antes
 * do filtro do "no ar": quem sai do ar some da resposta na hora, mesmo vinda
 * do cache. O Cache API funciona em Pages Functions, também no domínio padrão da hospedagem
 * (documentação da Cloudflare, conferida em 21/09); cada data center tem o
 * seu. A pergunta NÃO é registrada em lugar nenhum: o cache guarda a
 * resposta, não quem perguntou.
 *
 * QUANDO FALHA — o teto do mês do Vectorize, o modelo fora, a rede —, a
 * resposta chega VAZIA e com `indisponivel`, em 200, e a tela não mostra erro:
 * a busca literal é a mesma.
 *
 * `?cru=1` é a leitura de quem mede — a prova dos capítulos e a conta
 * do corte: sem o corte, sem o filtro do no ar, sem cache, com `tipo` e `k`.
 * Só com conta: ela mostra o que está fora do ar.
 */
import { json } from '../_middleware.js';
import AppIndice from '../../../indice-core.js';

const PROXIMOS = 50;

function responder(corpo, cache) {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      /* A resposta pode ficar 5 minutos no navegador de quem perguntou: a
       * mesma pergunta, na mesma visita, não volta ao servidor. */
      'cache-control': cache || 'private, max-age=300'
    }
  });
}

async function vetorDaPergunta(env, q) {
  return AppIndice.vetoresDaResposta(await env.AI.run(AppIndice.MODELO, { text: [q] }), 1)[0];
}

export async function onRequestGet({ request, env, data, waitUntil }) {
  const url = new URL(request.url);
  const q = AppIndice.consultaDoSentido(url.searchParams.get('q'));
  const cru = url.searchParams.get('cru') === '1';

  if (cru && !data.admin) return json(401, { erro: 'não autorizado' });
  if (!AppIndice.consultaValida(q)) return responder({ resultados: [] });
  if (!env.AI || !env.VETORES || !env.CATALOGO) return responder({ resultados: [], indisponivel: true });

  try {
    if (cru) {
      const tipo = url.searchParams.get('tipo');
      const k = Math.max(1, Math.min(PROXIMOS, Number(url.searchParams.get('k')) || PROXIMOS));
      const opcoes = { topK: k, returnMetadata: 'all' };
      if (tipo === 'f' || tipo === 'c' || tipo === 's') opcoes.filter = { tipo };
      const r = await env.VETORES.query(await vetorDaPergunta(env, q), opcoes);
      return responder({ brutos: AppIndice.brutosDoVectorize(r), corte: AppIndice.CORTE }, 'no-store');
    }

    const [catalogo, estado] = await Promise.all([
      env.CATALOGO.get('catalogo', 'json'),
      env.CATALOGO.get(AppIndice.CHAVES.estado, 'json')
    ]);
    const versao = (estado && estado.versao) || 0;
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const chave = new Request(new URL('/api/busca/sentido/cache?v=' + versao + '&q=' + encodeURIComponent(q), request.url).toString());

    let brutos = null;
    if (cache) {
      const guardada = await cache.match(chave);
      if (guardada) brutos = await guardada.json();
    }
    if (!brutos) {
      const r = await env.VETORES.query(await vetorDaPergunta(env, q), { topK: PROXIMOS, returnMetadata: 'all' });
      brutos = AppIndice.brutosDoVectorize(r);
      if (cache) {
        const guardar = cache.put(chave, new Response(JSON.stringify(brutos), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' }
        }));
        if (typeof waitUntil === 'function') waitUntil(guardar); else await guardar;
      }
    }

    return responder({ resultados: AppIndice.filtrarSentido(brutos, AppIndice.videosNoAr(catalogo), AppIndice.CORTE) });
  } catch (e) {
    return responder({ resultados: [], indisponivel: true });
  }
}
