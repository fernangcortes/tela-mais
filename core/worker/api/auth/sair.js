/* POST /api/auth/sair  { todas? }
 *
 * Encerra a sessão: apaga a linha do banco (o cookie vira lixo no pedido seguinte) e
 * manda o navegador esquecer o cookie. `{ todas: true }` derruba TODAS as sessões da
 * pessoa, de todos os aparelhos. Sempre responde 200: sair sem sessão é só um no-op,
 * e a rota não revela nada. Funciona em qualquer modo, e sem banco só limpa o cookie. */
import { json } from '../../_lib/sessao.js';
import { temBanco, garantirBanco } from '../../_lib/contas-banco.js';
import { revogarSessao, revogarTodas, cookieApagado } from '../../_lib/sessoes.js';
import { lerCorpo } from '../../_lib/contas-fluxo.js';

export async function onRequestPost({ request, env, data }) {
  const s = data.sessao;
  if (s && s.origem === 'cookie' && temBanco(env)) {
    try {
      const db = await garantirBanco(env);
      const corpo = await lerCorpo(request);
      if (corpo && corpo.todas === true) await revogarTodas(db, s.usuarioId);
      else await revogarSessao(db, s.sessaoHash);
    } catch (e) { /* banco fora: o cookie some do mesmo jeito */ }
  }
  return json(200, { ok: true }, { 'set-cookie': cookieApagado() });
}
