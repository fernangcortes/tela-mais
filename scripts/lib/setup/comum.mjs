/* scripts/lib/setup/comum.mjs — pedaços que vários comandos repetem. */
import { lerSite, gravarSite, ehObjeto } from './config-io.mjs';
import { pendente } from './erros.mjs';
import { garantirGitignore } from './segredos.mjs';

export const clonar = (v) => JSON.parse(JSON.stringify(v));

/* Grava config/site.json (validando), reporta como ação e roda o aplicar-config. Devolve { mudou, config }. */
export async function salvarConfig(ctx, rel, novoBruto, descricao = 'Atualizei config/site.json') {
  const r = await gravarSite(ctx.raiz, novoBruto, { dryRun: ctx.flags.dryRun });
  if (!r.mudou) rel.acao('config', 'config/site.json já estava assim', 'ja-estava');
  else rel.acao('config', descricao, ctx.flags.dryRun ? 'simulado' : 'feito');
  if (ctx.flags.dryRun) { rel.acao('aplicar-config', 'Regeneraria os arquivos do site (tema, manifest, textos)', 'simulado'); return r; }
  const ap = await ctx.aplicarConfig({ raiz: ctx.raiz, verificar: false });
  if (!ap.ok) throw pendente('aplicar-falhou', 'a configuração foi gravada, mas não consegui gerar os arquivos do site.', { dica: String(ap.erros && ap.erros[0] && ap.erros[0].mensagem || '') });
  rel.acao('aplicar-config', ap.alterados.length ? `Arquivos do site atualizados (${ap.alterados.length})` : 'Arquivos do site já estavam em dia', ap.alterados.length ? 'feito' : 'ja-estava');
  return r;
}

export async function siteAtual(ctx) {
  const s = await lerSite(ctx.raiz);
  return { existe: s.existe, bruto: clonar(ehObjeto(s.bruto) ? s.bruto : {}) };
}

/* .gitignore antes de qualquer segredo ir para arquivo local. */
export async function protegerSegredosLocais(ctx, rel) {
  const add = await garantirGitignore(ctx.raiz, { dryRun: ctx.flags.dryRun });
  if (add.length) rel.acao('gitignore', `.gitignore passou a ignorar: ${add.join(', ')}`, ctx.flags.dryRun ? 'simulado' : 'feito');
}

/* Pergunta se pode, ou exige --yes. `codigo` identifica a pendência no JSON. */
export async function autorizar(ctx, codigo, pergunta, comandoComYes) {
  if (ctx.flags.yes) return true;
  if (ctx.interativo) {
    if (await ctx.perguntar.confirmar(pergunta, false)) return true;
    throw pendente(codigo, 'a pessoa não autorizou; nada foi alterado.', { comando: comandoComYes, quem: 'agente' });
  }
  throw pendente(codigo, `${pergunta} Preciso da autorização da pessoa.`, { comando: comandoComYes, quem: 'agente', dica: 'Pergunte à pessoa e, se ela concordar, rode de novo com --yes.' });
}

export const apelidoDeModo = (v) => ({ public: 'publico', publico: 'publico', público: 'publico', signup: 'cadastro', cadastro: 'cadastro', private: 'privado', privado: 'privado' })[String(v || '').toLowerCase()];

export const normalizarHex = (v) => {
  const t = String(v || '').trim().replace(/^#?/, '#').toLowerCase();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t) ? t : null;
};
