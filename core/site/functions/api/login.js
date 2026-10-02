/* POST /api/login  { usuario?, senha }  ->  { token, expira, usuario, nome, super, permissoes }
 *
 * Sem `usuario`, é o SUPERADMIN: a senha do ambiente, como sempre foi. É o que
 * mantém os scripts de carga entrando do mesmo jeito (eles mandam só a senha).
 * Com `usuario`, é uma das contas criadas pelo superadmin, guardadas no KV.
 */
import { json, emitirToken, iguaisEmTempoConstante, lerContas, acharConta, conferirSenha, contaSuper } from './_middleware.js';

/* Atraso proposital: encarece a tentativa de adivinhar em série. A proteção de
 * verdade é o Cloudflare Access na frente do site (Task 5.2). */
function atraso() {
  return new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
}

export async function onRequestPost({ request, env }) {
  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  const senha = corpo && corpo.senha;
  if (typeof senha !== 'string' || !senha) {
    return json(400, { erro: 'informe a senha' });
  }
  const usuario = String((corpo && corpo.usuario) || '').trim().toLowerCase();

  if (!usuario || usuario === 'superadmin' || usuario === 'admin') {
    if (!iguaisEmTempoConstante(senha, env.ADMIN_PASSWORD)) {
      await atraso();
      return json(401, { erro: 'usuário ou senha incorretos' });
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
    return json(401, { erro: 'usuário ou senha incorretos' });
  }

  return json(200, await emitirToken(env, conta));
}
