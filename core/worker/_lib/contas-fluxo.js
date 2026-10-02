/* _lib/contas-fluxo.js — o que as rotas de conta têm em comum.
 *
 * Cada rota de /api/auth/* e /api/conta/* é curta porque as decisões repetidas
 * moram aqui: "este site usa contas?", "o banco está de pé?", "o corpo é JSON?",
 * "a pessoa aceitou os textos vigentes?", "como entregar o link", "abrir sessão e
 * pôr o cookie". Nada aqui conhece HTTP além de `Response`. */
import { json, erro, hashSenha, iteracoesDe } from './sessao.js';
import { temBanco, garantirBanco } from './contas-banco.js';
import { hashDe } from './contas-cripto.js';
import {
  consentimentosDe, consentimentosPendentes, registrarConsentimento,
  tipoDoToken, espiarToken, consumirToken, usuarioPorEmail, mudarEspectador
} from './contas.js';
import { chaveDe, limitar, respostaDeLimite } from './limite.js';
import { versoesVigentes, TIPOS_LEGAIS } from './contas-legal.js';
import { criarSessao, cookieDeSessao, ipDe } from './sessoes.js';
import { adaptadorDe, emailDisponivel, enviarEmail, linkDeAcesso, montarMensagem } from './email.js';
import { turnstileConfigurado, chavePublicaDoTurnstile } from './turnstile.js';

export const VALIDADE_LINK_S = 15 * 60;
export const VALIDADE_CONVITE_S = 7 * 24 * 3600;

export async function lerCorpo(request) {
  try {
    const c = await request.json();
    return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
  } catch (e) {
    return null;
  }
}

/* O banco pronto, ou { falha } com a resposta de erro. */
export async function abrirBanco(env) {
  if (!temBanco(env)) return { falha: erro(503, 'banco-ausente') };
  try {
    return { db: await garantirBanco(env) };
  } catch (e) {
    return { falha: erro(503, 'banco-indisponivel') };
  }
}

/* Contas só existem nos modos `cadastro` e `privado`, e só com banco. */
export async function prepararContas(env, modo) {
  if (modo === 'publico') return { falha: erro(404, 'sem-contas') };
  return abrirBanco(env);
}

/* O Turnstile no LOGIN (link mágico, senha) liga quando o servidor tem o segredo E a
 * página tem a chave pública para desenhar o desafio (sem a chave, exigir o token
 * trancaria todo mundo do lado de fora; o limite de tentativas continua valendo). No
 * CADASTRO o desafio é obrigatório sempre: sem segredo ou sem chave, o cadastro não abre. */
export function turnstileDoLogin(env) {
  return turnstileConfigurado(env) && Boolean(chavePublicaDoTurnstile(env));
}

/* Diagnóstico para a tela Acesso do /admin e para a página de entrada. */
export function diagnosticoDeAcesso({ env, config, politica, modo }) {
  const email = emailDisponivel(config, env);
  const turnstile = turnstileConfigurado(env);
  const metodoSenha = politica.metodo === 'email-e-senha';
  let cadastroDisponivel = false;
  let motivo = null;
  if (modo === 'cadastro') {
    if (!temBanco(env)) motivo = 'banco-ausente';
    else if (!turnstile) motivo = 'turnstile-nao-configurado';
    else if (!chavePublicaDoTurnstile(env)) motivo = 'turnstile-sem-chave-publica';
    else if (!metodoSenha && !email) motivo = 'cadastro-sem-email';
    else cadastroDisponivel = true;
  }
  return {
    modo,
    banco: temBanco(env),
    email: { adaptador: adaptadorDe(config), disponivel: email },
    turnstile: { configurado: turnstile, chavePublica: Boolean(chavePublicaDoTurnstile(env)) },
    cadastro: { metodo: politica.metodo, disponivel: cadastroDisponivel, motivo, aprovacaoManual: politica.aprovacaoManual, verificarEmail: politica.verificarEmail },
    limiteDeTentativas: Boolean(env && env.LIMITE_ENTRADA) ? 'binding' : (temBanco(env) ? 'banco' : 'nenhum'),
    sessoesMaximas: politica.maximoDeSessoes
  };
}

/* ---------------------------------------------------------- consentimento */

/* A pessoa precisa aceitar os textos vigentes?
 *   { ok: true, pendentes: [], vigentes }   nada a aceitar
 *   { ok: true, pendentes: [...], vigentes, aceitar: true }  aceitou agora: grave com `gravarAceite`
 *   { falha }                               falta o aceite, ou o texto mudou desde a tela */
export async function conferirAceite(env, db, usuarioId, corpo) {
  const vigentes = await versoesVigentes(env);
  const aceitos = usuarioId ? await consentimentosDe(db, usuarioId) : [];
  const pendentes = consentimentosPendentes(aceitos, vigentes);
  if (!pendentes.length) return { ok: true, pendentes, vigentes };
  if (!corpo || corpo.aceite !== true) {
    return { falha: erro(409, 'consentimento-necessario', null, { pendentes, versoes: vigentes }) };
  }
  const versoes = corpo.versoes && typeof corpo.versoes === 'object' ? corpo.versoes : {};
  for (const tipo of pendentes) {
    if (versoes[tipo] !== vigentes[tipo]) return { falha: erro(409, 'termos-mudaram', null, { pendentes, versoes: vigentes }) };
  }
  return { ok: true, pendentes, vigentes, aceitar: true };
}

