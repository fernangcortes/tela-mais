/* POST /api/login  { usuario?, senha }  ->  { token, expira, usuario, nome, super, permissoes }
 *
 * Sem `usuario`, é o SUPERADMIN: a senha do ambiente, como sempre foi. É o que
 * mantém os scripts de carga entrando do mesmo jeito (eles mandam só a senha).
 * Com `usuario`, é uma das contas criadas pelo superadmin, guardadas no KV.
 */
import { json, erro, emitirToken, iguaisEmTempoConstante, conferirSenha, contaSuper, segredoDeSessao } from '../_lib/sessao.js';
import { equipeAchar, politicaDeAcesso } from '../_lib/contas.js';
import { chaveDe, limitar, bloqueioAtivo, falhar, limparFalhas, respostaDeLimite } from '../_lib/limite.js';
import { ipDe } from '../_lib/sessoes.js';

/* Atraso proposital: encarece a tentativa de adivinhar em série. A proteção de
 * verdade é o limite por IP (10 tentativas em 10 s) e o bloqueio progressivo por
 * IP + usuário (a partir da 5ª falha), ambos em _lib/limite.js — que só existem
 * com D1 ou com o binding de Rate Limiting. */
function atraso() {
  return new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
}

export async function onRequestPost({ request, env, config }) {
  /* Sem a chave de sessão não há como emitir token: falha fechada e avisa
   * quem instala, em vez de devolver um 500 misterioso depois de a senha
   * conferir. */
  if (!segredoDeSessao(env)) {
    return erro(503, 'session-secret-ausente');
  }
  const horas = politicaDeAcesso(config).horasEquipe;
  const ip = ipDe(request);
  const rajada = await limitar(env, { chave: await chaveDe(env, 'login', ip), max: 10, janelaS: 10 });
  if (!rajada.ok) return respostaDeLimite(rajada.tentarEmS);

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

  /* Falhas seguidas de ESTE IP contra ESTE usuário: bloqueio que cresce. A chave
   * mistura os dois para que errar a senha de outra pessoa não a tranque. */
  const chaveFalhas = await chaveDe(env, 'login-falhas', ip + '|' + (usuario || 'superadmin'));
  const bloqueio = await bloqueioAtivo(env, chaveFalhas);
  if (bloqueio.bloqueado) return respostaDeLimite(bloqueio.tentarEmS);

  if (!usuario || usuario === 'superadmin' || usuario === 'admin') {
    /* Sem ADMIN_PASSWORD o superadmin não existe (e comparar com `undefined`
     * aceitaria a senha "undefined"). */
    /* Instalação incompleta: diz o que falta (quem tenta entrar é quem instalou), sem contar como tentativa errada. */
    if (!env.ADMIN_PASSWORD) return erro(401, 'senha-admin-ausente');
    if (!iguaisEmTempoConstante(senha, env.ADMIN_PASSWORD)) {
      await falhar(env, chaveFalhas);
      await atraso();
      return erro(401, 'credenciais-incorretas');
    }
    await limparFalhas(env, chaveFalhas);
    return json(200, await emitirToken(env, contaSuper(), { horas }));
  }

  const conta = await equipeAchar(env, usuario);
  /* A conferência roda MESMO quando a conta não existe: sem isso, o tempo de
   * resposta diria quais usuários existem. E a mensagem é a mesma nos dois
   * casos, pelo mesmo motivo. */
  const senhaConfere = await conferirSenha(senha, conta && conta.senha);
  if (!conta || conta.ativa === false || !senhaConfere) {
    await falhar(env, chaveFalhas);
    await atraso();
    return erro(401, 'credenciais-incorretas');
  }

  await limparFalhas(env, chaveFalhas);
  return json(200, await emitirToken(env, conta, { horas }));
}
