/* POST /api/upload-token   { titulo, duracaoEstimadaSeg? } -> cria o vídeo e assina
 * POST /api/upload-token   { pedidoId }                    -> cria o vídeo de um pedido já aprovado
 * POST /api/upload-token   { videoId }                     -> só reassina (retomada)
 *
 * O arquivo de vídeo NÃO passa por aqui. Esta função só devolve uma assinatura
 * de uso único; o navegador envia os bytes direto para o Bunny via TUS. É o que
 * torna viável subir um arquivo de 3,9 GB sem esbarrar no limite de tamanho de
 * requisição das serverless.
 *
 * A criação do vídeo precisa acontecer aqui, e não no navegador: só o endpoint
 * TUS tem CORS documentado para uso client-side.
 *
 * LIMITE DE ENVIO (M2+, superadmin configura em /api/contas). Vale só para
 * vídeo NOVO — retomar (`videoId`) não cria vídeo, então não conta de novo:
 *   - `maxVideos`: confere o contador gravado na conta (registrarEnvio).
 *   - `maxDuracaoSeg`: confere contra a duração ESTIMADA que o navegador lê do
 *     arquivo local antes de enviar — o servidor só sabe a duração de verdade
 *     depois que o Bunny termina de codificar, tarde demais para recusar aqui.
 *   - `autorizacaoManual`: em vez de criar o vídeo, grava um pedido em
 *     /api/autorizacoes e devolve 202; o navegador manda de novo com
 *     `pedidoId` depois que o superadmin aprova.
 */
import { json, erro, pode, semPermissao, lerContas, acharConta, registrarEnvio,
  lerAutorizacoes, gravarAutorizacoes, acharPedido, idPedido } from '../_lib/sessao.js';

const VALIDADE_S = 3600;   /* UNIX em SEGUNDOS. Milissegundos invalidam a assinatura. */

export async function onRequestPost({ request, env, data }) {
  /* Subir vídeo ocupa armazenamento pago no Bunny: é permissão à parte (M2). */
  if (!pode(data.conta, 'enviar')) return semPermissao('enviar');

  const bunny = data.bunny;
  if (!bunny.configurado) {
    return erro(500, 'provedor-nao-configurado');
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  let videoId = corpo && corpo.videoId ? String(corpo.videoId) : '';
  let pedidoAprovado = null;
  let contaCriando = false;

  if (!videoId) {
    let titulo = corpo && typeof corpo.titulo === 'string' ? corpo.titulo.trim() : '';
    const pedidoId = corpo && corpo.pedidoId ? String(corpo.pedidoId) : '';

    if (pedidoId) {
      const autorizacoes = await lerAutorizacoes(env);
      const pedido = acharPedido(autorizacoes, pedidoId);
      if (!pedido || pedido.usuario !== data.conta.usuario || pedido.status !== 'aprovado') {
        return erro(403, 'pedido-nao-aprovado', null, { motivo: 'pedido-invalido' });
      }
      titulo = pedido.titulo;
      pedidoAprovado = pedido;
    } else if (data.conta.super !== true && data.conta.limiteEnvio) {
      const limite = data.conta.limiteEnvio;

      if (limite.maxVideos != null) {
        const minhaConta = acharConta(await lerContas(env), data.conta.usuario);
        if ((minhaConta && minhaConta.enviosContagem || 0) >= limite.maxVideos) {
          return erro(403, 'limite-videos', null, { motivo: 'limite-videos' });
        }
      }

      const duracaoEstimada = Number(corpo && corpo.duracaoEstimadaSeg);
      if (limite.maxDuracaoSeg != null && Number.isFinite(duracaoEstimada) && duracaoEstimada > limite.maxDuracaoSeg) {
        return erro(403, 'limite-duracao', null, { motivo: 'limite-duracao' });
      }

      if (limite.autorizacaoManual === true) {
        if (!titulo) return erro(400, 'informe-titulo');
        const autorizacoes = await lerAutorizacoes(env);
        const pedido = {
          id: idPedido(),
          usuario: data.conta.usuario,
          titulo,
          duracaoEstimadaSeg: Number.isFinite(duracaoEstimada) ? duracaoEstimada : null,
          criado_em: new Date().toISOString(),
          status: 'aguardando'
        };
        autorizacoes.pedidos = (autorizacoes.pedidos || []).concat([pedido]);
        await gravarAutorizacoes(env, autorizacoes);
        return json(202, { aguardando: true, pedidoId: pedido.id });
      }
    }

    if (!titulo) return erro(400, 'informe-titulo');

    const criacao = await bunny.chamar('/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: titulo })
    });

    if (!criacao.ok) {
      const detalhe = await criacao.text();
      return erro(502, 'provedor-recusou-criacao', null, { status: criacao.status, detalhe });
    }

    const criado = await criacao.json();
    videoId = criado.guid;
    if (!videoId) return erro(502, 'provedor-sem-guid');
    contaCriando = true;
  }

  if (pedidoAprovado) {
    const autorizacoes = await lerAutorizacoes(env);
    const pedidoGravado = acharPedido(autorizacoes, pedidoAprovado.id);
    if (pedidoGravado) { pedidoGravado.status = 'usado'; await gravarAutorizacoes(env, autorizacoes); }
  }
  if (contaCriando && data.conta.super !== true) await registrarEnvio(env, data.conta.usuario);

  const expira = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const assinatura = await bunny.assinarUpload(videoId, expira);

  return json(200, {
    libraryId: bunny.libraryId,
    videoId,
    signature: assinatura,
    expire: expira
  });
}
