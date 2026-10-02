/* provedores/contrato.js — a interface comum de provedor de vídeo (M4).
 *
 * UM ADAPTADOR POR PROVEDOR (bunny.js, cloudflare-stream.js, hls-generico.js).
 * O resto do projeto (handlers do Worker, scripts de carga, testes) só conhece
 * o que está descrito aqui; host, caminho de API, nome de arquivo de capa e
 * tabela de status de cada provedor ficam DENTRO do adaptador. O navegador
 * não conhece nada disso: recebe `item.midia`, já pronto (ver `Midia`).
 *
 * COMO UM ADAPTADOR SE APRESENTA. O módulo exporta:
 *
 *   ID              'bunny' | 'cloudflare-stream' | 'hls-generico' (igual a `video.provedor`)
 *   CHAVE_CONFIG    bloco de `config.video` do provedor ('bunny', 'cloudflareStream', 'hlsGenerico')
 *   CREDENCIAIS     { nomeNoConfig: { env: 'NOME_PADRAO_DA_VARIAVEL', obrigatoria: bool, segredo: bool } }
 *   criar(opcoes)   devolve o objeto adaptador (abaixo)
 *
 *   opcoes = {
 *     credenciais: { nomeNoConfig: 'valor' },   já resolvidas pelo registro (index.js), de env;
 *                                               só chaves que existem
 *     config: <config.video>,                    para o que não é segredo (tamanho do pedaço, qualidades...)
 *     fetch?: Function,                          injetável nos testes; padrão: globalThis.fetch lido NA HORA
 *     agora?: () => number                       relógio em milissegundos; padrão Date.now
 *   }
 *
 * REGRAS QUE VALEM PARA TODO ADAPTADOR (a suíte de contrato confere):
 *   1. Chave de API, token e segredo NUNCA saem do adaptador: nem em retorno,
 *      nem em mensagem de erro, nem em `cabecalhos` de um plano de upload (o
 *      que sai são credenciais de USO ÚNICO e curta duração, derivadas ou
 *      emitidas pelo provedor).
 *   2. Falha do provedor vira `ErroProvedor` (com `codigo` estável, `status`
 *      HTTP e `detalhe` curto). Nada de exceção crua de fetch para o handler.
 *   3. Todas as funções são assíncronas, EXCETO `capacidades`, `hostsMidia` e
 *      `padraoId`/`id`/`configurado` (propriedades). Funções que só montam URL
 *      (`urlCapa`, `urlPreview`, `urlReproducao`, `legendas` com `idiomas`) não
 *      fazem rede quando o provedor permite; são assíncronas porque a
 *      assinatura de URL (M5) é assíncrona (crypto.subtle).
 *   4. Nada de autoplay: se o provedor tem player embutido, o `embed.url` sai
 *      com autoplay/loop/preload desligados quando o provedor aceita o
 *      parâmetro. A suíte confere que nenhuma URL liga autoplay.
 *   5. Permissão, limite de vídeos, limite de duração, pedido de autorização,
 *      gravação no catálogo e escolha do modo de acesso são do NÚCLEO. O
 *      adaptador só fala com o provedor.
 *
 * O TIPO `Fonte` (o que o item do catálogo guarda no campo `fonte`):
 *
 *   { provedor: 'bunny', id: '<id do vídeo no provedor>', extras: { ... } }
 *
 * `extras` é o que o provedor precisa além do id e que NÃO é segredo (ex.:
 * `{ libraryId }` no Bunny). O formato antigo `{ tipo, libraryId, videoId }`
 * é migrado por `App.migrarFonte` (core/site/catalogo-core.js).
 *
 * O TIPO `Midia` (o que o servidor entrega em `item.midia`; é o ÚNICO jeito de
 * o navegador chegar ao vídeo):
 *
 *   {
 *     hls:      string|null,                       playlist HLS (o caminho principal; hls.js)
 *     mp4:      { '240p'?: url, '360p'?: url, '720p'?: url }|null,   reserva e seletor de capa
 *     capa:     string|null,                       URL final da capa (já com versão contra cache)
 *     previa:   string|null,                       imagem animada do hover (opcional)
 *     legendas: [{ idioma, rotulo, url }],         faixas conhecidas (o navegador busca com fetch)
 *     embed:    { url, scriptUrl?, controle? }|null  player embutido do provedor; `controle: 'playerjs'`
 *                                                  diz que `scriptUrl` fala postMessage (capítulos)
 *     expiraEm: number|null                        UNIX em segundos, se a URL é assinada (M5)
 *   }
 *
 * `montarMidia` (index.js) é quem chama o adaptador e monta isso; é puro do
 * ponto de vista do navegador e não faz rede quando o adaptador não precisa.
 */

