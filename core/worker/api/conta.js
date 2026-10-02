/* GET  /api/conta   -> quem está usando a mesa, e o que essa conta pode
 * PUT  /api/conta   { senhaAtual, senhaNova } -> troca a própria senha
 *
 * A senha do superadmin não passa por aqui: ela é a variável ADMIN_PASSWORD do
 * ambiente do Worker, e trocá-la é trocar a variável (o que também invalida
 * todos os tokens de uma vez, inclusive os das contas).
 */
import { json, lerContas, gravarContas, acharConta, conferirSenha, hashSenha, iteracoesDe, emitirToken } from '../_lib/sessao.js';
import App from '../../site/catalogo-core.js';

export async function onRequestGet({ data }) {
  const c = data.conta;
  return json(200, { usuario: c.usuario, nome: c.nome, super: c.super === true, permissoes: c.permissoes || [] });
}

export async function onRequestPut({ request, env, data }) {
  if (data.conta.super === true) {
    return json(400, { erro: 'a senha do superadmin é a variável ADMIN_PASSWORD, no ambiente do Worker' });
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  const senhaNova = corpo && corpo.senhaNova;
  if (!App.senhaValida(senhaNova)) {
    return json(400, { erro: 'a senha nova precisa de pelo menos ' + App.SENHA_MINIMA + ' caracteres' });
  }

  const dados = await lerContas(env);
  const conta = acharConta(dados, data.conta.usuario);
  if (!conta) return json(404, { erro: 'conta não encontrada' });
  if (!await conferirSenha(corpo.senhaAtual, conta.senha)) {
    return json(401, { erro: 'a senha atual não confere' });
  }

  conta.senha = await hashSenha(senhaNova, iteracoesDe(env));
  /* A versão sobe: os tokens de antes param de valer no pedido seguinte —
   * inclusive os de outro navegador onde a conta ficou aberta. */
  conta.versao = (conta.versao || 1) + 1;
  conta.alterada_em = new Date().toISOString();
  await gravarContas(env, dados);

  /* E esta sessão ganha um token novo, senão ela cairia junto. */
  return json(200, Object.assign({ ok: true }, await emitirToken(env, conta)));
}
