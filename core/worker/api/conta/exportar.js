/* GET /api/conta/exportar  -> um JSON com tudo o que o site guarda sobre a pessoa
 * (LGPD, art. 18: acesso e portabilidade). Baixa como arquivo.
 *
 * Sai: dados da conta, consentimentos (qual texto, qual versão, quando), sessões
 * (datas e navegador resumido), convites e links mágicos (só as datas). NÃO sai: hash
 * de senha, hash de token, nem nada de outra pessoa. Equipe e superadmin recebem o
 * que o servidor sabe da conta deles (sem hash de senha). */
import { json, erro } from '../../_lib/sessao.js';
import { exportarUsuario } from '../../_lib/contas.js';
import { abrirBanco } from '../../_lib/contas-fluxo.js';

export async function onRequestGet({ env, data }) {
  const s = data.sessao;
  let corpo;
  if (s.papel === 'espectador') {
    const aberto = await abrirBanco(env);
    if (aberto.falha) return aberto.falha;
    corpo = await exportarUsuario(aberto.db, s.usuarioId);
    if (!corpo) return erro(404, 'espectador-nao-encontrado');
  } else {
    const c = data.conta || {};
    corpo = { conta: { usuario: c.usuario, nome: c.nome || c.usuario, permissoes: c.permissoes || [], equipe: true } };
  }
  corpo.geradoEm = new Date().toISOString();
  return json(200, corpo, { 'content-disposition': 'attachment; filename="meus-dados.json"' });
}
