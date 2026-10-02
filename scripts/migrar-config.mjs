#!/usr/bin/env node
/* scripts/migrar-config.mjs — leva o config/site.json para o formato (`versaoDoEsquema`) que o core instalado entende.
 *
 *   node scripts/migrar-config.mjs              migra o que for preciso (guarda cópia em config/site.json.antes-da-migracao)
 *   node scripts/migrar-config.mjs --verificar  não grava; sai 1 se ainda precisa migrar (usado no CI)
 *   node scripts/migrar-config.mjs --json       resultado em JSON
 *   node scripts/migrar-config.mjs --arquivo outro.json --esquema outro.schema.json
 *
 * A versão que o core entende é a MAIOR de `versaoDoEsquema.enum` em config/site.schema.json. Config mais NOVA que o core
 * não é migrada para trás: o script para e pede a atualização do core. Idempotente: com a config em dia não escreve nada.
 * Depois de migrar, rode `npm run config:validar && npm run config:aplicar`. Códigos de saída: 0 em dia/migrado,
 * 1 falhou ou (--verificar) precisa migrar, 2 uso incorreto. */
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { MIGRACOES as MIGRACOES_REAIS } from './lib/migracoes-config.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function versaoSuportada(esquema) {
  const e = esquema && esquema.properties && esquema.properties.versaoDoEsquema;
  const lista = e && Array.isArray(e.enum) ? e.enum.filter(Number.isInteger) : [];
  if (lista.length) return Math.max(...lista);
  if (e && Number.isInteger(e.default)) return e.default;
  return 1;
}

/* Aplica as migrações em cadeia. Devolve { config, de, para, passos[], erro? }. Não grava nada. */
export function migrar(config, alvo, migracoes = MIGRACOES_REAIS) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { config, de: null, para: null, passos: [], erro: 'a config não é um objeto JSON.' };
  const de = Number.isInteger(config.versaoDoEsquema) ? config.versaoDoEsquema : 1;
  if (de > alvo) return { config, de, para: de, passos: [], erro: `a config está na versão ${de} do formato, mais nova que a do core instalado (${alvo}). Atualize o core (docs/atualizar.md) antes de usar esta config.` };
  let atual = config;
  let v = de;
  const passos = [];
  while (v < alvo) {
    const m = migracoes[v];
    if (!m || m.para !== v + 1) return { config: atual, de, para: v, passos, erro: `não existe migração da versão ${v} para ${v + 1}: peça ajuda a quem indicou o produto.` };
    const antes = JSON.stringify(atual);
    atual = m.migrar(JSON.parse(antes));
    if (!atual || atual.versaoDoEsquema !== v + 1) return { config: atual, de, para: v, passos, erro: `a migração ${v} -> ${v + 1} não deixou versaoDoEsquema em ${v + 1} (defeito do produto).` };
    passos.push({ de: v, para: v + 1, descricao: m.descricao || '' });
    v += 1;
  }
  return { config: atual, de, para: v, passos };
}

export async function principal(argv = process.argv.slice(2), { raiz = RAIZ, migracoes = MIGRACOES_REAIS } = {}) {
  const flags = { verificar: false, json: false, arquivo: null, esquema: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verificar') flags.verificar = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--arquivo' || a === '--esquema') { flags[a.slice(2)] = argv[++i]; if (!flags[a.slice(2)]) return { codigo: 2, texto: `${a} precisa de um valor.\n` }; }
    else return { codigo: 2, texto: `Opção desconhecida: ${a}\nUso: node scripts/migrar-config.mjs [--verificar] [--json] [--arquivo f] [--esquema f]\n` };
  }
  const arquivo = path.resolve(raiz, flags.arquivo || 'config/site.json');
  const esquemaArq = path.resolve(raiz, flags.esquema || 'config/site.schema.json');
  const saida = (obj, texto, codigo) => ({ codigo, texto: flags.json ? JSON.stringify(obj) + '\n' : texto + '\n', ...obj });
  let bruto, config, esquema;
  try { bruto = await readFile(arquivo, 'utf8'); } catch { return saida({ ok: false, erro: 'config-ausente' }, `Não achei ${path.relative(raiz, arquivo)}.`, 1); }
  try { config = JSON.parse(bruto); } catch (e) { return saida({ ok: false, erro: 'config-invalida' }, `${path.relative(raiz, arquivo)} não é um JSON válido (${e.message}).`, 1); }
  try { esquema = JSON.parse(await readFile(esquemaArq, 'utf8')); } catch { return saida({ ok: false, erro: 'esquema-ausente' }, `Não consegui ler o esquema (${path.relative(raiz, esquemaArq)}).`, 1); }

  const alvo = versaoSuportada(esquema);
  const r = migrar(config, alvo, migracoes);
  if (r.erro) return saida({ ok: false, erro: 'migracao', mensagem: r.erro, de: r.de, para: r.para, alvo }, `Não migrei: ${r.erro}`, 1);
  if (!r.passos.length) return saida({ ok: true, migrado: false, versao: r.de, alvo }, `A config já está na versão ${alvo} do formato. Nada a fazer.`, 0);
  const resumo = r.passos.map((p) => `  ${p.de} -> ${p.para}${p.descricao ? ': ' + p.descricao : ''}`).join('\n');
  if (flags.verificar) return saida({ ok: false, migrado: false, precisaMigrar: true, de: r.de, alvo, passos: r.passos }, `A config está na versão ${r.de} e o core espera ${alvo}. Rode: node scripts/migrar-config.mjs\n${resumo}`, 1);

  const copia = arquivo + '.antes-da-migracao';
  await copyFile(arquivo, copia);
  const fim = bruto.endsWith('\n') ? '\n' : '';
  await writeFile(arquivo, JSON.stringify(r.config, null, 2) + fim, 'utf8');
  return saida({ ok: true, migrado: true, de: r.de, para: r.para, alvo, passos: r.passos, copia: path.relative(raiz, copia) },
    `Config migrada da versão ${r.de} para ${r.para}:\n${resumo}\nCópia da anterior: ${path.relative(raiz, copia)}\nAgora rode: npm run config:validar && npm run config:aplicar`, 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await principal();
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
