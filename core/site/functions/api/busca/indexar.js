/* /api/busca/indexar — o ÚNICO caminho de escrita no índice da busca
 *. A mesa, no envio e depois do Publicar, e o script
 * `scripts/indice-busca.mjs` usam esta mesma rota.
 *
 *   GET                      -> o manifesto: por vídeo, o hash e os inícios de
 *                               cada conjunto. É por ele que o script pula o
 *                               que não mudou e a mesa vê quem ficou fora
 *   POST { videoId, … }      -> ver `AppIndice.validarPedido` no indice-core.js
 *
 * Exige conta, como toda rota nova (o middleware). Escrever pede a permissão
 * da legenda — `conteudo` ou `enviar` —, a mesma do `POST /api/midia`: quem
 * manda a legenda de um vídeo manda a fala dele para a busca.
 *
 * QUEM CONDENSA É QUEM CHAMA. Medido em 21/09: ler e condensar a legenda
 * rolante mais longa custa 5,3 ms nesta máquina, metade dos 10 ms que a função
 * tem no plano gratuito. A rota recebe os blocos prontos, e o que ela faz com
 * a fala é trocar UMA linha num texto de ~430 KB (0,5 ms, medido).
 *
 * As duas escritas do KV — a linha da fala e o manifesto — são chaves
 * diferentes, e cada chave aceita uma escrita por segundo: quem manda vários
 * vídeos espera um segundo entre um e o seguinte.
 */
import { json, pode, semPermissao } from '../_middleware.js';
import AppIndice from '../../../indice-core.js';

async function lerManifesto(env) {
  const guardado = await env.CATALOGO.get(AppIndice.CHAVES.estado, 'json');
  return guardado && typeof guardado === 'object' ? guardado : { versao: 0, videos: {} };
}

/* O Workers AI e o Vectorize estão ligados neste ambiente? Sem eles a busca
 * por sentido não existe aqui — o Preview, por exemplo —, e a rota diz isso
 * em vez de fingir que gravou vetor. */
function temSentido(env) {
  return Boolean(env.AI && env.VETORES);
}

export async function onRequestGet({ env }) {
  if (!env.CATALOGO) return json(500, { erro: 'namespace KV CATALOGO não vinculado ao projeto' });
  const manifesto = await lerManifesto(env);
  return json(200, {
    versao: manifesto.versao || 0,
    atualizado_em: manifesto.atualizado_em || null,
    videos: manifesto.videos || {},
    sentido: temSentido(env)
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!pode(data.conta, 'conteudo') && !pode(data.conta, 'enviar')) return semPermissao('conteudo');
  if (!env.CATALOGO) return json(500, { erro: 'namespace KV CATALOGO não vinculado ao projeto' });

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }
  const pedido = AppIndice.validarPedido(corpo);
  if (pedido.erro) return json(400, { erro: pedido.erro });

  /* OS VETORES (fase 4): até 10 textos por chamada viram vetor no `bge-m3` e
   * vão ao Vectorize por `upsert`. O id é determinístico — `f:<videoId>:
   * <início>` —, e reindexar sobrescreve em vez de duplicar. Em ambiente sem
   * o Workers AI e o Vectorize (o Preview), a rota recusa em vez de gravar a
   * fala e deixar o pedido achar que o sentido também foi.
   *
   * O CPU está aqui: o que custa é ler a resposta do modelo e montar o upsert
   * — 1.024 números por texto. O tamanho do lote é a alavanca, e a
   * medida da fase 5 está no registro de medições. */
  let vetores = 0;
  if (pedido.vetores.length) {
    if (!temSentido(env)) {
      return json(503, { erro: 'a busca por sentido não está ligada neste ambiente', sentido: false });
    }
    const valores = AppIndice.vetoresDaResposta(
      await env.AI.run(AppIndice.MODELO, { text: pedido.vetores.map((v) => v[2]) }), pedido.vetores.length);
    await env.VETORES.upsert(pedido.vetores.map((v, i) => ({
      id: AppIndice.idDoVetor(v[0], pedido.videoId, v[1]),
      values: valores[i],
      metadata: { videoId: pedido.videoId, tipo: v[0], inicio: v[1] }
    })));
    vetores = pedido.vetores.length;
  }

  let versao = null;
  let apagados = 0;
  if (pedido.fim) {
    const agora = new Date().toISOString();
    const { manifesto, apagar, falaMudou } = AppIndice.manifestoNovo(await lerManifesto(env), pedido, agora);

    /* O que sumiu do conjunto sai do índice: o bloco da legenda trocada, o
     * capítulo apagado, a sinopse que ficou vazia. Sem o sentido ligado não
     * há vetor a apagar. */
    if (apagar.length && temSentido(env)) {
      await env.VETORES.deleteByIds(apagar);
      apagados = apagar.length;
    }

    /* A fala primeiro, o manifesto depois: se a segunda escrita falhar, o
     * manifesto continua dizendo o hash VELHO, e a próxima rodada do script
     * refaz o vídeo — em vez de pular uma fala que não foi gravada.
     *
     * E SÓ SE ELA MUDOU. Reescrever os ~500 KB é a parte cara desta chamada —
     * medida no ar em 22/09, 8 a 17 ms de CPU com a fala reescrita —, e
     * reindexar a mesma legenda (o `--refazer`, o botão da mesa para quem só
     * perdeu os vetores) não tem o que mudar nela. */
    if (falaMudou) {
      const texto = (await env.CATALOGO.get(AppIndice.CHAVES.fala, 'text')) || '';
      await env.CATALOGO.put(AppIndice.CHAVES.fala, AppIndice.trocarLinha(texto, pedido.videoId, pedido.fala),
        { metadata: { versao: manifesto.versao } });
    }
    await env.CATALOGO.put(AppIndice.CHAVES.estado, JSON.stringify(manifesto));
    versao = manifesto.versao;
  }

  return json(200, { ok: true, videoId: pedido.videoId, versao, vetores, apagados, sentido: temSentido(env) });
}
