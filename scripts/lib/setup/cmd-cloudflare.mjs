/* scripts/lib/setup/cmd-cloudflare.mjs — `setup.mjs cloudflare`: confere o login do wrangler e cria o que falta
 * (KV do catálogo, banco D1), gravando os ids no wrangler.jsonc. Nunca pede token de API: o login é o do navegador. */
import { lerWrangler, recursosDoWrangler, gravarIdsNoWrangler, exigirLogin, criarWrangler, slugDoProjeto } from './cloudflare.mjs';
import { lerSite } from './config-io.mjs';
import { falha } from './erros.mjs';
import { gerarSegredo } from './segredos.mjs';

export function avisarTokenGlobal(ctx, rel) {
  if (ctx.env.CLOUDFLARE_API_TOKEN) {
    rel.aviso('a variável CLOUDFLARE_API_TOKEN está no ambiente. O wrangler vai usá-la no lugar do login do navegador, e um token amplo é arriscado. Prefira removê-la (unset CLOUDFLARE_API_TOKEN) e entrar com "npx wrangler login". Este comando nunca pede token de API.');
    return true;
  }
  return false;
}

/* Garante SESSION_SECRET no Worker (gerado aqui, nunca mostrado). Só se o Worker já existir. */
export async function garantirSessionSecret(ctx, rel, wr) {
  const segredos = await wr.listarSegredos();
  if (segredos.nomes.includes('SESSION_SECRET')) { rel.acao('session-secret', 'SESSION_SECRET já está cadastrado', 'ja-estava'); return 'ja-estava'; }
  if (!segredos.existeWorker) { rel.acao('session-secret', 'SESSION_SECRET (chave interna das sessões): o Worker ainda não existe; ela é criada sozinha logo depois da primeira publicação', 'pulado'); return 'pulado'; }
  if (ctx.flags.dryRun) { rel.acao('session-secret', 'Geraria e cadastraria SESSION_SECRET', 'simulado'); return 'simulado'; }
  await wr.colocarSegredo('SESSION_SECRET', gerarSegredo(36));
  rel.acao('session-secret', 'SESSION_SECRET gerado e cadastrado (o valor não é mostrado)', 'feito');
  return 'feito';
}

export const CUSTO_DOS_RECURSOS = 'Custo: grátis. O armazenamento do catálogo (KV) e o banco de contas (D1) cabem no plano gratuito da Cloudflare; o plano pago do Worker (a partir de US$ 5 por mês) só é preciso se o site tiver muito público.';

