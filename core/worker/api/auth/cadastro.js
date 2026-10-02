/* POST /api/auth/cadastro  { email, nome?, senha?, aceite, versoes, turnstile }
 *
 * Cadastro ABERTO: só no modo `cadastro`. Protegido por três camadas, nesta ordem:
 *
 *   1. TURNSTILE OBRIGATÓRIO. Sem TURNSTILE_SECRET (e a chave pública TURNSTILE_SITE_KEY)
 *      no Worker, o cadastro não abre
 *      (503 `turnstile-nao-configurado`): cadastro aberto sem anti-robô vira spam em
 *      horas. Com o secret, o token é conferido no siteverify a cada pedido, e se o
 *      siteverify não responder o pedido é recusado (FALHA FECHADA, 503 `turnstile-indisponivel`).
 *      `acesso.cadastro.turnstile: false` NÃO desliga isto: vale só para o login.
 *   2. LIMITE de tentativas: 10 em 10 s por IP, 20 por hora por IP, 3 por hora por e-mail.
 *   3. CONSENTIMENTO: a caixa de aceite não vem marcada; o servidor só grava o cadastro
 *      se `aceite` for true e `versoes` forem as vigentes (política e termos).
 *
 * Métodos (`acesso.cadastro.metodo`):
 *   link-magico      sem senha. Exige adaptador de e-mail (senão não há como entregar o
 *                    link: 503 `cadastro-sem-email`). A conta nasce `convidado` e vira
 *                    `ativo` quando a pessoa confirma o link.
 *   email-e-senha    senha de no mínimo `acesso.senha.tamanhoMinimo`. Com adaptador e
 *                    `verificarEmail`, o cadastro NÃO pede senha: quem a define é o dono
 *                    do e-mail, na página do link (senão alguém cadastraria o e-mail
 *                    alheio com uma senha que só ele conhece). Sem adaptador ou sem
 *                    verificação, a senha vem aqui e a conta nasce `ativa`.
 * `aprovacaoManual` deixa a conta `pendente` até a equipe aprovar (tela Acesso).
 *
 * ANTI-ENUMERAÇÃO: o cadastro NUNCA abre sessão e responde `{ ok: true }` igual
 * para e-mail novo e e-mail que já tem conta. Para quem já tem conta (ativa), o que
 * sai é um link de entrada, como no login. */
import { json, erro, hashSenha, iteracoesDe } from '../../_lib/sessao.js';
import { normalizarEmail, dominioDe } from '../../_lib/contas-cripto.js';
import { garantirEspectador, criarLinkMagico } from '../../_lib/contas.js';
import { chaveDe, limitar, respostaDeLimite } from '../../_lib/limite.js';
import { ipDe } from '../../_lib/sessoes.js';
import { verificarTurnstile, turnstileConfigurado, chavePublicaDoTurnstile } from '../../_lib/turnstile.js';
import { emailDisponivel } from '../../_lib/email.js';
import {
  lerCorpo, emSegundoPlano, prepararContas, entregarLink, conferirAceite, gravarAceite, VALIDADE_LINK_S
} from '../../_lib/contas-fluxo.js';

export async function onRequestPost({ request, env, data, modo, config, waitUntil }) {
  if (modo !== 'cadastro') return erro(403, modo === 'publico' ? 'sem-contas' : 'cadastro-fechado');
  const preparo = await prepararContas(env, modo);
  if (preparo.falha) return preparo.falha;
  const { db } = preparo;
  const politica = data.politica;
  const comSenha = politica.metodo === 'email-e-senha';

  if (!turnstileConfigurado(env) || !chavePublicaDoTurnstile(env)) return erro(503, 'turnstile-nao-configurado');
  if (!comSenha && !emailDisponivel(config, env)) return erro(503, 'cadastro-sem-email');

  const ip = ipDe(request);
  for (const [escopo, max, janelaS] of [['cadastro', 10, 10], ['cadastro-hora', 20, 3600]]) {
    const r = await limitar(env, { chave: await chaveDe(env, escopo, ip), max, janelaS });
    if (!r.ok) return respostaDeLimite(r.tentarEmS);
  }

  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');

  const t = await verificarTurnstile(env, corpo.turnstile, ip);
  if (!t.ok) return t.motivo === 'indisponivel' ? erro(503, 'turnstile-indisponivel') : erro(400, 'turnstile-falhou');

  const email = normalizarEmail(corpo.email);
  if (!email) return erro(400, 'email-invalido');
  if (politica.dominiosPermitidos.length && politica.dominiosPermitidos.indexOf(dominioDe(email)) < 0) {
    return erro(403, 'dominio-nao-permitido');
  }
  const verificar = politica.verificarEmail && emailDisponivel(config, env);
  const pedeSenha = comSenha && !verificar;
  if (pedeSenha && (typeof corpo.senha !== 'string' || corpo.senha.length < politica.senhaMinima)) {
    return erro(400, 'senha-curta', { minimo: politica.senhaMinima });
  }

  const porEmail = await limitar(env, { chave: await chaveDe(env, 'cadastro-email', email), max: 3, janelaS: 3600 });
  if (!porEmail.ok) return respostaDeLimite(porEmail.tentarEmS);

  /* Aceite dos textos vigentes: confere ANTES de gravar qualquer coisa (conta nova). */
  const conferido = await conferirAceite(env, db, null, corpo);
  if (conferido.falha) return conferido.falha;

  /* O hash roda sempre (conta nova ou não): o tempo não diz se o e-mail já existia. */
  const registroDeSenha = pedeSenha ? await hashSenha(corpo.senha, iteracoesDe(env)) : null;

  const statusInicial = politica.aprovacaoManual ? 'pendente' : (verificar ? 'convidado' : 'ativo');
  const { usuario, criado } = await garantirEspectador(db, {
    email, nome: corpo.nome, status: statusInicial, senha: registroDeSenha, criadoPor: 'cadastro'
  });

  /* Tudo o que a conta NOVA grava a mais (aceite) e o link (conta nova ou já ativa) roda
   * FORA da resposta; conta que não recebe nada passa por um trabalho vazio no mesmo
   * lugar. Assim o tempo não diz se o e-mail já existia. */
  const mandaLink = criado ? statusInicial === 'convidado' : Boolean(usuario && usuario.status === 'ativo');
  await emSegundoPlano(waitUntil, !criado && !mandaLink ? async () => {} : async () => {
    if (criado) await gravarAceite(env, db, usuario.id, request, conferido);
    if (mandaLink) {
      /* Conta que já existia (ativa): sai um link de entrada, como no login. */
      const { token } = await criarLinkMagico(db, { email, validadeS: VALIDADE_LINK_S });
      await entregarLink({ env, request, config, tipo: 'link', email, token, minutos: VALIDADE_LINK_S / 60 });
    }
  });
  return json(200, { ok: true });
}