import AppI18n from '../../../site/i18n.js';

/* ------------------------------------------------------------- vocabulário */

/** Estado do vídeo, normalizado (o `estadoBruto` do provedor vai ao lado, só para diagnóstico). */
export const ESTADOS = Object.freeze(['enviando', 'processando', 'pronto', 'erro']);

/** Como os bytes chegam ao provedor. 'nenhum' = o cliente envia pelo painel do provedor (HLS genérico). */
export const PROTOCOLOS_UPLOAD = Object.freeze(['tus', 'put', 's3-multipart', 'nenhum']);

export const NIVEIS_DRM = Object.freeze(['nenhum', 'basico', 'estudio']);

/** Funções que TODO adaptador implementa (mesmo que só para dizer `recurso-indisponivel`). */
export const FUNCOES_OBRIGATORIAS = Object.freeze([
  'capacidades', 'hostsMidia', 'validarCredenciais', 'criarUpload', 'retomarUpload', 'statusEncoding',
  'urlReproducao', 'urlCapa', 'definirCapa', 'urlPreview', 'legendas', 'enviarLegenda',
  'obterVideo', 'listar', 'excluir'
]);

/** Só existem quando `capacidades()` diz que sim (a ausência da função é a resposta), exceto `midia`: atalho de desempenho, sem capacidade. */
export const FUNCOES_OPCIONAIS = Object.freeze(['gerarLegendaIA', 'definirCapitulos', 'receberWebhook', 'uso', 'midia', 'prepararFonte']);

/** Códigos de `ErroProvedor.codigo`. Cada um tem `api.<codigo>` em core/locales/*.json. */
export const CODIGOS_ERRO = Object.freeze([
  'provedor-nao-configurado',    /* faltam credenciais obrigatórias */
  'provedor-recusou-criacao',    /* criarUpload/criar vídeo */
  'provedor-sem-guid',           /* o provedor aceitou e não devolveu o id */
  'provedor-recusou-consulta',   /* statusEncoding/obterVideo/listar */
  'provedor-recusou-capa',
  'provedor-recusou-legenda',
  'provedor-recusou-capitulos',
  'provedor-recusou-exclusao',
  'provedor-inacessivel',        /* rede/timeout/resposta que não é JSON */
  'id-invalido',                 /* não casa com `padraoId` */
  'recurso-indisponivel',        /* o provedor não faz isso (ver capacidades) */
  'assinatura-indisponivel',     /* urlReproducao({ assinar: true }) antes do M5 */
  'parametro-invalido',          /* idioma, tamanho, tipo... que o adaptador recusa antes de ir à rede */
  'credenciais-recusadas'        /* o provedor respondeu 401/403 ao testar a conexão */
]);

/** Falha de um provedor, já em forma que o handler traduz para `erro(502, codigo, ...)`. */
export class ErroProvedor extends Error {
  constructor(codigo, { status = null, detalhe = '' } = {}) {
    super(codigo);
    this.name = 'ErroProvedor';
    this.codigo = codigo;
    this.status = status;
    /* Curto e sem segredo: vai para o corpo da resposta de erro. */
    this.detalhe = String(detalhe || '').slice(0, 400);
  }
}

/** Mapa de `capacidades().hostsMidia` / `hostsMidia()`: o que a CSP precisa liberar. */
export const DIRETIVAS_DE_HOSTS = Object.freeze(['img', 'media', 'connect', 'frame', 'script']);

/* ------------------------------------------------------------------- JSDoc */

