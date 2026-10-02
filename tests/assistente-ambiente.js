/* tests/assistente-ambiente.js — a mesa de verdade (os arquivos de core/site/mesa-*.js) num DOM falso, só com as telas de
 * operação (Saúde, Backup, Custos e o Assistente). Sem navegador e sem rede: o `fetch` é um roteador de mentira que o teste
 * configura, e registra cada pedido (método, caminho, corpo) para o teste conferir o que a tela mandou.
 *
 * Os eventos: as telas escutam no `document` (como mesa-acesso.js); o DOM falso só sobe até a raiz da tela, então `evento()`
 * dispara no nó e depois chama os ouvintes do documento. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarSite, SITE, No } = require('./home-dom-falso.js');

/* o DOM falso não tem `replaceWith` (o navegador tem; a mesa o usa para trocar só um pedaço da tela) */
if (!No.prototype.replaceWith) No.prototype.replaceWith = function (novo) { this.parentNode.replaceChild(novo, this); };

const TELAS = { saude: 'telaSaude', backup: 'telaBackup', custos: 'telaCustos', assistente: 'telaAssistente', mcp: 'telaMcp' };

class LeitorFalso {
  readAsText(arquivo) { setImmediate(() => { this.result = arquivo.texto; this.onload && this.onload(); }); }
  readAsDataURL(arquivo) { setImmediate(() => { this.result = 'data:' + arquivo.type + ';base64,AAAA'; this.onload && this.onload(); }); }
}

function abrirOperacao({ super: ehSuper = true, permissoes = [], rotas = {}, servidor, confirmar = true, idioma = 'pt-BR' } = {}) {
  const baixados = [];
  const copiados = [];
  const confirmacoes = [];
  const amb = criarSite({
    rotas,
    antes(janela) {
      janela.Blob = Blob;
      janela.FileReader = LeitorFalso;
      janela.URL = Object.assign(function (u, b) { return new URL(u, b); }, { createObjectURL: (b) => { baixados.push(b); return 'blob:falso'; }, revokeObjectURL() {} });
      janela.navigator.clipboard = { writeText: async (t) => { copiados.push(t); } };
      janela.confirm = (t) => { confirmacoes.push(t); return typeof confirmar === 'function' ? confirmar(t) : confirmar; };
      janela.setImmediate = setImmediate;
      janela.document = null;
    }
  });
  const doc = amb.doc;
  amb.janela.document = doc;
  amb.janela.MESA = undefined;
  doc.getElementById = (id) => doc.body.todos().find((n) => n.id === id) || null;
  doc.addEventListener = (t, f) => { (doc.ouvintes[t] = doc.ouvintes[t] || []).push(f); };
  const ctx = vm.createContext(amb.janela);
  const palco = doc.createElement('div'); palco.id = 'palco-admin'; doc.body.appendChild(palco);
  const aviso = doc.createElement('div'); aviso.id = 'aviso'; doc.body.appendChild(aviso);
  for (const arquivo of ['i18n.js', 'home-blocos.js', 'catalogo-core.js']) vm.runInContext(fs.readFileSync(path.join(SITE, arquivo), 'utf8'), ctx, { filename: arquivo });
  /* o pt-BR é a referência (e o que faltar em outro idioma cai nele); o idioma da vez entra por cima */
  for (const id of idioma === 'pt-BR' ? ['pt-BR'] : ['pt-BR', idioma]) {
    ctx.__catalogo = JSON.parse(fs.readFileSync(path.join(SITE, '..', 'locales', id + '.json'), 'utf8'));
    vm.runInContext(`AppI18n.instancia().definirCatalogo('${id}', __catalogo);`, ctx);
  }
  vm.runInContext(`AppI18n.instancia().definirIdioma('${idioma}');`, ctx);
  for (const arquivo of ['mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa-mcp.js', 'mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js']) {
    vm.runInContext(fs.readFileSync(path.join(SITE, arquivo), 'utf8'), ctx, { filename: arquivo });
  }
  const M = amb.janela.MESA;
  M.sessao.super = ehSuper;
  M.sessao.permissoes = permissoes;
  M.sessao.token = 'token-de-teste';
  M.st.servidor = servidor === undefined ? { rev: 5, itens: [], padroes: {}, site: {} } : servidor;
  if (M.st.servidor) M.st.servidor.itens = M.st.servidor.itens || [];
  const painelDir = doc.createElement('div'); painelDir.id = 'dir-corpo'; doc.body.appendChild(painelDir);

  /* o que mesa.js faz: desenha a tela da vez no centro (e o painel da direita) */
  M.redesenhar = function () {
    const fn = TELAS[M.st.tela];
    if (fn) palco.replaceChildren(M[fn]());
    const p = M.painel(M.efetivo());
    painelDir.replaceChildren(p.cab, p.corpo);
  };
  M.irTela = function (tela) { M.st.tela = tela; M.redesenhar(); };
  M.aoMudar = function () {};

  const api = {
    amb, M, App: amb.janela.App, doc, palco, painelDir, baixados, copiados, confirmacoes, aviso,
    pedidos: amb.pedidos,
    janela: amb.janela,
    /* um evento no nó: sobe pela árvore e chega aos ouvintes do documento */
    evento(no, tipo, extra) {
      no.disparar(tipo, extra);
      const ev = Object.assign({ type: tipo, target: no, preventDefault() {}, stopPropagation() {} }, extra);
      (doc.ouvintes[tipo] || []).slice().forEach((f) => f(ev));
    },
    clicar(no) { if (typeof no === 'string') no = api.achar(no); if (!no) throw new Error('não achei o nó para clicar'); api.evento(no, 'click'); },
    digitar(no, valor) { if (typeof no === 'string') no = api.achar(no); no.value = valor; api.evento(no, 'input'); },
    mudar(no, valor) {
      if (typeof no === 'string') no = api.achar(no);
      if (typeof valor === 'boolean') no.checked = valor; else if (valor !== undefined) no.value = valor;
      api.evento(no, 'change');
    },
    achar(sel) { return palco.querySelector(sel); },
    todos(sel) { return palco.querySelectorAll(sel); },
    texto() { return palco.textContent; },
    /* deixa promessas e temporizadores andarem */
    async esperar(n = 12) { for (let i = 0; i < n; i++) { await new Promise((r) => setImmediate(r)); amb.janela.__correr(); } },
    /* os pedidos que bateram num caminho (ignorando a barra de consulta, a menos que se passe) */
    pedidosDe(caminho, metodo) { return amb.pedidos.filter((p) => (metodo ? p.metodo === metodo : true) && (caminho instanceof RegExp ? caminho.test(p.url) : p.url.indexOf(caminho) === 0)); },
    corpoDe(p) { return p && p.corpo ? JSON.parse(p.corpo) : null; },
    tela(nome) { M.st.tela = nome; M.redesenhar(); },
    arquivo(texto, nome = 'backup.json', tipo = 'application/json') { return { name: nome, type: tipo, size: texto.length, texto }; }
  };
  return api;
}

const resposta = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

module.exports = { abrirOperacao, resposta, SITE };
