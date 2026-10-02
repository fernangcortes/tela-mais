/* core/worker/_lib/custos.js — a conta da calculadora de custo (docs/custos.md e a tela do /admin).
 *
 * ESM PURO, SEM REDE, SEM ESTADO: recebe números, devolve números e textos. Não lê config, não chama API de
 * provedor e não lê o relógio: a mesma entrada dá sempre a mesma saída, e o /admin e os testes usam a MESMA conta.
 *
 * ISTO É UMA ESTIMATIVA. Os preços abaixo são de tabelas públicas e de fontes de terceiros lidas em
 * DATA_DOS_VALORES (nenhuma página oficial de preço foi lida diretamente); cada linha traz `confirmado: false`
 * quando o valor não foi conferido na fonte oficial. Quem mostrar o resultado TEM de mostrar `dataDosValores`
 * e o aviso `AVISO_ESTIMATIVA` junto. Atualize os valores em PRECOS (e DATA_DOS_VALORES) quando reconferir.
 *
 * API (tudo por nome):
 *   estimarCusto(entrada)          { entrada, provedores:{bunny,'cloudflare-stream','hls-generico'}, cloudflare, ... }
 *   estimarProvedor(id, entrada)   uma linha só: { id, rotulo, calculavel, itens[], totalUsd, totalBrl, totalBrlComIof, ... }
 *   estimarCloudflare(entrada)     hospedagem do site (Workers): plano grátis ou pago, folga, avisos
 *   normalizarEntrada(entrada)     { entrada, avisos[] }: aplica padrões, trunca absurdos, nunca lança
 *   visitasPorDiaNoGratis(modo)    quantas visitas por dia cabem no plano grátis do Worker (para docs e Saúde)
 *   CENARIOS                       pequeno / médio / grande (os mesmos de docs/provedores.md)
 *   PRECOS, PADROES, LIMITES, CAMBIO_BRL, IOF, DATA_DOS_VALORES, AVISO_ESTIMATIVA
 *
 * Entrada (todos opcionais, números não negativos):
 *   videos               quantos títulos no acervo                                  (padrão 50)
 *   horasPorVideo        duração média de cada um, em horas                          (padrão 1)
 *   visualizacoesMes     quantas vezes por mês alguém aperta play                    (padrão 500)
 *   minutosPorVisualizacao  quanto de cada vídeo a pessoa assiste, em minutos        (padrão 20)
 *   publico              'brasil' (padrão) | 'global': muda o preço de entrega do Bunny
 *   visitasPorDia        visitas ao site por dia (padrão: derivado das visualizações)
 *   modoAcesso           'publico' | 'cadastro' | 'privado': o privado faz mais chamadas ao Worker por visita
 */

export const DATA_DOS_VALORES = '2026-10-01';
export const CAMBIO_BRL = 5.18;
/* IOF de compra internacional no cartão (aproximado, "cerca de 6%" em docs/provedores.md): reconferir. */
export const IOF = 0.06;

export const AVISO_ESTIMATIVA =
  'Estimativa com preços de ' + DATA_DOS_VALORES + ', de tabelas públicas e fontes de terceiros. ' +
  'Reconfira no site de cada provedor antes de decidir: preço muda.';

/* Premissas de volume (as mesmas de docs/provedores.md). */
export const PADROES = Object.freeze({
  videos: 50,
  horasPorVideo: 1,
  visualizacoesMes: 500,
  minutosPorVisualizacao: 20,
  publico: 'brasil',
  modoAcesso: 'publico',
  /* HLS com várias qualidades mais o original, como na tabela de docs/provedores.md. */
  gbArmazenadosPorHora: 2,
  /* O que a pessoa baixa por hora assistida: 0,375 GB em 20 min = 1,125 GB/h. */
  gbEntreguesPorHora: 1.125,
  /* Visitas por dia por visualização por mês: nem toda visita dá play, e quem dá play volta. */
  visitasPorDiaPorVisualizacaoMes: 0.1,
  diasNoMes: 30
});

/* Chamadas ao Worker por visita (catálogo, busca, token de reprodução...). No modo privado quase tudo passa pelo Worker. */
export const CHAMADAS_POR_VISITA = Object.freeze({ publico: 3, cadastro: 5, privado: 6 });

