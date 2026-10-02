/* POST /api/login  { usuario?, senha }  ->  { token, expira, usuario, nome, super, permissoes }
 *
 * Sem `usuario`, é o SUPERADMIN: a senha do ambiente, como sempre foi. É o que
 * mantém os scripts de carga entrando do mesmo jeito (eles mandam só a senha).
 * Com `usuario`, é uma das contas criadas pelo superadmin, guardadas no KV.
 */
import { json, erro, emitirToken, iguaisEmTempoConstante, lerContas, acharConta, conferirSenha, contaSuper, segredoDeSessao } from '../_lib/sessao.js';

/* Atraso proposital: encarece a tentativa de adivinhar em série. A proteção de
 * verdade é o Cloudflare Access na frente do site (Task 5.2). */
function atraso() {
  return new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
}

export async function onRequestPost({ request, env }) {
  /* Sem a chave de sessão não há como emitir token: falha fechada e avisa
   * quem instala, em vez de devolver um 500 misterioso depois de a senha
   * conferir. */
  if (!segredoDeSessao(env)) {
    return erro(503, 'session-secret-ausente');
  }
  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  const senha = corpo && corpo.senha;
  if (typeof senha !== 'string' || !senha) {
    return erro(400, 'informe-senha');
  }
  const usuario = String((corpo && corpo.usuario) || '').trim().toLowerCase();

  if (!usuario || usuario === 'superadmin' || usuario === 'admin') {
    /* Sem ADMIN_PASSWORD o superadmin não existe (e comparar com `undefined`
     * aceitaria a senha "undefined"). */
    if (!env.ADMIN_PASSWORD || !iguaisEmTempoConstante(senha, env.ADMIN_PASSWORD)) {
      await atraso();
      return erro(401, 'credenciais-incorretas');
    }
    return json(200, await emitirToken(env, contaSuper()));
  }

  const conta = acharConta(await lerContas(env), usuario);
  /* A conferência roda MESMO quando a conta não existe: sem isso, o tempo de
   * resposta diria quais usuários existem. E a mensagem é a mesma nos dois
   * casos, pelo mesmo motivo. */
  const senhaConfere = await conferirSenha(senha, conta && conta.senha);
  if (!conta || conta.ativa === false || !senhaConfere) {
    await atraso();
    return erro(401, 'credenciais-incorretas');
  }

  return json(200, await emitirToken(env, conta));
}
