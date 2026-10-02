/* scripts/lib/setup/saida.mjs — o relatório de um comando.
 *
 * Em modo normal escreve português simples na tela; com --json escreve UM objeto JSON no stdout (e nada mais),
 * com este formato (versao 1):
 *
 *   { versao, comando, ok, codigoDeSaida, dryRun, resumo, mensagens[], acoes[], checagens[], pendencias[], dados, proximoPasso }
 *
 *   acoes[]       { id, descricao, estado: 'feito' | 'ja-estava' | 'simulado' | 'pulado' | 'pendente' | 'falhou' }
 *   checagens[]   { id, grupo, status: 'ok' | 'aviso' | 'erro' | 'pulado', mensagem, correcao }
 *   pendencias[]  { codigo, mensagem, comando, quem }   o que falta (saída 3). quem = 'pessoa' (ela mesma precisa rodar o
 *                 comando no terminal dela: senha, login) ou 'agente' (falta uma resposta/autorização: o agente pergunta
 *                 à pessoa e roda o comando de novo)
 */
import { SAIDA } from './erros.mjs';

const TITULOS = { env: 'Ambiente', config: 'Configuração', cloudflare: 'Cloudflare', video: 'Vídeo', acesso: 'Acesso', admin: 'Administrador', seguranca: 'Segurança', remoto: 'Site publicado' };
const ROTULO = { ok: 'OK    ', aviso: 'AVISO ', erro: 'ERRO  ', pulado: 'PULOU ' };
const ROTULO_ACAO = { feito: 'feito', 'ja-estava': 'já estava pronto', simulado: 'simulado (--dry-run)', pulado: 'pulado', pendente: 'pendente', falhou: 'falhou' };

/* Frase final quando o comando não deu a sua: descreve o que aconteceu sem prometer mais do que isso. */
function resumoPadrao(codigo, dryRun) {
  if (codigo === SAIDA.OK) return dryRun ? 'Simulação concluída: nada foi alterado.' : 'Concluído.';
  if (codigo === SAIDA.PENDENTE) return 'Ainda falta uma coisa (veja acima); este passo não terminou.';
  if (codigo === SAIDA.USO) return 'O comando não foi entendido (veja acima).';
  return 'Não deu certo (veja acima).';
}

export function criarRelatorio(comando, { json = false, dryRun = false, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t) } = {}) {
  const r = {
    comando, json, dryRun, mensagens: [], acoes: [], checagens: [], pendencias: [], dados: {}, proximoPasso: null, resumo: '',
    info(texto) { r.mensagens.push(texto); if (!r.json) out(texto + '\n'); },
    /* Aviso para quem lê, vai ao stderr em modo normal; no JSON só entra em `mensagens`. */
    aviso(texto) { r.mensagens.push('Aviso: ' + texto); if (!r.json) err('Aviso: ' + texto + '\n'); },
    acao(id, descricao, estado = 'feito') {
      r.acoes.push({ id, descricao, estado });
      if (!r.json) out(`  [${ROTULO_ACAO[estado] || estado}] ${descricao}\n`);
    },
    checagem(id, grupo, status, mensagem, correcao = null) {
      r.checagens.push({ id, grupo, status, mensagem, correcao });
    },
    pendencia(codigo, mensagem, comandoSugerido = null, quem = 'pessoa') { r.pendencias.push({ codigo, mensagem, comando: comandoSugerido, quem }); },
    /* Frase final própria do comando (quando o padrão genérico não descreve bem o resultado). */
    resumir(texto) { r.resumoProprio = texto; },
    dado(chave, valor) { r.dados[chave] = valor; },
    passo(texto) { r.proximoPasso = texto; },
    err
  };
  r.finalizar = (codigo, resumo = '') => {
    const contagem = { ok: 0, aviso: 0, erro: 0, pulado: 0 };
    for (const c of r.checagens) contagem[c.status] = (contagem[c.status] || 0) + 1;
    r.resumo = resumo || r.resumoProprio || (r.checagens.length
      ? `${contagem.erro} erro(s), ${contagem.aviso} aviso(s), ${contagem.ok} ok`
      : resumoPadrao(codigo, r.dryRun));
    const objeto = {
      versao: 1, comando, ok: codigo === SAIDA.OK, codigoDeSaida: codigo, dryRun: r.dryRun, resumo: r.resumo,
      mensagens: r.mensagens, acoes: r.acoes, checagens: r.checagens, pendencias: r.pendencias, dados: r.dados, proximoPasso: r.proximoPasso
    };
    if (r.json) { out(JSON.stringify(objeto, null, 2) + '\n'); return objeto; }
    if (r.checagens.length) {
      let grupo = null;
      for (const c of r.checagens) {
        if (c.grupo !== grupo) { grupo = c.grupo; out(`\n${TITULOS[grupo] || grupo}\n`); }
        out(`  ${ROTULO[c.status]} ${c.mensagem}\n`);
        if (c.correcao && (c.status === 'erro' || c.status === 'aviso')) out(`         O que fazer: ${c.correcao}\n`);
      }
      out('\n');
    }
    for (const p of r.pendencias) {
      if (p.quem === 'agente') {
        out(`Falta uma resposta ou autorização da pessoa: ${p.mensagem}\n`);
        if (p.comando) out(`  Agente: pergunte à pessoa e rode de novo:  ${p.comando}\n`);
      } else {
        out(`Falta uma ação da pessoa: ${p.mensagem}\n`);
        if (p.comando) out(`  Ela precisa rodar, no terminal dela (agente: não rode por ela):  ${p.comando}\n`);
      }
    }
    if (r.resumo) out(`${r.resumo}\n`);
    if (r.proximoPasso) out(`Próximo passo: ${r.proximoPasso}\n`);
    return objeto;
  };
  return r;
}
