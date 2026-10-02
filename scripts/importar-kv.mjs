#!/usr/bin/env node
/* scripts/importar-kv.mjs — restaura um backup feito por exportar-kv.mjs ou pelo botão "Baixar backup" do /admin.
 *
 *   node scripts/importar-kv.mjs backup.json                    SÓ MOSTRA o que mudaria (confere o arquivo, não altera nada)
 *   node scripts/importar-kv.mjs backup.json --yes              restaura catálogo + configuração operacional (sobrescreve!)
 *   node scripts/importar-kv.mjs backup.json --yes --com-contas também restaura a equipe (nunca sobrescreve conta que já existe)
 *   node scripts/importar-kv.mjs backup.json --partes catalogo  escolhe as partes (catalogo, operacao, contas)
 *   node scripts/importar-kv.mjs backup.json --namespace-id ID --local --json
 *
 * Restaurar é uma PUBLICAÇÃO como as do /admin: o catálogo ganha a revisão seguinte e entra no histórico (dá para voltar
 * pelo /admin). Só acontece com `--yes` (o "sim" da pessoa). Antes de gravar, o estado atual vira um arquivo de segurança
 * em dados/pre-restauracao-AAAA-MM-DDTHH-MM-SS.json (guarde-o até conferir o site; ele traz hash de senha da equipe).
 * Depois de gravar, relê o KV e confere o hash do catálogo contra o do arquivo. Textos legais e espectadores (banco D1)
 * não são restaurados por aqui: use o botão do /admin. Nunca apaga chaves. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lerArgumentos } from './lib/setup/args.mjs';
import { ErroSetup, SAIDA, falha } from './lib/setup/erros.mjs';
import { importarKv } from './lib/backup-kv.mjs';

const FLAGS = { 'com-contas': 'bool', partes: 'lista', 'namespace-id': 'valor', local: 'bool' };
const PARTES_DESTE_SCRIPT = ['catalogo', 'operacao', 'contas'];
const AJUDA = `Uso: node scripts/importar-kv.mjs <backup.json> [--yes] [--com-contas] [--partes catalogo,operacao,contas] [--namespace-id ID] [--local] [--json]
Sem --yes só mostra o que mudaria. Com --yes restaura (publica o catálogo do backup como uma revisão nova).`;

export async function principal(argv, ctx0 = null) {
  let args;
  try { args = lerArgumentos(argv, FLAGS); } catch (e) { return { codigo: SAIDA.USO, texto: (e.message || String(e)) + '\n' + AJUDA + '\n' }; }
  const { flags, posicionais } = args;
  if (flags.help) return { codigo: 0, texto: AJUDA + '\n' };
  if (posicionais.length !== 1) return { codigo: SAIDA.USO, texto: 'Informe o arquivo de backup.\n' + AJUDA + '\n' };
  const lista = flags.partes && flags.partes.length ? flags.partes : ['catalogo', 'operacao'];
  const invalida = lista.find((p) => !PARTES_DESTE_SCRIPT.includes(p));
  if (invalida) return { codigo: SAIDA.USO, texto: `Parte desconhecida: ${invalida}. Use catalogo, operacao ou contas (legal e espectadores só pelo /admin).\n` };
  const partes = Object.fromEntries(lista.map((p) => [p, true]));
  if (flags['com-contas']) partes.contas = true;
  const ctx = ctx0 || await (await import('./lib/setup/contexto.mjs')).criarContextoReal();
  const aplicar = flags.yes === true && flags['dry-run'] !== true;
  let arquivoSeguranca = null;
  try {
    let texto;
    try { texto = await readFile(path.resolve(ctx.raiz, posicionais[0]), 'utf8'); }
    catch { throw falha('backup-ilegivel', `não consegui abrir o arquivo "${posicionais[0]}".`); }
    const r = await importarKv(ctx, texto, {
      flags, partes, aplicar,
      aoTerCopia: async (copia) => {
        const marca = ctx.agora().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
        arquivoSeguranca = path.resolve(ctx.raiz, `dados/pre-restauracao-${marca}.json`);
        await mkdir(path.dirname(arquivoSeguranca), { recursive: true });
        await writeFile(arquivoSeguranca, JSON.stringify(copia, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      }
    });
    const divergiu = r.conferido === false;
    const codigo = divergiu ? SAIDA.FALHA : SAIDA.OK;
    if (flags.json) {
      return { codigo, texto: JSON.stringify({ ok: !divergiu, aplicado: !r.simulado, conferido: r.conferido, hashDoCatalogo: r.hashDoCatalogo, arquivoDeSeguranca: arquivoSeguranca, partes: r.partes, plano: r.plano, feito: r.feito, naoAlcancadas: r.naoAlcancadas }) + '\n' };
    }
    const L = [];
    const c = r.plano.catalogo;
    if (c) L.push(`Catálogo: ${c.titulos} títulos; a revisão ${c.revDe} passaria a ${c.revPara} (${c.mudancas} mudanças).`);
    if (r.plano.operacao) L.push(`Configuração operacional: ${r.plano.operacao.secoes.length ? r.plano.operacao.secoes.join(', ') : '(vazia)'}.`);
    if (r.plano.contas) L.push(`Equipe: ${r.plano.contas.equipe.novas} novas, ${r.plano.contas.equipe.existentes} já existem (não mexo), ${r.plano.contas.equipe.invalidas} inválidas.`);
    if (!r.partes.length) L.push('Nada a restaurar com as partes escolhidas.');
    for (const n of r.naoAlcancadas) L.push('Fica de fora: ' + n + '.');
    if (r.simulado) {
      L.push('Arquivo conferido (hashes batem). Nada foi alterado. Para restaurar de verdade, rode de novo com --yes (isso publica o catálogo do backup).');
    } else {
      if (arquivoSeguranca) L.push(`Cópia de segurança do estado anterior: ${arquivoSeguranca}`);
      if (r.feito && r.feito.catalogo) L.push(`Catálogo restaurado na revisão ${r.feito.catalogo.rev}${r.feito.catalogo.historico ? ', registrado no histórico' : ' (o histórico não pôde ser gravado)'}.`);
      L.push(divergiu ? 'ATENÇÃO: gravei, mas a conferência final do hash do catálogo NÃO bateu. Não use o site até revisar; a cópia de segurança está acima.' : (r.conferido ? 'Conferido: o hash do catálogo restaurado é o do arquivo.' : 'Concluído.'));
      L.push('O índice da busca não faz parte do backup: reindexe pelo /admin se usava a busca pela fala ou por sentido.');
    }
    return { codigo, texto: L.join('\n') + '\n' };
  } catch (e) {
    if (e instanceof ErroSetup) {
      const msg = flags.json ? JSON.stringify({ ok: false, codigo: e.codigo, mensagem: e.message, dica: e.dica || null }) : `Erro: ${e.message}${e.dica ? '\n  ' + e.dica : ''}`;
      return { codigo: e.saida || SAIDA.FALHA, texto: msg + '\n' };
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.removeAllListeners('warning');
  process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') process.stderr.write(`${w.name}: ${w.message}\n`); });
  const r = await principal(process.argv.slice(2));
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
