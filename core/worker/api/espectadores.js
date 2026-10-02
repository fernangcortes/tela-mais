/* /api/espectadores — quem tem conta de espectador. Só o superadmin.
 *
 *   GET   ?antes=<criadoEm>        -> { espectadores[], diagnostico } (100 por página, do mais novo ao mais velho)
 *   PUT   { id, acao }             -> aprovar | bloquear | desbloquear | revogar-sessoes
 *   DELETE ?id=…                   -> apaga a conta e tudo o que é dela (como "excluir minha conta")
 *
 * `aprovar` libera quem ficou `pendente` (cadastro com aprovação manual): vira `ativo`, e a
 * pessoa entra pelo link mágico ou pela senha. `bloquear` derruba as sessões na hora. O
 * `diagnostico` diz o que falta para o modo de acesso funcionar (banco, Turnstile, e-mail)
 * e alimenta o aviso da tela Acesso. */
import { json, erro } from '../_lib/sessao.js';
import { usuarioPorId, mudarEspectador, listarEspectadores, excluirUsuario } from '../_lib/contas.js';
import { revogarTodas } from '../_lib/sessoes.js';
import { abrirBanco, prepararContas, lerCorpo, diagnosticoDeAcesso } from '../_lib/contas-fluxo.js';

export async function onRequestGet({ request, env, data, modo, config }) {
  const diagnostico = diagnosticoDeAcesso({ env, config, politica: data.politica, modo });
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) {
    /* Modo público ou sem banco: a tela ainda precisa do diagnóstico para explicar. */
    return json(200, { espectadores: [], diagnostico, indisponivel: true });
  }
  const antes = new URL(request.url).searchParams.get('antes');
  return json(200, { espectadores: await listarEspectadores(preparo.db, { antes }), diagnostico });
}

export async function onRequestPut({ request, env }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const { db } = aberto;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const u = typeof corpo.id === 'string' ? await usuarioPorId(db, corpo.id) : null;
  if (!u || u.papel !== 'espectador') return erro(404, 'espectador-nao-encontrado');

  switch (corpo.acao) {
    case 'aprovar':
      if (u.status === 'pendente') await mudarEspectador(db, u.id, { status: 'ativo' });
      break;
    case 'bloquear':
      await mudarEspectador(db, u.id, { status: 'bloqueado' });
      await revogarTodas(db, u.id);
      break;
    case 'desbloquear':
      if (u.status === 'bloqueado') await mudarEspectador(db, u.id, { status: 'ativo' });
      break;
    case 'revogar-sessoes':
      await revogarTodas(db, u.id);
      break;
    default:
      return erro(400, 'acao-invalida');
  }
  return json(200, { ok: true, espectador: await usuarioPorId(db, u.id).then((x) => x && { id: x.id, email: x.email, status: x.status }) });
}

export async function onRequestDelete({ request, env }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const id = new URL(request.url).searchParams.get('id') || '';
  const u = id ? await usuarioPorId(aberto.db, id) : null;
  if (!u || u.papel !== 'espectador') return erro(404, 'espectador-nao-encontrado');
  await excluirUsuario(aberto.db, u.id, u.email);
  return json(200, { ok: true });
}
