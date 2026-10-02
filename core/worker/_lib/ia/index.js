/* core/worker/_lib/ia — IA de conteúdo (M9): texto, transcrição, orçamento e sugestões. Ver LEIA-ME.md.
 *
 * Quem integra (api/ia*.js, scripts/ia-*.mjs, trailer e capas) importa DAQUI. */
export { gerarTexto } from './texto.js';
export { transcrever, consultarTranscricao, ADAPTADORES_DE_TRANSCRICAO } from './transcricao/index.js';
export { traduzirLegenda } from './traducao.js';
export { estimarLote, estimarChamada, criarOrcamento, mesDe, MARGEM } from './orcamento.js';
export { registrarSugestao, aceitar, descartar, listarSugestoes, lerSugestao, contarPendentes, comLadoALado } from './sugestoes.js';
export { gerarSugestoes, transcricaoDoItem, entradaDoItem } from './pipeline.js';
export { configDoExecutor, retratoDoExecutor, entradasDoFluxo, dispararFluxo, TAREFAS_DO_EXECUTOR } from './executor.js';
export { estadoDaIA, lerLigados, gravarLigados } from './estado.js';
export { TAREFAS, NOMES_DE_TAREFAS, tarefaPorNome } from './tarefas.js';
export { CAMPOS, campoValido, validarValor, valorAtual } from './campos.js';
export { configDeTexto, configDeTranscricao, recursosLigados, estiloDe, orcamentoMensalUSD, TAREFAS_LIGAVEIS, PROVEDORES_TEXTO, PROVEDORES_TRANSCRICAO } from './config.js';
export { tabelaDePrecos, PRECOS_PADRAO, DATA_DOS_PRECOS } from './precos.js';
export { proveniencia } from './proveniencia.js';
export { ErroIA, CODIGOS_ERRO_IA } from './erros.js';
export { nomesSemSuporte } from './anti-alucinacao.js';
