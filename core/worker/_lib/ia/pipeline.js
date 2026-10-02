/* ia/pipeline.js — da legenda do título à sugestão na fila: lê a transcrição, gera cada tarefa e REGISTRA a sugestão.
 *
 * É o caminho que o botão "gerar" do /admin e os scripts compartilham. Para cada tarefa: confere se está ligada, gera
 * (gerarTexto: JSON validado, 1 retentativa) e SÓ SE saiu 'ok' registra a sugestão. 'insuficiente' e 'falhou' não gravam nada.
 * `registrar` é injetável: no Worker grava no KV; nos scripts fala com a API do site. */
import App from '../../../site/catalogo-core.js';
import { gerarTexto } from './texto.js';
import { traduzirLegenda } from './traducao.js';
import { registrarSugestao } from './sugestoes.js';
import { valorAtual, CAMPOS } from './campos.js';
import { analisarLegenda, juntarSemRepetir, emBlocos, reduzirBlocos, textoDasCues } from './srt.js';
import { tarefaPorNome } from './tarefas.js';
import { estiloDe } from './config.js';
import { pedir } from './texto/http.js';
import { ErroIA } from './erros.js';

export const MAX_CARACTERES_DE_TRANSCRICAO = 150000;
const curto = (i) => String(i || 'pt').split('-')[0].toLowerCase();

/* A legenda do título, lida do provedor: { cues, texto, blocos, duracaoSeg } ou null. */
export async function transcricaoDoItem({ provedor, item, idioma = 'pt', fetch, referer, opcoesLegenda }) {
  const f = App.migrarFonte(item && item.fonte);
  if (!provedor || !f || !f.id || (f.provedor && f.provedor !== provedor.id)) return null;
  const faixas = await provedor.legendas(f.id, Object.assign({ idiomas: [idioma], extras: f.extras }, opcoesLegenda || {}));
  const faixa = (faixas || []).find((x) => x.idioma === idioma) || (faixas || []).find((x) => curto(x.idioma) === curto(idioma)) || (faixas || [])[0];
  if (!faixa || !faixa.url) return null;
  let r;
  try {
    r = await pedir(fetch, faixa.url, { method: 'GET', headers: referer ? { Referer: referer } : {} });
  } catch (e) {
    if (e instanceof ErroIA && e.status === 404) return null;   /* título sem legenda (ex.: institucional sem narração) */
    throw e;
  }
  const cues = juntarSemRepetir(analisarLegenda(r.texto));
  if (!cues.length) return null;
  return { cues, texto: textoDasCues(cues), blocos: emBlocos(cues, 30), duracaoSeg: cues[cues.length - 1].fim, idioma: faixa.idioma };
}

/* A entrada das tarefas de texto a partir do item e da transcrição, dentro do teto de tamanho. */
export function entradaDoItem(item, transcricao, extra) {
  const blocos = reduzirBlocos(transcricao.blocos, MAX_CARACTERES_DE_TRANSCRICAO);
  return Object.assign({
    titulo: item.titulo || '', serie: item.serie || '',
    duracaoSeg: Number(item.duracao_seg) || transcricao.duracaoSeg || 0,
    blocos, transcricao: blocos.map((b) => b.texto).join(' ')
  }, extra || {});
}

/* Gera e registra. `tarefas`: nomes de tarefa (e 'traducao-legenda' com `idiomasDestino`).
 * `ligados`: { tarefa: bool } (o que o /admin liga); ausente = não confere (script que já conferiu).
 * Devolve um resultado por tarefa: { tarefa, estado: 'sugerida'|'insuficiente'|'falhou'|'sem-transcricao'|'desligada', campo?, custoUSD, codigo? }. */
export async function gerarSugestoes({ env, config, item, tarefas, idiomasDestino = [], provedor, transcricao, fetch, orcamento, referer, opcoesLegenda, ligados, registrar, agora = Date.now }) {
  const guardar = registrar || ((s) => registrarSugestao(env, Object.assign({ agora }, s)));
  const estilo = estiloDe(config);
  const idioma = (config && config.ia && config.ia.transcricao && config.ia.transcricao.idioma) || curto(estilo.idioma);
  const saida = [];
  let lida = transcricao;
  const obter = async () => {
    if (lida === undefined) lida = await transcricaoDoItem({ provedor, item, idioma, fetch, referer, opcoesLegenda });
    return lida;
  };

  for (const nome of tarefas) {
    const t = tarefaPorNome(nome);
    if (!t || nome === 'trechos-trailer') { saida.push({ tarefa: nome, estado: 'falhou', codigo: 'ia-tarefa-invalida', custoUSD: 0 }); continue; }
    if (ligados && ligados[nome] === false) { saida.push({ tarefa: nome, estado: 'desligada', codigo: 'ia-recurso-desligado', custoUSD: 0 }); continue; }
    const tr = await obter();
    if (!tr) { saida.push({ tarefa: nome, estado: 'sem-transcricao', codigo: 'ia-sem-transcricao', custoUSD: 0 }); continue; }

    if (nome === 'traducao-legenda') {
      for (const destino of idiomasDestino) {
        if (curto(destino) === curto(tr.idioma || idioma)) continue;
        const r = await traduzirLegenda({ cues: tr.cues, de: tr.idioma || idioma, para: destino, titulo: item.titulo, config, env, fetch, orcamento, agora });
        if (r.estado !== 'ok') { saida.push({ tarefa: nome, idioma: destino, estado: 'falhou', codigo: r.codigo, detalhe: r.detalhe, custoUSD: r.custoUSD }); continue; }
        const campo = 'legenda-' + destino;
        const g = await guardar({ itemId: item.id, campo, valor: r.srt, proveniencia: r.proveniencia, custoUSD: r.custoUSD, atual: null });
        saida.push({ tarefa: nome, idioma: destino, estado: g.ok ? 'sugerida' : 'falhou', campo, codigo: g.ok ? undefined : g.codigo, custoUSD: r.custoUSD });
      }
      continue;
    }

    const r = await gerarTexto({ tarefa: nome, entrada: entradaDoItem(item, tr, { vocabulario: estilo.vocabularioTags }), config, env, fetch, orcamento, agora });
    if (r.estado === 'insuficiente') { saida.push({ tarefa: nome, estado: 'insuficiente', codigo: r.codigo, custoUSD: r.custoUSD }); continue; }
    if (r.estado !== 'ok') { saida.push({ tarefa: nome, estado: 'falhou', codigo: r.codigo, detalhe: r.detalhe, custoUSD: r.custoUSD }); continue; }
    const g = await guardar({ itemId: item.id, campo: t.campo, valor: r.valor, proveniencia: r.proveniencia, custoUSD: r.custoUSD, atual: CAMPOS[t.campo] ? valorAtual(t.campo, item) : null });
    saida.push({ tarefa: nome, estado: g.ok ? 'sugerida' : 'falhou', campo: t.campo, codigo: g.ok ? undefined : g.codigo, custoUSD: r.custoUSD });
  }
  return saida;
}
