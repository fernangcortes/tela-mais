#!/usr/bin/env node
/* scripts/exportar-kv.mjs — backup do catálogo (e da config operacional) em UM arquivo JSON, no formato do /admin.
 *
 *   node scripts/exportar-kv.mjs                       grava dados/backup-AAAA-MM-DD.json
 *   node scripts/exportar-kv.mjs --saida meu.json      escolhe o arquivo ("-" escreve na tela)
 *   node scripts/exportar-kv.mjs --com-contas          inclui a equipe (TÊM hash de senha: dado sensível)
 *   node scripts/exportar-kv.mjs --registrar           anota "backup feito agora" (a tela Saúde lê): EXIGE escrita no KV
 *   node scripts/exportar-kv.mjs --namespace-id ID     qual KV (padrão: o do wrangler.jsonc ou o "<projeto>-catalogo")
 *   node scripts/exportar-kv.mjs --local               lê o KV do `wrangler dev --local` (testes)
 *   node scripts/exportar-kv.mjs --json                resultado em JSON (sem o conteúdo do backup)
 *
 * Só LÊ (exceto com --registrar, que escreve uma chave de aviso). Precisa de `wrangler login` (ou do CLOUDFLARE_API_TOKEN do
 * CI, só de leitura de KV). Segredos do Worker, o histórico de versões, o índice da busca e os vídeos NÃO entram; o que mora
 * no banco D1 (textos legais, espectadores) só sai pelo botão "Baixar backup" do /admin: veja docs/atualizar.md.
 * O arquivo é o MESMO do botão do /admin (formato e verificação em core/worker/_lib/backup.js). */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lerArgumentos } from './lib/setup/args.mjs';
import { ErroSetup, SAIDA } from './lib/setup/erros.mjs';
import { exportarKv } from './lib/backup-kv.mjs';

const FLAGS = { saida: 'valor', 'com-contas': 'bool', registrar: 'bool', 'namespace-id': 'valor', local: 'bool' };
const AJUDA = `Uso: node scripts/exportar-kv.mjs [--saida arquivo|-] [--com-contas] [--registrar] [--namespace-id ID] [--local] [--json]
Grava o backup do catálogo e da configuração operacional em um arquivo JSON (padrão: dados/backup-AAAA-MM-DD.json).`;

export async function principal(argv, ctx0 = null) {
  const saidas = [];
  const imprimir = (t) => saidas.push(t);
  let args;
  try { args = lerArgumentos(argv, FLAGS); } catch (e) { return { codigo: SAIDA.USO, texto: (e.message || String(e)) + '\n' + AJUDA }; }
  const { flags } = args;
  if (flags.help) return { codigo: 0, texto: AJUDA };
  const ctx = ctx0 || await (await import('./lib/setup/contexto.mjs')).criarContextoReal();
  try {
    const { backup, namespace, registrado } = await exportarKv(ctx, { flags, contas: !!flags['com-contas'], registrar: !!flags.registrar });
    const dia = backup.criadoEm.slice(0, 10);
    const r = backup.resumo;
    const destino = flags.saida === '-' ? null : path.resolve(ctx.raiz, typeof flags.saida === 'string' ? flags.saida : `dados/backup-${dia}.json`);
    const texto = JSON.stringify(backup, null, 2) + '\n';
    if (flags['dry-run']) imprimir(`Simulação: gravaria o backup de ${r.titulos} títulos em ${destino || 'a tela'}.`);
    else if (!destino) return { codigo: 0, texto, backup };
    else { await mkdir(path.dirname(destino), { recursive: true }); await writeFile(destino, texto, { encoding: 'utf8', mode: 0o600 }); }
    if (!flags['dry-run']) imprimir(`Backup gravado em ${destino}`);
    imprimir(`  ${r.titulos} títulos (${r.noAr} no ar), revisão ${r.rev}${r.operacao ? ', com a configuração operacional' : ''}, hash ${backup.hashes.catalogo.slice(0, 19)}...`);
    if (backup.conteudo.contas) imprimir('  ATENÇÃO: traz a equipe com hash de senha. Guarde em lugar privado.');
    if (flags.registrar) imprimir(registrado ? '  Anotei "backup feito agora" para a tela Saúde.' : '  Não consegui anotar o backup para a tela Saúde (o token precisa de escrita no KV).');
    imprimir('  Textos legais e espectadores (banco D1) não vêm por aqui: use o botão "Baixar backup" do /admin.');
    if (flags.json) return { codigo: 0, texto: JSON.stringify({ ok: true, arquivo: destino, namespace: namespace.origem, resumo: r, hash: backup.hash, hashDoCatalogo: backup.hashes.catalogo, comContas: backup.conteudo.contas != null, registrado }) + '\n' };
    return { codigo: 0, texto: saidas.join('\n') + '\n', backup };
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
