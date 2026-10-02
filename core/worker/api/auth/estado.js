/* GET /api/auth/estado — o que a página de entrada precisa saber, sem segredo nenhum.
 *
 *   { modo, contas, metodo, cadastroAberto, emailAtivo, senha, turnstile: { siteKey },
 *     versoes: { privacidade, termos }, sessao: { papel } }
 *
 * `sessao.papel` é como a página sabe se já está dentro (o cookie é HttpOnly: o
 * JavaScript não o lê). Tudo aqui já é público de qualquer jeito (o modo aparece
 * em config.public.json); o que NÃO sai: motivo de configuração faltando, nomes de
 * variável, qualquer valor de segredo. */
import { json } from '../../_lib/sessao.js';
import { versoesVigentes } from '../../_lib/contas-legal.js';
import { diagnosticoDeAcesso } from '../../_lib/contas-fluxo.js';
import { chavePublicaDoTurnstile } from '../../_lib/turnstile.js';

export async function onRequestGet({ env, data, modo, config }) {
  const d = diagnosticoDeAcesso({ env, config, politica: data.politica, modo });
  let versoes = { privacidade: 1, termos: 1 };
  try { versoes = await versoesVigentes(env); } catch (e) { /* sem banco: modelo, versão 1 */ }
  return json(200, {
    modo,
    contas: modo !== 'publico' && d.banco,
    metodo: data.politica.metodo,
    cadastroAberto: d.cadastro.disponivel,
    aprovacaoManual: modo === 'cadastro' && data.politica.aprovacaoManual,
    emailAtivo: d.email.disponivel,
    senha: modo === 'cadastro' && data.politica.metodo === 'email-e-senha',
    /* Onde a senha é definida: no formulário (sem verificação de e-mail) ou na
     * página do link (com verificação: quem a define é o dono do e-mail). */
    senhaNoCadastro: modo === 'cadastro' && data.politica.metodo === 'email-e-senha' && !(data.politica.verificarEmail && d.email.disponivel),
    turnstile: { siteKey: d.turnstile.configurado ? chavePublicaDoTurnstile(env) : '' },   /* só a chave PÚBLICA */
    versoes,
    sessao: { papel: data.sessao.papel }
  });
}
