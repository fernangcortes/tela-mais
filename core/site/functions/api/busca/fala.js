/* GET /api/busca/fala — o que é falado nos vídeos NO AR, para a busca do site.
 *
 * Público, e só GET: o `_middleware.js` abre esta rota como abre o GET do
 * catálogo. O navegador pede isto na PRIMEIRA BUSCA — o foco no campo —, nunca
 * na chegada: são ~430 KB, cinco vezes o catálogo inteiro.
 *
 * O índice guarda todo vídeo que já foi lido, também o que está fora do ar. É
 * AQUI que o fora do ar sai, pelo catálogo da hora: o título tirado do ar some
 * da fala no mesmo instante, sem rodar script nenhum — é o caso do título com
 * direitos a verificar.
 *
 * Uma linha por vídeo, `<videoId>\t[[início, "texto"], …]`, em texto puro —
 * quem monta as linhas é o `POST /api/busca/indexar`, e quem as lê é o
 * `AppBusca.lerFala` do navegador.
 *
 * O CPU, MEDIDO NO AR EM 22/09 (fase 5), é o que desenhou esta rota. A
 * primeira versão lia a fala inteira (~500 KB) e o catálogo antes de tudo —
 * até para responder um 304 — e mediu 6, 13 e 16 ms, numa conta de 10 ms por
 * pedido no plano gratuito, que tolera estouro INFREQUENTE e corta quem estoura
 * sempre (erro 1102). E esta rota é pública: toda visita que busca passa
 * aqui. Agora:
 *
 *   - o ETAG sai do manifesto, que é pequeno: a rev do catálogo mais a
 *     VERSÃO DA FALA, que só anda quando a fala muda (uma sinopse revisada
 *     não faz ninguém baixar a fala de novo). O 304 volta antes de a fala ser
 *     lida;
 *   - a resposta montada vai para o CACHE API, com a rev e a versão na chave:
 *     no dia a dia, a rota devolve a fala guardada, sem decodificar, cortar e
 *     juntar 500 KB de texto. A chave muda com o catálogo, então o título que
 *     sai do ar some da resposta guardada no mesmo instante.
 */
import { json } from '../_middleware.js';
import AppIndice from '../../../indice-core.js';

export async function onRequestGet({ env, request, waitUntil }) {
  if (!env.CATALOGO) return json(500, { erro: 'namespace KV CATALOGO não vinculado ao projeto' });

  const [catalogo, estado] = await Promise.all([
    env.CATALOGO.get('catalogo', 'json'),
    env.CATALOGO.get(AppIndice.CHAVES.estado, 'json')
  ]);
  const rev = (catalogo && catalogo.rev) || 0;
  const versao = (estado && (estado.versaoDaFala || estado.versao)) || 0;
  const etag = 'W/"' + rev + '-' + versao + '"';
  const cabecalhos = {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    etag
  };

  const pedida = request.headers.get('if-none-match') || '';
  if (pedida.split(',').map(s => s.trim()).indexOf(etag) >= 0) {
    return new Response(null, { status: 304, headers: cabecalhos });
  }

  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const chave = new Request(new URL('/api/busca/fala/cache?rev=' + rev + '&v=' + versao, request.url).toString());
  if (cache) {
    const guardada = await cache.match(chave);
    if (guardada) return new Response(guardada.body, { status: 200, headers: cabecalhos });
  }

  const fala = await env.CATALOGO.get(AppIndice.CHAVES.fala, 'text');
  const corpo = AppIndice.linhasNoAr(fala || '', AppIndice.videosNoAr(catalogo));
  if (cache) {
    const guardar = cache.put(chave, new Response(corpo, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' }
    }));
    if (typeof waitUntil === 'function') waitUntil(guardar); else await guardar;
  }
  return new Response(corpo, { status: 200, headers: cabecalhos });
}
