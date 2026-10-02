/* _lib/contas.js — as pessoas: equipe (admin) e espectadores, sobre o D1.
 *
 * DUAS FAMÍLIAS DE FUNÇÕES, UMA TABELA (`usuarios`):
 *
 *   equipe*       as contas que o superadmin cria (usuário + senha + permissões).
 *                 Formato de saída IGUAL ao que o KV guardava (`usuario`, `ativa`,
 *                 `enviosContagem`, `senha: {alg, iter, sal, hash}`...), para os
 *                 handlers de /api/login, /api/contas e /api/conta quase não
 *                 mudarem. Com D1, mora em `usuarios` (papel 'equipe', `login`).
 *                 Sem D1 (instalação antiga, testes), cai de volta para a chave
 *                 `admins` do KV: a equipe continua entrando, e só.
 *   espectador*   quem assiste nos modos `cadastro` e `privado`: e-mail, sem
 *                 senha por padrão, status ativo|convidado|pendente|bloqueado.
 *                 Só existe com D1: sem ele, nada daqui roda.
 *
 * O superadmin NÃO está aqui: ele é a variável de ambiente ADMIN_PASSWORD
 * (recuperação de acesso garantida mesmo com o banco vazio ou fora do ar).
 *
 * Toda função de espectador recebe o `db` já pronto (de `garantirBanco`). Tempo
 * é segundo Unix. Nada devolve hash de senha nem hash de token. */
import { garantirBanco, temBanco } from './contas-banco.js';
import { agoraS, idAleatorio, sha256Hex, sortearToken } from './contas-cripto.js';

const CHAVE_KV_EQUIPE = 'admins';

/* ------------------------------------------------------------ a política */

export const PADROES_DE_ACESSO = {
  metodo: 'link-magico',
  verificarEmail: true,
  aprovacaoManual: false,
  dominiosPermitidos: [],
  listaDeEmails: [],
  assinarMidia: true,
  validadeDaAssinaturaSeg: 3600,
  horasEspectador: 720,
  horasEquipe: 8,
  maximoDeSessoes: 5,
  senhaMinima: 12
};

const inteiro = (v, padrao, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : padrao);

/* O que a config diz sobre contas, com os padrões do schema para o que faltar
 * (a config pode vir só com `acesso.modo`, como nos testes, ou de emergência). */
export function politicaDeAcesso(config) {
  const a = (config && config.acesso) || {};
  const cad = a.cadastro || {};
  const pri = a.privado || {};
  const ses = a.sessao || {};
  const sen = a.senha || {};
  const lista = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
  return {
    modo: a.modo,
    metodo: cad.metodo === 'email-e-senha' ? 'email-e-senha' : PADROES_DE_ACESSO.metodo,
    verificarEmail: cad.verificarEmail !== false,
    aprovacaoManual: cad.aprovacaoManual === true,
    dominiosPermitidos: lista(cad.dominiosPermitidos),
    listaDeEmails: lista(pri.listaDeEmails),
    convitesPorEmail: pri.convitesPorEmail !== false,
    assinarMidia: pri.assinarMidia !== false,
    validadeDaAssinaturaSeg: inteiro(pri.validadeDaAssinaturaSeg, PADROES_DE_ACESSO.validadeDaAssinaturaSeg, 60, 86400),
    horasEspectador: inteiro(ses.horasEspectador, PADROES_DE_ACESSO.horasEspectador, 1, 8760),
    horasEquipe: inteiro(ses.horasEquipe, PADROES_DE_ACESSO.horasEquipe, 1, 168),
    maximoDeSessoes: inteiro(ses.maximoSimultaneas, PADROES_DE_ACESSO.maximoDeSessoes, 1, 50),
    sameSite: ses.cookie && ses.cookie.sameSite === 'Strict' ? 'Strict' : 'Lax',   /* i18n-ignorar: valor de cookie (dado) */
    senhaMinima: inteiro(sen.tamanhoMinimo, PADROES_DE_ACESSO.senhaMinima, 8, 128)
  };
}

