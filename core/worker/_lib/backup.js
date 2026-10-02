/* _lib/backup.js — exportar e importar o que é DADO desta instalação, em um arquivo JSON só.
 *
 * O que entra no arquivo:
 *   catalogo   o documento da chave `catalogo` do KV, como está (títulos, a estrutura da home, os ajustes do player);
 *   operacao   a chave `config:operacao` (o que o /admin guardou das seções operacionais da configuração), se existir;
 *   legal      os textos de privacidade e termos (D1), se houver banco;
 *   contas     (SÓ se pedido, e SÓ o superadmin) a equipe com o hash da senha — o que é preciso para ela voltar a entrar —
 *              e os espectadores (e-mail, nome, estado; nunca senha de espectador, nunca sessão, nunca convite).
 *
 * O que NÃO entra: segredos (ficam no painel da Cloudflare), o histórico de publicações e as cópias antigas (são
 * memória, e a restauração cria uma publicação nova), e o índice da busca (se regenera com scripts/indice-busca.mjs).
 *
 * INTEGRIDADE. O arquivo traz o hash SHA-256 de cada parte e do conjunto; importar confere os dois antes de tocar em
 * qualquer coisa, e um arquivo editado à mão ou cortado é recusado. O `hashes.catalogo` não conta `rev`, `atualizado_em`
 * nem `total`: é o que permite exportar, restaurar num projeto de teste, exportar de novo e COMPARAR (o conteúdo é o
 * mesmo, só o número da revisão anda).
 *
 * IMPORTAR é uma publicação como outra qualquer: o catálogo ganha rev + 1 e entra no histórico (dá para voltar), e quem
 * chama manda a `rev` que viu, para o 409 de sempre se alguém mexeu no meio. As contas NUNCA sobrescrevem uma conta que
 * já existe. As funções de montar e verificar não dependem de rota nenhuma: servem também aos scripts de backup. */
import App from '../../site/catalogo-core.js';
import AppHome from '../../site/home-blocos.js';
import { equipeListar, equipeAchar, equipeCriar, garantirEspectador, usuarioPorEmail, listarEspectadores } from './contas.js';
import { temBanco, garantirBanco } from './contas-banco.js';
import { lerDocumentos, salvarDocumento, TIPOS_LEGAIS } from './contas-legal.js';
import { montarConfig, CHAVE_OPERACAO, SECOES_OPERACAO, limparCacheConfig } from './config.js';
import { ARQUIVO_DE_IMPLANTACAO, ESQUEMA_DA_CONFIG } from './assistente.js';
import { registrarPublicacao } from '../api/historico.js';
import { VERSAO_DO_CORE, CHAVE_ULTIMO_BACKUP } from './saude.js';

export const FORMATO = 'streaming-backup';
export const VERSAO_DO_FORMATO = 1;
export const BYTES_MAXIMOS_DO_ARQUIVO = 15 * 1024 * 1024;
const PAGINA_DE_ESPECTADORES = 500;
const PAGINAS_MAXIMAS = 20;
const STATUS_DE_ESPECTADOR = ['ativo', 'convidado', 'pendente', 'bloqueado'];
export const PARTES = ['catalogo', 'operacao', 'legal', 'contas'];
const CHAVE_CATALOGO = 'catalogo';
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ hash */

/* JSON com as chaves em ordem: o mesmo valor dá sempre o mesmo texto. */
export function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (ehObjeto(v)) return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

export async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return 'sha256:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* O hash do catálogo SEM o que muda a cada gravação (rev, data e total): é o que se compara entre projetos. */
export async function hashDoCatalogo(doc) {
  if (!ehObjeto(doc)) return null;
  const copia = Object.assign({}, doc);
  delete copia.rev; delete copia.atualizado_em; delete copia.total;
  return sha256(canonico(copia));
}

