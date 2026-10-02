/* /api/convites — convites de acesso. Só o superadmin.
 *
 *   GET                           -> convites pendentes (sem o token: ele só existe uma vez, na criação)
 *   POST   { email, enviar? }     -> cria o espectador (se não existe) e um convite de 7 dias.
 *                                    Devolve o LINK COPIÁVEL: { link, expiraEm, enviado, motivo? }.
 *                                    `enviar` (padrão true) manda também por e-mail se houver
 *                                    adaptador; sem adaptador (`nenhum`, o padrão), o administrador
 *                                    copia o link e o manda por WhatsApp. Para quem já tem conta
 *                                    ativa, é um novo link de acesso.
 *   DELETE ?email=…               -> revoga os convites pendentes desse e-mail
 *
 * O token vai no FRAGMENTO do endereço (#t=...): não passa por servidor, log ou Referer, e
 * quem abre o link só vê a página de entrada; o gasto é um POST. Conta bloqueada não recebe
 * convite (desbloqueie antes). */
import { json, erro } from '../_lib/sessao.js';
import { normalizarEmail } from '../_lib/contas-cripto.js';
import { garantirEspectador, mudarEspectador, criarConvite, convitesPendentes, revogarConvites } from '../_lib/contas.js';
import { prepararContas, lerCorpo, entregarLink, VALIDADE_CONVITE_S } from '../_lib/contas-fluxo.js';
import { linkDeAcesso } from '../_lib/email.js';

export async function onRequestGet({ env, modo }) {
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  return json(200, { convites: await convitesPendentes(preparo.db) });
}

export async function onRequestPost({ request, env, data, modo, config, waitUntil }) {
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  const { db } = preparo;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const email = normalizarEmail(corpo.email);
  if (!email) return erro(400, 'email-invalido');

  const { usuario } = await garantirEspectador(db, { email, nome: corpo.nome, status: 'convidado', criadoPor: data.conta.usuario });
  if (!usuario || usuario.papel !== 'espectador') return erro(409, 'email-ja-e-da-equipe');
  if (usuario.status === 'bloqueado') return erro(409, 'espectador-bloqueado');
  if (usuario.status === 'pendente') await mudarEspectador(db, usuario.id, { status: 'convidado' });

  const { token, expiraEm } = await criarConvite(db, { email, validadeS: VALIDADE_CONVITE_S, criadoPor: data.conta.usuario });
  const enviar = corpo.enviar !== false;
  if (!enviar) return json(200, { ok: true, link: linkDeAcesso(env, request, token), expiraEm, enviado: false, motivo: null });
  const entrega = await entregarLink({
    env, request, config, waitUntil, tipo: 'convite', email, token,
    minutos: Math.round(VALIDADE_CONVITE_S / 60), esperar: true
  });
  return json(200, { ok: true, link: entrega.link, expiraEm, enviado: entrega.enviado, motivo: entrega.enviado ? null : entrega.motivo });
}

export async function onRequestDelete({ request, env, modo }) {
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  const email = normalizarEmail(new URL(request.url).searchParams.get('email'));
  if (!email) return erro(400, 'email-invalido');
  return json(200, { ok: true, revogados: await revogarConvites(preparo.db, email) });
}
