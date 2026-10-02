/* scripts/lib/setup/cmd-acesso.mjs — `setup.mjs acesso`: o modo de acesso (público, cadastro ou privado). */
import { erroUso } from './erros.mjs';
import { definirCaminho, lerCaminho, validarBruto } from './config-io.mjs';
import { salvarConfig, siteAtual, apelidoDeModo, autorizar } from './comum.mjs';
import { DEFINICOES_DO_MODO, COMO_FUNCIONA_O_MODO, AVISO_GRAVAR_TELA } from './doctor.mjs';
import { avisosDe } from '../../validar-config.mjs';

export function aplicarAcesso(bruto, { modo, metodo, email }) {
  if (modo) definirCaminho(bruto, 'acesso.modo', modo);
  const atual = lerCaminho(bruto, 'acesso.modo');
  if (email) definirCaminho(bruto, 'acesso.email.adaptador', email);
  if (metodo) definirCaminho(bruto, 'acesso.cadastro.metodo', metodo);
  /* Cadastro que funciona sem serviço de e-mail: senha, sem verificação por e-mail. */
  if (atual === 'cadastro' && !lerCaminho(bruto, 'acesso.cadastro.metodo') && (lerCaminho(bruto, 'acesso.email.adaptador') ?? 'nenhum') === 'nenhum') {
    definirCaminho(bruto, 'acesso.cadastro.metodo', 'email-e-senha');
    if (lerCaminho(bruto, 'acesso.cadastro.verificarEmail') === undefined) definirCaminho(bruto, 'acesso.cadastro.verificarEmail', false);
  }
  if (atual === 'privado' && lerCaminho(bruto, 'acesso.privado.assinarMidia') === undefined) definirCaminho(bruto, 'acesso.privado.assinarMidia', true);
  return bruto;
}

export const acesso = {
  nome: 'acesso',
  resumo: 'Escolhe quem pode assistir: público, cadastro aberto ou privado (só convidados).',
  uso: 'acesso --modo publico|cadastro|privado [--metodo link-magico|email-e-senha] [--email nenhum|resend|cloudflare-email] [--yes]',
  flags: { modo: 'valor', mode: 'valor', metodo: 'valor', email: 'valor' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const { bruto, existe } = await siteAtual(ctx);
    if (!existe) throw erroUso('não existe config/site.json. Rode antes: node scripts/setup.mjs init');
    const atual = lerCaminho(bruto, 'acesso.modo') || 'privado';
    let modo = f.modo ?? f.mode;
    if (modo !== undefined) { modo = apelidoDeModo(modo); if (!modo) throw erroUso('modo inválido. Use publico, cadastro ou privado.'); }
    if (modo === undefined && !f.metodo && !f.email) {
      if (ctx.interativo && !f.yes) {
        modo = await ctx.perguntar.escolher('Quem pode assistir?', [
          { valor: 'publico', rotulo: 'Público', detalhe: DEFINICOES_DO_MODO.publico },
          { valor: 'cadastro', rotulo: 'Cadastro aberto', detalhe: DEFINICOES_DO_MODO.cadastro },
          { valor: 'privado', rotulo: 'Privado', detalhe: DEFINICOES_DO_MODO.privado }
        ], atual);
      } else {
        rel.info(`Modo atual: ${atual}. ${DEFINICOES_DO_MODO[atual]}`);
        rel.info(`  Na prática: ${COMO_FUNCIONA_O_MODO[atual]}`);
        rel.info(`  ${AVISO_GRAVAR_TELA}`);
        rel.dado('modo', atual);
        return 0;
      }
    }
    if (f.metodo && !['link-magico', 'email-e-senha'].includes(f.metodo)) throw erroUso('--metodo: use link-magico ou email-e-senha.');
    if (f.email && !['nenhum', 'resend', 'cloudflare-email'].includes(f.email)) throw erroUso('--email: use nenhum, resend ou cloudflare-email.');
    if (modo === 'publico' && atual !== 'publico') {
      await autorizar(ctx, 'confirmar-publico', 'Deixar o site PÚBLICO faz o catálogo abrir para qualquer pessoa com o endereço. Confirma?', 'node scripts/setup.mjs acesso --modo publico --yes');
    }
    const novo = aplicarAcesso(bruto, { modo, metodo: f.metodo, email: f.email });
    const r = await validarBruto(ctx.raiz, novo);
    await salvarConfig(ctx, rel, novo, `Acesso agora é "${lerCaminho(novo, 'acesso.modo')}"`);
    const m = lerCaminho(novo, 'acesso.modo');
    rel.info(`Modo "${m}": ${DEFINICOES_DO_MODO[m]}`);
    rel.info(`  Na prática: ${COMO_FUNCIONA_O_MODO[m]}`);
    rel.info(`  Custo: o acesso em si não custa nada extra; no plano grátis da Cloudflare cabem cerca de 100 mil chamadas por dia (veja COMECE-AQUI.md).`);
    rel.info(`  ${AVISO_GRAVAR_TELA}`);
    if (r.ok) for (const a of avisosDe(r.config)) rel.info('  Atenção: ' + a);
    rel.dado('modo', m);
    rel.passo(m === 'publico' ? 'Siga para a conta da Cloudflare: node scripts/setup.mjs cloudflare verificar' : `Siga para a conta da Cloudflare: node scripts/setup.mjs cloudflare verificar${m === 'cadastro' ? ' (lembrete: o modo cadastro também precisa do Turnstile antes de publicar)' : ''}. Depois, no vídeo, o modo restrito precisa da chave de assinatura.`);
    return 0;
  }
};
