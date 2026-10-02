/* POST /api/upload-token   { titulo, tamanhoBytes?, duracaoEstimadaSeg? } -> cria o vídeo e devolve o plano de envio
 * POST /api/upload-token   { pedidoId }                    -> cria o vídeo de um pedido já aprovado
 * POST /api/upload-token   { videoId }                     -> só reassina (retomada)
 *
 * O arquivo de vídeo NÃO passa por aqui. Esta função devolve o PLANO DE UPLOAD
 * do adaptador (provedores/contrato.js, `PlanoDeUpload`): endpoint, cabeçalhos de
 * uso único e metadados; o navegador envia os bytes direto ao provedor (TUS). É
 * o que torna viável subir um arquivo de 3,9 GB sem esbarrar no limite de
 * tamanho de requisição das serverless, e é por isso que o navegador não
 * escreve endereço de provedor nenhum: o endpoint vem daqui.
 *
 * A criação do vídeo precisa acontecer aqui, e não no navegador: o provedor
 * só aceita criar com a chave de API, e a chave nunca sai do servidor.
 *
 * Resposta: o plano (`id`, `protocolo`, `modo`, `url`, `cabecalhos`, `metadados`,
 * `expiraEm`, `pedacoBytes`, `fonte`) mais `videoId` (o mesmo que `id`).
 *
 * LIMITE DE ENVIO (M2+, superadmin configura em /api/contas). Vale só para
 * vídeo NOVO — retomar (`videoId`) não cria vídeo, então não conta de novo:
 *   - `maxVideos`: confere o contador gravado na conta (registrarEnvio).
 *   - `maxDuracaoSeg`: confere contra a duração ESTIMADA que o navegador lê do
 *     arquivo local antes de enviar — o servidor só sabe a duração de verdade
 *     depois que o provedor termina de codificar, tarde demais para recusar aqui.
 *   - `autorizacaoManual`: em vez de criar o vídeo, grava um pedido em
 *     /api/autorizacoes e devolve 202; o navegador manda de novo com
 *     `pedidoId` depois que o superadmin aprova.
 */
import { equipeAchar } from '../_lib/contas.js';
import { json, erro, pode, semPermissao, registrarEnvio,
  lerAutorizacoes, gravarAutorizacoes, acharPedido, idPedido } from '../_lib/sessao.js';
import { respostaDeErro } from '../_lib/provedores/index.js';

const VALIDADE_S = 3600;   /* o plano vale 1 h; o adaptador devolve `expiraEm` em SEGUNDOS UNIX */

export async function onRequestPost({ request, env, data }) {
  /* Subir vídeo ocupa armazenamento pago no provedor: é permissão à parte (M2). */
  if (!pode(data.conta, 'enviar')) return semPermissao('enviar');

  const provedor = data.provedor;
  if (!provedor.configurado) {
    return erro(500, 'provedor-nao-configurado', { provedor: provedor.id, faltando: (provedor.faltando || []).join(', ') });
  }
  /* HLS genérico não recebe arquivo pela mesa: o cliente envia pelo painel do provedor dele. */
  if (!provedor.capacidades().envio) return erro(501, 'recurso-indisponivel');

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  let videoId = corpo && (corpo.videoId || corpo.id) ? String(corpo.videoId || corpo.id) : '';
  let plano = null;
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
        const minhaConta = await equipeAchar(env, data.conta.usuario);
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

    /* O tamanho do arquivo só serve a quem cria o upload já com o tamanho
     * (o TUS do Cloudflare Stream); os outros adaptadores o ignoram. */
    const tamanho = Number(corpo && corpo.tamanhoBytes);
    try {
      plano = await provedor.criarUpload({
        titulo, validadeSeg: VALIDADE_S, tipo: corpo && typeof corpo.tipo === 'string' ? corpo.tipo : undefined,
        tamanhoBytes: Number.isFinite(tamanho) && tamanho > 0 ? tamanho : undefined
      });
    } catch (e) {
      return respostaDeErro(erro, e);
    }
    videoId = plano.id;
    contaCriando = true;
  }

  if (pedidoAprovado) {
    const autorizacoes = await lerAutorizacoes(env);
    const pedidoGravado = acharPedido(autorizacoes, pedidoAprovado.id);
    if (pedidoGravado) { pedidoGravado.status = 'usado'; await gravarAutorizacoes(env, autorizacoes); }
  }
  if (contaCriando && data.conta.super !== true) await registrarEnvio(env, data.conta.usuario);

  if (!plano) {
    try {
      plano = await provedor.retomarUpload(videoId, { validadeSeg: VALIDADE_S });
    } catch (e) {
      return respostaDeErro(erro, e);
    }
  }

  return json(200, Object.assign({}, plano, { videoId: plano.id }));
}
