/* Tela "Estatísticas" (#/estatisticas). Carregue ANTES de app.js. O rotear() do app.js chama
   DiarioEstatisticasTela.mostrar() quando a rota é #/estatisticas (ver app.js, T-0035-3).
   Usa textContent (nunca innerHTML com dados). Só lê o banco local: abre sem internet.
   Insulina e glicose: só contagem, lista e valores anotados, sem faixa, média, meta, alerta nem dose. */
(function () {
  'use strict';
  var E = DiarioEstatisticas;
  var store = DiarioDB.criarStore(DiarioDB.criarIndexedDB('diario-saude'));
  var tela = document.getElementById('tela');
  var estado = { janela: E.JANELA_PADRAO, pessoa: '' };
  var sequencia = 0;
  var LIMITE_LISTA = 50;

  function el(tag, texto, attrs) {
    var e = document.createElement(tag);
    if (texto) e.textContent = texto;
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
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
  function celula(tag, texto) { return el(tag, texto); }
  function pcel(c) { return celula('td', c.casos + ' (' + String(c.pct).replace('.', ',') + '%)'); }
  function quando(iso) {
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function nomePessoa(p) { return window.DiarioFamilia ? DiarioFamilia.rotuloDe(p) : String(p); }

  function listaAnotada(itens, formatar) {
    var ul = el('ul', '', { 'class': 'anotados' });
    itens.slice(0, LIMITE_LISTA).forEach(function (it) {
      ul.appendChild(el('li', quando(it.dataHora) + ' (' + nomePessoa(it.pessoa) + '): ' + formatar(it)));
    });
    if (itens.length > LIMITE_LISTA) ul.appendChild(el('li', 'Mostrando as ' + LIMITE_LISTA + ' mais recentes de ' + itens.length + '.'));
    return ul;
  }

  function blocoAnotados(a) {
    tela.appendChild(el('h3', 'Insulina anotada'));
    tela.appendChild(el('p', E.AVISO_ANOTADOS));
    if (!a.insulina.total) {
      tela.appendChild(el('p', 'Nenhuma insulina anotada.'));
    } else {
      tela.appendChild(el('p', 'Total anotado: ' + a.insulina.total + (a.insulina.total === 1 ? ' vez.' : ' vezes.')));
      if (a.insulina.poucos) tela.appendChild(el('p', '⚠ ' + E.avisoPoucos(a.insulina.total), { 'class': 'poucos' }));
      var tb = el('table', '', { 'class': 'estat' });
      var th = el('tr');
      ['Nome anotado', 'n (vezes)', 'Quantidades anotadas'].forEach(function (t) { th.appendChild(celula('th', t)); });
      tb.appendChild(th);
      a.insulina.porNome.forEach(function (g) {
        var tr = el('tr');
        var c0 = celula('td', g.rotulo);
        if (g.poucos) c0.appendChild(el('small', ' ⚠ poucos casos', { 'class': 'poucos' }));
        tr.appendChild(c0);
        tr.appendChild(celula('td', String(g.n)));
        tr.appendChild(celula('td', g.quantidades.map(function (q) { return String(q).replace('.', ','); }).join(', ') + (g.quantidades.length ? ' U' : '')));
        tb.appendChild(tr);
      });
      tela.appendChild(tb);
      tela.appendChild(listaAnotada(a.insulina.lista, E.fraseInsulina));
    }

    tela.appendChild(el('h3', 'Glicose anotada'));
    if (!a.glicose.total) {
      tela.appendChild(el('p', 'Nenhuma glicose anotada.'));
    } else {
      tela.appendChild(el('p', 'Total anotado: ' + a.glicose.total + (a.glicose.total === 1 ? ' vez.' : ' vezes.')));
      if (a.glicose.poucos) tela.appendChild(el('p', '⚠ ' + E.avisoPoucos(a.glicose.total), { 'class': 'poucos' }));
      tela.appendChild(listaAnotada(a.glicose.lista, E.fraseGlicose));
    }
  }

  async function desenhar() {
    var meu = ++sequencia;
    var todos = await store.listarTodos();
    if (meu !== sequencia) return; // outra chamada mais nova assumiu
    while (tela.firstChild) tela.removeChild(tela.firstChild);
    tela.appendChild(el('h2', 'Estatísticas'));
    tela.appendChild(el('p', E.AVISO_LEITURA));
    var barra = el('div', '', { 'class': 'filtros' });
    barra.appendChild(seletor('Depois de quanto tempo olhar?',
      [[60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [240, '4 horas'], [360, '6 horas'], [720, '12 horas']],
      estado.janela, function (v) { estado.janela = Number(v); desenhar(); }));
    barra.appendChild(seletor('De quem?',
      DiarioFamilia.opcoesFiltro(),
      estado.pessoa, function (v) { estado.pessoa = v; desenhar(); }));
    tela.appendChild(barra);

    var r = E.calcular(todos, { janelaMin: estado.janela, pessoa: estado.pessoa || undefined, agora: new Date().toISOString() });
    if (!r.totalRegistros) tela.appendChild(el('p', 'Ainda não há registros para mostrar.'));
    if (r.aindaAbertos) tela.appendChild(el('p', r.aindaAbertos + ' anotação(ões) recente(s) ficaram de fora porque o tempo escolhido ainda não passou.'));

    r.grupos.forEach(function (g) {
      tela.appendChild(el('h3', g.titulo));
      if (!g.linhas.length) { tela.appendChild(el('p', 'Sem registros neste grupo.')); return; }
      var tb = el('table', '', { 'class': 'estat' });
      var th = el('tr');
      ['Registro', 'n (vezes)', 'Náusea', 'Tontura', 'Pressão baixa', 'Algum'].forEach(function (t) { th.appendChild(celula('th', t)); });
      tb.appendChild(th);
      g.linhas.forEach(function (l) {
        var tr = el('tr');
        var c0 = celula('td', l.rotulo);
        if (l.poucos) c0.appendChild(el('small', ' ⚠ poucos casos', { 'class': 'poucos' }));
        tr.appendChild(c0);
        tr.appendChild(celula('td', String(l.n)));
        tr.appendChild(pcel(l.nausea)); tr.appendChild(pcel(l.tontura)); tr.appendChild(pcel(l.pressao)); tr.appendChild(pcel(l.algum));
        tb.appendChild(tr);
        if (l.poucos) tr.setAttribute('title', E.frase(l, r.janelaMin));
      });
      tela.appendChild(tb);
    });
    tela.appendChild(el('p', 'Colunas: quantas vezes (e %) apareceu junto, em relação ao n da linha. Poucos casos (n de ' + r.minimoN + ' ou menos) não permitem conclusão.'));

    blocoAnotados(E.anotados(todos, { pessoa: estado.pessoa || undefined }));
  }

  function mostrar() {
    desenhar().catch(function (e) { document.getElementById('status').textContent = 'Erro: ' + e.message; });
  }
  window.DiarioEstatisticasTela = { mostrar: mostrar };
})();
