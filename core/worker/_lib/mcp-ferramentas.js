/* _lib/mcp-ferramentas.js — as ferramentas do MCP (M10): o que um agente de IA pode ler e mudar no streaming.
 *
 * REGRAS (cada uma tem teste em tests/mcp-*.test.js):
 *   1. ESCOPO. Cada ferramenta pede `read`, `curate` ou `admin`. O escopo que vale é o MENOR entre o do token e o que a
 *      configuração permite (`mcp.somenteLeitura`, padrão true: só leitura). Ferramenta acima do escopo não aparece em
 *      tools/list e, se chamada, é recusada e registrada.
 *   2. ESCRITA SÓ PELO CAMINHO VALIDADO. Toda mudança passa por `gravarCatalogo` (api/catalogo.js), o MESMO caminho do PUT
 *      da mesa: validação, permissão por campo (o token vira uma conta de equipe sem poder de superadmin), rascunho,
 *      histórico com o nome do token e 409 quando o catálogo mudou. Nada escreve direto no KV.
 *   3. DESTRUTIVAS PEDEM CONFIRMAÇÃO. Mudar o que já está no ar, publicar, reorganizar a home, trocar textos e gerar convite
 *      só acontecem com `confirmar: true`; sem ele, a ferramenta devolve o RESUMO do efeito e não altera nada.
 *   4. TEXTO DO CATÁLOGO É DADO, NÃO ORDEM. Títulos, sinopses, tags e capítulos podem ter sido escritos por qualquer pessoa
 *      (ou vir de uma transcrição). Vão sempre dentro de `conteudoNaoConfiavel`, com um `aviso`, e nenhuma ferramenta faz
 *      algo porque um texto desses mandou.
 *   5. NADA SECRETO SAI. Nenhuma ferramenta devolve segredo, chave, hash de token ou e-mail de espectador (só contagens;
 *      o e-mail do convite sai mascarado). */
import App from '../../site/catalogo-core.js';
import AppHome from '../../site/home-blocos.js';
import { lerCatalogo, gravarCatalogo } from '../api/catalogo.js';
import { onRequestPost as convitesPost } from '../api/convites.js';
import { montarSaude } from './saude.js';
import { criarProvedor } from './provedores/index.js';
import { garantirBanco } from './contas-banco.js';
import { agoraS, mascararEmail, normalizarEmail } from './contas-cripto.js';
import { contarTokensAtivos } from './mcp-tokens.js';

export class ErroDeFerramenta extends Error {
  constructor(codigo, params, extras) {
    super(codigo);
    this.codigo = codigo;
    this.params = params || null;
    this.extras = extras || {};
  }
}
const recusar = (codigo, params, extras) => { throw new ErroDeFerramenta(codigo, params, extras); };

const LIMITE_LISTA = 50;
const LIMITE_ID = 120;
const PADRAO_ID_DE_BLOCO = /^[a-z0-9-]{1,40}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cortar = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ------------------------------------------------------------------ leitura do catálogo */

async function catalogoOuErro(env) {
  const doc = await lerCatalogo(env);
  if (!doc || !Array.isArray(doc.itens)) recusar('catalogo-vazio');
  return doc;
}

function itemOuErro(doc, id) {
  if (typeof id !== 'string' || !id || id.length > 200) recusar('argumento-invalido', { campo: 'id' });
  const item = doc.itens.find((i) => i && i.id === id);
  if (!item) recusar('titulo-inexistente');
  return item;
}

/* O que de um título pode ser entregue ao agente, separado em ESTRUTURA (confiável: o sistema a produz) e TEXTO
 * (não confiável: alguém o escreveu). Sem `fonte`, `midia`, caminhos de arquivo nem links de origem. */
