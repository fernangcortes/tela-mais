/* scripts/lib/setup/args.mjs — leitor de flags sem dependências.
 *
 * Cada comando declara as flags que aceita: { nome: 'bool' | 'valor' | 'lista' }.
 * `lista` aceita repetir a flag ou separar por vírgula. As flags globais valem em todos. */
import { erroUso } from './erros.mjs';

export const FLAGS_GLOBAIS = Object.freeze({ json: 'bool', yes: 'bool', 'dry-run': 'bool', help: 'bool' });
const SEGREDO_NA_LINHA = new Set(['valor', 'value', 'senha', 'password', 'chave', 'key', 'secret', 'token', 'segredo']);
const CURTAS = { y: 'yes', h: 'help' };

export function lerArgumentos(argv, flagsDoComando = {}) {
  const spec = { ...FLAGS_GLOBAIS, ...flagsDoComando };
  const flags = {};
  const posicionais = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { posicionais.push(...argv.slice(i + 1)); break; }
    let nome, valor;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      nome = eq > 0 ? a.slice(2, eq) : a.slice(2);
      valor = eq > 0 ? a.slice(eq + 1) : undefined;
    } else if (/^-[a-zA-Z]$/.test(a) && CURTAS[a[1]]) {
      nome = CURTAS[a[1]];
    } else {
      posicionais.push(a);
      continue;
    }
    const tipo = spec[nome];
    if (!tipo && SEGREDO_NA_LINHA.has(nome)) throw erroUso(`--${nome}: segredo nunca vai na linha de comando (ficaria no histórico do terminal e na conversa).`, 'Use o prompt oculto: node scripts/setup.mjs segredo NOME  (ou --stdin / --do-ambiente).');
    if (!tipo) throw erroUso(`não conheço a opção --${nome}.`, 'Veja as opções com: node scripts/setup.mjs --help');
    if (tipo === 'bool') {
      if (valor !== undefined && !['true', 'false', '1', '0'].includes(valor)) throw erroUso(`--${nome} não recebe valor.`);
      flags[nome] = valor === undefined ? true : (valor === 'true' || valor === '1');
      continue;
    }
    if (valor === undefined) {
      const prox = argv[i + 1];
      if (prox === undefined || (prox.startsWith('--') && prox.length > 2)) throw erroUso(`--${nome} precisa de um valor.`);
      valor = prox;
      i++;
    }
    if (tipo === 'lista') {
      flags[nome] = (flags[nome] || []).concat(String(valor).split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      flags[nome] = valor;
    }
  }
  /* camelCase de conveniência: flags['dry-run'] também em flags.dryRun */
  flags.dryRun = flags['dry-run'] === true;
  return { flags, posicionais };
}
