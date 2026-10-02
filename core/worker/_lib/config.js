/* core/worker/_lib/config.js — a configuração do site, como o Worker a enxerga.
 *
 * DUAS CAMADAS (decisão D-5 do plano):
 *   implantação  config/site.json, empacotado com o Worker no deploy;
 *   operação     chave `config:operacao` do KV, editada pelo /admin, só nas
 *                seções home, textos, player e recursos.
 * Precedência: KV > arquivo > padrão do schema. O resto (acesso, video, ia,
 * mcp, marca...) só muda por deploy, de propósito: uma conta de equipe que
 * edite a home não pode, nem por engano, abrir o acesso ao site.
 *
 * FALHA FECHADA. Arquivo inválido, schema que não carrega, segredo escrito em
 * texto, qualquer coisa fora do esperado: o site sobe com `acesso.modo` =
 * 'privado' (o mais fechado) e `_estado.valido` = false, com os motivos em
 * `_estado.erros`. Quem consome decide o que mostrar; o modo já vem trancado.
 * Nunca devolvemos os valores de um arquivo inválido: o que não passou na
 * validação não é confiável nem para ler o nome da marca.
 *
 * O arquivo entra por `import ... with { type: 'json' }`: o wrangler (esbuild)
 * empacota o JSON dentro do Worker, então não há leitura de disco em runtime,
 * nem arquivo gerado que possa ficar velho. Se config/site.json não existir, o
 * deploy falha — e isso é melhor que subir sem configuração.
 *
 * O validador mora em ./config-validar.mjs (ESM puro, o mesmo que os scripts
 * de Node usam).
 */
import arquivoEmpacotado from '../../../config/site.json' with { type: 'json' };
import esquemaEmpacotado from '../../../config/site.schema.json' with { type: 'json' };
import { validarConfig, aplicarPadroes, clonar, ehReferenciaEnv } from './config-validar.mjs';

export const CHAVE_OPERACAO = 'config:operacao';
export const SECOES_OPERACAO = ['home', 'textos', 'player', 'recursos'];
/* Curto o bastante para a edição do /admin aparecer logo; longo o bastante
 * para o KV não ser lido em toda requisição. */
export const TTL_MS = 30 * 1000;

let cache = null;   /* { ate, valor } — por isolate */

export function limparCacheConfig() {
  cache = null;
}