/**
 * @typedef {Object} Capacidades
 * @property {'tus'|'put'|'s3-multipart'|'nenhum'} uploadProtocolo  como o navegador envia o arquivo
 * @property {boolean} envio           aceita upload pela mesa (false no HLS genérico)
 * @property {boolean} assinatura      `urlReproducao({ assinar: true })` funciona (modo privado; M5)
 * @property {'nenhum'|'basico'|'estudio'} drm
 * @property {boolean} embed           tem player embutido (`midia.embed`)
 * @property {boolean} mp4             tem MP4 de reserva (`midia.mp4`)
 * @property {boolean} previa          tem imagem animada de hover (`midia.previa`)
 * @property {boolean} sprites         tem sprite de miniaturas da linha do tempo
 * @property {boolean} clipe           tem clipe HLS curto (trailer/fundo)
 * @property {boolean} capaPorUpload   `definirCapa` aceita bytes de imagem
 * @property {boolean} capaPorTempo    a capa é um instante do vídeo (sem upload)
 * @property {boolean} legendaPorUpload `enviarLegenda` funciona
 * @property {boolean} legendaIA       existe `gerarLegendaIA`
 * @property {boolean} capitulosNativos existe `definirCapitulos`
 * @property {boolean} webhooks        existe `receberWebhook`
 * @property {boolean} uso             existe `uso`
 * @property {boolean} [fontePorUrl]   existe `prepararFonte`: o título se cadastra colando endereços (HLS genérico), não enviando arquivo
 * @property {{img:string[],media:string[],connect:string[],frame:string[],script:string[]}} hostsMidia
 *           hosts ESTÁTICOS do provedor (a CSP do Worker os une aos dinâmicos de `hostsMidia()`)
 */

/**
 * @typedef {Object} PlanoDeUpload   o que `criarUpload`/`retomarUpload` devolvem; o navegador envia os bytes sozinho
 * @property {string} id              id do vídeo no provedor (casa com `padraoId`)
 * @property {'tus'|'put'|'s3-multipart'} protocolo
 * @property {'endpoint'|'url-pronta'} modo   'endpoint': o cliente cria o upload com POST em `url` (tus-js-client `endpoint`);
 *                                            'url-pronta': o servidor já criou, o cliente só envia a `url` (`uploadUrl`)
 * @property {string} url             https
 * @property {Object<string,string>} cabecalhos  credenciais de uso único para o envio (nunca a chave de API)
 * @property {Object<string,string>} metadados   metadados TUS além dos que o cliente já manda (ex.: filetype, name)
 * @property {number} expiraEm        UNIX em SEGUNDOS
 * @property {number} pedacoBytes     tamanho do pedaço sugerido
 * @property {{provedor:string,id:string,extras:Object}} fonte   o que o item do catálogo deve guardar
 */

/**
 * @typedef {Object} StatusEncoding
 * @property {'enviando'|'processando'|'pronto'|'erro'} estado
 * @property {number|null} progresso    0 a 100, ou null se o provedor não informa
 * @property {number|null} duracaoSeg
 * @property {string|null} titulo
 * @property {number|string|null} estadoBruto   o status do provedor, só para diagnóstico
 * @property {string[]} [qualidades]    ex.: ['240p','720p'], quando o provedor diz
 */