/* ----------------------------------------------------------------- equipe */

const iso = (s) => (s ? new Date(s * 1000).toISOString() : undefined);
const lerJson = (texto, padrao) => {
  if (!texto) return padrao;
  try { return JSON.parse(texto); } catch (e) { return padrao; }
};

function linhaParaConta(l) {
  return {
    id: l.id,
    usuario: l.login,
    nome: l.nome || l.login,
    permissoes: lerJson(l.permissoes, []),
    ativa: l.status !== 'bloqueado',
    versao: l.versao || 1,
    limiteEnvio: lerJson(l.limite_envio, null),
    enviosContagem: l.envios || 0,
    senha: lerJson(l.senha, null),
    criada_em: iso(l.criado_em),
    criada_por: l.criado_por || undefined,
    alterada_em: iso(l.alterado_em)
  };
}

const COLUNAS_EQUIPE = 'id, login, nome, status, senha, permissoes, limite_envio, envios, versao, criado_em, criado_por, alterado_em';

async function kvLer(env) {
  if (!env.CATALOGO) return { contas: [] };
  const guardado = await env.CATALOGO.get(CHAVE_KV_EQUIPE, 'json');
  return guardado && Array.isArray(guardado.contas) ? guardado : { contas: [] };
}

async function kvGravar(env, dados) {
  await env.CATALOGO.put(CHAVE_KV_EQUIPE, JSON.stringify({ contas: dados.contas || [] }));
}

const normalizarUsuario = (u) => String(u || '').trim().toLowerCase();

export async function equipeListar(env) {
  const db = await garantirBanco(env);
  if (!db) return (await kvLer(env)).contas;
  const r = await db.prepare(`SELECT ${COLUNAS_EQUIPE} FROM usuarios WHERE papel = 'equipe' ORDER BY criado_em, login`).all();
  return (r.results || []).map(linhaParaConta);
}

/* UMA linha, pelo índice único de `login`: é o que cada requisição da equipe paga. */
export async function equipeAchar(env, usuario) {
  const alvo = normalizarUsuario(usuario);
  if (!alvo) return null;
  const db = await garantirBanco(env);
  if (!db) return ((await kvLer(env)).contas.find((c) => c && c.usuario === alvo)) || null;
  const l = await db.prepare(`SELECT ${COLUNAS_EQUIPE} FROM usuarios WHERE login = ?`).bind(alvo).first();
  return l ? linhaParaConta(l) : null;
}

/* Cria; devolve false se o usuário já existe (ninguém é sobrescrito sem querer). */
export async function equipeCriar(env, conta) {
  const db = await garantirBanco(env);
  if (!db) {
    const dados = await kvLer(env);
    if (dados.contas.some((c) => c.usuario === conta.usuario)) return false;
    dados.contas.push(conta);
    await kvGravar(env, dados);
    return true;
  }
  const t = Date.parse(conta.criada_em || '');
  const r = await db.prepare(
    'INSERT OR IGNORE INTO usuarios (id, login, nome, papel, status, senha, permissoes, limite_envio, envios, versao, criado_em, criado_por) ' +
    "VALUES (?, ?, ?, 'equipe', ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    idAleatorio(), conta.usuario, conta.nome || conta.usuario, conta.ativa === false ? 'bloqueado' : 'ativo',
    conta.senha ? JSON.stringify(conta.senha) : null, JSON.stringify(conta.permissoes || []),
    conta.limiteEnvio ? JSON.stringify(conta.limiteEnvio) : null, conta.enviosContagem || 0, conta.versao || 1,
    Number.isFinite(t) ? Math.floor(t / 1000) : agoraS(), conta.criada_por || null
  ).run();
  return Boolean(r.meta && r.meta.changes > 0);
}

