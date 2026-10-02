/* functions/api/_middleware.js — roda antes de toda função em /api/*.
 *
 * Faz três coisas:
 *   1. descobre DE QUEM é a requisição (`data.conta`) e o que essa conta pode;
 *   2. barra o que não for público — o padrão é "exige conta", então uma
 *      função nova nasce protegida em vez de nascer aberta;
 *   3. entrega em `data.bunny` o acesso à API do Bunny, único lugar do projeto
 *      onde a AccessKey existe. Ela nunca é devolvida ao navegador.
 *
 * `_middleware.js` é o único nome de arquivo que o Pages trata como middleware
 * e não como rota — por isso os utilitários compartilhados moram aqui.
 *
 * CONTAS (M2, 16/09). O superadmin é a senha do ambiente (`ADMIN_PASSWORD`) e
 * pode tudo; ele cria as outras contas, que moram no KV com permissões
 * escolhidas uma a uma. A conferência de verdade é no servidor: o PUT do
 * catálogo compara o documento velho com o novo e recusa campo que a conta não
 * pode mudar.
 */
import App from '../../catalogo-core.js';

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

/* As leituras da busca que o público faz sem conta.
 * Só GET: a escrita do índice é o `POST /api/busca/indexar`, que exige conta
 * e permissão. Uma rota entra aqui por decisão, com teste — nunca por nascer
 * em `functions/api/busca/`. */
const ROTAS_DE_LEITURA_DA_BUSCA = ['/api/busca/fala', '/api/busca/sentido'];

export function json(status, corpo, extras) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }, extras || {})
  });
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
  return { usuario: 'superadmin', nome: 'Superadmin', super: true, permissoes: App.PERMISSOES.slice(), limiteEnvio: null };
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
 * cria o vídeo no Bunny na hora: fica um pedido aqui, esperando o superadmin
 * aprovar ou recusar (/api/autorizacoes). Nada é gasto no Bunny sem aprovação.
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

export async function emitirToken(env, conta) {
  const expira = agora() + VALIDADE_TOKEN_S;
  const versao = conta.super ? 0 : (conta.versao || 1);
  const assinatura = await assinarHmac(env.ADMIN_PASSWORD, ROTULO_TOKEN + conta.usuario + ':' + expira + ':' + versao);
  return {
    token: ['v2', conta.usuario, expira, versao, assinatura].join('.'),
    expira,
    usuario: conta.usuario,
    nome: conta.nome || conta.usuario,
    super: conta.super === true,
    permissoes: conta.super === true ? App.PERMISSOES.slice() : (conta.permissoes || [])
  };
}

/* O token de ANTES das contas (`expira.assinatura`) continua valendo, e vale
 * como superadmin: é o que mantém os scripts de carga e as sessões abertas
 * funcionando no dia da virada, sem ninguém entrar de novo. */
async function tokenLegado(token, senha) {
  const partes = token.split('.');
  const expira = Number(partes[0]);
  if (!Number.isFinite(expira) || expira < agora()) return false;
  return iguaisEmTempoConstante(partes[1], await assinarHmac(senha, ROTULO_TOKEN + expira));
}

async function contaDoToken(token, env) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length === 2) return (await tokenLegado(token, env.ADMIN_PASSWORD)) ? contaSuper() : null;
  if (partes.length !== 5 || partes[0] !== 'v2') return null;

  const [, usuario, expiraTexto, versaoTexto, assinatura] = partes;
  const expira = Number(expiraTexto);
  if (!Number.isFinite(expira) || expira < agora()) return null;
  const esperado = await assinarHmac(env.ADMIN_PASSWORD, ROTULO_TOKEN + usuario + ':' + expira + ':' + versaoTexto);
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
  return json(403, {
    erro: 'esta conta não tem a permissão “' + (App.ROTULO_PERMISSAO[permissao] || permissao) + '”',
    permissao
  });
}

/* --------------------------------------------------------------- o Bunny */

function criarClienteBunny(env) {
  const libraryId = String(env.BUNNY_LIBRARY_ID || '');
  const apiKey = String(env.BUNNY_API_KEY || '');
  const base = 'https://video.bunnycdn.com/library/' + libraryId;

  return {
    libraryId,
    configurado: Boolean(libraryId && apiKey),

    /* A AccessKey entra aqui e não sai daqui. */
    async chamar(caminho, init = {}) {
      return fetch(base + caminho, Object.assign({}, init, {
        headers: Object.assign({ AccessKey: apiKey, accept: 'application/json' }, init.headers || {})
      }));
    },

    /* Assinatura de uso único do upload TUS.
     * expire é UNIX em SEGUNDOS — milissegundos invalidam a assinatura. */
    async assinarUpload(videoId, expira) {
      return hex(await crypto.subtle.digest('SHA-256', enc.encode(libraryId + apiKey + expira + videoId)));
    }
  };
}

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const rota = new URL(request.url).pathname.replace(/\/+$/, '') || '/api';

  if (!env.ADMIN_PASSWORD) {
    return json(500, { erro: 'ADMIN_PASSWORD não configurada no ambiente do Pages' });
  }

  const cabecalho = request.headers.get('authorization') || '';
  const token = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : '';
  data.conta = await contaDoToken(token, env);
  data.admin = !!data.conta;
  data.bunny = criarClienteBunny(env);

  /* Aberto ao público interno: o login, a leitura do catálogo e as leituras
   * da busca. Todo o resto exige conta — inclusive rotas que
   * ainda nem existem, e o POST de /api/busca/indexar, que escreve. */
  const leituraDaBusca = ROTAS_DE_LEITURA_DA_BUSCA.indexOf(rota) >= 0 && request.method === 'GET';
  const publico = rota === '/api/login' ||
    (rota === '/api/catalogo' && request.method === 'GET') ||
    leituraDaBusca;

  if (!publico && !data.admin) {
    return json(401, { erro: 'não autorizado' });
  }

  const resposta = await next();
  const saida = new Response(resposta.body, resposta);
  /* Tudo sai com `no-store`, menos as leituras da busca que dizem o próprio
   * cache: o índice da fala tem `ETag` e `no-cache`, e é isso que devolve um
   * 304 sem corpo à visita que busca de novo. Um `no-store` por cima faria o
   * navegador baixar os ~430 KB a cada visita. */
  if (!(leituraDaBusca && resposta.headers.has('cache-control'))) {
    saida.headers.set('cache-control', 'no-store');
  }
  saida.headers.set('x-content-type-options', 'nosniff');
  saida.headers.set('referrer-policy', 'no-referrer');
  return saida;
}
