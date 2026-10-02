/* ia/tarefas.js — o que a IA sabe fazer com texto, uma tarefa por entrada.
 *
 * Cada tarefa traz: o `campo` do catálogo a que a sugestão se destina, o `schema` da saída (o MESMO subconjunto do
 * validador de config), a conferência `validar` (regras que schema não expressa: limite de palavras, capítulos
 * crescentes, nome sem suporte na transcrição) e o `extrair` que transforma a resposta no valor da sugestão.
 *
 * `validar` devolve null (ok) ou uma frase curta que vira a CORREÇÃO pedida na retentativa. Nada aqui grava: a tarefa só diz
 * como pedir e como conferir. */
import { nomesSemSuporte, nomesSemSuporteEmTitulo, normalizar } from './anti-alucinacao.js';
import { sistemaBase, mensagemDoUsuario, INSTRUCOES, FORMATOS } from './prompts.js';
import { mmss } from './srt.js';

const ABERTURAS_PROIBIDAS = /^\s*(neste v[ií]deo|o v[ií]deo|este v[ií]deo|este material|in this video|the video|this video|en este v[ií]deo|el v[ií]deo)\b/i;
export const MIN_CARACTERES_DA_TRANSCRICAO = 200;

const palavras = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

/* A transcrição como texto corrido (de `transcricao`, ou dos `blocos`). */
export function textoDaEntrada(entrada) {
  if (typeof entrada.transcricao === 'string') return entrada.transcricao;
  if (Array.isArray(entrada.blocos)) return entrada.blocos.map((b) => b.texto).join(' ');
  return '';
}

/* A transcrição com os tempos, `[m:ss] texto` por linha (capítulos e trailers). */
export function textoComTempos(entrada) {
  if (Array.isArray(entrada.blocos)) return entrada.blocos.map((b) => '[' + mmss(b.inicio) + ' = ' + Math.floor(b.inicio) + ' s] ' + b.texto).join('\n');
  return '';
}

function fontesDeNomes(entrada, estilo) {
  return [textoDaEntrada(entrada), entrada.titulo || '', entrada.serie || '', estilo.glossario || [], entrada.nomes || []];
}

/* Nome próprio sem suporte e nome proibido: vale para todo texto livre gerado. */
function conferirTexto(texto, entrada, estilo, ehTitulo = false) {
  const proibidos = (estilo.nomesProibidos || []).filter((n) => normalizar(texto).includes(normalizar(n)));
  if (proibidos.length) return 'o texto cita "' + proibidos[0] + '", que o cliente proibiu; reescreva sem isso.';
  const sem = (ehTitulo ? nomesSemSuporteEmTitulo : nomesSemSuporte)(texto, ...fontesDeNomes(entrada, estilo));
  if (sem.length) return 'o texto cita "' + sem.slice(0, 3).join('", "') + '", que não aparece na transcrição nem no título; reescreva sem esse(s) nome(s).';
  return null;
}

const schemaTexto = (campo, min, max) => ({
  type: 'object', required: [campo], additionalProperties: false,
  properties: { [campo]: { type: 'string', minLength: min, maxLength: max } }
});

const suficienteTexto = (entrada) => textoDaEntrada(entrada).trim().length >= MIN_CARACTERES_DA_TRANSCRICAO;

