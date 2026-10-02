/* scripts/lib/setup/entrada.mjs — perguntas ao terminal: texto, escolha, confirmação e SENHA (prompt oculto).
 *
 * As perguntas vão para o stderr, para o stdout ficar livre para o --json. Sem terminal (agente, CI), a
 * pergunta não pode ser feita: quem chama trata `ErroSetup('sem-terminal')` como "falta ação da pessoa". */
import { pendente } from './erros.mjs';

export function criarPerguntador({ stdin = process.stdin, stderr = process.stderr } = {}) {
  const interativo = Boolean(stdin.isTTY && stderr.isTTY);

  function lerLinha({ oculto = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!stdin.isTTY) return reject(pendente('sem-terminal', 'preciso de um terminal de verdade para perguntar isto.'));
      let buf = '';
      const eraRaw = stdin.isRaw;
      stdin.setEncoding('utf8');
      if (oculto) stdin.setRawMode?.(true);
      stdin.resume();
      const fim = (valor) => {
        stdin.removeListener('data', aoReceber);
        if (oculto) stdin.setRawMode?.(Boolean(eraRaw));
        stdin.pause();
        stderr.write('\n');
        resolve(valor);
      };
      const aoReceber = (dados) => {
        for (const ch of String(dados)) {
          if (ch === '\r' || ch === '\n') return fim(buf);
          if (ch === '\u0003') { stdin.setRawMode?.(Boolean(eraRaw)); stderr.write('\n'); process.exit(130); }
          if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
          if (ch >= ' ') buf += ch;
        }
        if (!oculto) { /* modo cozido: o terminal já entrega a linha inteira, tratada acima */ }
      };
      stdin.on('data', aoReceber);
    });
  }

  return {
    interativo,
    async texto(pergunta, padrao = '') {
      stderr.write(`${pergunta}${padrao ? ` [${padrao}]` : ''}: `);
      const r = (await lerLinha()).trim();
      return r || padrao;
    },
    async senha(pergunta) {
      stderr.write(`${pergunta} (a digitação não aparece): `);
      return lerLinha({ oculto: true });
    },
    async confirmar(pergunta, padrao = false) {
      stderr.write(`${pergunta} ${padrao ? '[S/n]' : '[s/N]'}: `);
      const r = (await lerLinha()).trim().toLowerCase();
      if (!r) return padrao;
      return ['s', 'sim', 'y', 'yes'].includes(r);
    },
    /* opcoes: [{ valor, rotulo, detalhe? }]; devolve o `valor`. */
    async escolher(pergunta, opcoes, padrao) {
      stderr.write(`${pergunta}\n`);
      opcoes.forEach((o, i) => stderr.write(`  ${i + 1}) ${o.rotulo}${o.detalhe ? ' — ' + o.detalhe : ''}${o.valor === padrao ? '  (padrão)' : ''}\n`));
      for (;;) {
        stderr.write('Número ou nome: ');
        const r = (await lerLinha()).trim();
        if (!r && padrao !== undefined) return padrao;
        const porNumero = opcoes[Number(r) - 1];
        if (porNumero) return porNumero.valor;
        const porNome = opcoes.find((o) => o.valor === r);
        if (porNome) return porNome.valor;
        stderr.write('Não entendi. ');
      }
    }
  };
}

/* O texto inteiro de um stdin que NÃO é terminal (para --stdin). Tira só a quebra de linha final. */
export async function lerStdinInteiro(stdin = process.stdin) {
  if (stdin.isTTY) throw pendente('sem-stdin', 'nada foi enviado pela entrada padrão. Use: echo -n "valor" | node scripts/setup.mjs ... --stdin, ou rode sem --stdin num terminal.');
  const partes = [];
  for await (const p of stdin) partes.push(Buffer.from(p));
  return Buffer.concat(partes).toString('utf8').replace(/\r?\n$/, '');
}