function ehObjeto(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/* Mescla em profundidade: blocos se fundem, listas e valores simples são trocados. */
export function mesclar(base, cima) {
  if (!ehObjeto(base) || !ehObjeto(cima)) return clonar(cima);
  const saida = clonar(base);
  for (const [k, v] of Object.entries(cima)) {
    saida[k] = ehObjeto(v) && ehObjeto(saida[k]) ? mesclar(saida[k], v) : clonar(v);
  }
  return saida;
}

/* Só as seções que a operação pode mexer. Devolve { permitido, ignoradas }. */
export function filtrarOperacao(bruto) {
  const permitido = {};
  const ignoradas = [];
  for (const [k, v] of Object.entries(bruto)) {
    if (SECOES_OPERACAO.includes(k)) permitido[k] = v;
    else ignoradas.push(k);
  }
  return { permitido, ignoradas };
}

/* A configuração de emergência: padrões do schema + acesso trancado. */
export function configFechada(esquema, erros, extra = {}) {
  let base = {};
  try {
    base = aplicarPadroes(esquema, {}) || {};
  } catch (e) {
    base = {};
  }
  base.acesso = { ...(base.acesso || {}), modo: 'privado' };
  base._estado = { valido: false, origem: 'emergencia', erros, avisos: [], ...extra };
  return base;
}

/* A parte pura: sem KV, sem cache, sem relógio. É o que os testes exercitam.
 *   arquivo   o JSON do site.json (null/undefined = ausente)
 *   operacao  o objeto lido do KV (ou null)
 *   avisos    avisos já acumulados (leitura do KV etc.) */
export function montarConfig(esquema, arquivo, operacao = null, avisos = []) {
  if (arquivo === null || arquivo === undefined) {
    return configFechada(esquema, [{ caminho: 'config/site.json', mensagem: 'arquivo de configuração ausente.' }]);
  }
  if (!esquema || typeof esquema !== 'object') {
    return configFechada(esquema, [{ caminho: 'config/site.schema.json', mensagem: 'schema ausente ou ilegível.' }]);
  }
  const r = validarConfig(esquema, arquivo);
  if (!r.ok) return configFechada(esquema, r.erros);

  let final = r.config;
  let usouOperacao = false;
  if (operacao !== null && operacao !== undefined) {
    if (!ehObjeto(operacao)) {
      avisos.push('o override do KV não é um bloco JSON; foi ignorado.');
    } else {
      const { permitido, ignoradas } = filtrarOperacao(operacao);
      if (ignoradas.length) avisos.push(`seções do KV fora da operação, ignoradas: ${ignoradas.join(', ')}.`);
      if (Object.keys(permitido).length) {
        /* Mescla sobre o ARQUIVO (sem padrões) e aplica os padrões por último:
         * assim a ordem é padrão < arquivo < KV, e um KV parcial não "apaga"
         * o que o arquivo definiu. */
        const r2 = validarConfig(esquema, mesclar(arquivo, permitido));
        if (r2.ok) {
          final = r2.config;
          usouOperacao = true;
        } else {
          avisos.push('o override do KV não passou na validação e foi ignorado: ' +
            r2.erros.slice(0, 3).map((e) => `${e.caminho}: ${e.mensagem}`).join(' | '));
        }
      }
    }
  }
  final._estado = { valido: true, origem: 'arquivo', operacaoAplicada: usouOperacao, erros: [], avisos };
  return final;
}

async function lerOperacao(env, avisos) {
  const kv = env && env.CATALOGO;
  if (!kv || typeof kv.get !== 'function') return null;
  try {
    const cru = await kv.get(CHAVE_OPERACAO);
    if (cru === null || cru === undefined) return null;
    return typeof cru === 'string' ? JSON.parse(cru) : cru;
  } catch (e) {
    avisos.push('não consegui ler o override do KV (' + (e && e.message ? e.message : 'erro') + '); usei só o arquivo.');
    return null;
  }
}

/* obterConfig(env, opcoes?) -> Promise<config>
 *
 * `config` é o objeto do site.json com os padrões aplicados, mais `_estado`:
 *   { valido, origem: 'arquivo'|'emergencia', operacaoAplicada, erros[], avisos[] }
 * Nunca lança. Em qualquer falha do ARQUIVO devolve acesso.modo = 'privado'.
 * Uma falha só do override do KV é descartada (vira aviso): o KV é escrito
 * pelo /admin já validado, e uma queda do KV não deve trancar quem lê.
 *
 * opcoes (para testes): { arquivo, schema, agora, semCache }
 *   arquivo: objeto, ou null para simular "ausente". */
export async function obterConfig(env, opcoes = {}) {
  const agora = typeof opcoes.agora === 'number' ? opcoes.agora : Date.now();
  if (!opcoes.semCache && cache && cache.ate > agora) return cache.valor;

  const esquema = 'schema' in opcoes ? opcoes.schema : esquemaEmpacotado;
  const arquivo = 'arquivo' in opcoes ? opcoes.arquivo : arquivoEmpacotado;

  let valor;
  try {
    const avisos = [];
    /* Arquivo inválido não precisa do KV: o resultado já é a config fechada. */
    const operacao = arquivo && esquema ? await lerOperacao(env, avisos) : null;
    valor = montarConfig(esquema, arquivo, operacao, avisos);
  } catch (e) {
    valor = configFechada(esquema, [{ caminho: '(config)', mensagem: 'erro inesperado ao montar a configuração: ' + (e && e.message ? e.message : e) }]);
  }
  if (!opcoes.semCache) cache = { ate: agora + TTL_MS, valor };
  return valor;
}

/* Lê um segredo declarado como {"$env":"NOME"}. Valor literal (string) é
 * recusado pelo validador, mas aqui também não é aceito: segredo só vem do env. */
export function resolverSegredo(referencia, env) {
  if (!ehReferenciaEnv(referencia)) return undefined;
  const v = env ? env[referencia.$env] : undefined;
  return typeof v === 'string' && v !== '' ? v : undefined;
}
