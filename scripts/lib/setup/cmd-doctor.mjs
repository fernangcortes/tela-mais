/* scripts/lib/setup/cmd-doctor.mjs — `setup.mjs doctor`: diagnóstico em português simples, com --json. */
import { executarDoctor, GRUPOS } from './doctor.mjs';
import { erroUso, SAIDA } from './erros.mjs';

export const doctor = {
  nome: 'doctor',
  resumo: 'Diagnóstico: ambiente, config, Cloudflare, vídeo, acesso, administrador, segurança e (com --remote) o site publicado.',
  uso: `doctor [--only ${GRUPOS.join(',')}] [--remote] [--url https://...] [--video-id ID] [--hls URL] [--fix] [--json]`,
  flags: { only: 'lista', remote: 'bool', url: 'valor', 'video-id': 'valor', hls: 'lista', fix: 'bool' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    for (const g of f.only || []) if (!GRUPOS.includes(g)) throw erroUso(`grupo "${g}" desconhecido. Grupos: ${GRUPOS.join(', ')}.`);
    const r = await executarDoctor(ctx, rel, { only: f.only, remote: f.remote === true, url: f.url, hls: f.hls || [], videoId: f['video-id'] });
    rel.dado('acesso', r.modo);
    const erros = rel.checagens.filter((c) => c.status === 'erro').length;
    if (erros) rel.passo('Corrija os itens com ERRO (cada um diz o que fazer) e rode o doctor de novo.');
    else if (!f.remote && !(f.only || []).includes('remoto')) {
      const completo = !(f.only && f.only.length);
      const avisos = rel.checagens.filter((c) => c.status === 'aviso').length;
      rel.passo(completo
        ? (avisos ? 'Sem erros. Leia os avisos acima; depois use node scripts/setup.mjs status para ver a próxima etapa.' : 'Sem erros. Use node scripts/setup.mjs status para ver a próxima etapa.')
        : 'Esta parte está em ordem. Use node scripts/setup.mjs status para ver a próxima etapa.');
    }
    return erros ? SAIDA.FALHA : SAIDA.OK;
  }
};
