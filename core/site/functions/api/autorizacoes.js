/* /api/autorizacoes — pedidos de envio de vídeo à espera de autorização
 * manual do superadmin (limiteEnvio.autorizacaoManual, ver /api/contas).
 *
 *   GET  ?id=…                     -> o próprio pedido (dono do pedido ou superadmin)
 *   GET                            -> lista os pedidos aguardando (só superadmin)
 *   PUT  { id, aprovado }          -> aprova ou recusa (só superadmin)
 *
 * Quem cria o pedido é /api/upload-token, na hora do envio. Aprovar não sobe
 * o vídeo sozinho: só libera o próximo /api/upload-token com o mesmo pedidoId.
 */
import { json, lerAutorizacoes, gravarAutorizacoes, acharPedido } from './_middleware.js';

function soSuper(data) {
  return data.conta && data.conta.super === true ? null : json(403, { erro: 'só o superadmin decide pedidos de envio' });
}

export async function onRequestGet({ request, env, data }) {
  const id = new URL(request.url).searchParams.get('id');
  const dados = await lerAutorizacoes(env);

  if (id) {
    const pedido = acharPedido(dados, id);
    if (!pedido) return json(404, { erro: 'pedido não encontrado' });
    if (data.conta.super !== true && data.conta.usuario !== pedido.usuario) {
      return json(403, { erro: 'este pedido não é desta conta' });
    }
    return json(200, { pedido });
  }

  const barrado = soSuper(data);
  if (barrado) return barrado;
  return json(200, { pedidos: (dados.pedidos || []).filter(p => p.status === 'aguardando') });
}

export async function onRequestPut({ request, env, data }) {
  const barrado = soSuper(data);
  if (barrado) return barrado;

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  const dados = await lerAutorizacoes(env);
  const pedido = acharPedido(dados, corpo && corpo.id);
  if (!pedido) return json(404, { erro: 'pedido não encontrado' });
  if (pedido.status !== 'aguardando') return json(409, { erro: 'este pedido já foi decidido' });

  pedido.status = corpo.aprovado === true ? 'aprovado' : 'recusado';
  pedido.decidido_em = new Date().toISOString();
  pedido.decidido_por = data.conta.usuario;
  await gravarAutorizacoes(env, dados);
  return json(200, { ok: true, pedido });
}