/* Grava o estado inteiro de uma conta que já existe. */
export async function equipeSalvar(env, conta) {
  const db = await garantirBanco(env);
  if (!db) {
    const dados = await kvLer(env);
    const i = dados.contas.findIndex((c) => c.usuario === conta.usuario);
    if (i < 0) return false;
    dados.contas[i] = conta;
    await kvGravar(env, dados);
    return true;
  }
  const r = await db.prepare(
    "UPDATE usuarios SET nome = ?, status = ?, senha = ?, permissoes = ?, limite_envio = ?, envios = ?, versao = ?, alterado_em = ? WHERE login = ? AND papel = 'equipe'"
  ).bind(
    conta.nome || conta.usuario, conta.ativa === false ? 'bloqueado' : 'ativo',
    conta.senha ? JSON.stringify(conta.senha) : null, JSON.stringify(conta.permissoes || []),
    conta.limiteEnvio ? JSON.stringify(conta.limiteEnvio) : null, conta.enviosContagem || 0, conta.versao || 1,
    agoraS(), conta.usuario
  ).run();
  return Boolean(r.meta && r.meta.changes > 0);
}

export async function equipeApagar(env, usuario) {
  const alvo = normalizarUsuario(usuario);
  const db = await garantirBanco(env);
  if (!db) {
    const dados = await kvLer(env);
    const antes = dados.contas.length;
    dados.contas = dados.contas.filter((c) => c.usuario !== alvo);
    if (dados.contas.length === antes) return false;
    await kvGravar(env, dados);
    return true;
  }
  const l = await db.prepare("SELECT id FROM usuarios WHERE login = ? AND papel = 'equipe'").bind(alvo).first();
  if (!l) return false;
  await db.batch([
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(l.id),
    db.prepare('DELETE FROM consentimentos WHERE usuario_id = ?').bind(l.id),
    db.prepare('DELETE FROM usuarios WHERE id = ?').bind(l.id)
  ]);
  return true;
}

/* Soma um vídeo enviado ao contador da conta (limiteEnvio.maxVideos). */
export async function equipeContarEnvio(env, usuario) {
  const alvo = normalizarUsuario(usuario);
  const db = await garantirBanco(env);
  if (!db) {
    const dados = await kvLer(env);
    const conta = dados.contas.find((c) => c && c.usuario === alvo);
    if (!conta) return;
    conta.enviosContagem = (conta.enviosContagem || 0) + 1;
    await kvGravar(env, dados);
    return;
  }
  await db.prepare("UPDATE usuarios SET envios = envios + 1 WHERE login = ? AND papel = 'equipe'").bind(alvo).run();
}

/* ------------------------------------------------------------ espectadores */

const COLUNAS_ESPECTADOR = 'id, email, nome, papel, status, senha, criado_em, criado_por, alterado_em, ultimo_acesso';

function paraEspectador(l) {
  return l ? {
    id: l.id, email: l.email, nome: l.nome || '', papel: l.papel, status: l.status,
    temSenha: Boolean(l.senha), criadoEm: l.criado_em, criadoPor: l.criado_por || null,
    alteradoEm: l.alterado_em || null, ultimoAcesso: l.ultimo_acesso || null
  } : null;
}

export async function usuarioPorEmail(db, email) {
  const l = await db.prepare(`SELECT ${COLUNAS_ESPECTADOR} FROM usuarios WHERE email = ?`).bind(email).first();
  return l ? Object.assign(paraEspectador(l), { senhaRegistro: lerJson(l.senha, null) }) : null;
}

export async function usuarioPorId(db, id) {
  const l = await db.prepare(`SELECT ${COLUNAS_ESPECTADOR} FROM usuarios WHERE id = ?`).bind(id).first();
  return l ? Object.assign(paraEspectador(l), { senhaRegistro: lerJson(l.senha, null) }) : null;
}

/* Cria o espectador se o e-mail ainda não existe; devolve { usuario, criado }.
 * Nunca rebaixa nem reativa quem já existe. */