function ficha(item, { completa = false } = {}) {
  const texto = {
    titulo: cortar(item.titulo || '', 300), serie: cortar(item.serie || '', 300)
  };
  const saida = {
    id: cortar(String(item.id), LIMITE_ID),
    publicado: item.publicar === true,
    duracaoSeg: item.duracao_seg ?? null,
    temporada: item.temporada ?? null,
    episodio: item.episodio ?? null,
    conteudoNaoConfiavel: texto
  };
  if (completa) {
    Object.assign(texto, {
      ano: cortar(String(item.ano || ''), 20), sinopse: cortar(item.sinopse || '', 2000), tema: cortar(item.tema || '', 300),
      publico_alvo: cortar(item.publico_alvo || '', 300), nota_curadoria: cortar(item.nota_curadoria || '', 1000),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 30).map((x) => cortar(String(x), 80)) : [],
      capitulos: Array.isArray(item.capitulos) ? item.capitulos.slice(0, 60).map((c) => ({ inicio: Number(c && c.inicio) || 0, titulo: cortar(String((c && c.titulo) || ''), 200) })) : []
    });
    saida.destaque = item.destaque === true;
    saida.framerate = item.framerate ?? null;
  }
  return saida;
}

const COM_AVISO = (ctx, dados) => Object.assign({ aviso: ctx.t('mcp.avisoDados') }, dados);

/* ------------------------------------------------------------------ escrita pelo caminho validado */

/* Lê o catálogo, deixa `mutar` mexer numa CÓPIA e grava com `gravarCatalogo`. `rev` (opcional, vinda do agente) é a revisão
 * em que ele LEU: se o catálogo já mudou, o PUT responde 409 e nada é gravado. Sem `rev`, usa a de agora (o conflito só
 * aparece numa corrida dentro da própria chamada). */
async function escreverCatalogo(ctx, mutar, rev) {
  const atual = await catalogoOuErro(ctx.env);
  const corpo = JSON.parse(JSON.stringify(atual));
  mutar(corpo);
  if (rev !== undefined && rev !== null) {
    if (!Number.isInteger(rev)) recusar('argumento-invalido', { campo: 'rev' });
    corpo.rev = rev;
  }
  const resposta = await gravarCatalogo({ env: ctx.env, corpo, conta: ctx.conta });
  let j = null;
  try { j = await resposta.json(); } catch (e) { /* sem corpo */ }
  if (resposta.status === 200 && j && j.ok) return { rev: j.rev, mudancas: j.mudancas, historico: j.historico };
  if (resposta.status === 409) recusar('conflito', { servidor: j && j.rev_servidor, enviada: j && j.rev_enviada }, { rev_servidor: j && j.rev_servidor });
  if (resposta.status === 403) recusar('permissao-negada', null, { barradas: (j && j.barradas) || [] });
  if (resposta.status === 400 && j && typeof j.codigo === 'string') recusar('gravacao-recusada', { motivo: j.mensagem || j.codigo }, { motivo: j.codigo });
  recusar('gravacao-falhou', { status: resposta.status });
}

function pedirConfirmacao(ctx, resumo, extras) {
  return {
    dados: Object.assign({
      aviso: ctx.t('mcp.avisoDados'),
      confirmacaoNecessaria: true, nadaFoiAlterado: true,
      comoConfirmar: ctx.t('mcp.comoConfirmar')
    }, { resumo }, extras || {}),
    naoConfiavel: true
  };
}

/* ------------------------------------------------------------------ as ferramentas */

const T_ID = { type: 'string', maxLength: 200 };
const T_REV = { type: 'integer', minimum: 0 };
const T_CONFIRMAR = { type: 'boolean' };

const CAMPOS_EDITAVEIS = {
  titulo: { tipo: 'texto', max: 200, naoVazio: true },
  serie: { tipo: 'texto', max: 200 },
  sinopse: { tipo: 'texto', max: 2000 },
  tema: { tipo: 'texto', max: 200 },
  publico_alvo: { tipo: 'texto', max: 200 },
  nota_curadoria: { tipo: 'texto', max: 1000 },
  ano: { tipo: 'texto', max: 20 },
  temporada: { tipo: 'inteiro', min: 0, max: 999 },
  episodio: { tipo: 'inteiro', min: 0, max: 9999 },
  tags: { tipo: 'lista', max: 20, itemMax: 60 }
};