async function hashesDe(conteudo) {
  return {
    catalogo: await hashDoCatalogo(conteudo.catalogo),
    operacao: conteudo.operacao == null ? null : await sha256(canonico(conteudo.operacao)),
    legal: conteudo.legal == null ? null : await sha256(canonico(conteudo.legal)),
    contas: conteudo.contas == null ? null : await sha256(canonico(conteudo.contas))
  };
}

/* ------------------------------------------------------------------ o catálogo, na forma de guardar */

/* O catálogo como o PUT o guarda: fontes no formato novo, estrutura da home saneada, nada que venha do ambiente. Exportar e importar
 * passam pela MESMA função, e por isso exportar -> importar -> exportar devolve o mesmo hash, mesmo quando o KV tem um documento
 * gravado por script (sem passar pelo PUT). Não mexe em rev, data nem total. */
export function normalizarCatalogo(doc) {
  if (!ehObjeto(doc)) return null;
  const n = App.catalogoMigrado(JSON.parse(JSON.stringify(doc)));
  delete n.config; delete n.padroes; delete n.quem; delete n.restaurou;
  if (App.siteVazio(n.site)) delete n.site; else n.site = App.siteSaneado(n.site);
  return n;
}

/* ------------------------------------------------------------------ exportar */

function resumoDe(conteudo) {
  const itens = conteudo.catalogo && Array.isArray(conteudo.catalogo.itens) ? conteudo.catalogo.itens : [];
  return {
    titulos: itens.length,
    noAr: itens.filter((i) => i && i.publicar === true).length,
    rev: conteudo.catalogo ? (conteudo.catalogo.rev || 0) : null,
    operacao: conteudo.operacao != null,
    legal: conteudo.legal != null,
    equipe: conteudo.contas ? conteudo.contas.equipe.length : null,
    espectadores: conteudo.contas ? conteudo.contas.espectadores.length : null
  };
}

/* Monta o arquivo. `incluirContas` só vale para o superadmin (quem chama confere). `origem` diz quem gerou ('admin' ou
 * 'script'). Não grava nada. */
export async function montarBackup({ env, incluirContas = false, origem = 'admin', agora = Date.now() }) {
  const kv = env.CATALOGO;
  const conteudo = {
    catalogo: normalizarCatalogo(await kv.get(CHAVE_CATALOGO, 'json')),
    operacao: (await kv.get(CHAVE_OPERACAO, 'json')) || null,
    legal: null,
    contas: null
  };
  let aviso = null;
  if (temBanco(env)) {
    try {
      const docs = await lerDocumentos(env);
      conteudo.legal = Object.fromEntries(TIPOS_LEGAIS.map((t) => [t, { versao: docs[t].versao, campos: docs[t].campos, textos: docs[t].textos }]));
    } catch (e) { aviso = 'legal-indisponivel'; }
  }
  if (incluirContas) {
    const equipe = (await equipeListar(env)).map((c) => ({
      usuario: c.usuario, nome: c.nome, permissoes: c.permissoes || [], ativa: c.ativa !== false,
      limiteEnvio: c.limiteEnvio || null, senha: c.senha || null, criada_em: c.criada_em || null
    }));
    const espectadores = [];
    let cortado = false;
    if (temBanco(env)) {
      try {
        const db = await garantirBanco(env);
        let antes = null;
        for (let p = 0; p < PAGINAS_MAXIMAS; p++) {
          const pagina = await listarEspectadores(db, { limite: PAGINA_DE_ESPECTADORES, antes });
          for (const e of pagina) espectadores.push({ email: e.email, nome: e.nome || '', status: e.status });
          if (pagina.length < PAGINA_DE_ESPECTADORES) break;
          antes = pagina[pagina.length - 1].criadoEm;
          if (p === PAGINAS_MAXIMAS - 1) cortado = true;
        }
      } catch (e) { aviso = 'espectadores-indisponiveis'; }
    }
    conteudo.contas = { equipe, espectadores };
    if (cortado) aviso = 'espectadores-cortados';
  }
  const hashes = await hashesDe(conteudo);
  return {
    formato: FORMATO,
    versaoDoFormato: VERSAO_DO_FORMATO,
    core: VERSAO_DO_CORE,
    criadoEm: new Date(agora).toISOString(),
    origem,
    resumo: resumoDe(conteudo),
    aviso,
    hashes,
    hash: await sha256(canonico(conteudo)),
    conteudo
  };
}

