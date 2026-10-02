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
import { json, erro, lerAutorizacoes, gravarAutorizacoes, acharPedido } from '../_lib/sessao.js';

function soSuper(data) {
  return data.conta && data.conta.super === true ? null : erro(403, 'so-superadmin-pedidos');
}

export async function onRequestGet({ request, env, data }) {
  const id = new URL(request.url).searchParams.get('id');
  const dados = await lerAutorizacoes(env);

  if (id) {
    const pedido = acharPedido(dados, id);
    if (!pedido) return erro(404, 'pedido-nao-encontrado');
    if (data.conta.super !== true && data.conta.usuario !== pedido.usuario) {
      return erro(403, 'pedido-de-outra-conta');
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
    return erro(400, 'corpo-invalido');
  }

  const dados = await lerAutorizacoes(env);
  const pedido = acharPedido(dados, corpo && corpo.id);
  if (!pedido) return erro(404, 'pedido-nao-encontrado');
  if (pedido.status !== 'aguardando') return erro(409, 'pedido-ja-decidido');

  pedido.status = corpo.aprovado === true ? 'aprovado' : 'recusado';
  pedido.decidido_em = new Date().toISOString();
  pedido.decidido_por = data.conta.usuario;
  await gravarAutorizacoes(env, dados);
  return json(200, { ok: true, pedido });
}