function campoValidado(nome, valor) {
  const e = CAMPOS_EDITAVEIS[nome];
  if (!e) recusar('campo-nao-permitido', { campo: nome });
  if (e.tipo === 'texto') {
    if (typeof valor !== 'string') recusar('argumento-invalido', { campo: nome });
    const t = valor.trim();
    if (e.naoVazio && !t) recusar('argumento-invalido', { campo: nome });
    if (t.length > e.max) recusar('argumento-invalido', { campo: nome });
    return t;
  }
  if (e.tipo === 'inteiro') {
    if (valor === null) return null;
    if (!Number.isInteger(valor) || valor < e.min || valor > e.max) recusar('argumento-invalido', { campo: nome });
    return valor;
  }
  if (!Array.isArray(valor) || valor.length > e.max || valor.some((x) => typeof x !== 'string' || !x.trim() || x.length > e.itemMax)) recusar('argumento-invalido', { campo: nome });
  return valor.map((x) => x.trim());
}

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* Os blocos que a home mostra agora: o que a mesa escolheu, senão o config, senão o padrão do código. */
function homeAtual(doc, config) {
  const site = AppHome.siteComPadroes(doc.site || {}, AppHome.padroesDaConfig(config));
  return { site, blocos: AppHome.blocosEfetivos(site), colecoes: AppHome.colecoesEfetivas(site) };
}
const resumoDeBloco = (b) => ({ id: b.id, tipo: b.tipo, escondido: b.escondido === true });