export async function garantirEspectador(db, { email, nome = '', status = 'ativo', senha = null, criadoPor = null }) {
  const id = idAleatorio();
  const r = await db.prepare(
    "INSERT OR IGNORE INTO usuarios (id, email, nome, papel, status, senha, criado_em, criado_por) VALUES (?, ?, ?, 'espectador', ?, ?, ?, ?)"
  ).bind(id, email, String(nome || '').slice(0, 80), status, senha ? JSON.stringify(senha) : null, agoraS(), criadoPor).run();
  const usuario = await usuarioPorEmail(db, email);
  return { usuario, criado: Boolean(r.meta && r.meta.changes > 0) };
}

export async function mudarEspectador(db, id, campos) {
  const sets = [];
  const valores = [];
  if (campos.status) { sets.push('status = ?'); valores.push(campos.status); }
  if (campos.nome != null) { sets.push('nome = ?'); valores.push(String(campos.nome).slice(0, 80)); }
  if (campos.senha !== undefined) { sets.push('senha = ?'); valores.push(campos.senha ? JSON.stringify(campos.senha) : null); }
  if (campos.ultimoAcesso) { sets.push('ultimo_acesso = ?'); valores.push(campos.ultimoAcesso); }
  if (!sets.length) return false;
  sets.push('alterado_em = ?');
  valores.push(agoraS());
  const r = await db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ? AND papel = 'espectador'`).bind(...valores, id).run();
  return Boolean(r.meta && r.meta.changes > 0);
}

/* Do mais novo para o mais velho; `antes` é o `criadoEm` da última linha da
 * página anterior. O índice (papel, criado_em) faz a consulta ler só a página. */
export async function listarEspectadores(db, { limite = 100, antes = null } = {}) {
  const n = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const filtro = antes ? 'AND criado_em < ?' : '';
  const stmt = db.prepare(
    `SELECT ${COLUNAS_ESPECTADOR} FROM usuarios WHERE papel = 'espectador' ${filtro} ORDER BY criado_em DESC LIMIT ?`
  );
  const r = await (antes ? stmt.bind(Number(antes), n) : stmt.bind(n)).all();
  return (r.results || []).map(paraEspectador);
}

/* ---------------------------------------------------- convites e links */

/* Cria o token (devolvido UMA vez, em claro) e grava só o hash. */
export async function criarConvite(db, { email, validadeS, criadoPor }) {
  const token = sortearToken('cv_');
  const t = agoraS();
  await db.prepare('INSERT INTO convites (token_hash, email, papel, criado_em, expira_em, criado_por) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), email, 'espectador', t, t + validadeS, criadoPor || null).run();
  return { token, expiraEm: t + validadeS };
}

export async function criarLinkMagico(db, { email, validadeS = 15 * 60 }) {
  const token = sortearToken('ml_');
  const t = agoraS();
  await db.prepare('INSERT INTO links_magicos (token_hash, email, criado_em, expira_em) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), email, t, t + validadeS).run();
  return { token, expiraEm: t + validadeS };
}

const TABELA_DE = { cv_: 'convites', ml_: 'links_magicos' };

export function tipoDoToken(token) {
  const t = typeof token === 'string' ? token : '';
  if (t.length < 20 || t.length > 80) return null;
  const prefixo = t.slice(0, 3);
  return TABELA_DE[prefixo] ? prefixo : null;
}

/* Olha sem gastar: { email } se vale (existe, não usado, não vencido). */
export async function espiarToken(db, token) {
  const tipo = tipoDoToken(token);
  if (!tipo) return null;
  const l = await db.prepare(`SELECT email FROM ${TABELA_DE[tipo]} WHERE token_hash = ? AND usado_em IS NULL AND expira_em > ?`)
    .bind(await sha256Hex(token), agoraS()).first();
  return l ? { email: l.email, tipo } : null;
}

/* Gasta de verdade, de uma vez só: o UPDATE condicional é a trava de uso único
 * (dois cliques ao mesmo tempo: um ganha, o outro recebe null). */
export async function consumirToken(db, token) {
  const tipo = tipoDoToken(token);
  if (!tipo) return null;
  const t = agoraS();
  const r = await db.prepare(
    `UPDATE ${TABELA_DE[tipo]} SET usado_em = ? WHERE token_hash = ? AND usado_em IS NULL AND expira_em > ? RETURNING email`
  ).bind(t, await sha256Hex(token), t).all();
  const l = r.results && r.results[0];
  return l ? { email: l.email, tipo } : null;
}

export async function convitesPendentes(db, { limite = 200 } = {}) {
  const r = await db.prepare(
    'SELECT email, criado_em, expira_em, criado_por FROM convites WHERE usado_em IS NULL AND expira_em > ? ORDER BY expira_em DESC LIMIT ?'
  ).bind(agoraS(), limite).all();
  return (r.results || []).map((l) => ({ email: l.email, criadoEm: l.criado_em, expiraEm: l.expira_em, criadoPor: l.criado_por || null }));
}

export async function revogarConvites(db, email) {
  const r = await db.prepare('DELETE FROM convites WHERE email = ? AND usado_em IS NULL').bind(email).run();
  return (r.meta && r.meta.changes) || 0;
}

/* -------------------------------------------------------- consentimentos */

export async function registrarConsentimento(db, usuarioId, tipo, versao, ipHash) {
  await db.prepare('INSERT OR IGNORE INTO consentimentos (usuario_id, tipo, versao, aceito_em, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(usuarioId, tipo, versao, agoraS(), ipHash || null).run();
}

export async function consentimentosDe(db, usuarioId) {
  const r = await db.prepare('SELECT tipo, versao, aceito_em FROM consentimentos WHERE usuario_id = ? ORDER BY aceito_em').bind(usuarioId).all();
  return (r.results || []).map((l) => ({ tipo: l.tipo, versao: l.versao, aceitoEm: l.aceito_em }));
}

/* Quais tipos o usuário ainda não aceitou na versão em vigor. */
export function consentimentosPendentes(aceitos, vigentes) {
  return Object.keys(vigentes).filter((tipo) => !aceitos.some((a) => a.tipo === tipo && a.versao >= vigentes[tipo]));
}

/* ------------------------------------------------- exportar e excluir */

/* O que se sabe de uma pessoa, em JSON (LGPD art. 18, II e V). Sem hash de
 * senha, sem hash de token: o que a pessoa não pode usar nem precisa ver. */
export async function exportarUsuario(db, id) {
  const u = await usuarioPorId(db, id);
  if (!u) return null;
  const [sessoes, convites, links, consentimentos, lista] = await Promise.all([
    db.prepare('SELECT criado_em, renovada_em, expira_em, ua FROM sessoes WHERE usuario_id = ? ORDER BY criado_em').bind(id).all(),
    db.prepare('SELECT criado_em, expira_em, usado_em FROM convites WHERE email = ?').bind(u.email).all(),
    db.prepare('SELECT criado_em, expira_em, usado_em FROM links_magicos WHERE email = ?').bind(u.email).all(),
    consentimentosDe(db, id),
    db.prepare('SELECT titulo_id, adicionado_em FROM minha_lista WHERE usuario_id = ? ORDER BY adicionado_em DESC LIMIT ?').bind(id, LIMITE_MINHA_LISTA).all()
  ]);
  return {
    conta: { email: u.email, nome: u.nome, status: u.status, temSenha: u.temSenha, criadoEm: u.criadoEm, ultimoAcesso: u.ultimoAcesso },
    consentimentos,
    sessoes: sessoes.results || [],
    convites: convites.results || [],
    linksMagicos: links.results || [],
    minhaLista: (lista.results || []).map((l) => ({ titulo: l.titulo_id, adicionadoEm: l.adicionado_em }))
  };
}

/* ------------------------------------------------------------ minha lista (M6)
 *
 * Os títulos que a pessoa guardou para ver depois. Mora no D1, uma linha por título e por pessoa, e só existe
 * para quem tem conta de espectador: sem conta não há "pessoa" para a lista pertencer. Cada pessoa guarda até
 * LIMITE_MINHA_LISTA títulos (o D1 grátis cobra por linha lida, e uma lista sem teto é uma leitura sem teto). */
export const LIMITE_MINHA_LISTA = 200;

export async function minhaListaDe(db, usuarioId) {
  const r = await db.prepare(
    'SELECT titulo_id FROM minha_lista WHERE usuario_id = ? ORDER BY adicionado_em DESC LIMIT ?'
  ).bind(usuarioId, LIMITE_MINHA_LISTA).all();
  return (r.results || []).map((l) => l.titulo_id);
}

/* Guarda um título. Devolve 'ok', ou 'cheia' quando a lista já está no teto e o título é novo. Guardar de novo o
 * que já está na lista só o põe na frente. */
export async function guardarNaMinhaLista(db, usuarioId, tituloId, agora = agoraS()) {
  const ja = await db.prepare('SELECT 1 AS x FROM minha_lista WHERE usuario_id = ? AND titulo_id = ?').bind(usuarioId, tituloId).first();
  if (!ja) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM minha_lista WHERE usuario_id = ?').bind(usuarioId).first('n');
    if (Number(n) >= LIMITE_MINHA_LISTA) return 'cheia';
  }
  await db.prepare(
    'INSERT INTO minha_lista (usuario_id, titulo_id, adicionado_em) VALUES (?, ?, ?) ' +
    'ON CONFLICT (usuario_id, titulo_id) DO UPDATE SET adicionado_em = excluded.adicionado_em'
  ).bind(usuarioId, tituloId, agora).run();
  return 'ok';
}

export async function tirarDaMinhaLista(db, usuarioId, tituloId) {
  await db.prepare('DELETE FROM minha_lista WHERE usuario_id = ? AND titulo_id = ?').bind(usuarioId, tituloId).run();
}

/* Apaga a pessoa: usuarios, sessoes, convites, links_magicos (e consentimentos e a minha lista,
 * que sem a conta só sobrariam órfãos). Uma transação. */
export async function excluirUsuario(db, id, email) {
  await db.batch([
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(id),
    db.prepare('DELETE FROM convites WHERE email = ?').bind(email),
    db.prepare('DELETE FROM links_magicos WHERE email = ?').bind(email),
    db.prepare('DELETE FROM consentimentos WHERE usuario_id = ?').bind(id),
    db.prepare('DELETE FROM minha_lista WHERE usuario_id = ?').bind(id),
    db.prepare("DELETE FROM usuarios WHERE id = ? AND papel = 'espectador'").bind(id)
  ]);
}

/* ------------------------------------------------------------- retenção */

const DIA = 24 * 3600;

/* O que o cron diário (`scheduled`) faz: some o que venceu. Devolve quantas
 * linhas saíram de cada tabela. Sem D1, não há o que limpar. */
export async function limparExpirados(env, agora = agoraS()) {
  const db = await garantirBanco(env);
  if (!db) return null;
  const [sessoes, links, convites, limites] = await db.batch([
    db.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(agora),
    db.prepare('DELETE FROM links_magicos WHERE expira_em < ?').bind(agora - DIA),
    db.prepare('DELETE FROM convites WHERE expira_em < ?').bind(agora - 30 * DIA),
    db.prepare('DELETE FROM limites WHERE atualizado_em < ? AND bloqueado_ate < ?').bind(agora - DIA, agora)
  ]);
  const n = (r) => (r && r.meta && r.meta.changes) || 0;
  return { sessoes: n(sessoes), linksMagicos: n(links), convites: n(convites), limites: n(limites) };
}

export { temBanco, garantirBanco };
