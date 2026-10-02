/* /api/backup — exportar e importar os dados desta instalação (formato e regras em _lib/backup.js).
 *
 *   GET                  equipe  baixa o backup: catálogo + configuração operacional + textos legais. Anota "backup feito agora"
 *                                (a tela Saúde olha isso).
 *   GET ?contas=1        super   o mesmo, COM as contas (equipe com hash de senha, espectadores sem senha). O arquivo passa a ser
 *                                sensível: quem baixa precisa guardá-lo como guarda uma senha.
 *   POST { backup, aplicar, rev, simular }
 *                        super   importa. `aplicar` diz quais partes ({ catalogo, operacao, legal, contas }); `simular: true`
 *                                só descreve o que faria (e confere o arquivo); `rev` é a do catálogo que a tela viu (409 se
 *                                mudou). O catálogo entra como publicação nova, no histórico. */
import { json, erro } from '../_lib/sessao.js';
import { montarBackup, registrarBackup, importarBackup, BYTES_MAXIMOS_DO_ARQUIVO } from '../_lib/backup.js';

export async function onRequestGet({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const comContas = new URL(request.url).searchParams.get('contas') === '1';
  if (comContas && !(data.conta && data.conta.super === true)) return erro(403, 'so-superadmin');
  const backup = await montarBackup({ env, incluirContas: comContas });
  const registrado = await registrarBackup(env, backup, data.conta && data.conta.usuario);
  const dia = backup.criadoEm.slice(0, 10);
  return json(200, Object.assign({}, backup, { registrado }), { 'content-disposition': `attachment; filename="backup-${dia}.json"` });
}

export async function onRequestPost({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const texto = await request.text();
  if (texto.length > BYTES_MAXIMOS_DO_ARQUIVO) return erro(413, 'backup-grande');
  let corpo;
  try { corpo = JSON.parse(texto); } catch (e) { return erro(400, 'corpo-invalido'); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro(400, 'corpo-invalido');

  const r = await importarBackup({
    env, backup: corpo.backup, escolhas: corpo.aplicar, rev: corpo.rev, simular: corpo.simular === true,
    quem: (data.conta && data.conta.usuario) || 'superadmin'
  });
  if (!r.ok) return erro(r.status, r.codigo, r.params, r.extras);
  return json(200, r);
}
