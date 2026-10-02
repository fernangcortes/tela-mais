/* ia/campos.js — para onde cada sugestão vai: o campo do item do catálogo, como ler o valor de hoje (para o lado a lado),
 * como conferir o valor (o que vem do modelo, ou o que a pessoa editou) e como aplicar quando ela aceita.
 *
 * `aplicar(item, valor, opcoes)` MUTA a cópia do item que sugestoes.js prepara; quem grava é o `gravarCatalogo` (o mesmo
 * caminho do PUT da mesa: permissão por campo, 409, histórico). `editado` diz se a pessoa mexeu no texto antes de aceitar. */
import { validarSchema } from '../config-validar.mjs';

export const REGEX_LEGENDA = /^legenda-([a-z]{2}(?:-[A-Za-z]{2})?)$/;
export const LIMITE_LEGENDA_CARACTERES = 2 * 1024 * 1024;

const texto = (min, max) => ({ type: 'string', minLength: min, maxLength: max });
const unicas = (lista) => { const v = new Set(); return lista.filter((t) => { const k = String(t).trim().toLowerCase(); if (!k || v.has(k)) return false; v.add(k); return true; }); };

const URL_HTTPS = { type: 'string', pattern: '^https://[^\\s]+$', maxLength: 500 };

const SCHEMAS = {
  sinopse: texto(5, 900),
  sinopse_longa: texto(60, 2500),
  titulo_alternativo: texto(5, 120),
  descricao_acessivel: texto(10, 400),
  capitulos: {
    type: 'array', minItems: 1, maxItems: 30,
    items: { type: 'object', required: ['inicio', 'titulo'], properties: { inicio: { type: 'integer', minimum: 0 }, titulo: texto(1, 120) }, additionalProperties: false }
  },
  midia_clipe: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: { url: URL_HTTPS, posterUrl: URL_HTTPS, duracao: { type: 'number', minimum: 0, maximum: 60 }, bytes: { type: 'integer', minimum: 1, maximum: 4000000 } }
  },
  midia_trailer: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: {
      url: URL_HTTPS, posterUrl: URL_HTTPS, duracao: { type: 'number', minimum: 0, maximum: 61 }, bytes: { type: 'integer', minimum: 1 },
      trechos: { type: 'array', maxItems: 12, items: { type: 'object', required: ['inicio', 'fim'], additionalProperties: false, properties: { inicio: { type: 'number', minimum: 0 }, fim: { type: 'number', minimum: 0 }, motivo: { type: 'string', maxLength: 300 } } } }
    }
  },
  tags: {
    type: 'object', required: ['tags'], additionalProperties: false,
    properties: { tema: texto(0, 60), tags: { type: 'array', maxItems: 20, items: texto(2, 40) }, tagsNovas: { type: 'array', maxItems: 10, items: texto(2, 40) } }
  }
};

export const CAMPOS = {
  sinopse: {
    tarefa: 'sinopse-curta',
    ler: (i) => i.sinopse || '',
    aplicar(item, valor, { editado }) { item.sinopse = valor; item.sinopse_origem = editado ? 'revisada' : 'auto'; }
  },
  sinopse_longa: { tarefa: 'sinopse-longa', ler: (i) => i.sinopse_longa || '', aplicar(item, valor) { item.sinopse_longa = valor; } },
  capitulos: { tarefa: 'capitulos', ler: (i) => (Array.isArray(i.capitulos) ? i.capitulos : []), aplicar(item, valor) { item.capitulos = valor.map((c) => ({ inicio: c.inicio, titulo: c.titulo })); } },
  tags: {
    tarefa: 'tags',
    ler: (i) => ({ tema: i.tema || '', tags: Array.isArray(i.tags) ? i.tags : [] }),
    /* UNIÃO: as tags que a pessoa já pôs não somem. As "tagsNovas" só entram se ela marcar (`incluirTagsNovas`). */
    aplicar(item, valor, { incluirTagsNovas }) {
      if (valor.tema) item.tema = valor.tema;
      item.tags = unicas((Array.isArray(item.tags) ? item.tags : []).concat(valor.tags || [], incluirTagsNovas ? (valor.tagsNovas || []) : []));
    }
  },
  titulo_alternativo: { tarefa: 'titulo-alternativo', ler: (i) => i.titulo_alternativo || '', aplicar(item, valor) { item.titulo_alternativo = valor; } },
  /* Mídia gerada (clipe de fundo e trailer, scripts/trailer.mjs). Aceitar = uma pessoa assistiu e quer no ar: o carimbo entra em
   * `midia_gerada.proveniencia` com revisado:true, que é o que o Worker exige para pôr `clipe`/`trailer` em `item.midia`. */
  midia_clipe: {
    tarefa: 'trailer', midia: true,
    ler: (i) => (i.midia_gerada && i.midia_gerada.clipe ? { url: i.midia_gerada.clipe, posterUrl: i.midia_gerada.clipePoster || null } : null),
    aplicar(item, valor, { carimbo }) {
      item.midia_gerada = Object.assign({}, item.midia_gerada, { clipe: valor.url, clipePoster: valor.posterUrl || null, proveniencia: Object.assign({}, carimbo, { revisado: true }) });
    }
  },
  midia_trailer: {
    tarefa: 'trailer', midia: true,
    ler: (i) => (i.midia_gerada && i.midia_gerada.trailer ? { url: i.midia_gerada.trailer, posterUrl: i.midia_gerada.trailerPoster || null } : null),
    aplicar(item, valor, { carimbo }) {
      item.midia_gerada = Object.assign({}, item.midia_gerada, { trailer: valor.url, trailerPoster: valor.posterUrl || null, proveniencia: Object.assign({}, carimbo, { revisado: true }) });
    }
  },
  descricao_acessivel: { tarefa: 'descricao-acessivel', ler: (i) => i.descricao_acessivel || '', aplicar(item, valor) { item.descricao_acessivel = valor; } }
};

export function ehCampoDeLegenda(campo) {
  return REGEX_LEGENDA.test(String(campo));
}

export function idiomaDaLegenda(campo) {
  const m = String(campo).match(REGEX_LEGENDA);
  return m ? m[1] : null;
}

export function campoValido(campo) {
  return Object.prototype.hasOwnProperty.call(CAMPOS, campo) || ehCampoDeLegenda(campo);
}

/* null = o valor serve para este campo; senão, a frase do problema. */
export function validarValor(campo, valor) {
  if (ehCampoDeLegenda(campo)) {
    if (typeof valor !== 'string' || !/-->/.test(valor)) return 'a legenda precisa ser um texto SRT ou VTT.';
    if (valor.length > LIMITE_LEGENDA_CARACTERES) return 'a legenda é grande demais.';
    return null;
  }
  const schema = SCHEMAS[campo];
  if (!schema) return 'campo desconhecido: ' + campo;
  const erros = validarSchema(schema, valor);
  if (erros.length) return erros[0].caminho + ': ' + erros[0].mensagem;
  if (campo === 'capitulos') {
    for (let i = 1; i < valor.length; i++) if (valor[i].inicio <= valor[i - 1].inicio) return 'os inícios dos capítulos precisam crescer.';
  }
  return null;
}

/* O valor que o item tem HOJE neste campo (para o lado a lado). Legenda: null (quem sabe é o provedor de vídeo). */
export function valorAtual(campo, item) {
  if (!item) return null;
  const c = CAMPOS[campo];
  return c ? c.ler(item) : null;
}