/* Limites do Cloudflare Workers (conferir: developers.cloudflare.com/workers/platform/limits e /pricing). */
export const LIMITES = Object.freeze({
  gratisRequisicoesPorDia: 100000,
  gratisCpuMsPorRequisicao: 10,
  pagoMensalidadeUsd: 5,
  pagoRequisicoesIncluidasMes: 10000000,
  pagoUsdPorMilhaoExtra: 0.3,
  kvGratisGravacoesPorDia: 1000,
  kvGratisLeiturasPorDia: 100000
});

export const PRECOS = Object.freeze({
  bunny: Object.freeze({
    rotulo: 'Bunny Stream',
    armazenamentoUsdPorGbMes: 0.01,
    entregaUsdPorGb: Object.freeze({ brasil: 0.045, global: 0.01 }),
    minimoUsdMes: 1,
    confirmado: false,
    fonte: 'bunny.net/pricing (via resultados de busca e blogs de 2026)',
    observacoes: Object.freeze([
      'Com público só no Brasil a entrega custa mais (US$ 0,045 por GB); existe rede mais barata ("Volume"), sem confirmação de que vale para o Stream.',
      'Mínimo de US$ 1 por mês. Codificação e player sem cobrança extra.'
    ])
  }),
  'cloudflare-stream': Object.freeze({
    rotulo: 'Cloudflare Stream',
    armazenamentoUsdPor1000Min: 5,
    entregaUsdPor1000Min: 1,
    confirmado: false,
    fonte: 'cloudflare.com/products/cloudflare-stream (via resultados de busca e blogs de 2026)',
    observacoes: Object.freeze([
      'Paga por minuto guardado e por minuto assistido: previsível, mas fica caro com acervo grande e pouco assistido.',
      'Codificação e banda sem cobrança extra.'
    ])
  }),
  'hls-generico': Object.freeze({
    rotulo: 'HLS genérico',
    confirmado: true,
    fonte: 'não se aplica',
    observacoes: Object.freeze(['O custo é o do serviço onde estão os seus arquivos .m3u8: o site só toca.'])
  })
});

export const CENARIOS = Object.freeze({
  pequeno: Object.freeze({ videos: 50, horasPorVideo: 1, visualizacoesMes: 500, minutosPorVisualizacao: 20 }),
  medio: Object.freeze({ videos: 300, horasPorVideo: 1, visualizacoesMes: 10000, minutosPorVisualizacao: 20 }),
  grande: Object.freeze({ videos: 2000, horasPorVideo: 1, visualizacoesMes: 200000, minutosPorVisualizacao: 20 })
});

const TETO = 1e9;   /* só para um campo digitado errado não virar Infinity */

function arredondar(n, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

function numero(v, padrao, nome, avisos, { min = 0, max = TETO } = {}) {
  if (v === undefined || v === null || v === '') return padrao;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n < min) { avisos.push(`"${nome}" inválido: usei ${padrao}.`); return padrao; }
  if (n > max) { avisos.push(`"${nome}" acima de ${max}: usei ${max}.`); return max; }
  return n;
}

/* Aplica padrões e saneia. NUNCA lança: a tela chama a cada tecla digitada. */
export function normalizarEntrada(bruta) {
  const e = bruta && typeof bruta === 'object' ? bruta : {};
  const avisos = [];
  const videos = numero(e.videos, PADROES.videos, 'videos', avisos);
  const horasPorVideo = numero(e.horasPorVideo, PADROES.horasPorVideo, 'horasPorVideo', avisos);
  const visualizacoesMes = numero(e.visualizacoesMes, PADROES.visualizacoesMes, 'visualizacoesMes', avisos);
  const minutosPorVisualizacao = numero(e.minutosPorVisualizacao, PADROES.minutosPorVisualizacao, 'minutosPorVisualizacao', avisos);
  const publico = e.publico === 'global' ? 'global' : 'brasil';
  const modoAcesso = Object.prototype.hasOwnProperty.call(CHAMADAS_POR_VISITA, e.modoAcesso) ? e.modoAcesso : PADROES.modoAcesso;
  const derivada = Math.ceil(visualizacoesMes * PADROES.visitasPorDiaPorVisualizacaoMes);
  const visitasPorDia = numero(e.visitasPorDia, derivada, 'visitasPorDia', avisos);
  return {
    entrada: { videos, horasPorVideo, visualizacoesMes, minutosPorVisualizacao, publico, modoAcesso, visitasPorDia },
    avisos
  };
}