export const TAREFAS = {
  'sinopse-curta': {
    nome: 'sinopse-curta', campo: 'sinopse', usaTranscricao: true, saidaTokens: 220,
    schema: schemaTexto('sinopse', 20, 900),
    suficiente: suficienteTexto,
    validar(v, { entrada, estilo }) {
      const n = palavras(v.sinopse).length;
      if (n > estilo.tamanhoSinopse) return 'a sinopse tem ' + n + ' palavras; o máximo é ' + estilo.tamanhoSinopse + '.';
      if (n < 5) return 'a sinopse é curta demais.';
      if (ABERTURAS_PROIBIDAS.test(v.sinopse)) return 'a sinopse não pode começar com "Neste vídeo", "O vídeo" ou equivalente.';
      return conferirTexto(v.sinopse, entrada, estilo);
    },
    extrair: (v) => v.sinopse.trim()
  },

  'sinopse-longa': {
    nome: 'sinopse-longa', campo: 'sinopse_longa', usaTranscricao: true, saidaTokens: 450,
    schema: schemaTexto('sinopse', 100, 2500),
    suficiente: suficienteTexto,
    validar(v, { entrada, estilo }) {
      const n = palavras(v.sinopse).length;
      if (n < 60 || n > 220) return 'a sinopse longa tem ' + n + ' palavras; precisa ter entre 80 e 200.';
      if (ABERTURAS_PROIBIDAS.test(v.sinopse)) return 'a sinopse não pode começar com "Neste vídeo", "O vídeo" ou equivalente.';
      return conferirTexto(v.sinopse, entrada, estilo);
    },
    extrair: (v) => v.sinopse.trim()
  },

  capitulos: {
    nome: 'capitulos', campo: 'capitulos', usaTranscricao: true, comTempos: true, saidaTokens: 900,
    schema: {
      type: 'object', required: ['capitulos'], additionalProperties: false,
      properties: {
        capitulos: {
          type: 'array', minItems: 2, maxItems: 15,
          items: {
            type: 'object', required: ['inicio', 'titulo'], additionalProperties: false,
            properties: { inicio: { type: 'integer', minimum: 0 }, titulo: { type: 'string', minLength: 3, maxLength: 80 } }
          }
        }
      }
    },
    suficiente: (entrada) => suficienteTexto(entrada) && Array.isArray(entrada.blocos) && Number(entrada.duracaoSeg) >= 120,
    validar(v, { entrada, estilo }) {
      const lista = v.capitulos;
      if (lista[0].inicio !== 0) return 'o primeiro capítulo precisa começar em 0 segundo.';
      for (let i = 1; i < lista.length; i++) {
        if (lista[i].inicio <= lista[i - 1].inicio) return 'os inícios precisam crescer (capítulo ' + (i + 1) + ').';
        if (lista[i].inicio - lista[i - 1].inicio < 20) return 'o capítulo ' + i + ' tem menos de 20 segundos.';
      }
      const dur = Number(entrada.duracaoSeg);
      if (dur && lista[lista.length - 1].inicio >= dur) return 'o último capítulo começa depois do fim do vídeo (' + Math.round(dur) + ' s).';
      for (const c of lista) {
        const p = conferirTexto(c.titulo, entrada, estilo, true);
        if (p) return p;
      }
      return null;
    },
    extrair: (v) => v.capitulos.map((c) => ({ inicio: c.inicio, titulo: c.titulo.trim() }))
  },

  tags: {
    nome: 'tags', campo: 'tags', usaTranscricao: true, saidaTokens: 220,
    schema: {
      type: 'object', required: ['tags'], additionalProperties: false,
      properties: {
        tema: { type: 'string', maxLength: 60 },
        tags: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 40 } },
        tagsNovas: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 2, maxLength: 40 } }
      }
    },
    suficiente: suficienteTexto,
    validar(v, { estilo }) {
      const voc = estilo.vocabularioTags || [];
      if (voc.length) {
        const ok = new Set(voc.map(normalizar));
        const fora = v.tags.filter((t) => !ok.has(normalizar(t)));
        if (fora.length) return 'a tag "' + fora[0] + '" não está na lista permitida; use só as da lista ou ponha em tagsNovas.';
      }
      return null;
    },
    extrair(v, { estilo }) {
      const canon = new Map((estilo.vocabularioTags || []).map((t) => [normalizar(t), t]));
      const unicas = (lista, jaVistos) => {
        const vistos = new Set(jaVistos);
        const saida = [];
        for (const bruto of lista) {
          const t = (canon.get(normalizar(bruto)) || String(bruto)).trim();
          const k = normalizar(t);
          if (t && !vistos.has(k)) { vistos.add(k); saida.push(t); }
        }
        return saida;
      };
      const tags = unicas(v.tags, []);
      return { tema: (v.tema || '').trim(), tags, tagsNovas: unicas(v.tagsNovas || [], tags.map(normalizar)) };
    }
  },

  'titulo-alternativo': {
    nome: 'titulo-alternativo', campo: 'titulo_alternativo', usaTranscricao: true, saidaTokens: 60,
    schema: schemaTexto('titulo', 5, 120),
    suficiente: suficienteTexto,
    validar(v, { entrada, estilo }) {
      if (v.titulo.length > 90) return 'o título tem ' + v.titulo.length + ' caracteres; o máximo é 90.';
      if (normalizar(v.titulo) === normalizar(entrada.titulo || '')) return 'o título proposto é igual ao atual.';
      return conferirTexto(v.titulo, entrada, estilo, true);
    },
    extrair: (v) => v.titulo.trim()
  },

  'descricao-acessivel': {
    nome: 'descricao-acessivel', campo: 'descricao_acessivel', usaTranscricao: true, saidaTokens: 150,
    schema: schemaTexto('descricao', 20, 400),
    suficiente: suficienteTexto,
    validar(v, { entrada, estilo }) {
      if (v.descricao.length > 280) return 'a descrição tem ' + v.descricao.length + ' caracteres; o máximo é 280.';
      return conferirTexto(v.descricao, entrada, estilo);
    },
    extrair: (v) => v.descricao.trim()
  },

  'traducao-legenda': {
    nome: 'traducao-legenda', campo: 'legenda', usaTranscricao: false, saidaTokens: null, /* saída ≈ entrada */
    schema: {
      type: 'object', required: ['cues'], additionalProperties: false,
      properties: {
        cues: { type: 'array', minItems: 1, items: { type: 'object', required: ['n', 'texto'], additionalProperties: false, properties: { n: { type: 'integer', minimum: 1 }, texto: { type: 'string', minLength: 1, maxLength: 1000 } } } }
      }
    },
    suficiente: (entrada) => Array.isArray(entrada.cues) && entrada.cues.length > 0,
    validar(v, { entrada }) {
      if (v.cues.length !== entrada.cues.length) return 'vieram ' + v.cues.length + ' itens e eram ' + entrada.cues.length + '; devolva exatamente um por item.';
      for (let i = 0; i < v.cues.length; i++) {
        if (v.cues[i].n !== entrada.cues[i].n) return 'o item ' + (i + 1) + ' veio com n=' + v.cues[i].n + ' e devia ser n=' + entrada.cues[i].n + '.';
      }
      return null;
    },
    extrair: (v) => v.cues.map((c) => ({ n: c.n, texto: c.texto }))
  },

  'trechos-trailer': {
    nome: 'trechos-trailer', campo: null, usaTranscricao: true, comTempos: true, saidaTokens: 400,
    schema: {
      type: 'object', required: ['trechos'], additionalProperties: false,
      properties: {
        trechos: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', required: ['inicio', 'fim'], additionalProperties: false, properties: { inicio: { type: 'number', minimum: 0 }, fim: { type: 'number', minimum: 0 }, motivo: { type: 'string', maxLength: 300 } } } }
      }
    },
    suficiente: (entrada) => suficienteTexto(entrada) && Array.isArray(entrada.blocos),
    validar(v, { entrada }) {
      const dur = Number(entrada.duracaoSeg) || Infinity;
      const alvo = Number(entrada.alvoSeg) || 45;
      let soma = 0;
      for (let i = 0; i < v.trechos.length; i++) {
        const t = v.trechos[i];
        if (t.fim <= t.inicio) return 'o trecho ' + (i + 1) + ' termina antes de começar.';
        if (t.fim > dur) return 'o trecho ' + (i + 1) + ' passa do fim do vídeo (' + Math.round(dur) + ' s).';
        if (i && t.inicio < v.trechos[i - 1].fim) return 'o trecho ' + (i + 1) + ' se sobrepõe ao anterior ou está fora de ordem.';
        const d = t.fim - t.inicio;
        if (d < 3 || d > 20) return 'o trecho ' + (i + 1) + ' dura ' + d.toFixed(1) + ' s; cada um precisa ter entre 3 e 20 s.';
        soma += d;
      }
      if (soma > alvo * 1.1) return 'os trechos somam ' + soma.toFixed(0) + ' s; o máximo é ' + Math.round(alvo * 1.1) + ' s.';
      if (soma < alvo * 0.4) return 'os trechos somam só ' + soma.toFixed(0) + ' s; precisam chegar perto de ' + alvo + ' s.';
      return null;
    },
    extrair: (v) => v.trechos.map((t) => ({ inicio: t.inicio, fim: t.fim, motivo: (t.motivo || '').trim() }))
  }
};

