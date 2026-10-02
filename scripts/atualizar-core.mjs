#!/usr/bin/env node
/* scripts/atualizar-core.mjs — atualiza o PRODUTO (core/, scripts/, tests/, docs/, instruções dos agentes e o esquema da
 * config) sem encostar no que é do cliente (config/site.json, config/fontes, wrangler.jsonc, core/site/marca, dados/).
 *
 *   node scripts/atualizar-core.mjs --baixar                    baixa a última release pública e aplica
 *   node scripts/atualizar-core.mjs --baixar --versao 1.2.0     uma versão específica
 *   node scripts/atualizar-core.mjs --de ../tela-mais-nova      aplica a partir de uma pasta (ou .tar.gz) já baixada
 *   node scripts/atualizar-core.mjs --baixar --simular          mostra o que mudaria, sem gravar
 *   ... --corpo-do-pr pr.md    escreve o texto do Pull Request (resumo, "precisa de ação sua", changelog)
 *   ... --repo dono/nome       outro repositório de origem (padrão: o oficial)
 *   ... --json
 *
 * A release traz `core-vX.Y.Z.tar.gz` e `core-vX.Y.Z.sha256`; o sha256 é conferido ANTES de extrair. Depois de aplicar:
 *   node scripts/migrar-config.mjs && npm run config:validar && npm run config:aplicar && npm test
 * (o workflow atualizar-core.yml faz isso e abre um PR). Nunca faz commit: quem faz é o fluxo ou a pessoa.
 * Códigos: 0 certo (ou já em dia), 1 falhou, 2 uso incorreto. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  planejar, aplicar, acharRaizDaVersao, lerCoreVersion, mudancasEntre, corpoDoPr, acharRelease, sha256Do, somaDeclarada
} from './lib/atualizar-core.mjs';
import { compararVersoes, REPOSITORIO_OFICIAL } from './lib/semver.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AJUDA = `Uso: node scripts/atualizar-core.mjs (--baixar [--versao X.Y.Z] | --de <pasta|arquivo.tar.gz>) [--simular] [--repo dono/nome] [--corpo-do-pr arquivo] [--json]`;

/* Rede e arquivos entram por aqui, para os testes trocarem por falsos. */
export function ambienteReal() {
  return {
    raiz: RAIZ,
    agora: () => new Date(),
    async fetchJson(url) {
      const r = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'tela-mais-atualizar' } });
      if (!r.ok) throw new Error(`GitHub respondeu ${r.status} para ${url}`);
      return r.json();
    },
    async baixar(url, destino) {
      const r = await fetch(url, { headers: { 'user-agent': 'tela-mais-atualizar' }, redirect: 'follow' });
      if (!r.ok) throw new Error(`download falhou (${r.status})`);
      await writeFile(destino, Buffer.from(await r.arrayBuffer()));
    },
    async extrair(arquivo, pasta) {
      const { spawn } = await import('node:child_process');
      await new Promise((ok, erro) => {
        const f = spawn('tar', ['-xzf', arquivo, '-C', pasta], { stdio: 'ignore' });
        f.on('error', erro);
        f.on('close', (c) => (c === 0 ? ok() : erro(new Error('não consegui extrair o arquivo (tar).'))));
      });
    }
  };
}

