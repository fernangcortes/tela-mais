/* core/worker/_lib/config-validar.mjs — validador do config/site.json, sem dependências.
 *
 * ESM puro: roda igual no Node (scripts/validar-config.mjs, scripts/aplicar-config.mjs,
 * testes) e no Worker (core/worker/_lib/config.js). Mora em core/ — e não em scripts/ —
 * porque o produto não pode depender de uma pasta que o cliente costuma editar, e
 * `core/` é a parte que se atualiza por substituição. Os scripts importam daqui.
 *
 * Por que não usar uma biblioteca de JSON Schema: a regra do projeto é zero
 * dependência de runtime, e o que o schema usa cabe em ~200 linhas. O subconjunto
 * suportado é o que `config/site.schema.json` realmente usa:
 *   type (inclusive lista, "integer", "null"), enum, const, properties, required,
 *   additionalProperties (booleano ou schema), patternProperties, items, minItems,
 *   maxItems, minimum, maximum, minLength, maxLength, pattern, default,
 *   anyOf, oneOf, $ref local ("#/$defs/...").
 * Palavra-chave fora da lista é ignorada (não falha): o schema pode crescer, mas o
 * teste `config.test.js` confere que ele só usa o que está aqui.
 *
 * Mensagens em português claro, para quem não é programador: dizem ONDE (caminho
 * do campo, ex.: "tema.cores.escuro.marca") e O QUE fazer.
 */

export const PALAVRAS_SUPORTADAS = new Set([
  '$schema', '$id', '$comment', '$defs', '$ref', 'title', 'description', 'examples',
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties',
  'patternProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'default', 'anyOf', 'oneOf'
]);

/* ------------------------------------------------------------------ utilidades */

function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;   /* string, number, boolean, object, undefined */
}

function combinaTipo(v, tipo) {
  const t = tipoDe(v);
  if (tipo === t) return true;
  return tipo === 'number' && t === 'integer';
}

const NOMES_TIPO = {
  string: 'texto', number: 'número', integer: 'número inteiro', boolean: 'verdadeiro ou falso (true/false)',
  object: 'um bloco { ... }', array: 'uma lista [ ... ]', null: 'vazio (null)'
};

function rotuloTipos(tipos) {
  return tipos.map((t) => NOMES_TIPO[t] || t).join(' ou ');
}