/**
 * A INTERFACE. Cada função abaixo é assíncrona (Promise) salvo `capacidades` e `hostsMidia`.
 *
 * @typedef {Object} ProvedorDeVideo
 *
 * @property {string} id                      igual a `video.provedor`
 * @property {boolean} configurado            as credenciais OBRIGATÓRIAS existem (não testa a rede; para isso `validarCredenciais`)
 * @property {RegExp} padraoId                único lugar que sabe o formato de id do provedor; os handlers validam `videoId` com ele
 *
 * @property {() => Capacidades} capacidades
 *   Síncrona e barata. O núcleo decide o que mostrar/permitir por ela (ex.: botão "gerar legenda por IA").
 *
 * @property {() => {img:string[],media:string[],connect:string[],frame:string[],script:string[]}} hostsMidia
 *   Síncrona. Hosts que a CSP e o preconnect precisam liberar NESTA instalação: os estáticos de
 *   `capacidades().hostsMidia` mais os que vêm da config/env (pull zone própria, subdomínio de cliente,
 *   endpoint de upload). Só `https://host` ou `https://*.dominio`; nada com ponto-e-vírgula ou espaço.
 *
 * @property {() => Promise<{ok:boolean, mensagem:string, codigo?:string}>} validarCredenciais
 *   Botão "Testar conexão" do /admin: uma chamada barata e autenticada. NUNCA lança: devolve `ok:false`
 *   com `mensagem` curta (sem segredo). Sem credenciais, `ok:false` sem tocar a rede.
 *
 * @property {(p:{titulo:string, tamanhoBytes?:number, tipo?:string, validadeSeg?:number}) => Promise<PlanoDeUpload>} criarUpload
 *   Cria o vídeo no provedor (precisa ser no servidor) e devolve o plano para o NAVEGADOR enviar os bytes
 *   direto. O arquivo nunca passa pelo Worker. `tamanhoBytes` é obrigatório para quem cria upload com tamanho
 *   (Cloudflare Stream); os demais ignoram. Lança `ErroProvedor('provedor-recusou-criacao' | 'provedor-sem-guid' | 'provedor-nao-configurado' | 'recurso-indisponivel')`.
 *
 * @property {(id:string, p?:{validadeSeg?:number, tamanhoBytes?:number}) => Promise<PlanoDeUpload>} retomarUpload
 *   Reassina um vídeo que já existe (a retomada não cria vídeo e não conta no limite de envios).
 *   Mesmo formato de `criarUpload`.
 *
 * @property {(id:string, p?:{extras?:Object}) => Promise<StatusEncoding>} statusEncoding
 *   Estado NORMALIZADO ('enviando'|'processando'|'pronto'|'erro'). Só 'pronto' pode ir ao ar. `extras` são os `fonte.extras`
 *   do item: só quem guarda endereço por título (HLS genérico) os usa; os demais ignoram.
 *
 * @property {(id:string, p?:{assinar?:boolean, validadeSeg?:number, viewer?:string, extras?:Object}) => Promise<{hls:string|null, mp4:Object|null, embed:Object|null, expiraEm:number|null}>} urlReproducao
 *   As URLs de reprodução (parte de `Midia`). `assinar: true` pede URL assinada com `validadeSeg`
 *   (modo privado, M5): `extras` são os `fonte.extras` do item (ex.: libraryId do Bunny). Enquanto `capacidades().assinatura` for false, REJEITA com `ErroProvedor('assinatura-indisponivel')`
 *   (nunca devolve URL aberta quando a assinatura foi pedida). `viewer` é só um rótulo para o provedor
 *   que o aceite; quem decide se a pessoa pode ver é o middleware.
 *
 * @property {(id:string, p?:{arquivo?:string, versao?:string|number, tempoSeg?:number, largura?:number, extras?:Object}) => Promise<string|null>} urlCapa
 *   A URL FINAL da capa. `arquivo` e `versao` são `item.capa_arquivo`/`item.capa_versao` (o Bunny grava a capa
 *   enviada com hash no nome; `versao` é só cache do navegador). `null` se o provedor não está configurado.
 *
 * @property {(id:string, bytes:ArrayBuffer|Uint8Array, mime?:string) => Promise<{urlCapa:string|null, arquivo:string|null, versao:string|null}>} definirCapa
 *   Troca a capa e devolve a URL JÁ nova (lição do hash do Bunny: o adaptador relê o vídeo). `arquivo` e `versao` são
 *   o que o catálogo guarda em `capa_arquivo` e `capa_versao` (null se o provedor não tem esse conceito). Sem
 *   `capacidades().capaPorUpload`: rejeita com `ErroProvedor('recurso-indisponivel')`.
 *
 * @property {(id:string) => Promise<{animada:string|null, clipeHls:string|null, sprite:string|null}>} urlPreview
 *   Hover da grade e vídeo de fundo, quando existirem; campos ausentes vêm `null`.
 *
 * @property {(id:string, p?:{idiomas?:string[], extras?:Object}) => Promise<Array<{idioma:string, rotulo:string, url:string, origem:'ia'|'manual'|'desconhecida'}>>} legendas
 *   COM `idiomas`: monta as URLs sem rede (é o caminho do catálogo, que não pode fazer uma chamada por item).
 *   SEM `idiomas`: pergunta ao provedor quais existem.
 *
 * @property {(id:string, p:{idioma:string, rotulo?:string, srt?:string, vtt?:string}) => Promise<{idioma:string, rotulo:string}>} enviarLegenda
 *   `idioma` é BCP-47 curto ('pt', 'pt-BR', 'en'); o adaptador recusa o que não casa. Sem `legendaPorUpload`: `recurso-indisponivel`.
 *
 * @property {(id:string, p:{idioma:string}) => Promise<{iniciado:boolean}>} [gerarLegendaIA]    só se `capacidades().legendaIA`
 * @property {(id:string, capitulos:Array<{titulo:string, inicio:number, fim:number}>) => Promise<{n:number}>} [definirCapitulos]
 *   só se `capacidades().capitulosNativos`; sem ela, os capítulos vivem só no catálogo. `[]` apaga.
 *
 * @property {(id:string, p?:{extras?:Object}) => Promise<{id:string, titulo:string|null, duracaoSeg:number|null, criadoEm:string|null, tamanhoBytes:number|null, estado:string, progresso:number|null, framerate:number|null, arquivoCapa:string|null, urlCapa:string|null, capitulos?:Array<{titulo:string, inicio:number, fim:number}>|null}>} obterVideo
 * @property {(p?:{cursor?:string|number, limite?:number}) => Promise<{itens:Array<Object>, proximo:string|number|null}>} listar
 *   `itens` com o mesmo formato de `obterVideo`. `proximo` null quando acabou.
 * @property {(id:string) => Promise<{ok:true}>} excluir
 *
 * @property {(id:string, p:{extras?:Object, arquivo?:string, versao?:string|number, idiomas:string[]}) => Promise<Object>} [midia]
 *   ATALHO DE DESEMPENHO, opcional: a `Midia` inteira (ver acima, sem `assinar`) numa chamada só e sem rede. O catálogo
 *   monta `midia` por título e o plano gratuito dá 10 ms de CPU; quatro chamadas assíncronas por título pesam.
 *   Tem de ser IGUAL à composição `urlReproducao + urlCapa + urlPreview + legendas` (a suíte confere). Não use com `assinar`.
 * @property {(entrada:{hls:string, mp4?:string|Object, capa?:string, legendas?:Array<{idioma:string, rotulo?:string, url:string}>}, p?:{verificar?:boolean}) => Promise<{fonte:{provedor:string,id:string,extras:Object}, estado?:string, estadoBruto?:string, duracaoSeg?:number|null}>} [prepararFonte]
 *   só se `capacidades().fontePorUrl` (HLS genérico): o título entra no catálogo por endereços colados, sem upload. Confere
 *   cada endereço (https, host liberado na config, extensão) e devolve a `fonte` pronta para o item; com `verificar`, lê o
 *   playlist. Endereço recusado: `ErroProvedor('parametro-invalido', { detalhe: '<campo>:<motivo>' })`, motivo em
 *   'invalida' | 'sem-https' | 'host-nao-permitido' | 'extensao'. Quem edita o catálogo não amplia a lista de hosts liberados.
 * @property {(request:Request) => Promise<{id:string, evento:'pronto'|'erro'|'processando'}|null>} [receberWebhook]
 *   Normaliza o corpo do webhook do provedor; `null` se não for reconhecível (ou assinatura inválida).
 *   O handler (futuro) decide o que fazer.
 * @property {() => Promise<{minutosArmazenados?:number, minutosEntregues?:number, gbEntregues?:number, custoEstimadoUSD?:number}>} [uso]
 */

