/* _lib/contas-legal.js — Política de privacidade e Termos de uso: versão e edição.
 *
 * O TEXTO MODELO mora nos catálogos de idioma (`legal.*`, neutro, com {controlador},
 * {contato} e {retencao} a preencher) e é desenhado no navegador. Aqui só se guarda
 * o que o CLIENTE muda, na tabela `documentos`:
 *
 *   campos   { controlador, contato, retencao }  preenchem o modelo;
 *   textos   { 'pt-BR': '...' }                  texto próprio (parágrafos separados por
 *                                                linha em branco) que SUBSTITUI o modelo
 *                                                naquele idioma;
 *   versao   sobe a cada alteração. É o que o consentimento registra: mudou o texto,
 *            todo mundo precisa aceitar de novo (LGPD: consentimento específico).
 *
 * O CLIENTE É O CONTROLADOR dos dados: o modelo diz isso. É um ponto de partida,
 * não parecer jurídico — a tela do /admin avisa para validar com o jurídico dele.
 * Sem D1, valem os modelos e a versão 1. */
import { garantirBanco } from './contas-banco.js';
import { agoraS } from './contas-cripto.js';

export const TIPOS_LEGAIS = ['privacidade', 'termos'];
const LIMITE_CAMPO = 300;
const LIMITE_TEXTO = 20000;

const lerJson = (t, padrao) => { try { return t ? JSON.parse(t) : padrao; } catch (e) { return padrao; } };

function vazio(tipo) {
  return { tipo, versao: 1, campos: {}, textos: {}, atualizadoEm: 0 };
}

export async function lerDocumentos(env) {
  const saida = {};
  for (const tipo of TIPOS_LEGAIS) saida[tipo] = vazio(tipo);
  let db = null;
  try { db = await garantirBanco(env); } catch (e) { db = null; }
  if (!db) return saida;
  const r = await db.prepare('SELECT tipo, versao, campos, textos, atualizado_em FROM documentos').all();
  for (const l of r.results || []) {
    if (!saida[l.tipo]) continue;
    saida[l.tipo] = {
      tipo: l.tipo, versao: l.versao || 1, campos: lerJson(l.campos, {}), textos: lerJson(l.textos, {}), atualizadoEm: l.atualizado_em || 0
    };
  }
  return saida;
}

export async function versoesVigentes(env) {
  const d = await lerDocumentos(env);
  const v = {};
  for (const tipo of TIPOS_LEGAIS) v[tipo] = d[tipo].versao;
  return v;
}

/* Limpa e limita o que veio do /admin. */
export function sanearDocumento(entrada) {
  const campos = {};
  const origem = (entrada && entrada.campos) || {};
  for (const k of ['controlador', 'contato', 'retencao']) {
    if (typeof origem[k] === 'string' && origem[k].trim()) campos[k] = origem[k].trim().slice(0, LIMITE_CAMPO);
  }
  const textos = {};
  const t = (entrada && entrada.textos) || {};
  for (const idioma of Object.keys(t)) {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(idioma)) continue;
    if (typeof t[idioma] === 'string' && t[idioma].trim()) textos[idioma] = t[idioma].replace(/\r\n/g, '\n').trim().slice(0, LIMITE_TEXTO);
  }
  return { campos, textos };
}

/* Grava; a versão só sobe se algo mudou. Devolve o documento. */
export async function salvarDocumento(db, tipo, entrada, por) {
  const novo = sanearDocumento(entrada);
  const atual = await db.prepare('SELECT versao, campos, textos FROM documentos WHERE tipo = ?').bind(tipo).first();
  const campos = JSON.stringify(novo.campos);
  const textos = JSON.stringify(novo.textos);
  if (atual && atual.campos === campos && atual.textos === textos) {
    return { tipo, versao: atual.versao, campos: novo.campos, textos: novo.textos, mudou: false };
  }
  const versao = (atual ? atual.versao : 1) + 1;
  await db.prepare(
    'INSERT INTO documentos (tipo, versao, campos, textos, atualizado_em, atualizado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
    'ON CONFLICT(tipo) DO UPDATE SET versao = ?2, campos = ?3, textos = ?4, atualizado_em = ?5, atualizado_por = ?6'
  ).bind(tipo, versao, campos, textos, agoraS(), por || null).run();
  return { tipo, versao, campos: novo.campos, textos: novo.textos, mudou: true };
}
