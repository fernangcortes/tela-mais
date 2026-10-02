/* scripts/ia-textos.mjs — gera SUGESTÕES de texto por IA para os títulos (M9): sinopse, capítulos, tags, título alternativo,
 * descrição para acessibilidade e tradução de legenda. Substitui o antigo sinopses.mjs (que só fazia a sinopse, com o modelo e o
 * prompt fixos); a regra de "não inventar nome" e o INSUFICIENTE continuam, agora conferidos por código.
 *
 * Nada vai ao ar: o que sai é SUGESTÃO na tela IA do /admin. Custa dinheiro: mostra a estimativa antes e só segue com --yes.
 *
 * Uso (da raiz do repositório):
 *     node scripts/ia-textos.mjs --tarefa sinopse-curta --item id1,id2 --simular
 *     node scripts/ia-textos.mjs --tarefa sinopse-curta,tags --piloto --yes
 *     node scripts/ia-textos.mjs --tarefa traducao-legenda --idiomas en,es --item id1 --yes
 *     node scripts/ia-textos.mjs --tarefa capitulos --todos --yes            (--refazer gera de novo o que já existe)
 *
 * tarefas: sinopse-curta, sinopse-longa, capitulos, tags, titulo-alternativo, descricao-acessivel, traducao-legenda
 * Precisa de: APP_SITE_URL e APP_SENHA (login do superadmin), a chave do provedor em ia.textos (config/site.json), e o recurso
 * ligado na tela IA do /admin. Equivalente no GitHub Actions: .github/workflows/gerar-midia.yml. */
import { argumentos, erroFatal } from './lib/catalogo.mjs';
import { carregarConfig } from './lib/config-carregar.mjs';
import { provedorDoAmbiente } from './lib/provedores/index.mjs';
import { entrar } from './lib/ia-cliente.mjs';
import { rodarTextos } from './lib/ia-lote.mjs';

const op = argumentos();
try {
  const lida = await carregarConfig({ arquivo: process.env.APP_CONFIG });
  if (!lida.ok) throw new Error('config/site.json inválida: rode `npm run config:validar`');
  const site = typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL;
  const cliente = await entrar({ site, senha: process.env.APP_SENHA || process.env.ADMIN_PASSWORD });
  const { provedor } = await provedorDoAmbiente();
  const r = await rodarTextos({ opcoes: op, cliente, config: lida.config, env: process.env, provedor });
  if (r.codigo !== 0) console.error('\n' + r.resumo);
  process.exit(r.codigo);
} catch (e) {
  erroFatal(e);
}
