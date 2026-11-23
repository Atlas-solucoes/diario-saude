/* Tela "Relatório" (#/relatorio). Carregue DEPOIS de relatorio.js e ANTES de app.js.
   O rotear() do app.js chama DiarioRelatorioTela.mostrar() quando a rota é #/relatorio.
   Só lê o banco local e gera o PDF no aparelho: abre e funciona sem internet, nada é enviado.
   Usa textContent (nunca innerHTML com dados). */
(function () {
  'use strict';
  var Rel = DiarioRelatorio;
  var store = DiarioDB.criarStore(DiarioDB.criarIndexedDB('diario-saude'));
  var tela = document.getElementById('tela');
  var estado = { periodo: '7', de: '', ate: '', pessoa: '' };

  function el(tag, texto, attrs) {
    var e = document.createElement(tag);
    if (texto) e.textContent = texto;
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function dia(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }

  /* Últimos N dias contando hoje (ex.: 7 dias = hoje e os 6 anteriores). Hora do aparelho. */
  function ultimosDias(n, hoje) {
    var fim = hoje || new Date();
    var ini = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() - (n - 1));
    return { de: dia(ini), ate: dia(fim) };
  }
  function periodoEscolhido() {
    if (estado.periodo === 'outro') return { de: estado.de, ate: estado.ate };
    return ultimosDias(Number(estado.periodo));
  }
  function seletor(rotulo, opcoes, valor, aoMudar) {
    var l = el('label', rotulo + ' ');
    var s = el('select');
    opcoes.forEach(function (o) {
      var op = el('option', o[1], { value: o[0] });
      if (String(o[0]) === String(valor)) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', function () { aoMudar(s.value); });
    l.appendChild(s);
    return l;
  }
  function campoData(rotulo, valor, aoMudar) {
    var l = el('label', rotulo + ' ');
    var i = el('input', '', { type: 'date' });
    i.value = valor || '';
    i.addEventListener('input', function () { aoMudar(i.value); });
    l.appendChild(i);
    return l;
  }

  async function desenhar() {
    var todos = await store.listarTodos();
    var pend = [];
    try { pend = await store.pendentes(); } catch (e) { pend = []; }
    while (tela.firstChild) tela.removeChild(tela.firstChild);
    tela.appendChild(el('h2', 'Relatório em PDF'));
    tela.appendChild(el('p', 'Gera um PDF com o que foi anotado, para levar ao médico. Insulina e glicose aparecem só como foram anotadas, em tabelas. O PDF é feito neste celular e nada é enviado.'));

    var barra = el('div', '', { 'class': 'filtros' });
    barra.appendChild(seletor('Período:', [['7', 'Últimos 7 dias'], ['14', 'Últimos 14 dias'], ['30', 'Últimos 30 dias'], ['outro', 'Escolher as datas']],
      estado.periodo, function (v) { estado.periodo = v; desenhar().catch(erro); }));
    if (estado.periodo === 'outro') {
      barra.appendChild(campoData('De', estado.de, function (v) { estado.de = v; }));
      barra.appendChild(campoData('Até', estado.ate, function (v) { estado.ate = v; }));
    }
    barra.appendChild(seletor('De quem?', [['', 'Todos'], ['filha', 'Filha'], ['pai', 'Pai'], ['mae', 'Mãe']],
      estado.pessoa, function (v) { estado.pessoa = v; desenhar().catch(erro); }));
    tela.appendChild(barra);

    if (pend.length) {
      tela.appendChild(el('p', pend.length + ' registro(s) ainda não sincronizado(s) com a família. Eles entram no PDF mesmo assim.'));
    }
    var msg = el('p', '', { role: 'status', 'class': 'erro' });
    var gerar = el('button', 'Gerar PDF', { type: 'button', 'class': 'principal' });
    gerar.addEventListener('click', function () {
      msg.textContent = '';
      var p = periodoEscolhido();
      if (!p.de || !p.ate) { msg.textContent = 'Escolha a data de início e a data final.'; return; }
      try {
        var r = Rel.baixarPDF(todos, { de: p.de, ate: p.ate, pessoa: estado.pessoa || undefined, agora: new Date().toISOString() });
        msg.textContent = 'PDF gerado neste celular com ' + r.total + ' registro(s).';
      } catch (e) { msg.textContent = e.message; }
    });
    tela.appendChild(gerar);
    tela.appendChild(msg);
  }
  function erro(e) { document.getElementById('status').textContent = 'Erro: ' + e.message; }

  function mostrar() { desenhar().catch(erro); }
  window.DiarioRelatorioTela = { mostrar: mostrar, ultimosDias: ultimosDias };
})();
