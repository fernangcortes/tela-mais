/* scripts/lib/env.mjs — carrega o `.env` da raiz do projeto para process.env.
 *
 * Sem isto, cada script exige exportar as variáveis à mão antes de rodar
 * (`export BUNNY_API_KEY=...`), e a variável some quando o terminal
 * fecha. Use o `.env.example` da raiz como modelo.
 *
 * Precedência: uma variável já definida no ambiente SEMPRE ganha do `.env`.
 * O arquivo é o padrão, não a última palavra — assim dá para sobrescrever
 * pontualmente numa execução sem editar nada.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* scripts/lib -> scripts -> raiz do repositório */
export const ENV_PADRAO = path.resolve(AQUI, '..', '..', '.env');

export function analisar(texto) {
  const valores = {};
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;

    const m = limpa.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    let valor = m[2].trim();
    /* aspas em volta são delimitador, não conteúdo */
    if ((valor.startsWith('"') && valor.endsWith('"') && valor.length > 1) ||
        (valor.startsWith("'") && valor.endsWith("'") && valor.length > 1)) {
      valor = valor.slice(1, -1);
    }
    valores[m[1]] = valor;
  }
  return valores;
}

export async function carregarEnv(caminho = ENV_PADRAO) {
  let texto;
  try {
    texto = await readFile(caminho, 'utf8');
  } catch {
    return { carregadas: 0, caminho, existe: false };
  }

  const valores = analisar(texto);
  let carregadas = 0;
  for (const [chave, valor] of Object.entries(valores)) {
    if (process.env[chave] === undefined && valor !== '') {
      process.env[chave] = valor;
      carregadas++;
    }
  }
  return { carregadas, caminho, existe: true };
}
