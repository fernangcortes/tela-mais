/* scripts/lib/setup/cmd-golive.mjs — `setup.mjs go-live`: o checklist antes de divulgar o site (docs/contas-e-chaves.md, seção 5),
 * rodando a verificação de cada item e imprimindo ok, falha ou manual. */
import { executarGoLive, SECOES } from './golive.mjs';
import { erroUso, SAIDA } from './erros.mjs';

const ROTULO = { ok: 'OK    ', falha: 'FALHA ', manual: 'MANUAL' };

export const goLive = {
  nome: 'go-live',
  resumo: 'Checklist antes de divulgar o site: roda a verificação de cada item e diz ok, falha ou manual.',
  uso: 'go-live [--url https://...] [--video-id ID] [--hls URL] [--confirmado id1,id2] [--pular-limite] [--json]',
  flags: { url: 'valor', 'video-id': 'valor', hls: 'lista', confirmado: 'lista', 'pular-limite': 'bool' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const r = await executarGoLive(ctx, { url: f.url, hls: f.hls || [], videoId: f['video-id'], confirmados: f.confirmado || [], pularLimite: f['pular-limite'] === true });
    for (const id of f.confirmado || []) if (!r.itens.some((i) => i.id === id)) throw erroUso(`--confirmado: não existe o item "${id}". Itens: ${r.itens.map((i) => i.id).join(', ')}.`);
    rel.dado('itens', r.itens);
    rel.dado('acesso', r.modo);
    if (r.url) rel.dado('url', r.url);
    const cont = { ok: 0, falha: 0, manual: 0 };
    for (const i of r.itens) cont[i.estado]++;
    rel.dado('contagem', cont);
    if (!rel.json) {
      let secao = null;
      for (const i of r.itens) {
        if (i.secao !== secao) { secao = i.secao; rel.info(`\n${secao}. ${SECOES[secao]}`); }
        rel.info(`  ${ROTULO[i.estado]} ${i.titulo}`);
        if (i.estado !== 'ok' || i.detalhe) rel.info(`         ${i.detalhe}`);
        if (i.comando && i.estado !== 'ok') rel.info(`         Comando: ${i.comando}`);
      }
      rel.info('');
    }
    rel.resumir(`${cont.ok} ok, ${cont.falha} falha(s), ${cont.manual} manual(is).`);
    if (cont.falha) { rel.passo('Corrija os itens com FALHA (cada um diz como) e rode de novo: node scripts/setup.mjs go-live'); return SAIDA.FALHA; }
    if (cont.manual) {
      const ids = r.itens.filter((i) => i.estado === 'manual').map((i) => i.id);
      rel.pendencia('go-live-manual', `${cont.manual} item(ns) só a pessoa confirma: ${ids.join(', ')}.`, `node scripts/setup.mjs go-live --confirmado ${ids.join(',')}`, 'agente');
      rel.passo('Leia cada item MANUAL à pessoa, uma pergunta por vez; ao ouvir "sim", rode de novo com --confirmado nos itens confirmados.');
      return SAIDA.PENDENTE;
    }
    rel.passo('Tudo conferido. Pode divulgar o endereço.');
    return SAIDA.OK;
  }
};
