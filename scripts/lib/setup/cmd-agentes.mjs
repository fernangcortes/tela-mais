/* scripts/lib/setup/cmd-agentes.mjs — `setup.mjs sync-agents`. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { lerSkills, lerNotas, gerarEspelhos, compararEspelhos, gravarEspelhos } from './agentes.mjs';
import { falha, SAIDA } from './erros.mjs';

export const syncAgents = {
  nome: 'sync-agents',
  resumo: 'Gera CLAUDE.md, GEMINI.md, .cursor/rules e .claude/skills a partir do AGENTS.md, de .agents/skills e de .agents/ferramentas (--check só confere).',
  uso: 'sync-agents [--check] [--json] [--dry-run]',
  flags: { check: 'bool' },
  async executar(ctx, rel) {
    let agentsMd;
    try { agentsMd = await readFile(path.join(ctx.raiz, 'AGENTS.md'), 'utf8'); }
    catch { throw falha('sem-agents', 'não encontrei o AGENTS.md na raiz do projeto.'); }
    const skills = await lerSkills(ctx.raiz);
    const esperado = gerarEspelhos({ agentsMd, skills, notas: await lerNotas(ctx.raiz) });
    const itens = await compararEspelhos(ctx.raiz, esperado);
    const ruins = itens.filter((i) => i.estado !== 'ok');
    rel.dado('arquivos', itens);
    rel.dado('skills', skills.map((s) => s.nome));
    if (ctx.flags.check) {
      for (const i of itens) rel.checagem('agentes:' + i.arquivo, 'seguranca', i.estado === 'ok' ? 'ok' : 'erro', `${i.arquivo}: ${i.estado}`, i.estado === 'ok' ? null : 'Rode: node scripts/setup.mjs sync-agents');
      if (ruins.length) { rel.passo('Rode: node scripts/setup.mjs sync-agents'); return SAIDA.FALHA; }
      rel.info('Os arquivos dos agentes conferem com o AGENTS.md.');
      return SAIDA.OK;
    }
    if (!ruins.length) { rel.acao('sync-agents', `Os ${itens.length} arquivos já estavam em dia`, 'ja-estava'); return SAIDA.OK; }
    if (ctx.flags.dryRun) { for (const i of ruins) rel.acao('sync:' + i.arquivo, `${i.arquivo} (${i.estado})`, 'simulado'); return SAIDA.OK; }
    await gravarEspelhos(ctx.raiz, esperado, itens);
    for (const i of ruins) rel.acao('sync:' + i.arquivo, `${i.arquivo} (${i.estado === 'obsoleto' ? 'removido' : 'gerado'})`, 'feito');
    return SAIDA.OK;
  }
};