export async function gravarAceite(env, db, usuarioId, request, conferido) {
  if (!conferido.aceitar) return;
  const ipHash = await hashDe(env, ipDe(request));
  for (const tipo of conferido.pendentes) {
    if (TIPOS_LEGAIS.indexOf(tipo) >= 0) await registrarConsentimento(db, usuarioId, tipo, conferido.vigentes[tipo], ipHash);
  }
}

/* ------------------------------------------------------------------- envio */

/* Monta o endereço e, havendo adaptador de e-mail, manda (em segundo plano quando
 * o Worker permite). Devolve { link, enviado } — `enviado` só é conhecido quando
 * a entrega foi esperada (`esperar: true`, usado pelo admin). */
export async function entregarLink({ env, request, config, waitUntil, tipo, email, token, minutos, esperar = false }) {
  const link = linkDeAcesso(env, request, token);
  if (!emailDisponivel(config, env)) return { link, enviado: false, motivo: 'sem-email' };
  const { assunto, texto } = montarMensagem(tipo, { link, request, config, minutos });
  const envio = enviarEmail(env, config, { para: email, assunto, texto });
  if (esperar || typeof waitUntil !== 'function') {
    const r = await envio;
    return { link, enviado: r.enviado, motivo: r.motivo };
  }
  waitUntil(envio);
  return { link, enviado: true, motivo: null };
}

/* O que só existe para quem TEM conta (criar o link, gravar o aceite, entregar) roda
 * aqui, FORA do caminho da resposta, e a rota chama isto também quando não há conta
 * (com um trabalho vazio): o tempo da resposta não diz se o e-mail existe. Sem
 * `waitUntil` (dev, teste) o trabalho é esperado, e quem falha não derruba a resposta. */
export async function emSegundoPlano(waitUntil, trabalho) {
  const rodando = Promise.resolve().then(trabalho).catch(() => {});
  if (typeof waitUntil === 'function') { waitUntil(rodando); return; }
  await rodando;
}

/* ------------------------------------------------------------------ sessão */

export async function responderComSessao({ env, db, request, politica, usuarioId, extras }) {
  const sessao = await criarSessao(db, {
    usuarioId, horas: politica.horasEspectador, maximo: politica.maximoDeSessoes,
    ua: request.headers.get('user-agent') || ''
  });
  return json(200, Object.assign({ ok: true, papel: 'espectador' }, extras || {}), {
    'set-cookie': cookieDeSessao(sessao.token, { horas: politica.horasEspectador, sameSite: politica.sameSite })
  });
}

/* ------------------------------------------------- link mágico e convite */

/* O passo final dos dois fluxos (/api/auth/link e /api/auth/convite): gasta o
 * token (uso único, atômico), ativa a conta, grava o aceite e abre a sessão.
 *
 * ORDEM, para o link não queimar à toa: valida o token SEM gastá-lo, confere o
 * aceite e (no modo e-mail-e-senha, primeira ativação) a senha, e só então gasta.
 * Um clique de pré-visualizador não chega aqui: o link abre uma PÁGINA (GET, que não
 * gasta nada) e o gasto é este POST, com o botão da pessoa. */
export async function confirmarToken({ request, env, data, modo, tipoEsperado, config }) {
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  const { db } = preparo;
  const politica = data.politica;

  const ip = ipDe(request);
  const rajada = await limitar(env, { chave: await chaveDe(env, 'confirmar', ip), max: 10, janelaS: 10 });
  if (!rajada.ok) return respostaDeLimite(rajada.tentarEmS);

  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const token = typeof corpo.token === 'string' ? corpo.token : '';
  if (tipoDoToken(token) !== tipoEsperado) return erro(400, 'link-invalido');

  const visto = await espiarToken(db, token);
  const u = visto ? await usuarioPorEmail(db, visto.email) : null;
  if (!visto || !u || u.papel !== 'espectador' || (u.status !== 'ativo' && u.status !== 'convidado')) {
    return erro(400, 'link-invalido');
  }

  const conferido = await conferirAceite(env, db, u.id, corpo);
  if (conferido.falha) return conferido.falha;

  let registroDeSenha = null;
  if (u.status === 'convidado' && modo === 'cadastro' && politica.metodo === 'email-e-senha' && !u.temSenha) {
    if (typeof corpo.senha !== 'string' || !corpo.senha) return erro(409, 'senha-necessaria', { minimo: politica.senhaMinima }, { minimo: politica.senhaMinima });
    if (corpo.senha.length < politica.senhaMinima) return erro(400, 'senha-curta', { minimo: politica.senhaMinima });
    registroDeSenha = await hashSenha(corpo.senha, iteracoesDe(env));
  }

  const gasto = await consumirToken(db, token);
  if (!gasto || gasto.email !== visto.email) return erro(400, 'link-invalido');   /* alguém gastou no meio */

  if (u.status === 'convidado') await mudarEspectador(db, u.id, { status: 'ativo' });
  if (registroDeSenha) await mudarEspectador(db, u.id, { senha: registroDeSenha });
  await gravarAceite(env, db, u.id, request, conferido);
  return responderComSessao({ env, db, request, politica, usuarioId: u.id });
}