/* Volumes derivados, em um lugar só. */
function volumes(e) {
  const horasTotais = e.videos * e.horasPorVideo;
  const minutosGuardados = horasTotais * 60;
  const minutosEntregues = e.visualizacoesMes * e.minutosPorVisualizacao;
  return {
    horasTotais,
    minutosGuardados,
    minutosEntregues,
    horasAssistidas: minutosEntregues / 60,
    gbArmazenados: horasTotais * PADROES.gbArmazenadosPorHora,
    gbEntregues: (minutosEntregues / 60) * PADROES.gbEntreguesPorHora
  };
}

function moeda(usd) {
  const totalUsd = arredondar(usd);
  const totalBrl = arredondar(usd * CAMBIO_BRL);
  return { totalUsd, totalBrl, totalBrlComIof: arredondar(usd * CAMBIO_BRL * (1 + IOF)) };
}

function linha(id, rotulo, usd, detalhe) {
  return { id, rotulo, usd: arredondar(usd), detalhe };
}

function estimarBunny(e, v) {
  const p = PRECOS.bunny;
  const itens = [
    linha('armazenamento', 'Armazenamento', v.gbArmazenados * p.armazenamentoUsdPorGbMes,
      `${arredondar(v.gbArmazenados, 1)} GB x US$ ${p.armazenamentoUsdPorGbMes}/GB`),
    linha('entrega', 'Entrega (banda)', v.gbEntregues * p.entregaUsdPorGb[e.publico],
      `${arredondar(v.gbEntregues, 1)} GB x US$ ${p.entregaUsdPorGb[e.publico]}/GB (${e.publico === 'brasil' ? 'público no Brasil' : 'EUA/Europa'})`)
  ];
  const soma = itens.reduce((s, i) => s + i.usd, 0);
  const avisos = [];
  let total = soma;
  if (soma < p.minimoUsdMes) { total = p.minimoUsdMes; avisos.push(`Vale o mínimo mensal do Bunny (US$ ${p.minimoUsdMes}).`); }
  return { itens, total, avisos };
}

function estimarStream(_e, v) {
  const p = PRECOS['cloudflare-stream'];
  const itens = [
    linha('armazenamento', 'Minutos guardados', (v.minutosGuardados / 1000) * p.armazenamentoUsdPor1000Min,
      `${Math.round(v.minutosGuardados)} min x US$ ${p.armazenamentoUsdPor1000Min} por 1.000`),
    linha('entrega', 'Minutos assistidos', (v.minutosEntregues / 1000) * p.entregaUsdPor1000Min,
      `${Math.round(v.minutosEntregues)} min x US$ ${p.entregaUsdPor1000Min} por 1.000`)
  ];
  return { itens, total: itens.reduce((s, i) => s + i.usd, 0), avisos: [] };
}

/* Uma linha da comparação. `id` desconhecido devolve null. */
export function estimarProvedor(id, entradaBruta) {
  const preco = PRECOS[id];
  if (!preco) return null;
  const { entrada } = normalizarEntrada(entradaBruta);
  const v = volumes(entrada);
  const base = { id, rotulo: preco.rotulo, confirmado: preco.confirmado, fonte: preco.fonte, dataDosValores: DATA_DOS_VALORES, observacoes: [...preco.observacoes] };
  if (id === 'hls-generico') {
    return { ...base, calculavel: false, itens: [], totalUsd: null, totalBrl: null, totalBrlComIof: null, avisos: [] };
  }
  const r = id === 'bunny' ? estimarBunny(entrada, v) : estimarStream(entrada, v);
  return { ...base, calculavel: true, itens: r.itens, ...moeda(r.total), avisos: r.avisos };
}