/* ------------------------------------------------------------- utilidades */

/** Confere se um objeto cumpre a interface. Devolve a lista de problemas (vazia = ok). */
export function validarAdaptador(a) {
  const problemas = [];
  if (!a || typeof a !== 'object') return ['o adaptador não é um objeto']; /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
  if (typeof a.id !== 'string' || !a.id) problemas.push('falta `id`'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
  if (typeof a.configurado !== 'boolean') problemas.push('`configurado` precisa ser boolean'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
  if (!(a.padraoId instanceof RegExp)) problemas.push('`padraoId` precisa ser RegExp'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
  for (const nome of FUNCOES_OBRIGATORIAS) {
    if (typeof a[nome] !== 'function') problemas.push('falta a função `' + nome + '`'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
  }
  if (typeof a.capacidades === 'function') {
    const c = a.capacidades();
    if (!c || typeof c !== 'object') problemas.push('`capacidades()` não devolveu objeto'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
    else {
      if (!PROTOCOLOS_UPLOAD.includes(c.uploadProtocolo)) problemas.push('capacidades.uploadProtocolo inválido: ' + c.uploadProtocolo); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
      if (!NIVEIS_DRM.includes(c.drm)) problemas.push('capacidades.drm inválido: ' + c.drm); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
      for (const k of ['envio', 'assinatura', 'embed', 'mp4', 'previa', 'sprites', 'clipe', 'capaPorUpload', 'capaPorTempo',
        'legendaPorUpload', 'legendaIA', 'capitulosNativos', 'webhooks', 'uso']) {
        if (typeof c[k] !== 'boolean') problemas.push('capacidades.' + k + ' precisa ser boolean'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
      }
      /* A capacidade e a função andam juntas: nada de prometer o que não há. */
      const pares = { legendaIA: 'gerarLegendaIA', capitulosNativos: 'definirCapitulos', webhooks: 'receberWebhook', uso: 'uso', fontePorUrl: 'prepararFonte' };
      for (const [cap, fn] of Object.entries(pares)) {
        if (c[cap] === true && typeof a[fn] !== 'function') problemas.push('capacidades.' + cap + ' é true mas falta `' + fn + '`'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
        if (c[cap] === false && typeof a[fn] === 'function') problemas.push('`' + fn + '` existe mas capacidades.' + cap + ' é false'); /* i18n-ignorar: diagnóstico técnico, para quem escreve adaptador */
      }
    }
  }
  return problemas;
}

/** `https://host` ou `https://*.dominio`: o único formato aceito na lista de hosts da CSP. */
const HOST_DE_CSP = /^https:\/\/(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(:[0-9]{1,5})?$/i;

export function hostDeCspValido(valor) {
  return typeof valor === 'string' && valor.length < 200 && HOST_DE_CSP.test(valor);
}

/** Normaliza o que um adaptador devolveu em `hostsMidia()`: só entram hosts de formato seguro, sem repetição. */
export function hostsLimpos(bruto) {
  const saida = {};
  for (const d of DIRETIVAS_DE_HOSTS) {
    const vistos = [];
    for (const h of (bruto && bruto[d]) || []) {
      if (hostDeCspValido(h) && !vistos.includes(h)) vistos.push(h);
    }
    saida[d] = vistos;
  }
  return saida;
}

/** `host`, `https://host/` ou `host/`: devolve só o host se parecer um (senão null). */
export function hostSimples(valor) {
  if (typeof valor !== 'string') return null;
  const h = valor.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(h) && h.length < 200 ? h.toLowerCase() : null;
}

/** Base64 (UTF-8) para quem manda arquivo de texto em JSON. */
export function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

/** Idioma de legenda: 'pt', 'pt-BR', 'en'. Minúsculo na raiz, como o provedor espera na URL. */
export const PADRAO_IDIOMA = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Rótulos de faixa de legenda quando ninguém disse o nome. É DADO (a língua da fala), não texto de tela. */
export const ROTULOS_DE_IDIOMA = Object.freeze({
  pt: 'Português', 'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano' /* i18n-ignorar: rótulos de faixa de legenda são dado (a língua da fala) */
});

export function rotuloDoIdioma(idioma) {
  return ROTULOS_DE_IDIOMA[idioma] || ROTULOS_DE_IDIOMA[String(idioma).split('-')[0]] || String(idioma);
}

/** Troca cada segredo que aparecer no texto por `***` (um provedor que repete a chave no erro não a vaza). */
export function mascarar(texto, segredos) {
  let t = String(texto == null ? '' : texto);
  for (const s of segredos || []) if (typeof s === 'string' && s.length >= 4) t = t.split(s).join('***');
  return t;
}

/** Lê o corpo de uma resposta de erro sem lançar e sem trazer o mundo. `segredos` são mascarados. */
export async function detalheDe(resposta, segredos) {
  try { return mascarar((await resposta.text()).slice(0, 400), segredos); } catch (e) { return ''; }
}

/** O texto de um código, no idioma corrente (catálogo `api.<codigo>`). Para `validarCredenciais().mensagem`. */
export function mensagemDe(codigo, params) {
  return AppI18n.t('api.' + codigo, params || undefined);
}