export const NOMES_DE_TAREFAS = Object.freeze(Object.keys(TAREFAS));

export function tarefaPorNome(nome) {
  return Object.prototype.hasOwnProperty.call(TAREFAS, nome) ? TAREFAS[nome] : null;
}

/* O par sistema/usuário que vai ao modelo. `correcao` é o motivo da recusa anterior (retentativa). */
export function montarPrompt(tarefa, entrada, estilo, correcao) {
  const instrucao = (INSTRUCOES[tarefa.nome] || (() => tarefa.instrucao || ''))(estilo, entrada);
  const formato = FORMATOS[tarefa.nome] || tarefa.formato || '{}';
  let transcricao;
  if (tarefa.nome === 'traducao-legenda') transcricao = JSON.stringify((entrada.cues || []).map((c) => ({ n: c.n, texto: c.texto })));
  else transcricao = tarefa.comTempos ? textoComTempos(entrada) : textoDaEntrada(entrada);
  let usuario = mensagemDoUsuario(entrada, transcricao, instrucao, formato);
  if (correcao) usuario += '\n\nSUA RESPOSTA ANTERIOR FOI RECUSADA: ' + correcao + ' Corrija e responda de novo, só com o JSON.';
  return { sistema: sistemaBase(estilo), usuario };
}

/* Estimativa de tokens de entrada de UMA chamada (conservadora: 3,2 caracteres por token, mais o prompt fixo). */
export const CARACTERES_POR_TOKEN = 3.2;
export const TOKENS_DO_PROMPT_FIXO = 450;
