/* scripts/lib/catalogo.mjs — leitura e escrita do catálogo local usado
 * durante a carga em lote, além de utilidades comuns aos scripts.
 *
 * Durante as Fases 2 e 3 a fonte da verdade é este arquivo JSON local.
 * Depois de semeado no KV (scripts/semear.mjs), a fonte da verdade passa a
 * ser o KV, editado pela tela de administração.
 */
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from './env.mjs';
import App from '../../core/site/catalogo-core.js';

/* Efeito colateral proposital: todo script do projeto importa este módulo, e
 * módulos ESM são avaliados antes do corpo de quem importa. Assim o `.env` já
 * está em process.env quando o script lê suas credenciais — sem precisar que
 * cada um lembre de chamar carregarEnv() na ordem certa. */
await carregarEnv();

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* Raiz do repositório (scripts/lib -> scripts -> raiz). */
export const RAIZ = path.resolve(AQUI, '..', '..');

/* O catálogo local vive FORA do diretório publicado (`core/site/`): ele carrega
 * caminhos de arquivo da sua máquina e links de origem que não podem ser
 * servidos como arquivo estático. O padrão é o catálogo de exemplo; para usar o
 * seu, passe `--catalogo <arquivo>` ou defina APP_CATALOGO no `.env`. */
export const CATALOGO_PADRAO = process.env.APP_CATALOGO
  ? path.resolve(RAIZ, process.env.APP_CATALOGO)
  : path.join(RAIZ, 'exemplo', 'catalogo.json');

export function argumentos(argv = process.argv.slice(2)) {
  const opcoes = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const nome = a.slice(2);
      const proximo = argv[i + 1];
      if (proximo && !proximo.startsWith('--')) { opcoes[nome] = proximo; i++; }
      else opcoes[nome] = true;
    } else {
      opcoes._.push(a);
    }
  }
  return opcoes;
}

export async function lerCatalogo(caminho = CATALOGO_PADRAO) {
  const bruto = await readFile(caminho, 'utf8');
  const dados = JSON.parse(bruto);
  if (!Array.isArray(dados.itens)) throw new Error(`${caminho} não tem a lista \`itens\``);
  return dados;
}

/* Grava sempre com backup: o JSON carrega os videoId, e perdê-los significa
 * subir os 50 arquivos de novo. */
export async function gravarCatalogo(dados, caminho = CATALOGO_PADRAO) {
  try {
    await access(caminho);
    await copyFile(caminho, caminho + '.bak');
  } catch { /* primeira gravação */ }
  await writeFile(caminho, JSON.stringify(dados, null, 1) + '\n', 'utf8');
}

/* Grava SÓ o que o upload produz (a `fonte`: provedor, id e extras), relendo
 * o arquivo antes de escrever.
 *
 * Por que não usar `gravarCatalogo` direto: um upload de 8 GB leva muitos minutos,
 * e durante esse tempo o catálogo pode ser editado por fora — à mão, por outro
 * script, pela curadoria. `gravarCatalogo` despeja a cópia em memória por cima e
 * apaga tudo que mudou nesse meio-tempo. Este merge preserva. */
export async function gravarFontes(itens, caminho = CATALOGO_PADRAO) {
  const atual = await lerCatalogo(caminho);
  const porId = new Map(atual.itens.map(i => [i.id, i]));
  let mudou = 0;

  for (const item of itens) {
    const alvo = porId.get(item.id);
    if (!alvo || !item.fonte) continue;
    /* O arquivo local pode estar no formato de antes do M4 (`videoId`/`libraryId`): compara migrado. */
    const antes = App.migrarFonte(alvo.fonte);
    const novo = App.migrarFonte(item.fonte);
    if (JSON.stringify(antes) !== JSON.stringify(novo)) {
      alvo.fonte = novo;
      mudou++;
    }
  }

  if (mudou) await gravarCatalogo(atual, caminho);
  return mudou;
}

/* Seleção de itens comum a todos os scripts:
 *   --piloto        só os 6 títulos do lote-piloto
 *   --item <id>     um título específico (pode repetir separando por vírgula)
 *   (nada)          todos */
export function selecionar(itens, opcoes) {
  if (opcoes.item && typeof opcoes.item === 'string') {
    const ids = new Set(opcoes.item.split(',').map(s => s.trim()));
    const escolhidos = itens.filter(i => ids.has(i.id));
    const faltando = [...ids].filter(id => !itens.some(i => i.id === id));
    if (faltando.length) throw new Error('id não encontrado no catálogo: ' + faltando.join(', '));
    return escolhidos;
  }
  if (opcoes.piloto) return itens.filter(i => i.piloto === true);
  return itens.slice();
}

export function mb(bytes) {
  return (bytes / 1048576).toFixed(0) + ' MB';
}

export function barra(feito, total, largura = 28) {
  const fracao = total ? feito / total : 0;
  const cheio = Math.round(fracao * largura);
  return '[' + '='.repeat(cheio) + ' '.repeat(largura - cheio) + '] ' +
    (fracao * 100).toFixed(1).padStart(5) + '%';
}

export function agora() {
  return new Date().toLocaleTimeString('pt-BR');
}

export function erroFatal(e) {
  console.error('\n✖ ' + (e && e.message ? e.message : e));
  process.exit(1);
}
