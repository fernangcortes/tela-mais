/* scripts/lib/setup/cmd-turnstile.mjs — `setup.mjs turnstile`: liga a proteção anti-robô do cadastro.
 * A chave do SITE é pública (vai em `vars` do wrangler.jsonc); a chave SECRETA entra só por `segredo TURNSTILE_SECRET`. */
import { erroUso, pendente } from './erros.mjs';
import { lerWrangler, gravarVarNoWrangler } from './cloudflare.mjs';
import { lerJsonc } from './jsonc.mjs';

const PADRAO_CHAVE_DO_SITE = /^[0-9A-Za-z_-]{8,80}$/;

export const PASSO_A_PASSO = [
  'No painel da Cloudflare (dash.cloudflare.com), no menu da esquerda abra "Turnstile" e clique em "Adicionar widget" (Add widget).',
  'Dê um nome (por exemplo o do seu site), em "Hostname" ponha o endereço do site (o que termina em workers.dev, ou o seu domínio) e deixe o modo "Gerenciado" (Managed).',
  'Ao criar, a Cloudflare mostra duas chaves: a "Chave do site" (Site Key, pública) e a "Chave secreta" (Secret Key). Copie a do site para este comando; a secreta você cola no passo seguinte, no campo escondido.'
];

export const turnstile = {
  nome: 'turnstile',
  resumo: 'Liga o Turnstile (proteção anti-robô gratuita da Cloudflare), obrigatório no modo cadastro.',
  uso: 'turnstile [--chave-do-site CHAVE_PUBLICA]',
  flags: { 'chave-do-site': 'valor' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const w = await lerWrangler(ctx.raiz);
    if (!w.existe) throw erroUso('não encontrei o wrangler.jsonc na pasta do projeto.');
    let atual = null;
    try { atual = lerJsonc(w.texto).vars?.TURNSTILE_SITE_KEY || null; } catch { /* arquivo com erro: o doctor avisa */ }
    let chave = f['chave-do-site'];
    if (!chave && atual) {
      rel.acao('turnstile-site', 'A chave pública do Turnstile já está no wrangler.jsonc', 'ja-estava');
    } else {
      if (!chave && ctx.interativo && !f.yes) {
        PASSO_A_PASSO.forEach((p, i) => rel.info(`  ${i + 1}. ${p}`));
        chave = (await ctx.perguntar.texto('Cole a "Chave do site" (a pública, não a secreta)')).trim();
      }
      if (!chave) {
        throw pendente('turnstile-chave-do-site', 'falta a chave PÚBLICA (a "Chave do site") do Turnstile. Ela não é segredo, pode vir pelo chat; a chave SECRETA nunca.', {
          quem: 'agente', comando: 'node scripts/setup.mjs turnstile --chave-do-site <CHAVE_DO_SITE>',
          dica: `Agente: guie a pessoa, um passo por vez. ${PASSO_A_PASSO.join(' ')} Depois rode o comando com a chave do SITE e peça que ela rode, no terminal dela: node scripts/setup.mjs segredo TURNSTILE_SECRET`
        });
      }
      if (!PADRAO_CHAVE_DO_SITE.test(chave)) throw erroUso('essa chave não parece a "Chave do site" do Turnstile (letras, números, _ e -; ela costuma começar com 0x). Se for a SECRETA, não a cole aqui: apague-a do chat e gere outra no painel.');
      const g = await gravarVarNoWrangler(ctx.raiz, 'TURNSTILE_SITE_KEY', chave, { dryRun: ctx.flags.dryRun });
      rel.acao('turnstile-site', 'Chave pública do Turnstile gravada em vars do wrangler.jsonc (não é segredo)', ctx.flags.dryRun ? 'simulado' : (g.mudou ? 'feito' : 'ja-estava'));
    }
    rel.passo('Agora a chave SECRETA, no terminal da pessoa: node scripts/setup.mjs segredo TURNSTILE_SECRET  (e republique com: node scripts/setup.mjs deploy)');
    return 0;
  }
};