/* Quantas visitas por dia cabem nas 100 mil requisições diárias do plano grátis. */
export function visitasPorDiaNoGratis(modoAcesso) {
  const chamadas = CHAMADAS_POR_VISITA[modoAcesso] || CHAMADAS_POR_VISITA.publico;
  return Math.floor(LIMITES.gratisRequisicoesPorDia / chamadas);
}

/* A hospedagem do site (Worker + arquivos estáticos). Os arquivos estáticos não contam como requisição de Worker. */
export function estimarCloudflare(entradaBruta) {
  const { entrada } = normalizarEntrada(entradaBruta);
  const chamadas = CHAMADAS_POR_VISITA[entrada.modoAcesso];
  const porDia = Math.ceil(entrada.visitasPorDia * chamadas);
  const noGratis = porDia <= LIMITES.gratisRequisicoesPorDia;
  const porMes = porDia * PADROES.diasNoMes;
  const extra = Math.max(0, porMes - LIMITES.pagoRequisicoesIncluidasMes);
  const pagoUsd = LIMITES.pagoMensalidadeUsd + (extra / 1e6) * LIMITES.pagoUsdPorMilhaoExtra;
  const avisos = [];
  if (!noGratis) avisos.push('Acima de 100 mil chamadas por dia o plano grátis do Worker para de responder até a meia-noite (UTC): o plano pago (US$ 5/mês) é necessário.');
  else if (porDia > LIMITES.gratisRequisicoesPorDia * 0.7) avisos.push('Mais de 70% do limite diário do plano grátis: considere o plano pago.');
  if (entrada.modoAcesso !== 'publico') avisos.push('Com acesso restrito quase tudo passa pelo Worker e o limite de CPU do plano grátis (10 ms) fica apertado: com cadastro aberto, assuma o plano pago.');
  /* Grátis só quando cabe no limite E (o site é público OU o movimento é pequeno). */
  const recomendado = noGratis && (entrada.modoAcesso === 'publico' || porDia < 5000) ? 'gratis' : 'pago';
  const usd = recomendado === 'gratis' ? 0 : pagoUsd;
  return {
    id: 'cloudflare',
    rotulo: 'Hospedagem do site (Cloudflare Workers)',
    confirmado: false,
    dataDosValores: DATA_DOS_VALORES,
    visitasPorDia: entrada.visitasPorDia,
    chamadasPorVisita: chamadas,
    requisicoesPorDia: porDia,
    usoDoLimiteGratis: arredondar(porDia / LIMITES.gratisRequisicoesPorDia, 3),
    cabeNoGratis: noGratis,
    plano: recomendado,
    ...moeda(usd),
    avisos
  };
}

/* A comparação inteira: os três provedores de vídeo + a hospedagem, com o total de cada combinação. */
export function estimarCusto(entradaBruta) {
  const { entrada, avisos } = normalizarEntrada(entradaBruta);
  const cloudflare = estimarCloudflare(entrada);
  const provedores = {};
  const totais = {};
  for (const id of Object.keys(PRECOS)) {
    const p = estimarProvedor(id, entrada);
    provedores[id] = p;
    if (p.calculavel) totais[id] = moeda(p.totalUsd + cloudflare.totalUsd);
  }
  const calculaveis = Object.values(provedores).filter((p) => p.calculavel);
  const maisBarato = calculaveis.length ? calculaveis.reduce((a, b) => (b.totalUsd < a.totalUsd ? b : a)).id : null;
  return {
    estimativa: true,
    dataDosValores: DATA_DOS_VALORES,
    cambioBrl: CAMBIO_BRL,
    iof: IOF,
    aviso: AVISO_ESTIMATIVA,
    entrada,
    volumes: Object.fromEntries(Object.entries(volumes(entrada)).map(([k, x]) => [k, arredondar(x, 1)])),
    provedores,
    cloudflare,
    totaisComHospedagem: totais,
    maisBarato,
    avisos
  };
}

/* "US$ 9,69" / "R$ 50,19": só apresentação, para quem não quiser formatar à mão. */
export function formatarMoeda(valor, moedaCodigo = 'USD') {
  if (valor == null || !Number.isFinite(Number(valor))) return '—';
  const n = Number(valor).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (moedaCodigo === 'BRL' ? 'R$ ' : 'US$ ') + n;
}