export function clonar(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function resolverRef(raiz, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let atual = raiz;
  for (const parte of ref.slice(2).split('/')) {
    if (atual == null || typeof atual !== 'object') return null;
    atual = atual[parte.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return atual ?? null;
}

function juntar(caminho, chave) {
  return caminho ? `${caminho}.${chave}` : String(chave);
}

/* Aceita um schema com $ref e devolve o schema "de verdade". */
function efetivo(raiz, schema) {
  let s = schema;
  for (let i = 0; i < 10 && s && typeof s === 'object' && s.$ref; i++) {
    const alvo = resolverRef(raiz, s.$ref);
    if (!alvo) return {};
    const { $ref, ...resto } = s;
    s = { ...alvo, ...resto };
  }
  return s || {};
}

/* ------------------------------------------------------------------ validação */

/* Devolve a lista de problemas: [{ caminho, mensagem }]. Lista vazia = válido. */
export function validarSchema(schema, valor, raiz = schema, caminho = '') {
  const erros = [];
  const s = efetivo(raiz, schema);
  const onde = caminho || '(raiz)';

  if (s.anyOf || s.oneOf) {
    const alternativas = s.anyOf || s.oneOf;
    const resultados = alternativas.map((alt) => validarSchema(alt, valor, raiz, caminho));
    const boas = resultados.filter((r) => r.length === 0).length;
    const ok = s.anyOf ? boas >= 1 : boas === 1;
    if (!ok) {
      /* Mostra o problema da alternativa que mais se aproximou: a menor lista de erros. */
      const melhor = resultados.slice().sort((a, b) => a.length - b.length)[0] || [];
      if (melhor.length && boas === 0) erros.push(...melhor);
      else erros.push({ caminho: onde, mensagem: 'o valor encaixa em mais de um formato; deixe só um.' });
    }
  }

  if (s.type !== undefined) {
    const tipos = Array.isArray(s.type) ? s.type : [s.type];
    if (!tipos.some((t) => combinaTipo(valor, t))) {
      erros.push({ caminho: onde, mensagem: `deve ser ${rotuloTipos(tipos)}, mas veio ${NOMES_TIPO[tipoDe(valor)] || tipoDe(valor)}.` });
      return erros;   /* sem o tipo certo, as outras regras não fazem sentido */
    }
  }

  if (s.const !== undefined && JSON.stringify(valor) !== JSON.stringify(s.const)) {
    erros.push({ caminho: onde, mensagem: `deve ser exatamente ${JSON.stringify(s.const)}.` });
  }

  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(valor))) {
    erros.push({ caminho: onde, mensagem: `valor não aceito (${JSON.stringify(valor)}). Use um destes: ${s.enum.map((e) => JSON.stringify(e)).join(', ')}.` });
  }

  if (typeof valor === 'string') {
    if (s.minLength !== undefined && valor.length < s.minLength) {
      erros.push({ caminho: onde, mensagem: `texto curto demais (mínimo ${s.minLength} caracteres).` });
    }
    if (s.maxLength !== undefined && valor.length > s.maxLength) {
      erros.push({ caminho: onde, mensagem: `texto longo demais (máximo ${s.maxLength} caracteres; tem ${valor.length}).` });
    }
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(valor)) {
      erros.push({ caminho: onde, mensagem: `formato inválido (${JSON.stringify(valor)}).${s.description ? ' ' + s.description : ''}` });
    }
  }

  if (typeof valor === 'number') {
    if (s.minimum !== undefined && valor < s.minimum) erros.push({ caminho: onde, mensagem: `deve ser no mínimo ${s.minimum}.` });
    if (s.maximum !== undefined && valor > s.maximum) erros.push({ caminho: onde, mensagem: `deve ser no máximo ${s.maximum}.` });
  }

  if (Array.isArray(valor)) {
    if (s.minItems !== undefined && valor.length < s.minItems) erros.push({ caminho: onde, mensagem: `a lista precisa ter pelo menos ${s.minItems} item(ns).` });
    if (s.maxItems !== undefined && valor.length > s.maxItems) erros.push({ caminho: onde, mensagem: `a lista pode ter no máximo ${s.maxItems} item(ns).` });
    if (s.items) valor.forEach((el, i) => erros.push(...validarSchema(s.items, el, raiz, `${caminho}[${i}]`)));
  }

  if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
    const props = s.properties || {};
    for (const obrigatorio of s.required || []) {
      if (!(obrigatorio in valor)) erros.push({ caminho: juntar(caminho, obrigatorio), mensagem: 'campo obrigatório, está faltando.' });
    }
    for (const [chave, v] of Object.entries(valor)) {
      if (chave === '$schema') continue;
      const cam = juntar(caminho, chave);
      let tratada = false;
      if (Object.prototype.hasOwnProperty.call(props, chave)) {
        erros.push(...validarSchema(props[chave], v, raiz, cam));
        tratada = true;
      }
      for (const [padrao, sub] of Object.entries(s.patternProperties || {})) {
        if (new RegExp(padrao, 'u').test(chave)) {
          erros.push(...validarSchema(sub, v, raiz, cam));
          tratada = true;
        }
      }
      if (!tratada) {
        if (s.additionalProperties === false) {
          const conhecidas = Object.keys(props);
          erros.push({ caminho: cam, mensagem: `campo desconhecido (provável erro de digitação).${conhecidas.length ? ' Campos aceitos aqui: ' + conhecidas.join(', ') + '.' : ''}` });
        } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          erros.push(...validarSchema(s.additionalProperties, v, raiz, cam));
        }
      }
    }
  }
  return erros;
}

