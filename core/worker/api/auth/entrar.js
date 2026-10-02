/* POST /api/auth/entrar  { email, senha?, turnstile? }
 *
 * Duas formas de entrar, as duas sem dizer se o e-mail existe:
 *
 *   sem `senha`   pede o LINK MÁGICO: se o e-mail pode entrar, um link de uso único
 *                 (15 min) é preparado e, havendo adaptador de e-mail, enviado. A
 *                 resposta é `{ ok: true }` SEMPRE — existente, inexistente, bloqueado,
 *                 sem e-mail configurado: a mesma resposta (anti-enumeração). Sem
 *                 adaptador de e-mail, quem entrega o link é o administrador.
 *   com `senha`   só no modo `cadastro` com `metodo: "email-e-senha"`. Credencial errada
 *                 e conta inexistente são a mesma resposta, e custam o mesmo (hash de
 *                 mentira quando a conta não existe).
 *
 * Quem pode receber link: espectador ativo ou convidado; no modo `privado`, também
 * quem está em `acesso.privado.listaDeEmails` (vira convidado na hora). No modo `cadastro`
 * quem não tem conta passa por /api/auth/cadastro.
 *
 * FREIOS: 10 tentativas em 10 s por IP e 5 pedidos de link por 15 min por e-mail; a
 * senha errada bloqueia de forma progressiva (IP + e-mail) e, além disso, 50 falhas por hora
 * na MESMA conta (de qualquer IP) recusam a senha até a janela passar. Turnstile: se o servidor
 * tem TURNSTILE_SECRET e a chave pública (TURNSTILE_SITE_KEY), é exigido aqui também. */
import { json, erro, conferirSenha } from '../../_lib/sessao.js';
import { normalizarEmail } from '../../_lib/contas-cripto.js';
import { usuarioPorEmail, garantirEspectador, criarLinkMagico } from '../../_lib/contas.js';
import { chaveDe, limitar, bloqueioAtivo, contaSobrecarregada, registrarFalhaDaConta, falhar, limparFalhas, respostaDeLimite } from '../../_lib/limite.js';
import { ipDe } from '../../_lib/sessoes.js';
import { verificarTurnstile } from '../../_lib/turnstile.js';
import { lerCorpo, emSegundoPlano, prepararContas, entregarLink, responderComSessao, turnstileDoLogin, VALIDADE_LINK_S } from '../../_lib/contas-fluxo.js';

const TETO_POR_CONTA = { max: 50, janelaS: 3600 };

export async function onRequestPost({ request, env, data, modo, config, waitUntil }) {
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  const { db } = preparo;
  const politica = data.politica;

  const ip = ipDe(request);
  const rajada = await limitar(env, { chave: await chaveDe(env, 'entrar', ip), max: 10, janelaS: 10 });
  if (!rajada.ok) return respostaDeLimite(rajada.tentarEmS);

  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const email = normalizarEmail(corpo.email);
  if (!email) return erro(400, 'email-invalido');

  if (turnstileDoLogin(env)) {
    const t = await verificarTurnstile(env, corpo.turnstile, ip);
    if (!t.ok) return t.motivo === 'indisponivel' ? erro(503, 'turnstile-indisponivel') : erro(400, 'turnstile-falhou');
  }

  /* ---- senha (opcional, só no modo cadastro com método e-mail-e-senha) ---- */
  if (typeof corpo.senha === 'string' && corpo.senha) {
    if (!(modo === 'cadastro' && politica.metodo === 'email-e-senha')) return erro(401, 'credenciais-incorretas');
    const chaveFalhas = await chaveDe(env, 'entrar-falhas', ip + '|' + email);
    const bloqueio = await bloqueioAtivo(env, chaveFalhas);
    if (bloqueio.bloqueado) return respostaDeLimite(bloqueio.tentarEmS);
    /* Teto por CONTA, qualquer que seja o IP: 50 falhas por hora (conta existente ou não: a
     * resposta é a mesma). Acima disso a senha fica recusada até a janela passar; o link
     * mágico e o convite do admin seguem abertos para o dono. */
    const chaveConta = await chaveDe(env, 'entrar-falhas-conta', email);
    const sobrecarga = await contaSobrecarregada(env, chaveConta, TETO_POR_CONTA);
    if (sobrecarga.bloqueado) return respostaDeLimite(sobrecarga.tentarEmS);
    const u = await usuarioPorEmail(db, email);
    const confere = await conferirSenha(corpo.senha, u && u.senhaRegistro);   /* custa igual com ou sem conta */
    if (!u || !confere || u.status !== 'ativo') {
      await falhar(env, chaveFalhas);
      await registrarFalhaDaConta(env, chaveConta, TETO_POR_CONTA.janelaS);
      return erro(401, 'credenciais-incorretas');
    }
    await limparFalhas(env, chaveFalhas);
    return responderComSessao({ env, db, request, politica, usuarioId: u.id });
  }

  /* ---- link mágico ---- */
  const porEmail = await limitar(env, { chave: await chaveDe(env, 'link-email', email), max: 5, janelaS: 15 * 60 });
  if (!porEmail.ok) return respostaDeLimite(porEmail.tentarEmS);

  const u = await usuarioPorEmail(db, email);
  /* Quem está na lista do modo privado é criado como convidado DENTRO do trabalho em segundo
   * plano: uma escrita síncrona no D1 só para esse caso seria um oráculo de tempo da lista. */
  const daLista = !u && modo === 'privado' && politica.listaDeEmails.indexOf(email) >= 0;
  const recebe = daLista || Boolean(u && u.papel === 'espectador' && (u.status === 'ativo' || u.status === 'convidado'));
  /* Criar o link (escrita no D1) e entregar custam tempo: rodam FORA da resposta, e quem
   * não tem conta passa por um trabalho vazio no mesmo lugar (anti-enumeração por tempo). */
  await emSegundoPlano(waitUntil, !recebe ? async () => {} : async () => {
    if (daLista) await garantirEspectador(db, { email, status: 'convidado', criadoPor: 'lista-de-emails' });
    const { token } = await criarLinkMagico(db, { email, validadeS: VALIDADE_LINK_S });
    await entregarLink({ env, request, config, tipo: 'link', email, token, minutos: VALIDADE_LINK_S / 60 });
  });
  return json(200, { ok: true });
}
