/* /api/saude — a tela Saúde e o assistente de configuração do /admin.
 *
 *   GET                  equipe  o retrato de saúde (configuração, KV, D1, segredos presentes — só os NOMES —, provedor,
 *                                acesso, backup, versão). Barato: não chama ninguém de fora.
 *   GET ?testar=1        equipe  o mesmo, MAIS uma chamada de verdade ao provedor de vídeo (validarCredenciais).
 *   GET ?versao=1        equipe  o mesmo, olhando de novo a última release pública (tolerante a falha de rede).
 *   GET ?custos=1&...    equipe  a calculadora de custo (a MESMA conta do docs/custos.md: _lib/custos.js). Os números vêm na consulta
 *                                (videos, horasPorVideo, visualizacoesMes, minutosPorVisualizacao, publico, modoAcesso); o que faltar ou vier
 *                                torto, a conta trata. Não lê nem grava nada.
 *   GET ?assistente=1    super   o ponto de partida do assistente: o que o config/site.json diz hoje e as escolhas possíveis.
 *   POST { acao }        super   contas que o assistente faz no servidor, sem gravar nada:
 *                                  'marca'  { cor, corClara, tema }  -> contraste e paleta (a MESMA régua do validador)
 *                                  'config' { escolhas }             -> o config/site.json novo, validado, para baixar
 *   PUT { assistente }   super   'concluido' | 'dispensado' | 'pendente': se o assistente abre na entrada do superadmin
 *
 * Nada aqui devolve valor de segredo, e nada grava o config/site.json: mudança de implantação é do repositório do cliente. */
import { json, erro } from '../_lib/sessao.js';
import { lerCorpo } from '../_lib/contas-fluxo.js';
import { montarSaude, ultimaVersaoPublicada, lerEstadoDoAssistente, gravarEstadoDoAssistente, ESTADOS_DO_ASSISTENTE } from '../_lib/saude.js';
import { dadosDoAssistente, avaliarMarca, gerarConfig, homeDoPreset, ARQUIVO_DE_IMPLANTACAO } from '../_lib/assistente.js';
import { estimarCusto, CENARIOS, PADROES as PADROES_DE_CUSTO } from '../_lib/custos.js';

const verdadeiro = (v) => v === '1' || v === 'true';
/* Os campos da calculadora que vêm na consulta. Nada além deles entra na conta. */
const CAMPOS_DO_CUSTO = ['videos', 'horasPorVideo', 'visualizacoesMes', 'minutosPorVisualizacao', 'publico', 'modoAcesso', 'visitasPorDia'];

export async function onRequestGet({ request, env, data, modo, config }) {
  const p = new URL(request.url).searchParams;

  if (verdadeiro(p.get('custos'))) {
    const entrada = {};
    for (const campo of CAMPOS_DO_CUSTO) if (p.has(campo) && p.get(campo) !== '') entrada[campo] = p.get(campo);
    return json(200, Object.assign(estimarCusto(entrada), { cenarios: CENARIOS, padroes: PADROES_DE_CUSTO }));
  }

  if (verdadeiro(p.get('assistente'))) {
    if (!data.conta || data.conta.super !== true) return erro(403, 'so-superadmin');
    return json(200, Object.assign(dadosDoAssistente({ config, env }), { estado: await lerEstadoDoAssistente(env) }));
  }

  /* A última versão só vem da rede quando pedida; no resto da vez sai do que ficou guardado no KV. */
  const versao = await ultimaVersaoPublicada(env, { soCache: !verdadeiro(p.get('versao')) });
  const saude = await montarSaude({ env, config, data, modo, testar: verdadeiro(p.get('testar')), versao });
  saude.assistente = await lerEstadoDoAssistente(env);
  return json(200, saude);
}

export async function onRequestPost({ request, env }) {
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');

  if (corpo.acao === 'marca') {
    const r = avaliarMarca({ cor: corpo.cor, corClara: corpo.corClara, tema: corpo.tema });
    if (!r.ok) return erro(400, r.codigo, null, { campo: r.campo });
    return json(200, r);
  }

  if (corpo.acao === 'config') {
    const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, corpo.escolhas);
    if (!r.ok) return erro(400, 'config-recusada', { n: r.erros.length }, { erros: r.erros });
    return json(200, { ok: true, texto: r.texto, mudancas: r.mudancas, precisaRepublicar: r.precisaRepublicar, home: corpo.escolhas && corpo.escolhas.preset ? homeDoPreset(corpo.escolhas.preset) : null });
  }

  return erro(400, 'acao-invalida');
}

export async function onRequestPut({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  if (!ESTADOS_DO_ASSISTENTE.includes(corpo.assistente)) return erro(400, 'acao-invalida');
  const doc = await gravarEstadoDoAssistente(env, corpo.assistente, data.conta && data.conta.usuario);
  return json(200, { ok: true, assistente: doc });
}