/* ------------------------------------------------------------------ padrões */

/* Preenche os `default` do schema. Não muta a entrada. Um bloco ausente só é
 * criado se tiver algum padrão dentro, para não encher a config de {} vazios. */
export function aplicarPadroes(schema, valor, raiz = schema) {
  const s = efetivo(raiz, schema);
  if (valor === undefined) {
    if (s.default !== undefined) return clonar(s.default);
    if (s.type === 'object' && s.properties) {
      const novo = preencherObjeto(s, {}, raiz);
      return Object.keys(novo).length ? novo : undefined;
    }
    return undefined;
  }
  if (valor !== null && typeof valor === 'object' && !Array.isArray(valor) && s.properties) {
    return preencherObjeto(s, valor, raiz);
  }
  if (Array.isArray(valor) && s.items) {
    return valor.map((el) => {
      const r = aplicarPadroes(s.items, el, raiz);
      return r === undefined ? el : r;
    });
  }
  return clonar(valor);
}

function preencherObjeto(s, valor, raiz) {
  const saida = clonar(valor);
  for (const [chave, sub] of Object.entries(s.properties)) {
    const r = aplicarPadroes(sub, saida[chave], raiz);
    if (r !== undefined) saida[chave] = r;
  }
  return saida;
}

/* ------------------------------------------------------------------ segredos */

/* Segredo só entra como {"$env":"NOME"}. Duas redes de proteção:
 *   1. o FORMATO do valor (chave de API, token, hash longo...);
 *   2. o NOME do campo (chave, senha, token...) com um texto qualquer dentro.
 * Pode haver falso positivo (ex.: um slogan com 40 letras coladas); a mensagem
 * explica como proceder. Falso negativo é o que importa evitar. */
const PADROES_SEGREDO = [
  [/^sk-[A-Za-z0-9_-]{16,}/, 'parece uma chave de API (sk-...)'],
  [/^(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/, 'parece um token do GitHub'],
  [/^xox[abprs]-[A-Za-z0-9-]{10,}/, 'parece um token do Slack'],
  [/^AKIA[0-9A-Z]{16}$/, 'parece uma chave de acesso da AWS'],
  [/^AIza[0-9A-Za-z_-]{30,}$/, 'parece uma chave de API do Google'],
  [/^Bearer\s+\S{10,}/i, 'parece um cabeçalho de autorização'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'parece uma chave privada'],
  [/^[0-9a-f]{32,}$/i, 'parece um identificador secreto ou hash (hexadecimal longo)'],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'parece uma chave em formato UUID'],
  /* Texto longo sem espaços, com letras E números misturados: slug comprido só de letras não pega. */
  [/^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}$/, 'parece uma chave codificada (texto longo sem espaços)']
];

const NOME_SENSIVEL = /(chave|senha|segredo|token|secret|password|apikey|api_key|credencial)/i;

export function ehReferenciaEnv(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.$env === 'string';
}

export const NOME_ENV = /^[A-Z][A-Z0-9_]{1,63}$/;

export function acharSegredos(valor, caminho = '', chave = '') {
  const achados = [];
  if (ehReferenciaEnv(valor)) {
    if (!NOME_ENV.test(valor.$env)) {
      achados.push({ caminho, mensagem: `o nome da variável "${valor.$env}" não é válido: use só MAIÚSCULAS, números e _ (ex.: {"$env":"BUNNY_API_KEY"}).` });
    }
    return achados;
  }
  if (typeof valor === 'string') {
    for (const [re, motivo] of PADROES_SEGREDO) {
      if (re.test(valor)) {
        achados.push({ caminho, mensagem: `${motivo}. Segredo nunca vai neste arquivo: guarde-o como variável secreta e escreva aqui só {"$env":"NOME_DA_VARIAVEL"}.` });
        return achados;
      }
    }
    if (NOME_SENSIVEL.test(chave) && valor.trim() !== '') {
      achados.push({ caminho, mensagem: `o campo "${chave}" guarda um segredo, e segredo não vai escrito no arquivo. Troque o texto por {"$env":"NOME_DA_VARIAVEL"}.` });
    }
    return achados;
  }
  if (Array.isArray(valor)) {
    valor.forEach((el, i) => achados.push(...acharSegredos(el, `${caminho}[${i}]`, chave)));
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) achados.push(...acharSegredos(v, juntar(caminho, k), k));
  }
  return achados;
}