export async function principal(argv = process.argv.slice(2), amb = ambienteReal()) {
  const f = { baixar: false, simular: false, json: false, de: null, versao: 'latest', repo: REPOSITORIO_OFICIAL, corpo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => { const v = argv[++i]; if (!v || v.startsWith('--')) throw new Error(`${a} precisa de um valor.`); return v; };
    try {
      if (a === '--baixar') f.baixar = true;
      else if (a === '--simular' || a === '--dry-run') f.simular = true;
      else if (a === '--json') f.json = true;
      else if (a === '--de') f.de = valor();
      else if (a === '--versao') { f.versao = valor(); if (f.versao !== 'latest' && !/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(f.versao)) throw new Error('--versao precisa ser X.Y.Z (ou latest).'); }
      else if (a === '--repo') f.repo = valor();
      else if (a === '--corpo-do-pr') f.corpo = valor();
      else if (a === '--help') return { codigo: 0, texto: AJUDA + '\n' };
      else return { codigo: 2, texto: `Opção desconhecida: ${a}\n${AJUDA}\n` };
    } catch (e) { return { codigo: 2, texto: e.message + '\n' + AJUDA + '\n' }; }
  }
  if (f.baixar === !!f.de) return { codigo: 2, texto: 'Escolha UMA origem: --baixar ou --de.\n' + AJUDA + '\n' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(f.repo)) return { codigo: 2, texto: 'O --repo precisa ser no formato dono/nome.\n' };
  const falha = (mensagem, extra = {}) => ({ codigo: 1, ok: false, texto: f.json ? JSON.stringify({ ok: false, mensagem, ...extra }) + '\n' : `Erro: ${mensagem}\n`, ...extra });

  const tmp = await mkdtemp(path.join(tmpdir(), 'tela-core-'));
  try {
    let pastaNova;
    if (f.baixar) {
      let rel;
      try { rel = await acharRelease({ repo: f.repo, versao: f.versao, fetchJson: amb.fetchJson }); }
      catch (e) { return falha('não consegui achar a release: ' + e.message); }
      const tar = path.join(tmp, 'core.tar.gz');
      try {
        await amb.baixar(rel.urlTar, tar);
        await amb.baixar(rel.urlSoma, path.join(tmp, 'core.sha256'));
      } catch (e) { return falha('o download falhou: ' + e.message); }
      const esperado = somaDeclarada(await readFile(path.join(tmp, 'core.sha256'), 'utf8'));
      const obtido = await sha256Do(tar);
      if (!esperado || esperado !== obtido) return falha('o sha256 do arquivo baixado NÃO confere com o da release: nada foi alterado. Tente de novo mais tarde; se repetir, avise quem indicou o produto.');
      pastaNova = path.join(tmp, 'novo');
      await (await import('node:fs/promises')).mkdir(pastaNova);
      try { await amb.extrair(tar, pastaNova); } catch (e) { return falha(e.message); }
    } else {
      const alvo = path.resolve(amb.raiz, f.de);
      if (/\.(tar\.gz|tgz)$/i.test(alvo)) {
        pastaNova = path.join(tmp, 'novo');
        await (await import('node:fs/promises')).mkdir(pastaNova);
        try { await amb.extrair(alvo, pastaNova); } catch (e) { return falha(e.message); }
      } else pastaNova = alvo;
    }

    const origem = await acharRaizDaVersao(pastaNova).catch(() => null);
    if (!origem) return falha('a versão nova não parece uma release do produto (falta o arquivo .core-version).');
    const nova = await lerCoreVersion(origem);
    const atual = await lerCoreVersion(amb.raiz);
    if (!nova) return falha('o .core-version da versão nova não é uma versão válida (X.Y.Z).');
    if (atual && compararVersoes(nova, atual) < 0) return falha(`a versão informada (${nova}) é MAIS ANTIGA que a instalada (${atual}). Não volto versão por este comando.`);
    if (atual && compararVersoes(nova, atual) === 0) {
      return { codigo: 0, ok: true, atualizado: false, versao: atual, texto: f.json ? JSON.stringify({ ok: true, atualizado: false, versao: atual }) + '\n' : `Já está na versão ${atual}. Nada a fazer.\n` };
    }

    let plano;
    try { plano = await planejar(origem, amb.raiz); } catch (e) { return falha(e.message); }
    let changelog = '';
    try { changelog = await readFile(path.join(origem, 'CHANGELOG.md'), 'utf8'); } catch { /* sem changelog */ }
    const blocos = atual ? mudancasEntre(changelog, atual, nova) : [];
    const precisaDeAcao = blocos.some((b) => b.precisaDeAcao);
    const seguranca = blocos.some((b) => b.seguranca);
    if (f.corpo) await writeFile(path.resolve(amb.raiz, f.corpo), corpoDoPr({ de: atual || 'nenhuma', ate: nova, blocos, plano }), 'utf8');
    if (!f.simular) await aplicar(origem, amb.raiz, plano);

    const dados = { ok: true, atualizado: !f.simular, simulado: f.simular, de: atual, para: nova, adicionados: plano.adicionar.length, alterados: plano.alterar.length, removidos: plano.remover.length, precisaDeAcao, seguranca, acoes: blocos.flatMap((b) => b.acoes) };
    if (f.json) return { codigo: 0, ...dados, texto: JSON.stringify(dados) + '\n' };
    const linhas = [
      f.simular ? `Simulação: ${atual || '(nenhuma)'} para ${nova}. Nada foi gravado.` : `Produto atualizado: ${atual || '(nenhuma)'} para ${nova}.`,
      `  ${plano.adicionar.length} arquivos novos, ${plano.alterar.length} alterados, ${plano.remover.length} removidos. A pasta config/ (menos o esquema) e a sua marca ficaram como estavam.`
    ];
    if (seguranca) linhas.push('  Esta atualização traz correção de SEGURANÇA.');
    if (dados.acoes.length) { linhas.push('  Precisa de ação sua:'); for (const a of dados.acoes) linhas.push('    - ' + a); }
    if (!f.simular) linhas.push('Agora rode: node scripts/migrar-config.mjs && npm run config:validar && npm run config:aplicar && npm test');
    return { codigo: 0, ...dados, texto: linhas.join('\n') + '\n' };
  } catch (e) {
    return falha(e.message || String(e));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.removeAllListeners('warning');
  process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') process.stderr.write(`${w.name}: ${w.message}\n`); });
  const r = await principal();
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
