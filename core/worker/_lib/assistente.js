/* _lib/assistente.js — o que o assistente de configuração do /admin precisa do servidor.
 *
 * O assistente edita a MESMA configuração que o `setup.mjs` (o config/site.json): este módulo é a versão do
 * Worker das contas de `init`, `marca`, `acesso` e `video`. Tudo aqui é função pura (sem KV, sem rede), e por isso
 * os testes a exercitam direto.
 *
 * O QUE O ASSISTENTE NÃO FAZ: não grava config/site.json (o Worker não escreve no repositório do cliente) e não recebe
 * segredo. Ele GERA o arquivo novo, validado pelo mesmo validador do deploy, e a pessoa o baixa e republica. As chaves
 * do provedor de vídeo nunca passam pelo navegador: o assistente só diz o NOME de cada segredo e onde colar.
 *
 * Os textos que a pessoa lê moram nos catálogos de idioma (core/locales); aqui só há códigos, ids e dados. */
import arquivoEmpacotado from '../../../config/site.json' with { type: 'json' };
import esquemaEmpacotado from '../../../config/site.schema.json' with { type: 'json' };
import criador from '../../presets/criador.json' with { type: 'json' };
import empresa from '../../presets/empresa.json' with { type: 'json' };
import escola from '../../presets/escola.json' with { type: 'json' };
import festival from '../../presets/festival.json' with { type: 'json' };
import igreja from '../../presets/igreja.json' with { type: 'json' };
import infoprodutor from '../../presets/infoprodutor.json' with { type: 'json' };
import prefeitura from '../../presets/prefeitura.json' with { type: 'json' };
import { PRESETS as TEMAS, PRESET_PADRAO } from '../../presets/temas/index.mjs';
import { validarConfig, ehReferenciaEnv, clonar } from './config-validar.mjs';
import { contraste, verificarPaleta, sugerirCorParaPares, normalizarHex, ehHex, paraRgb, deRgb, PARES_DE_CONTRASTE } from './contraste.mjs';
import { resolverTema } from './tema.mjs';
import { listarProvedores, moduloDe, criarProvedor } from './provedores/index.js';

export const ARQUIVO_DE_IMPLANTACAO = arquivoEmpacotado;
export const ESQUEMA_DA_CONFIG = esquemaEmpacotado;
export const PRESETS_DE_USO = Object.freeze([criador, empresa, escola, festival, igreja, infoprodutor, prefeitura]);
export const IDIOMAS_DO_PRODUTO = Object.freeze(['pt-BR', 'en', 'es']);
export const MODOS_DE_ACESSO = Object.freeze(['publico', 'cadastro', 'privado']);
export const MODOS_DE_TEMA = Object.freeze(['escuro', 'claro', 'auto']);

/* Variáveis que são só identificadores (aparecem em endereços e no painel): não são senha. É a mesma lista do `setup.mjs`
 * (scripts/lib/setup/credenciais.mjs); um teste confere que as duas não se afastam. */
export const NAO_SECRETAS = Object.freeze(new Set([
  'BUNNY_LIBRARY_ID', 'BUNNY_PULLZONE', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_STREAM_SUBDOMINIO', 'CLOUDFLARE_STREAM_KEY_ID'
]));

/* As credenciais que, nos modos restritos, ligam a assinatura do vídeo (mesma lista do setup). */
export const CREDENCIAIS_DE_ASSINATURA = Object.freeze({
  bunny: ['hostDaPullZone', 'chaveDeToken'],
  'cloudflare-stream': ['chaveAssinaturaId', 'chaveAssinaturaJwk']
});

/* Onde criar a conta de cada provedor (endereços, não texto de tela). */
export const LINKS_DO_PROVEDOR = Object.freeze({
  bunny: { conta: 'https://bunny.net/', docs: 'https://docs.bunny.net/stream' },
  'cloudflare-stream': { conta: 'https://dash.cloudflare.com/', docs: 'https://developers.cloudflare.com/stream/' },
  'hls-generico': { conta: '', docs: 'https://developer.mozilla.org/docs/Web/Media/Guides/Audio_and_video_delivery/Live_streaming_web_audio_and_video' }
});

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mesclar(base, cima) {
  if (!ehObjeto(base) || !ehObjeto(cima)) return clonar(cima);
  const saida = clonar(base);
  for (const [k, v] of Object.entries(cima)) saida[k] = ehObjeto(v) && ehObjeto(saida[k]) ? mesclar(saida[k], v) : clonar(v);
  return saida;
}

