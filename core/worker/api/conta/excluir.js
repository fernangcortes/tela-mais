/* POST /api/conta/excluir  { email }
 *
 * Exclui a conta de espectador de quem pediu: apaga `usuarios`, `sessoes`,
 * `convites`, `links_magicos` (e `consentimentos`, que sem a conta só sobrariam
 * órfãos), numa transação, e manda o navegador esquecer o cookie. Não tem volta.
 *
 * `email` precisa ser o da própria conta: a confirmação impede o clique sem querer (e
 * qualquer pedido forjado). Conta de equipe não se exclui por aqui (é do superadmin,
 * em /api/contas); o superadmin é a variável de ambiente. */
import { json, erro } from '../../_lib/sessao.js';
import { usuarioPorId, excluirUsuario } from '../../_lib/contas.js';
import { normalizarEmail } from '../../_lib/contas-cripto.js';
import { cookieApagado } from '../../_lib/sessoes.js';
import { abrirBanco, lerCorpo } from '../../_lib/contas-fluxo.js';

export async function onRequestPost({ request, env, data }) {
  if (data.sessao.papel !== 'espectador') return erro(403, 'conta-de-equipe');
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const { db } = aberto;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const u = await usuarioPorId(db, data.sessao.usuarioId);
  if (!u) return erro(404, 'espectador-nao-encontrado');
  if (normalizarEmail(corpo.email) !== u.email) return erro(400, 'confirmacao-invalida');
  await excluirUsuario(db, u.id, u.email);
  return json(200, { ok: true }, { 'set-cookie': cookieApagado() });
}
