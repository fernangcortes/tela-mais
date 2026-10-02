/* scripts/lib/setup/cmd-scan.mjs — `setup.mjs scan-secrets`: procura segredos em arquivos e em transcritos. */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { arquivosParaVarrer, varrerArquivos, varrerTexto } from './scan.mjs';
import { valoresSecretosLocais } from './segredos.mjs';
import { erroUso, SAIDA } from './erros.mjs';

const HOOK = `#!/bin/sh
# Trava de segredos: bloqueia o commit se algum arquivo preparado tiver chave, senha ou token.
# Instalado por: node scripts/setup.mjs scan-secrets --instalar-hook
node scripts/setup.mjs scan-secrets --staged || {
  echo "Commit bloqueado: achei um possível segredo. Tire-o do arquivo e guarde com: node scripts/setup.mjs segredo NOME" >&2
  exit 1
}
`;

export const scanSecrets = {
  nome: 'scan-secrets',
  resumo: 'Procura segredos (chaves, senhas, tokens) nos arquivos do projeto e em transcritos de conversa. Nunca mostra o segredo.',
  uso: 'scan-secrets [arquivos...] [--staged] [--transcript arquivo] [--stdin] [--incluir-testes] [--sem-valores-locais] [--instalar-hook] [--json]',
  flags: { 'incluir-testes': 'bool', staged: 'bool', transcript: 'lista', stdin: 'bool', 'sem-valores-locais': 'bool', 'instalar-hook': 'bool' },
  async executar(ctx, rel, posicionais) {
    const f = ctx.flags;
    if (f['instalar-hook']) {
      const arq = path.join(ctx.raiz, '.githooks', 'pre-commit');
      if (f.dryRun) { rel.acao('hook', 'Instalaria .githooks/pre-commit e git config core.hooksPath .githooks', 'simulado'); return SAIDA.OK; }
      await mkdir(path.dirname(arq), { recursive: true });
      await writeFile(arq, HOOK, { encoding: 'utf8', mode: 0o755 });
      try { await chmod(arq, 0o755); } catch { /* sem chmod no Windows */ }
      const g = await ctx.exec('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ctx.raiz });
      rel.acao('hook', '.githooks/pre-commit criado', 'feito');
      rel.acao('hooks-path', 'git configurado para usar .githooks', g.codigo === 0 ? 'feito' : 'falhou');
      return g.codigo === 0 ? SAIDA.OK : SAIDA.FALHA;
    }

    const valores = f['sem-valores-locais'] ? new Map() : await valoresSecretosLocais(ctx.raiz, ctx.env);
    const achados = [];
    let varridos = 0;
    let origem = 'arquivos';

    if (f.stdin) {
      const texto = await ctx.lerStdin();
      achados.push(...varrerTexto(texto, { rotulo: '(entrada padrão)', valores }));
      varridos = 1; origem = 'stdin';
    } else {
      const transcritos = f.transcript || [];
      for (const t of transcritos) {
        let texto;
        try { texto = await readFile(path.resolve(ctx.raiz, t), 'utf8'); } catch { throw erroUso(`não consegui ler o transcrito: ${t}`); }
        achados.push(...varrerTexto(texto, { rotulo: t, valores }));
        varridos++;
      }
      if (transcritos.length) origem = 'transcrito';
      if (!transcritos.length || posicionais.length) {
        let lista;
        if (posicionais.length) lista = { origem: 'indicados', arquivos: posicionais };
        else lista = await arquivosParaVarrer(ctx, { staged: f.staged, incluirTestes: f['incluir-testes'] });
        /* no projeto, só padrões (valores locais só valem para transcritos e para arquivos indicados) */
        const r = await varrerArquivos(ctx.raiz, lista.arquivos, { valores: posicionais.length ? valores : undefined });
        achados.push(...r.achados);
        varridos += r.varridos;
        if (!transcritos.length) origem = lista.origem;
      }
    }

    for (const a of achados) rel.checagem(`segredo:${a.arquivo}:${a.linha}`, 'seguranca', 'erro', `${a.arquivo}:${a.linha}  ${a.tipo}  ${a.trecho}`, 'Tire o valor do arquivo, troque a chave e guarde com: node scripts/setup.mjs segredo NOME');
    rel.dado('varridos', varridos);
    rel.dado('origem', origem);
    rel.dado('achados', achados);
    if (achados.length) {
      rel.passo('Considere a chave VAZADA: crie outra no painel do serviço e desative a antiga.');
      return SAIDA.FALHA;
    }
    rel.info(`Nenhum segredo encontrado (${varridos} arquivo(s)/texto(s) varridos).`);
    return SAIDA.OK;
  }
};