function lerCaminho(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
function definirCaminho(obj, caminho, valor) {
  const partes = caminho.split('.');
  let o = obj;
  for (const k of partes.slice(0, -1)) { if (!ehObjeto(o[k])) o[k] = {}; o = o[k]; }
  o[partes[partes.length - 1]] = valor;
}

/* ------------------------------------------------------------------ o que o assistente oferece */

/* Resumo de um preset de caso de uso: o que ele escolhe por você (para mostrar ANTES de aplicar). */
export function resumoDoPreset(p) {
  const c = p.config || {};
  return {
    id: p.id,
    nome: p.nome || p.id,
    resumo: p.resumo || '',
    sugere: {
      tema: (c.tema && c.tema.preset) || null,
      modoDeTema: (c.tema && c.tema.modo) || null,
      acesso: (c.acesso && c.acesso.modo) || null,
      modeloDeConteudo: (c.catalogo && c.catalogo.modeloDeConteudo) || null,
      legendas: Boolean(c.recursos && c.recursos.legendas),
      continuarAssistindo: Boolean(c.recursos && c.recursos.continuarAssistindo),
      blocos: ((c.home && c.home.blocos) || []).map((b) => b.tipo)
    },
    /* A parte OPERACIONAL do preset: o que o assistente grava no catálogo (campo `site`), pelo PUT validado. */
    home: { blocos: clonar((c.home && c.home.blocos) || []), modeloDeConteudo: (c.catalogo && c.catalogo.modeloDeConteudo) || null }
  };
}

export function listarPresetsDeUso() {
  return PRESETS_DE_USO.map(resumoDoPreset);
}

export function presetDeUso(id) {
  return PRESETS_DE_USO.find((p) => p.id === id) || null;
}

/* O que se pode dizer de um provedor sem rede: as variáveis dele e as capacidades. `env` só diz se cada NOME está
 * presente (nunca o valor). */
export function descreverProvedor(id, config, env) {
  const modulo = moduloDe(id);
  if (!modulo) return null;
  const bloco = (config && config.video && config.video[modulo.CHAVE_CONFIG]) || {};
  const assinatura = CREDENCIAIS_DE_ASSINATURA[id] || [];
  const credenciais = Object.entries(modulo.CREDENCIAIS).map(([nome, def]) => {
    const ref = bloco[nome];
    const variavel = ehReferenciaEnv(ref) ? ref.$env : def.env;
    const valor = env ? env[variavel] : undefined;
    return {
      nome,
      env: variavel,
      secreta: !NAO_SECRETAS.has(variavel) && def.segredo !== false,
      obrigatoria: def.obrigatoria === true,
      assinatura: assinatura.includes(nome),
      presente: typeof valor === 'string' && valor !== ''
    };
  });
  let capacidades = {};
  try {
    const c = criarProvedor({ video: { provedor: id } }, {}).capacidades();
    /* `assinatura` aqui é "o provedor SABE assinar" (tem chaves de assinatura previstas), e não "já está configurado para assinar" */
    capacidades = { assinatura: assinatura.length > 0, envio: c.envio === true, drm: c.drm || 'nenhum', legendaIA: c.legendaIA === true, previa: c.previa === true, fontePorUrl: c.fontePorUrl === true };
  } catch (e) {
    capacidades = {};
  }
  return { id, credenciais, capacidades, links: LINKS_DO_PROVEDOR[id] || { conta: '', docs: '' } };
}

/* O ponto de partida do assistente: o que o arquivo de implantação diz hoje + as escolhas possíveis. Nada de segredo. */
export function dadosDoAssistente({ config, env, arquivo = arquivoEmpacotado }) {
  const base = ehObjeto(arquivo) ? arquivo : {};
  const efetivo = ehObjeto(config) ? config : {};
  const tema = resolverTema({ tema: base.tema });
  const provedorAtual = (base.video && base.video.provedor) || 'bunny';
  return {
    atual: {
      preset: base.preset || null,
      marca: {
        nome: (base.marca && base.marca.nome) || '',
        nomeCurto: (base.marca && base.marca.nomeCurto) || '',
        slogan: (base.marca && base.marca.slogan) || ''
      },
      tema: { preset: tema.preset, modo: tema.modo, cores: { escuro: { marca: tema.cores.escuro.marca }, claro: { marca: tema.cores.claro.marca } } },
      acesso: (base.acesso && base.acesso.modo) || 'privado',
      video: { provedor: provedorAtual, hlsBaseUrl: (base.video && base.video.hlsGenerico && base.video.hlsGenerico.baseUrl) || '' },
      idiomas: {
        padrao: (base.idiomas && base.idiomas.padrao) || 'pt-BR',
        disponiveis: (base.idiomas && base.idiomas.disponiveis) || ['pt-BR']
      },
      modeloDeConteudo: (base.catalogo && base.catalogo.modeloDeConteudo) || 'seriado'
    },
    nomeDoProjeto: (base.implantacao && base.implantacao.nomeDoProjeto) || '',
    temas: Object.keys(TEMAS).map((id) => ({ id, modoPadrao: TEMAS[id].modoPadrao || 'escuro' })),
    presets: listarPresetsDeUso(),
    provedores: listarProvedores().map((id) => descreverProvedor(id, efetivo, env)).filter(Boolean),
    idiomasDoProduto: IDIOMAS_DO_PRODUTO.slice()
  };
}

/* ------------------------------------------------------------------ cor da marca */

const misturar = (a, b, t) => { const x = paraRgb(a), y = paraRgb(b); return deRgb(x.map((v, i) => v + (y[i] - v) * t)); };

/* A paleta de um esquema a partir de UMA cor da marca, mantendo o contraste que o validador exige. É a mesma conta do
 * `setup.mjs marca` (derivarPaleta); tests/assistente.test.js confere as duas lado a lado. */
export function derivarPaleta(corBase, esquema, cores) {
  const base = normalizarHex(corBase);
  const marcaFraca = misturar(cores.fundo, base, esquema === 'escuro' ? 0.14 : 0.12);
  const pares = [cores.fundo, cores.superficie, cores.mesaPainel, marcaFraca].filter(Boolean).map((fundo) => ({ fundo, minimo: 4.5 }));
  const marca = sugerirCorParaPares(base, pares);
  const marcaClara = esquema === 'escuro' ? misturar(marca, '#ffffff', 0.2) : misturar(marca, '#000000', 0.2);
  const candidatos = ['#ffffff', '#000000'];
  const pior = (t) => Math.min(contraste(t, marca), contraste(t, marcaClara));
  const textoSobreMarca = candidatos.sort((p, q) => pior(q) - pior(p))[0];
  return { marca, marcaClara, marcaFraca, marca2: marca, textoSobreMarca, ajustada: marca !== base };
}

const ARREDONDAR = (n) => Math.round(n * 100) / 100;

/* Avalia a escolha de cor e de tema para a tela: para cada esquema que vai aparecer, a cor pedida, a cor que vale (a mais
 * próxima que se lê bem), as razões de contraste que a pessoa entende (texto, link, botão) e as falhas do validador.
 *   entrada: { cor?, corClara?, tema?: { preset?, modo? } }  — hex #rgb/#rrggbb
 *   saída:   { ok, modo, esquemas: { escuro?, claro? } } ou { ok: false, codigo, campo } */
export function avaliarMarca(entrada) {
  const e = ehObjeto(entrada) ? entrada : {};
  const tema = ehObjeto(e.tema) ? e.tema : {};
  const presetDoTema = Object.prototype.hasOwnProperty.call(TEMAS, tema.preset) ? tema.preset : PRESET_PADRAO;
  const modo = MODOS_DE_TEMA.includes(tema.modo) ? tema.modo : (TEMAS[presetDoTema].modoPadrao || 'escuro');
  for (const campo of ['cor', 'corClara']) {
    if (e[campo] !== undefined && e[campo] !== null && e[campo] !== '' && !ehHex(e[campo])) return { ok: false, codigo: 'cor-invalida', campo };
  }
  const resolvido = resolverTema({ tema: { preset: presetDoTema, modo } });
  const esquemas = {};
  for (const esq of resolvido.modos) {
    const pedida = esq === 'escuro' ? (e.cor || null) : (e.corClara || e.cor || null);
    const cores = Object.assign({}, resolvido.cores[esq]);
    let derivada = null;
    if (pedida) {
      derivada = derivarPaleta(pedida, esq, cores);
      for (const k of ['marca', 'marcaClara', 'marcaFraca', 'marca2', 'textoSobreMarca']) cores[k] = derivada[k];
    }
    const falhas = verificarPaleta(cores, { prefixo: 'tema.cores.' + esq });
    const razao = (a, b) => ARREDONDAR(contraste(cores[a], cores[b]));
    esquemas[esq] = {
      pedida: pedida ? normalizarHex(pedida) : null,
      usada: cores.marca,
      /* "ajustada" é o que se avisa à pessoa: a cor pedida não se lê sobre o fundo. Mexida de décimos para caber no fundo discreto da
       * marca (que depende da própria cor) não é aviso: a cor vale, e a usada acompanha. */
      ajustada: derivada ? derivada.ajustada && contraste(normalizarHex(pedida), cores.fundo) < 4.5 : false,
      razaoDaPedida: pedida ? ARREDONDAR(contraste(normalizarHex(pedida), cores.fundo)) : null,
      razoes: {
        texto: razao('texto', 'fundo'),
        textoFraco: razao('textoFraco', 'fundo'),
        link: razao('marca', 'fundo'),
        botao: razao('textoSobreMarca', 'marca')
      },
      minimos: { texto: 4.5, controle: 3 },
      falhas: falhas.map((f) => ({ campo: f.campo, contra: f.contra, razao: ARREDONDAR(f.razao), minimo: f.minimo, sugestao: f.sugestao })),
      paleta: Object.fromEntries(['fundo', 'superficie', 'texto', 'textoFraco', 'marca', 'marcaClara', 'marcaFraca', 'textoSobreMarca', 'contorno', 'borda'].map((k) => [k, cores[k]]))
    };
  }
  return { ok: true, modo, preset: presetDoTema, esquemas };
}

/* ------------------------------------------------------------------ o config/site.json novo */

const SLUG_IDIOMA = /^[a-z]{2}(-[A-Z]{2})?$/;
const SLUG_PROJETO = /^[a-z0-9][a-z0-9-]{1,56}[a-z0-9]$/;

/* Lista as diferenças folha a folha entre dois objetos de configuração: ["marca.nome", "tema.cores.escuro.marca", ...]. */
export function caminhosMudados(antes, depois, prefixo = '') {
  const saida = [];
  const chaves = new Set([...Object.keys(ehObjeto(antes) ? antes : {}), ...Object.keys(ehObjeto(depois) ? depois : {})]);
  for (const k of [...chaves].sort()) {
    const a = ehObjeto(antes) ? antes[k] : undefined;
    const d = ehObjeto(depois) ? depois[k] : undefined;
    const caminho = prefixo ? prefixo + '.' + k : k;
    if (ehObjeto(a) && ehObjeto(d)) saida.push(...caminhosMudados(a, d, caminho));
    else if (JSON.stringify(a) !== JSON.stringify(d)) saida.push(caminho);
  }
  return saida;
}

/* Aplica as escolhas do assistente sobre o arquivo de implantação e valida. Nunca lança.
 *   escolhas: { preset?, nome?, nomeCurto?, slogan?, cor?, corClara?, tema?:{preset?,modo?}, acesso?, provedor?,
 *               hlsBaseUrl?, idiomas?:{padrao?,disponiveis?}, projeto? }
 *   devolve:  { ok, config?, texto?, erros[], mudancas[], precisaRepublicar } */
export function gerarConfig(arquivo, escolhas, esquema = esquemaEmpacotado) {
  const e = ehObjeto(escolhas) ? escolhas : {};
  const base = clonar(ehObjeto(arquivo) ? arquivo : arquivoEmpacotado);
  const erros = [];
  const falha = (campo, codigo, params) => erros.push({ campo, codigo, params: params || null });

  let novo = clonar(base);
  if (e.preset !== undefined && e.preset !== null && e.preset !== '') {
    const p = presetDeUso(e.preset);
    if (!p) falha('preset', 'preset-desconhecido');
    else { novo = mesclar(novo, p.config); novo.preset = p.id; }
  }

  if (e.nome !== undefined) {
    const nome = String(e.nome || '').trim();
    if (!nome || nome.length > 60) falha('nome', 'nome-invalido');
    else {
      definirCaminho(novo, 'marca.nome', nome);
      const curto = e.nomeCurto !== undefined ? String(e.nomeCurto || '').trim() : (nome.length <= 12 ? nome : nome.split(/\s+/)[0].slice(0, 12));
      if (curto) definirCaminho(novo, 'marca.nomeCurto', curto.slice(0, 12));
      /* a descrição do modelo cita o nome de exemplo: acompanha o nome novo, senão a marca-fantasma vai para o ar */
      const nomeAntes = String(lerCaminho(base, 'marca.nome') || '');
      const descAntes = String(lerCaminho(novo, 'marca.descricao') || '');
      if (nomeAntes && descAntes.includes(nomeAntes) && descAntes === String(lerCaminho(base, 'marca.descricao') || '')) {
        definirCaminho(novo, 'marca.descricao', descAntes.split(nomeAntes).join(nome).slice(0, 200));
      }
      if (!lerCaminho(novo, 'marca.organizacao') || lerCaminho(novo, 'marca.organizacao') === lerCaminho(base, 'marca.organizacao')) definirCaminho(novo, 'marca.organizacao', nome);
    }
  } else if (e.nomeCurto !== undefined) {
    const curto = String(e.nomeCurto || '').trim();
    if (!curto || curto.length > 12) falha('nomeCurto', 'nome-curto-invalido'); else definirCaminho(novo, 'marca.nomeCurto', curto);
  }
  if (e.slogan !== undefined) {
    const s = String(e.slogan || '').trim();
    if (s.length > 120) falha('slogan', 'slogan-longo'); else definirCaminho(novo, 'marca.slogan', s);
  }

  if (ehObjeto(e.tema)) {
    if (e.tema.preset !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(TEMAS, e.tema.preset)) falha('tema.preset', 'tema-desconhecido');
      else definirCaminho(novo, 'tema.preset', e.tema.preset);
    }
    if (e.tema.modo !== undefined) {
      if (!MODOS_DE_TEMA.includes(e.tema.modo)) falha('tema.modo', 'modo-de-tema-invalido');
      else definirCaminho(novo, 'tema.modo', e.tema.modo);
    }
  }
  for (const campo of ['cor', 'corClara']) {
    if (e[campo] !== undefined && e[campo] !== null && e[campo] !== '' && !ehHex(e[campo])) falha(campo, 'cor-invalida');
  }
  if ((e.cor && ehHex(e.cor)) || (e.corClara && ehHex(e.corClara))) {
    const resolvido = resolverTema({ tema: novo.tema });
    for (const esq of ['escuro', 'claro']) {
      const pedida = esq === 'escuro' ? e.cor : (e.corClara || e.cor);
      if (!pedida || !ehHex(pedida)) continue;
      const p = derivarPaleta(pedida, esq, resolvido.cores[esq]);
      for (const k of ['marca', 'marcaClara', 'marcaFraca', 'marca2', 'textoSobreMarca']) definirCaminho(novo, `tema.cores.${esq}.${k}`, p[k]);
    }
  }

  if (e.acesso !== undefined) {
    if (!MODOS_DE_ACESSO.includes(e.acesso)) falha('acesso', 'modo-de-acesso-invalido');
    else {
      novo.acesso = Object.assign({}, novo.acesso, { modo: e.acesso });
      /* o mesmo que `setup.mjs acesso`: cadastro que funciona sem serviço de e-mail, e vídeo assinado no privado */
      if (e.acesso === 'cadastro' && !lerCaminho(novo, 'acesso.cadastro.metodo') && (lerCaminho(novo, 'acesso.email.adaptador') ?? 'nenhum') === 'nenhum') {
        definirCaminho(novo, 'acesso.cadastro.metodo', 'email-e-senha');
        if (lerCaminho(novo, 'acesso.cadastro.verificarEmail') === undefined) definirCaminho(novo, 'acesso.cadastro.verificarEmail', false);
      }
      if (e.acesso === 'privado' && lerCaminho(novo, 'acesso.privado.assinarMidia') === undefined) definirCaminho(novo, 'acesso.privado.assinarMidia', true);
    }
  }

  if (e.provedor !== undefined) {
    if (!listarProvedores().includes(e.provedor)) falha('provedor', 'provedor-desconhecido');
    else definirCaminho(novo, 'video.provedor', e.provedor);
  }
  if (e.hlsBaseUrl !== undefined && e.hlsBaseUrl !== '') {
    if (!/^https:\/\/[^\s]+$/.test(String(e.hlsBaseUrl))) falha('hlsBaseUrl', 'endereco-invalido');
    else definirCaminho(novo, 'video.hlsGenerico.baseUrl', String(e.hlsBaseUrl));
  }

  if (ehObjeto(e.idiomas)) {
    const lista = Array.isArray(e.idiomas.disponiveis) ? e.idiomas.disponiveis : undefined;
    if (lista !== undefined) {
      if (!lista.length || lista.some((i) => typeof i !== 'string' || !SLUG_IDIOMA.test(i)) || new Set(lista).size !== lista.length) falha('idiomas.disponiveis', 'idiomas-invalidos');
      else definirCaminho(novo, 'idiomas.disponiveis', lista);
    }
    const disponiveis = lerCaminho(novo, 'idiomas.disponiveis') || ['pt-BR'];
    const padrao = e.idiomas.padrao !== undefined ? e.idiomas.padrao : (disponiveis.includes(lerCaminho(novo, 'idiomas.padrao')) ? lerCaminho(novo, 'idiomas.padrao') : disponiveis[0]);
    if (!disponiveis.includes(padrao)) falha('idiomas.padrao', 'idioma-padrao-fora-da-lista');
    else definirCaminho(novo, 'idiomas.padrao', padrao);
  }
  if (e.projeto !== undefined && e.projeto !== '') {
    if (!SLUG_PROJETO.test(String(e.projeto))) falha('projeto', 'projeto-invalido');
    else definirCaminho(novo, 'implantacao.nomeDoProjeto', String(e.projeto));
  }

  if (erros.length) return { ok: false, erros, mudancas: [], precisaRepublicar: false };

  const r = validarConfig(esquema, novo);
  if (!r.ok) {
    return { ok: false, erros: r.erros.slice(0, 12).map((x) => ({ campo: x.caminho, codigo: 'config-recusada', params: { detalhe: x.mensagem } })), mudancas: [], precisaRepublicar: false };
  }
  const mudancas = caminhosMudados(base, novo);
  return { ok: true, config: novo, texto: JSON.stringify(novo, null, 2) + '\n', erros: [], mudancas, precisaRepublicar: mudancas.length > 0 };
}

/* ------------------------------------------------------------------ a home inicial (parte operacional) */

/* Os blocos e o modelo de conteúdo que um preset de caso de uso põe na home. É a parte que vai ao KV (campo `site` do catálogo,
 * pelo PUT validado); o resto do preset é implantação e vai no site.json. */
export function homeDoPreset(id) {
  const p = presetDeUso(id);
  if (!p) return null;
  const c = p.config || {};
  return {
    blocos: clonar((c.home && c.home.blocos) || []),
    modeloDeConteudo: (c.catalogo && c.catalogo.modeloDeConteudo) || null
  };
}

export { PARES_DE_CONTRASTE };