export const FERRAMENTAS = [
  {
    nome: 'listar_titulos', escopo: 'read', leitura: true,
    esquema: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['todos', 'publicados', 'rascunhos'] },
        serie: { type: 'string', maxLength: 200 },
        limite: { type: 'integer', minimum: 1, maximum: LIMITE_LISTA },
        cursor: { type: 'string', maxLength: 12 }
      }
    },
    async executar(args, ctx) {
      const doc = await catalogoOuErro(ctx.env);
      const status = args.status === undefined ? 'todos' : args.status;
      if (['todos', 'publicados', 'rascunhos'].indexOf(status) < 0) recusar('argumento-invalido', { campo: 'status' });
      const limite = args.limite === undefined ? 20 : args.limite;
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_LISTA) recusar('argumento-invalido', { campo: 'limite' });
      const inicio = args.cursor === undefined ? 0 : Number(args.cursor);
      if (!Number.isInteger(inicio) || inicio < 0) recusar('argumento-invalido', { campo: 'cursor' });
      const serie = typeof args.serie === 'string' ? semAcento(args.serie.trim()) : '';
      const todos = doc.itens.filter((i) => i && (status === 'todos' || (status === 'publicados') === (i.publicar === true)) &&
        (!serie || semAcento(i.serie).includes(serie)));
      const pagina = todos.slice(inicio, inicio + limite);
      const proximo = inicio + limite < todos.length ? String(inicio + limite) : null;
      return { dados: COM_AVISO(ctx, { rev: doc.rev || 0, total: todos.length, itens: pagina.map((i) => ficha(i)), proximoCursor: proximo }), naoConfiavel: true };
    }
  },
  {
    nome: 'ver_titulo', escopo: 'read', leitura: true,
    esquema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: T_ID } },
    async executar(args, ctx) {
      const doc = await catalogoOuErro(ctx.env);
      const item = itemOuErro(doc, args.id);
      return { dados: COM_AVISO(ctx, { rev: doc.rev || 0, titulo: ficha(item, { completa: true }) }), naoConfiavel: true };
    }
  },
  {
    nome: 'buscar', escopo: 'read', leitura: true,
    esquema: {
      type: 'object', additionalProperties: false, required: ['consulta'],
      properties: { consulta: { type: 'string', minLength: 2, maxLength: 100 }, limite: { type: 'integer', minimum: 1, maximum: LIMITE_LISTA } }
    },
    async executar(args, ctx) {
      if (typeof args.consulta !== 'string' || args.consulta.trim().length < 2 || args.consulta.length > 100) recusar('argumento-invalido', { campo: 'consulta' });
      const limite = args.limite === undefined ? 20 : args.limite;
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_LISTA) recusar('argumento-invalido', { campo: 'limite' });
      const doc = await catalogoOuErro(ctx.env);
      const palavras = semAcento(args.consulta).split(/\s+/).filter(Boolean);
      const achados = doc.itens.filter((i) => {
        if (!i) return false;
        const palco = semAcento([i.titulo, i.serie, i.sinopse, i.tema, i.publico_alvo, i.nota_curadoria, ...(Array.isArray(i.tags) ? i.tags : [])].join(' '));
        return palavras.every((p) => palco.includes(p));
      });
      return { dados: COM_AVISO(ctx, { total: achados.length, itens: achados.slice(0, limite).map((i) => ficha(i)) }), naoConfiavel: true };
    }
  },
  {
    nome: 'estatisticas_basicas', escopo: 'read', leitura: true,
    esquema: { type: 'object', additionalProperties: false, properties: {} },
    async executar(args, ctx) {
      const doc = await lerCatalogo(ctx.env);
      const itens = doc && Array.isArray(doc.itens) ? doc.itens.filter(Boolean) : [];
      const series = new Set(itens.map((i) => i.serie).filter(Boolean));
      const publicados = itens.filter((i) => i.publicar === true).length;
      const dados = {
        catalogo: {
          titulos: itens.length, publicados, rascunhos: itens.length - publicados, series: series.size,
          minutosNoAr: Math.round(itens.filter((i) => i.publicar === true).reduce((s, i) => s + (Number(i.duracao_seg) || 0), 0) / 60),
          rev: (doc && doc.rev) || 0, atualizadoEm: (doc && doc.atualizado_em) || null
        },
        acesso: { modo: ctx.modo }
      };
      let db = null;
      try { db = await garantirBanco(ctx.env); } catch (e) { db = null; }
      if (db) {
        /* SÓ CONTAGENS: nenhum e-mail, nome ou id de pessoa sai daqui. */
        const linhas = (await db.prepare('SELECT papel, status, COUNT(*) AS n FROM usuarios GROUP BY papel, status').all()).results || [];
        const por = { espectadores: {}, equipe: 0 };
        for (const l of linhas) {
          if (l.papel === 'equipe') por.equipe += l.n;
          else por.espectadores[l.status] = l.n;
        }
        const convites = await db.prepare('SELECT COUNT(*) AS n FROM convites WHERE usado_em IS NULL AND expira_em > ?').bind(agoraS()).first();
        dados.pessoas = { equipe: por.equipe, espectadoresPorStatus: por.espectadores, convitesPendentes: convites ? convites.n : 0 };
        dados.integracoes = { tokensMcpAtivos: await contarTokensAtivos(ctx.env) };
      }
      return { dados };
    }
  },
  {
    nome: 'ver_saude', escopo: 'read', leitura: true,
    esquema: { type: 'object', additionalProperties: false, properties: {} },
    async executar(args, ctx) {
      const data = { provedor: criarProvedor(ctx.config, ctx.env) };
      const s = await montarSaude({ env: ctx.env, config: ctx.config, data, modo: ctx.modo, testar: false, versao: null });
      /* Só o que o diagnóstico sabe dizer sem valor secreto: os segredos saem por NOME e "presente ou não". */
      return {
        dados: {
          geradoEm: s.geradoEm, modo: s.modo, provedor: s.provedor, versao: { core: s.versao && s.versao.core },
          segredos: (s.segredos || []).map((x) => ({ nome: x.nome, presente: x.presente === true, necessario: x.necessario === true, grupo: x.grupo })),
          armazenamento: s.armazenamento, backup: s.backup, resumo: s.resumo,
          checagens: (s.checagens || []).map((c) => ({ id: c.id, estado: c.estado, codigo: c.codigo, params: c.params || undefined }))
        }
      };
    }
  },
  {
    nome: 'editar_titulo', escopo: 'curate', leitura: false, destrutiva: 'condicional',
    esquema: {
      type: 'object', additionalProperties: false, required: ['id', 'campos'],
      properties: {
        id: T_ID,
        campos: { type: 'object', additionalProperties: false, properties: {
          titulo: { type: 'string' }, serie: { type: 'string' }, sinopse: { type: 'string' }, tema: { type: 'string' },
          publico_alvo: { type: 'string' }, nota_curadoria: { type: 'string' }, ano: { type: 'string' },
          temporada: { type: ['integer', 'null'] }, episodio: { type: ['integer', 'null'] }, tags: { type: 'array', items: { type: 'string' } }
        } },
        rev: T_REV, confirmar: T_CONFIRMAR
      }
    },
    async executar(args, ctx) {
      if (!ehObjeto(args.campos) || !Object.keys(args.campos).length) recusar('argumento-invalido', { campo: 'campos' });
      const doc = await catalogoOuErro(ctx.env);
      const item = itemOuErro(doc, args.id);
      const novos = {};
      for (const k of Object.keys(args.campos)) novos[k] = campoValidado(k, args.campos[k]);
      const mudancas = Object.keys(novos).filter((k) => !igual(item[k], novos[k]));
      if (!mudancas.length) return { dados: { ok: true, nadaMudou: true, rev: doc.rev || 0 } };
      const resumo = {
        id: cortar(String(item.id), LIMITE_ID), publicado: item.publicar === true,
        conteudoNaoConfiavel: mudancas.map((k) => ({ campo: k, antes: item[k] ?? null, depois: novos[k] }))
      };
      /* Rascunho livre; título que já está no ar muda o que o público vê: pede confirmação. */
      if (item.publicar === true && args.confirmar !== true) return pedirConfirmacao(ctx, resumo);
      const r = await escreverCatalogo(ctx, (c) => {
        const i = c.itens.find((x) => x && x.id === item.id);
        for (const k of mudancas) i[k] = novos[k];
      }, args.rev);
      return { dados: { ok: true, rev: r.rev, camposAlterados: mudancas, publicado: item.publicar === true, historico: r.historico } };
    }
  },
  {
    nome: 'publicar_rascunho', escopo: 'curate', leitura: false, destrutiva: true,
    esquema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: T_ID, rev: T_REV, confirmar: T_CONFIRMAR } },
    async executar(args, ctx) {
      const doc = await catalogoOuErro(ctx.env);
      const item = itemOuErro(doc, args.id);
      if (item.publicar === true) recusar('ja-publicado');
      const resumo = { id: cortar(String(item.id), LIMITE_ID), efeito: 'publicar', visivelPara: ctx.modo, conteudoNaoConfiavel: { titulo: cortar(item.titulo || '', 300) } };
      if (args.confirmar !== true) return pedirConfirmacao(ctx, resumo);
      const r = await escreverCatalogo(ctx, (c) => { c.itens.find((x) => x && x.id === item.id).publicar = true; }, args.rev);
      return { dados: { ok: true, rev: r.rev, publicado: true, historico: r.historico } };
    }
  },
  {
    nome: 'organizar_home', escopo: 'curate', leitura: false, destrutiva: true,
    esquema: {
      type: 'object', additionalProperties: false,
      properties: {
        ordem: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 40 },
        esconder: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 40 },
        mostrar: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 40 },
        blocos: { type: 'array', items: { type: 'object' }, maxItems: 40 },
        rev: T_REV, confirmar: T_CONFIRMAR
      }
    },
    async executar(args, ctx) {
      const doc = await catalogoOuErro(ctx.env);
      const { blocos: atuais } = homeAtual(doc, ctx.config);
      let novos;
      if (args.blocos !== undefined) {
        if (!Array.isArray(args.blocos)) recusar('argumento-invalido', { campo: 'blocos' });
        const ruins = AppHome.blocosInvalidos(args.blocos);
        if (ruins.length) recusar('blocos-invalidos', { n: ruins.length });
        novos = AppHome.blocosSaneados(args.blocos);
      } else {
        for (const campo of ['ordem', 'esconder', 'mostrar']) {
          if (args[campo] !== undefined && (!Array.isArray(args[campo]) || args[campo].some((x) => typeof x !== 'string' || !PADRAO_ID_DE_BLOCO.test(x)))) recusar('argumento-invalido', { campo });
        }
        if (!args.ordem && !args.esconder && !args.mostrar) recusar('argumento-invalido', { campo: 'ordem' });
        const porId = new Map(atuais.map((b) => [b.id, b]));
        for (const id of [].concat(args.ordem || [], args.esconder || [], args.mostrar || [])) if (!porId.has(id)) recusar('bloco-desconhecido', { id });
        const ordem = args.ordem ? Array.from(new Set(args.ordem)) : [];
        const resto = atuais.map((b) => b.id).filter((id) => ordem.indexOf(id) < 0);
        novos = ordem.concat(resto).map((id) => {
          const b = Object.assign({}, porId.get(id));
          if ((args.esconder || []).indexOf(id) >= 0) b.escondido = true;
          if ((args.mostrar || []).indexOf(id) >= 0) delete b.escondido;
          return b;
        });
      }
      const resumo = { antes: atuais.map(resumoDeBloco), depois: novos.map(resumoDeBloco), efeito: 'home-reorganizada' };
      if (igual(resumo.antes, resumo.depois) && args.blocos === undefined) return { dados: { ok: true, nadaMudou: true, rev: doc.rev || 0 } };
      if (args.confirmar !== true) return pedirConfirmacao(ctx, resumo);
      const r = await escreverCatalogo(ctx, (c) => { c.site = Object.assign({}, c.site || {}, { blocos: novos }); }, args.rev);
      return { dados: { ok: true, rev: r.rev, blocos: novos.length, historico: r.historico } };
    }
  },
  {
    nome: 'criar_colecao', escopo: 'curate', leitura: false, destrutiva: false,
    esquema: {
      type: 'object', additionalProperties: false, required: ['id', 'nome'],
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, nome: { type: 'string', maxLength: 300 },
        titulos: { type: 'array', items: T_ID, maxItems: 50 }, rev: T_REV
      }
    },
    async executar(args, ctx) {
      if (typeof args.id !== 'string' || !PADRAO_ID_DE_BLOCO.test(args.id)) recusar('argumento-invalido', { campo: 'id' });
      if (typeof args.nome !== 'string' || !args.nome.trim() || args.nome.length > 300) recusar('argumento-invalido', { campo: 'nome' });
      const titulos = args.titulos === undefined ? [] : args.titulos;
      if (!Array.isArray(titulos) || titulos.length > 50 || titulos.some((x) => typeof x !== 'string')) recusar('argumento-invalido', { campo: 'titulos' });
      const doc = await catalogoOuErro(ctx.env);
      const ids = new Set(doc.itens.filter(Boolean).map((i) => i.id));
      for (const t of titulos) if (!ids.has(t)) recusar('titulo-inexistente', { id: cortar(t, LIMITE_ID) });
      const { colecoes } = homeAtual(doc, ctx.config);
      if (colecoes.some((c) => c.id === args.id)) recusar('colecao-existe');
      if (colecoes.length >= 30) recusar('colecoes-demais');
      const nova = { id: args.id, nome: args.nome.trim() };
      if (titulos.length) nova.titulos = Array.from(new Set(titulos));
      const r = await escreverCatalogo(ctx, (c) => { c.site = Object.assign({}, c.site || {}, { colecoes: colecoes.concat([nova]) }); }, args.rev);
      return { dados: { ok: true, rev: r.rev, colecao: args.id, historico: r.historico } };
    }
  },
  {
    nome: 'gerar_convite', escopo: 'admin', leitura: false, destrutiva: true,
    esquema: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 120 }, confirmar: T_CONFIRMAR } },
    async executar(args, ctx) {
      const email = normalizarEmail(args.email);
      if (!email) recusar('argumento-invalido', { campo: 'email' });
      if (ctx.modo === 'publico') recusar('sem-contas');
      const resumo = { efeito: 'convite', para: mascararEmail(email), validadeDias: 7, modo: ctx.modo };
      if (args.confirmar !== true) return pedirConfirmacao(ctx, resumo);
      /* O MESMO handler de /api/convites (POST), sem envio de e-mail: o link volta para quem pediu. */
      const req = new Request(ctx.request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, enviar: false }) });
      const r = await convitesPost({ request: req, env: ctx.env, data: { conta: ctx.conta }, modo: ctx.modo, config: ctx.config, waitUntil: ctx.waitUntil });
      let j = null;
      try { j = await r.json(); } catch (e) { /* sem corpo */ }
      if (r.status !== 200 || !j || !j.ok) recusar('gravacao-recusada', { motivo: (j && (j.mensagem || j.codigo)) || String(r.status) }, { motivo: j && j.codigo });
      /* O link é a credencial do convidado, de uso único e 7 dias: entregue ao administrador, para repassar. */
      return { dados: { ok: true, para: mascararEmail(email), link: j.link, expiraEm: j.expiraEm, aviso: ctx.t('mcp.avisoLinkConvite') } };
    }
  },
  {
    nome: 'trocar_textos', escopo: 'admin', leitura: false, destrutiva: true,
    esquema: {
      type: 'object', additionalProperties: false, required: ['textos'],
      properties: { textos: { type: 'object', additionalProperties: { type: 'string', maxLength: 300 } }, rev: T_REV, confirmar: T_CONFIRMAR }
    },
    async executar(args, ctx) {
      if (!ehObjeto(args.textos) || !Object.keys(args.textos).length || Object.keys(args.textos).length > 20) recusar('argumento-invalido', { campo: 'textos' });
      const doc = await catalogoOuErro(ctx.env);
      const antes = App.siteSaneado(doc.site).textos;
      let site = App.siteSaneado(doc.site);
      for (const chave of Object.keys(args.textos)) {
        if (!Object.prototype.hasOwnProperty.call(App.TEXTOS_PADRAO, chave)) recusar('texto-desconhecido', { chave: cortar(chave, 60) });
        const v = args.textos[chave];
        if (typeof v !== 'string' || v.length > 300) recusar('argumento-invalido', { campo: 'textos.' + cortar(chave, 60) });
        site = App.comTexto(site, chave, v);
      }
      const resumo = { efeito: 'textos-trocados', conteudoNaoConfiavel: Object.keys(args.textos).map((k) => ({ chave: k, antes: antes[k] || null, depois: site.textos[k] || null })) };
      if (igual(antes, site.textos)) return { dados: { ok: true, nadaMudou: true, rev: doc.rev || 0 } };
      if (args.confirmar !== true) return pedirConfirmacao(ctx, resumo);
      const r = await escreverCatalogo(ctx, (c) => { c.site = Object.assign({}, c.site || {}, { textos: site.textos }); }, args.rev);
      return { dados: { ok: true, rev: r.rev, textos: Object.keys(args.textos).length, historico: r.historico } };
    }
  }
];

export const FERRAMENTA_POR_NOME = new Map(FERRAMENTAS.map((f) => [f.nome, f]));