/* Marca o backup como feito (a tela Saúde lê isto). Falha do KV não derruba a exportação. */
export async function registrarBackup(env, backup, quem) {
  try {
    await env.CATALOGO.put(CHAVE_ULTIMO_BACKUP, JSON.stringify({
      em: backup.criadoEm, origem: backup.origem || 'admin', quem: quem || null,
      titulos: backup.resumo.titulos, contas: backup.conteudo.contas != null, hash: backup.hashes.catalogo
    }));
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------------ conferir */

/* Confere o arquivo SEM tocar em nada. { ok: true, partes[], conteudo, hashes } ou { ok: false, codigo, params? }. */
export async function verificarBackup(b) {
  if (!ehObjeto(b) || b.formato !== FORMATO || !ehObjeto(b.conteudo)) return { ok: false, codigo: 'backup-invalido' };
  if (b.versaoDoFormato !== VERSAO_DO_FORMATO) return { ok: false, codigo: 'backup-versao-nao-suportada', params: { versao: String(b.versaoDoFormato) } };
  const c = b.conteudo;
  const normal = {
    catalogo: c.catalogo == null ? null : c.catalogo, operacao: c.operacao == null ? null : c.operacao,
    legal: c.legal == null ? null : c.legal, contas: c.contas == null ? null : c.contas
  };
  if (normal.catalogo !== null && !ehObjeto(normal.catalogo)) return { ok: false, codigo: 'backup-invalido' };
  if (!ehObjeto(b.hashes) || typeof b.hash !== 'string') return { ok: false, codigo: 'backup-corrompido', params: { parte: 'arquivo' } };
  const recalculado = await hashesDe(normal);
  for (const parte of PARTES) if ((b.hashes[parte] || null) !== recalculado[parte]) return { ok: false, codigo: 'backup-corrompido', params: { parte } };
  if (b.hash !== await sha256(canonico(c))) return { ok: false, codigo: 'backup-corrompido', params: { parte: 'arquivo' } };
  return { ok: true, partes: PARTES.filter((p) => normal[p] !== null), conteudo: normal, hashes: recalculado };
}

/* ------------------------------------------------------------------ importar */

function sanearCatalogo(doc) {
  if (!ehObjeto(doc) || !Array.isArray(doc.itens)) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'itens' } };
  /* A home é conferida ANTES de ser saneada, como no PUT do catálogo: o saneador descarta em silêncio o que não tem a forma
   * certa, e um tipo de bloco que não existe merece um erro, não uma home que ignorou a metade. */
  const site = doc.site;
  if (site !== undefined && site !== null) {
    if (!ehObjeto(site)) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'site' } };
    if (AppHome.blocosInvalidos(site.blocos).length) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'blocos' } };
    if ('colecoes' in site && site.colecoes !== null && !Array.isArray(site.colecoes)) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'colecoes' } };
    if ('modeloDeConteudo' in site && site.modeloDeConteudo !== null && AppHome.MODELOS.indexOf(site.modeloDeConteudo) < 0) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'modeloDeConteudo' } };
  }
  const ids = new Set();
  for (const item of doc.itens) {
    if (!item || typeof item.id !== 'string' || !item.id) return { codigo: 'backup-catalogo-invalido', params: { detalhe: 'id' } };
    if (ids.has(item.id)) return { codigo: 'backup-catalogo-invalido', params: { detalhe: item.id } };
    ids.add(item.id);
  }
  return { catalogo: normalizarCatalogo(doc) };
}

