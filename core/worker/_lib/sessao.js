/* _lib/sessao.js — de quem é a requisição e o que essa conta pode.
 *
 * Vinha do `_middleware.js` do Pages; no Worker o middleware é `middleware.js`
 * (política de acesso) e isto aqui ficou só com o que as rotas compartilham:
 * resposta JSON, contas no KV, senha (PBKDF2) e token de sessão. O provedor de
 * vídeo (e a chave de API dele) mora em provedores/, e nunca é devolvido ao
 * navegador.
 *
 * DOIS SEGREDOS, DE PROPÓSITO. `ADMIN_PASSWORD` é a senha que o superadmin
 * digita; `SESSION_SECRET` é a chave que assina os tokens de sessão. Antes a
 * senha também assinava o token, então trocar uma coisa mexia na outra e quem
 * vazasse o token válido podia tentar derivar a senha offline. Agora são
 * independentes: a senha só prova quem entra, a chave só prova que o token é
 * nosso. Sem `SESSION_SECRET` (ou com menos de 32 caracteres) NENHUMA sessão
 * é emitida nem aceita — falha fechada.
 *
 * CONTAS. O superadmin é a senha do ambiente e pode tudo; ele cria as outras
 * contas, que moram no KV com permissões escolhidas uma a uma. A conferência
 * de verdade é no servidor: o PUT do catálogo compara o documento velho com o
 * novo e recusa campo que a conta não pode mudar.
 */
import App from '../../site/catalogo-core.js';
import AppI18n from '../../site/i18n.js';

const ROTULO_TOKEN = 'tm-admin:';
const VALIDADE_TOKEN_S = 8 * 60 * 60;   /* 8 h: uma jornada de trabalho */
const CHAVE_ADMINS = 'admins';
const CHAVE_AUTORIZACOES = 'autorizacoes';

/* PBKDF2 custa CPU, e o plano gratuito da Cloudflare dá 10 ms por requisição
 * (conferido na documentação em 15/09). Medido aqui: 10 mil iterações custam
 * ~5 ms; 100 mil custam ~35 ms e estourariam o login.
 *
 * O número fica GRAVADO em cada conta (`senha.iter`): dá para subi-lo pela
 * variável SENHA_ITERACOES no dia em que o projeto for para o plano pago, sem
 * invalidar nenhuma senha já guardada. As senhas nascem sorteadas pela mesa,
 * com 16 caracteres — é isso que carrega a segurança aqui, não o número. */
const ITERACOES_PADRAO = 10000;

export function json(status, corpo, extras) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }, extras || {})
  });
}

/* Erro de API: { erro, codigo, mensagem, params?, ...extras }.
 *
 *   codigo    estável (kebab-case): é o que o front traduz, com a chave `api.<codigo>`
 *             do seu catálogo, usando `params` para os buracos da frase;
 *   mensagem  o texto já pronto, no idioma do pedido (o index.js a refaz a partir do
 *             Accept-Language; aqui ela nasce no idioma de referência);
 *   erro      o mesmo texto, mantido por compatibilidade com quem lia `erro` (scripts
 *             de carga, a mesa antiga). Não remova sem avisar os scripts.
 * `extras` carrega o resto do contrato de cada rota (motivo, permissao, rev_servidor...). */
export function erro(status, codigo, params, extras) {
  const mensagem = AppI18n.t('api.' + codigo, params || undefined);
  const corpo = { erro: mensagem, codigo, mensagem };
  if (params) corpo.params = params;
  return json(status, Object.assign(corpo, extras || {}));
}