export async function provisionarCloudflare(ctx, rel, { contaId, soVerificar = false } = {}) {
  const wr = criarWrangler(ctx);
  avisarTokenGlobal(ctx, rel);
  /* Simulação (--dry-run) sem login: mostra o plano e o custo, sem criar nada (e sem fingir que conferiu a conta). */
  if (ctx.flags.dryRun && !soVerificar && !(await wr.quemSou()).logado) {
    const w0 = await lerWrangler(ctx.raiz);
    const site0 = await lerSite(ctx.raiz);
    const proj = site0.bruto?.implantacao?.nomeDoProjeto || recursosDoWrangler(w0.dados).nome || slugDoProjeto(site0.bruto?.marca?.nome);
    rel.acao('login', 'Sem login na Cloudflare, não consigo conferir a sua conta; mostro só o plano', 'pendente');
    rel.acao('kv', `Criaria (se ainda não existir) o armazenamento do catálogo "${proj}-catalogo" (KV)`, 'simulado');
    rel.acao('d1', `Criaria (se ainda não existir) o banco de contas "${proj}" (D1)`, 'simulado');
    rel.acao('session-secret', 'Geraria sozinho a chave interna das sessões (SESSION_SECRET) logo depois da primeira publicação', 'simulado');
    rel.info(CUSTO_DOS_RECURSOS);
    rel.pendencia('cloudflare-sem-login', 'para criar de verdade, a pessoa precisa entrar na Cloudflare antes (npx wrangler login).', 'npx wrangler login');
    rel.dado('cloudflare', { simulado: true, projeto: proj });
    return {};
  }
  const quem = await exigirLogin(ctx, wr, { contaId });
  if (!soVerificar) rel.info(CUSTO_DOS_RECURSOS);
  rel.acao('login', `Logado na Cloudflare como ${quem.email || '(conta)'}`, 'ja-estava');
  const w = await lerWrangler(ctx.raiz);
  if (!w.existe) throw falha('sem-wrangler', 'não encontrei wrangler.jsonc na raiz do projeto.', { dica: 'Restaure com: git checkout wrangler.jsonc' });
  const { kv, d1, nome: nomeWorker } = recursosDoWrangler(w.dados);
  const site = await lerSite(ctx.raiz);
  const projeto = site.bruto?.implantacao?.nomeDoProjeto || nomeWorker || slugDoProjeto(site.bruto?.marca?.nome);
  const dry = ctx.flags.dryRun || soVerificar;
  const ids = {};

  /* KV: o id do arquivo vale se existir na conta; senão procura pelo nome; senão cria. */
  const kvs = await wr.listarKv();
  const tituloKv = `${projeto}-catalogo`;
  if (kv && kv.id && kvs.some((x) => x.id === kv.id)) { ids.kvId = kv.id; rel.acao('kv', 'Armazenamento KV do catálogo já existe', 'ja-estava'); }
  else {
    const porNome = kvs.find((x) => x.titulo === tituloKv);
    if (porNome) { ids.kvId = porNome.id; rel.acao('kv', `Reaproveitei o KV "${tituloKv}" que já existia na conta`, 'ja-estava'); }
    else if (dry) rel.acao('kv', `Criaria o KV "${tituloKv}"`, soVerificar ? 'pendente' : 'simulado');
    else { ids.kvId = await wr.criarKv(tituloKv); rel.acao('kv', `Criei o KV "${tituloKv}"`, 'feito'); }
  }

  /* D1 */
  const bancos = await wr.listarD1();
  const nomeBanco = (d1 && d1.database_name) || projeto;
  if (d1 && d1.database_id && bancos.some((x) => x.id === d1.database_id)) { ids.d1Id = d1.database_id; rel.acao('d1', 'Banco D1 (contas) já existe', 'ja-estava'); }
  else {
    const porNome = bancos.find((x) => x.nome === nomeBanco);
    if (porNome) { ids.d1Id = porNome.id; rel.acao('d1', `Reaproveitei o banco D1 "${nomeBanco}" que já existia`, 'ja-estava'); }
    else if (dry) rel.acao('d1', `Criaria o banco D1 "${nomeBanco}"`, soVerificar ? 'pendente' : 'simulado');
    else { ids.d1Id = await wr.criarD1(nomeBanco); rel.acao('d1', `Criei o banco D1 "${nomeBanco}"`, 'feito'); }
  }

  if (!dry && (ids.kvId || ids.d1Id)) {
    const g = await gravarIdsNoWrangler(ctx.raiz, ids);
    rel.acao('wrangler-jsonc', 'Ids gravados no wrangler.jsonc (não são segredos)', g.mudou ? 'feito' : 'ja-estava');
  } else if (dry && !soVerificar) rel.acao('wrangler-jsonc', 'Gravaria os ids no wrangler.jsonc', 'simulado');

  if (!soVerificar) await garantirSessionSecret(ctx, rel, wr);
  rel.dado('cloudflare', { email: quem.email, kvId: ids.kvId || null, d1Id: ids.d1Id || null, projeto });
  return ids;
}

export const cloudflare = {
  nome: 'cloudflare',
  resumo: 'Confere o login do wrangler e cria o KV e o D1 que faltam (idempotente).',
  uso: 'cloudflare [verificar|provisionar] [--conta ID] [--dry-run]',
  flags: { conta: 'valor' },
  async executar(ctx, rel, posicionais) {
    const acao = posicionais[0] || 'provisionar';
    if (!['verificar', 'provisionar'].includes(acao)) throw falha('uso-invalido', 'use: cloudflare [verificar|provisionar]', { });
    const ids = await provisionarCloudflare(ctx, rel, { contaId: ctx.flags.conta, soVerificar: acao === 'verificar' });
    if (ids && Object.keys(ids).length === 0 && rel.pendencias.length) return 3;
    rel.passo(acao === 'verificar' ? 'Agora criar os recursos (grátis): node scripts/setup.mjs cloudflare provisionar' : 'Escolha o provedor de vídeo: node scripts/setup.mjs video');
    return 0;
  }
};