function operacaoValida(operacao) {
  if (!ehObjeto(operacao)) return false;
  const chaves = Object.keys(operacao);
  if (chaves.some((k) => !SECOES_OPERACAO.includes(k))) return false;
  if (!chaves.length) return true;
  const r = montarConfig(ESQUEMA_DA_CONFIG, ARQUIVO_DE_IMPLANTACAO, operacao, []);
  return Boolean(r._estado && r._estado.valido && r._estado.operacaoAplicada);
}

const senhaValida = (s) => ehObjeto(s) && typeof s.hash === 'string' && typeof s.sal === 'string' && Number.isInteger(s.iter) && s.iter > 0;
const USUARIO = /^[a-z0-9_-]{3,32}$/;
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,40}$/;

/* Importa. `escolhas` diz quais partes aplicar ({ catalogo, operacao, legal, contas }: booleanos); `rev` é a que a tela viu
 * (409 se mudou); `simular` só descreve o que faria. Devolve { ok, plano, ... } ou { ok: false, status, codigo, params, extras }. */
export async function importarBackup({ env, backup, escolhas, rev, simular, quem }) {
  const v = await verificarBackup(backup);
  if (!v.ok) return { ok: false, status: 400, codigo: v.codigo, params: v.params };
  const pedidas = PARTES.filter((p) => ehObjeto(escolhas) && escolhas[p] === true && v.conteudo[p] !== null);
  if (!pedidas.length) return { ok: false, status: 400, codigo: 'backup-sem-nada' };

  const plano = {};
  let catalogoNovo = null;
  let atual = null;
  let difsDoCatalogo = null;

  if (pedidas.includes('catalogo')) {
    const s = sanearCatalogo(v.conteudo.catalogo);
    if (s.codigo) return { ok: false, status: 400, codigo: s.codigo, params: s.params };
    atual = App.catalogoMigrado((await env.CATALOGO.get(CHAVE_CATALOGO, 'json')) || null);
    const revAtual = (atual && atual.rev) || 0;
    if (atual && !(simular && rev === undefined) && rev !== revAtual) return { ok: false, status: 409, codigo: 'catalogo-mudou', extras: { rev_servidor: revAtual, rev_enviada: rev === undefined ? null : rev } };
    catalogoNovo = Object.assign({}, s.catalogo, { versao: s.catalogo.versao || 1, rev: revAtual + 1, total: s.catalogo.itens.length, atualizado_em: new Date().toISOString() });
    difsDoCatalogo = App.diferencasDoCatalogo(atual || { itens: [] }, catalogoNovo);
    plano.catalogo = { titulos: catalogoNovo.total, revDe: revAtual, revPara: catalogoNovo.rev, mudancas: difsDoCatalogo.length, hash: await hashDoCatalogo(catalogoNovo) };
  }
  if (pedidas.includes('operacao')) {
    if (!operacaoValida(v.conteudo.operacao)) return { ok: false, status: 400, codigo: 'backup-operacao-invalida' };
    plano.operacao = { secoes: Object.keys(v.conteudo.operacao) };
  }
  if (pedidas.includes('legal')) {
    plano.legal = { disponivel: temBanco(env), documentos: TIPOS_LEGAIS.filter((t) => ehObjeto(v.conteudo.legal[t])) };
  }
  if (pedidas.includes('contas')) {
    const c = v.conteudo.contas;
    const equipe = Array.isArray(c.equipe) ? c.equipe : [];
    const espectadores = Array.isArray(c.espectadores) ? c.espectadores : [];
    let novosEquipe = 0, existentesEquipe = 0, invalidasEquipe = 0;
    for (const x of equipe) {
      if (!x || !USUARIO.test(String(x.usuario || '')) || !senhaValida(x.senha)) { invalidasEquipe++; continue; }
      if (await equipeAchar(env, x.usuario)) existentesEquipe++; else novosEquipe++;
    }
    let novosEsp = 0, existentesEsp = 0, invalidosEsp = 0;
    const banco = temBanco(env) ? await garantirBanco(env) : null;
    for (const x of espectadores) {
      if (!x || !EMAIL.test(String(x.email || '')) || !STATUS_DE_ESPECTADOR.includes(x.status)) { invalidosEsp++; continue; }
      if (!banco) continue;
      if (await usuarioPorEmail(banco, String(x.email).toLowerCase())) existentesEsp++; else novosEsp++;
    }
    plano.contas = {
      equipe: { novas: novosEquipe, existentes: existentesEquipe, invalidas: invalidasEquipe },
      espectadores: { novos: novosEsp, existentes: existentesEsp, invalidos: invalidosEsp, semBanco: !banco && espectadores.length > 0 }
    };
  }

  if (simular) return { ok: true, simulado: true, plano, partes: pedidas };

  const feito = {};
  if (catalogoNovo) {
    const gravado = JSON.stringify(catalogoNovo);
    await env.CATALOGO.put(CHAVE_CATALOGO, gravado);
    let historico = true;
    try { await registrarPublicacao(env, { anterior: atual, novo: catalogoNovo, corpoGravado: gravado, difs: difsDoCatalogo, quem: quem || 'superadmin' }); } catch (e) { historico = false; }
    feito.catalogo = { rev: catalogoNovo.rev, titulos: catalogoNovo.total, historico, hash: plano.catalogo.hash };
  }
  if (pedidas.includes('operacao')) {
    await env.CATALOGO.put(CHAVE_OPERACAO, JSON.stringify(v.conteudo.operacao));
    limparCacheConfig();
    feito.operacao = { secoes: plano.operacao.secoes };
  }
  if (pedidas.includes('legal') && temBanco(env)) {
    const banco = await garantirBanco(env);
    const salvos = [];
    for (const t of TIPOS_LEGAIS) {
      const d = v.conteudo.legal[t];
      if (!ehObjeto(d)) continue;
      await salvarDocumento(banco, t, { campos: d.campos, textos: d.textos }, quem || 'importacao');
      salvos.push(t);
    }
    feito.legal = { documentos: salvos };
  }
  if (pedidas.includes('contas')) {
    const c = v.conteudo.contas;
    const r = { equipe: { criadas: 0, puladas: 0 }, espectadores: { criados: 0, pulados: 0 } };
    for (const x of Array.isArray(c.equipe) ? c.equipe : []) {
      if (!x || !USUARIO.test(String(x.usuario || '')) || !senhaValida(x.senha)) { r.equipe.puladas++; continue; }
      const ok = await equipeCriar(env, {
        usuario: x.usuario, nome: String(x.nome || x.usuario).slice(0, 80), permissoes: Array.isArray(x.permissoes) && App.permissoesValidas(x.permissoes) ? x.permissoes : [],
        ativa: x.ativa !== false, versao: 1, limiteEnvio: x.limiteEnvio || null, enviosContagem: 0, senha: x.senha,
        criada_em: typeof x.criada_em === 'string' ? x.criada_em : new Date().toISOString(), criada_por: quem || 'importacao'
      });
      if (ok) r.equipe.criadas++; else r.equipe.puladas++;
    }
    const banco = temBanco(env) ? await garantirBanco(env) : null;
    for (const x of Array.isArray(c.espectadores) ? c.espectadores : []) {
      if (!banco || !x || !EMAIL.test(String(x.email || '')) || !STATUS_DE_ESPECTADOR.includes(x.status)) { r.espectadores.pulados++; continue; }
      const g = await garantirEspectador(banco, { email: String(x.email).toLowerCase(), nome: x.nome || '', status: x.status, criadoPor: quem || 'importacao' });
      if (g.criado) r.espectadores.criados++; else r.espectadores.pulados++;
    }
    feito.contas = r;
  }
  return { ok: true, simulado: false, plano, feito, partes: pedidas };
}