/* ------------------------------------------------------------------ cores (WCAG 2.x) */

export function luminancia(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const canal = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2];
}

export function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  const [alto, baixo] = la >= lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (baixo + 0.05);
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/* Regras que o schema sozinho não expressa. `config` já com padrões aplicados. */
export function validarSemantica(config) {
  const erros = [];
  const t = config.tema || {};
  const minTexto = t.validarContraste?.textoMinimo ?? 4.5;
  const minControle = t.validarContraste?.controleMinimo ?? 3;

  for (const esquema of ['escuro', 'claro']) {
    const c = t.cores?.[esquema];
    if (!c) continue;
    const par = (a, b, minimo, descricao) => {
      if (!HEX.test(c[a] || '') || !HEX.test(c[b] || '')) return;
      const razao = contraste(c[a], c[b]);
      if (razao < minimo) {
        erros.push({ caminho: `tema.cores.${esquema}.${a}`, mensagem: `contraste insuficiente: ${descricao} dá ${razao.toFixed(2).replace('.', ',')}:1, e o mínimo é ${String(minimo).replace('.', ',')}:1. Escolha cores mais distantes em claridade.` });
      }
    };
    par('texto', 'fundo', minTexto, 'o texto sobre o fundo');
    par('texto', 'superficie', minTexto, 'o texto sobre a superfície');
    par('textoFraco', 'fundo', minTexto, 'o texto fraco sobre o fundo');
    par('marca', 'fundo', minControle, 'a cor da marca sobre o fundo');
    par('contorno', 'fundo', minControle, 'o contorno dos controles sobre o fundo');
    if (c.textoSobreMarca) par('textoSobreMarca', 'marca', minTexto, 'o texto sobre a cor da marca');
  }

  const idi = config.idiomas;
  if (idi?.padrao && Array.isArray(idi.disponiveis) && !idi.disponiveis.includes(idi.padrao)) {
    erros.push({ caminho: 'idiomas.padrao', mensagem: `o idioma padrão "${idi.padrao}" precisa estar na lista idiomas.disponiveis.` });
  }
  const modo = config.acesso?.modo;
  if (modo === 'cadastro' && config.acesso?.cadastro?.turnstile === false) {
    erros.push({ caminho: 'acesso.cadastro.turnstile', mensagem: 'no modo "cadastro" a proteção anti-robô (Turnstile) é obrigatória. Use true, ou troque o modo para "privado".' });
  }
  return erros;
}

/* ------------------------------------------------------------------ orquestração */

/* Validação completa do arquivo: schema + segredos + semântica.
 * Devolve { ok, erros, config } — `config` já traz os padrões (só se ok). */
export function validarConfig(schema, bruto) {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ok: false, erros: [{ caminho: '(raiz)', mensagem: 'o arquivo de configuração precisa ser um bloco { ... } de JSON.' }], config: null };
  }
  const erros = [...validarSchema(schema, bruto), ...acharSegredos(bruto)];
  if (erros.length) return { ok: false, erros, config: null };
  const config = aplicarPadroes(schema, bruto);
  const sem = validarSemantica(config);
  if (sem.length) return { ok: false, erros: sem, config: null };
  return { ok: true, erros: [], config };
}

/* Texto para leigos: uma linha por problema. */
export function formatarErros(erros) {
  return erros.map((e) => `  - ${e.caminho}: ${e.mensagem}`).join('\n');
}