const enc = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function deHex(texto) {
  const bytes = new Uint8Array(Math.floor(String(texto || '').length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(texto.substr(i * 2, 2), 16);
  return bytes;
}

/* Comparação sem vazar o ponto da divergência pelo tempo de execução. */
export function iguaisEmTempoConstante(a, b) {
  const A = enc.encode(String(a));
  const B = enc.encode(String(b));
  let diferenca = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diferenca |= (A[i] || 0) ^ (B[i] || 0);
  return diferenca === 0;
}

async function assinarHmac(segredo, mensagem) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', chave, enc.encode(mensagem)));
}

const agora = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ contas */

export function contaSuper() {
  return { usuario: 'superadmin', nome: 'Superadmin', /* i18n-ignorar: nome de conta (dado) */ super: true, permissoes: App.PERMISSOES.slice(), limiteEnvio: null };
}

export async function lerContas(env) {
  if (!env.CATALOGO) return { contas: [] };
  const guardado = await env.CATALOGO.get(CHAVE_ADMINS, 'json');
  return guardado && Array.isArray(guardado.contas) ? guardado : { contas: [] };
}

export async function gravarContas(env, dados) {
  await env.CATALOGO.put(CHAVE_ADMINS, JSON.stringify({ contas: dados.contas || [] }));
}

export function acharConta(dados, usuario) {
  const alvo = String(usuario || '').trim().toLowerCase();
  return ((dados && dados.contas) || []).find(c => c && c.usuario === alvo) || null;
}

/* Some cada vídeo criado com sucesso: é o que o limite de "máximo de vídeos"
 * (limiteEnvio, M2+) confere antes de deixar subir o próximo. */
export async function registrarEnvio(env, usuario) {
  const dados = await lerContas(env);
  const conta = acharConta(dados, usuario);
  if (!conta) return;
  conta.enviosContagem = (conta.enviosContagem || 0) + 1;
  await gravarContas(env, dados);
}

/* --------------------------------------------------- pedidos de autorização
 *
 * Quando `limiteEnvio.autorizacaoManual` está ligado numa conta, o envio não
 * cria o vídeo no provedor na hora: fica um pedido aqui, esperando o superadmin
 * aprovar ou recusar (/api/autorizacoes). Nada é gasto no provedor sem aprovação.
 */
export async function lerAutorizacoes(env) {
  if (!env.CATALOGO) return { pedidos: [] };
  const guardado = await env.CATALOGO.get(CHAVE_AUTORIZACOES, 'json');
  return guardado && Array.isArray(guardado.pedidos) ? guardado : { pedidos: [] };
}

export async function gravarAutorizacoes(env, dados) {
  await env.CATALOGO.put(CHAVE_AUTORIZACOES, JSON.stringify({ pedidos: dados.pedidos || [] }));
}

export function acharPedido(dados, id) {
  const alvo = String(id || '');
  return ((dados && dados.pedidos) || []).find(p => p && p.id === alvo) || null;
}

export function idPedido() {
  return hex(crypto.getRandomValues(new Uint8Array(12)));
}

export function iteracoesDe(env) {
  const n = Number(env && env.SENHA_ITERACOES);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : ITERACOES_PADRAO;
}

async function derivar(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' }, chave, 256));
}

export async function hashSenha(senha, iteracoes) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iter = iteracoes || ITERACOES_PADRAO;
  return { alg: 'PBKDF2-SHA256', iter, sal: hex(sal), hash: hex(await derivar(senha, sal, iter)) };
}

/* Conta que não existe custa o MESMO que conta que existe: sem isto, o tempo
 * de resposta diria quais usuários existem. */
export async function conferirSenha(senha, registro) {
  if (!registro || !registro.sal || !registro.hash) {
    await derivar(String(senha || ''), new Uint8Array(16), ITERACOES_PADRAO);
    return false;
  }
  const hash = await derivar(senha, deHex(registro.sal), registro.iter || ITERACOES_PADRAO);
  return iguaisEmTempoConstante(hex(hash), registro.hash);
}

/* ------------------------------------------------------------------ token */

/* A chave de assinatura das sessões. Curta demais conta como ausente. */
export function segredoDeSessao(env) {
  const s = env && env.SESSION_SECRET;
  return typeof s === 'string' && s.length >= 32 ? s : null;
}

export async function emitirToken(env, conta) {
  const segredo = segredoDeSessao(env);
  if (!segredo) throw new Error('SESSION_SECRET ausente ou curta demais');
  const expira = agora() + VALIDADE_TOKEN_S;
  const versao = conta.super ? 0 : (conta.versao || 1);
  const assinatura = await assinarHmac(segredo, ROTULO_TOKEN + conta.usuario + ':' + expira + ':' + versao);
  return {
    token: ['v2', conta.usuario, expira, versao, assinatura].join('.'),
    expira,
    usuario: conta.usuario,
    nome: conta.nome || conta.usuario,
    super: conta.super === true,
    permissoes: conta.super === true ? App.PERMISSOES.slice() : (conta.permissoes || [])
  };
}

export async function contaDoToken(token, env) {
  const segredo = segredoDeSessao(env);
  if (!segredo || !token || typeof token !== 'string') return null;
  const partes = token.split('.');
  /* O token do formato antigo (`expira.assinatura`, assinado com a senha do
   * admin) deixou de valer: era a mistura de segredos que esta mudança desfaz.
   * Quem o tinha entra de novo, uma vez. */
  if (partes.length !== 5 || partes[0] !== 'v2') return null;

  const [, usuario, expiraTexto, versaoTexto, assinatura] = partes;
  const expira = Number(expiraTexto);
  if (!Number.isFinite(expira) || expira < agora()) return null;
  const esperado = await assinarHmac(segredo, ROTULO_TOKEN + usuario + ':' + expira + ':' + versaoTexto);
  if (!iguaisEmTempoConstante(assinatura, esperado)) return null;

  if (usuario === 'superadmin') return contaSuper();

  /* A conta é lida a cada requisição (uma leitura de KV). Tirar uma permissão,
   * desativar a conta ou trocar a senha sobe a `versao` — e o token de antes
   * para de valer no pedido seguinte, não daqui a 8 horas. */
  const conta = acharConta(await lerContas(env), usuario);
  if (!conta || conta.ativa === false || String(conta.versao || 1) !== versaoTexto) return null;
  return {
    usuario: conta.usuario,
    nome: conta.nome || conta.usuario,
    super: false,
    permissoes: conta.permissoes || [],
    versao: conta.versao || 1,
    limiteEnvio: conta.limiteEnvio || null
  };
}

export function pode(conta, permissao) {
  return App.contaPode(conta, permissao);
}

/* Resposta única para "a sua conta não faz isso", para a mesa poder explicar. */
export function semPermissao(permissao) {
  return erro(403, 'sem-permissao', { permissao: App.ROTULO_PERMISSAO[permissao] || permissao }, { permissao });
}
