/* scripts/lib/setup/index.mjs — o roteador do setup.mjs: lê a linha de comando, monta o contexto, roda o subcomando
 * e escreve o relatório (texto ou --json). `principal` é o que os testes chamam, com contexto falso. */
import { lerArgumentos } from './args.mjs';
import { criarRelatorio } from './saida.mjs';
import { criarContextoReal } from './contexto.mjs';
import { ErroSetup, SAIDA } from './erros.mjs';
import { esconderValores } from './segredos.mjs';
import { status } from './cmd-status.mjs';
import { init } from './cmd-init.mjs';
import { marca } from './cmd-marca.mjs';
import { acesso } from './cmd-acesso.mjs';
import { video } from './cmd-video.mjs';
import { cloudflare } from './cmd-cloudflare.mjs';
import { segredo } from './cmd-segredo.mjs';
import { deploy } from './cmd-deploy.mjs';
import { doctor } from './cmd-doctor.mjs';
import { syncAgents } from './cmd-agentes.mjs';
import { scanSecrets } from './cmd-scan.mjs';

export const COMANDOS = Object.freeze([status, init, marca, acesso, video, cloudflare, segredo, deploy, doctor, syncAgents, scanSecrets]);

export function textoDeAjuda(comando) {
  if (comando) return `Uso: node scripts/setup.mjs ${comando.uso}\n\n${comando.resumo}\n\nOpções em todos os comandos: --json (saída para programas), --yes (aceita as confirmações), --dry-run (mostra o que faria, sem fazer), --help.\nCódigos de saída: 0 deu certo, 1 falhou, 2 uso incorreto, 3 falta uma ação sua.\n`;
  return [
    'tela mAIs: assistente de montagem (node scripts/setup.mjs <comando>)',
    '',
    ...COMANDOS.map((c) => `  ${c.nome.padEnd(13)} ${c.resumo}`),
    '',
    'Opções em todos os comandos: --json, --yes, --dry-run, --help.',
    'Ajuda de um comando: node scripts/setup.mjs <comando> --help',
    'Códigos de saída: 0 deu certo, 1 falhou, 2 uso incorreto, 3 falta uma ação sua.',
    'Segredos nunca vão na linha de comando: o setup pede num prompt oculto (comando "segredo").',
    ''
  ].join('\n');
}

/* Devolve { codigo, relatorio }. `ambiente` permite trocar exec, fetch, perguntar, raiz, env... (testes). */
export async function principal(argv, ambiente = {}) {
  const out = ambiente.out || ((t) => process.stdout.write(t));
  const err = ambiente.err || ((t) => process.stderr.write(t));
  const nome = argv[0];
  const jsonPedido = argv.includes('--json');
  if (!nome || nome === '--help' || nome === '-h' || nome === 'help') { out(textoDeAjuda()); return { codigo: nome ? SAIDA.OK : SAIDA.USO, relatorio: null }; }
  const comando = COMANDOS.find((c) => c.nome === nome);
  const rel = criarRelatorio(nome, { json: jsonPedido, out, err });
  const segredosVistos = [];
  try {
    if (!comando) throw new ErroSetup('uso-invalido', `não existe o comando "${nome}".`, { saida: SAIDA.USO, dica: 'Veja os comandos com: node scripts/setup.mjs --help' });
    const { flags, posicionais } = lerArgumentos(argv.slice(1), comando.flags);
    if (flags.help) { out(textoDeAjuda(comando)); return { codigo: SAIDA.OK, relatorio: null }; }
    rel.json = flags.json === true;
    rel.dryRun = flags.dryRun;
    const base = ambiente.ctx || await criarContextoReal(ambiente);
    const ctx = Object.assign(base, { flags, rel });
    if (flags.dryRun) rel.info('(--dry-run: nada será alterado)');
    const codigo = await comando.executar(ctx, rel, posicionais);
    rel.finalizar(codigo ?? SAIDA.OK);
    return { codigo: codigo ?? SAIDA.OK, relatorio: rel };
  } catch (e) {
    const conhecido = e instanceof ErroSetup;
    const codigo = conhecido ? e.saida : SAIDA.FALHA;
    const mensagem = esconderValores(conhecido ? e.message : `erro inesperado: ${e && e.message ? e.message : e}`, segredosVistos);
    if (conhecido && e.saida === SAIDA.PENDENTE) {
      rel.pendencia(e.codigo, mensagem, e.comando, e.quem);
      if (e.dica) rel.info(e.dica);
      if (e.dados) rel.dado('detalhes', e.dados);
    } else {
      rel.acao(e.codigo || 'erro', mensagem, 'falhou');
      if (e.dica) rel.info(e.dica);
      if (e.dados) rel.dado('detalhes', e.dados);
    }
    if (!conhecido && process.env.TELA_DEBUG) err(String(e && e.stack) + '\n');
    rel.finalizar(codigo, rel.json ? mensagem : '');
    return { codigo, relatorio: rel };
  }
}
