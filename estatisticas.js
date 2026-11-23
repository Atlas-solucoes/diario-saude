/* Estatísticas que cruzam registros. Sem tela aqui (testável em Node). Funciona offline: só usa a lista já no aparelho.
   Ideia: para cada alimento/emoção/exercício/sono/situação, conta quantas vezes foi registrado (n) e em
   quantas delas apareceu náusea, tontura ou pressão baixa nos X minutos seguintes ("apareceu junto").
   Não diz causa, não sugere dose nem tratamento.
   T-0035-3: insulina e glicose entram SÓ como contagem, lista e valores anotados (função anotados()).
   Não entram no cruzamento, não há faixa boa/ruim, média, meta, alerta nem relação com dose.
   Aviso de poucos casos: n igual ou menor que 5 (MINIMO_N). */
(function (root) {
  'use strict';
  var R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./registros.js') : root.DiarioRegistros;

  var JANELA_PADRAO = 120;   // minutos
  var MINIMO_N = 5;          // n <= 5: aviso de poucos casos (acima de 5 o aviso some)
  var DESFECHOS = [['nausea', 'náusea'], ['tontura', 'tontura'], ['pressao', 'pressão baixa']];
  var GRUPOS = [
    { id: 'alimento', titulo: 'Alimentos', tipo: 'alimentacao' },
    { id: 'emocao', titulo: 'Emoções', tipo: 'emocao', campo: 'emocao' },
    { id: 'exercicio', titulo: 'Exercícios', tipo: 'exercicio', campo: 'atividade' },
    { id: 'sono', titulo: 'Sono', tipo: 'sono', campo: 'qualidade' },
    { id: 'situacao', titulo: 'Situações diferentes', tipo: 'diferente', campo: 'situacao' }
  ];
  var ROTULO_GRUPO_SONO = 'Dormiu ';

  function janelaValida(m) {
    m = Number(m);
    return isFinite(m) && Math.floor(m) === m && m >= 15 && m <= 720 ? m : JANELA_PADRAO;
  }
  function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function ms(iso) { return new Date(iso).getTime(); }
  function pct(casos, n) { return n ? Math.round(casos / n * 1000) / 10 : 0; }
  function ehPoucos(n, minimoN) { return n <= minimoN; }

  function rotuloEscolha(tipo, campoId, valor) {
    var campos = R.ESQUEMAS[tipo].campos;
    for (var i = 0; i < campos.length; i++) {
      if (campos[i].id !== campoId) continue;
      for (var j = 0; j < campos[i].opcoes.length; j++) if (campos[i].opcoes[j][0] === valor) return campos[i].opcoes[j][1];
    }
    return String(valor);
  }

  /* Cada registro de exposição vira uma lista de rótulos (alimentos: um por item, sem repetir no mesmo registro). */
  function rotulosDe(grupo, reg) {
    var d = reg.dados || {};
    if (grupo.id === 'alimento') {
      var vistos = {}, out = [];
      (Array.isArray(d.itens) ? d.itens : []).forEach(function (it) {
        var k = norm(it);
        if (k && !vistos[k]) { vistos[k] = 1; out.push(k); }
      });
      return out;
    }
    if (d[grupo.campo] === undefined || d[grupo.campo] === null || d[grupo.campo] === '') return [];
    var r = rotuloEscolha(grupo.tipo, grupo.campo, d[grupo.campo]);
    return [grupo.id === 'sono' ? ROTULO_GRUPO_SONO + r.toLowerCase() : r];
  }

  function filtrar(registros, opcoes) {
    return (registros || []).filter(function (r) {
      return r && r.dataHora && !isNaN(ms(r.dataHora)) && (!opcoes.pessoa || r.pessoa === opcoes.pessoa);
    });
  }

  /* registros: lista de {tipo, pessoa, dataHora, dados}. opcoes: {janelaMin, pessoa, minimoN, agora}
     Regra: o desfecho conta se estiver entre o horário do registro e o horário + janela (inclusive nas duas pontas).
     Um mesmo desfecho pode contar para vários alimentos/situações próximos — por isso é "apareceu junto". */
  function calcular(registros, opcoes) {
    opcoes = opcoes || {};
    var janelaMin = janelaValida(opcoes.janelaMin);
    var janelaMs = janelaMin * 60000;
    var minimoN = opcoes.minimoN > 0 ? opcoes.minimoN : MINIMO_N;
    var agora = opcoes.agora !== undefined ? ms(opcoes.agora) : null;
    var lista = filtrar(registros, opcoes);
    var desf = {};
    DESFECHOS.forEach(function (d) { desf[d[0]] = []; });
    lista.forEach(function (r) { if (desf[r.tipo]) desf[r.tipo].push(ms(r.dataHora)); });

    var aindaAbertos = 0;
    var saida = { janelaMin: janelaMin, minimoN: minimoN, pessoa: opcoes.pessoa || null, aindaAbertos: 0, totalRegistros: lista.length, grupos: [] };

    GRUPOS.forEach(function (g) {
      var mapa = {};
      lista.forEach(function (r) {
        if (r.tipo !== g.tipo) return;
        var t = ms(r.dataHora);
        if (agora !== null && t + janelaMs > agora) { aindaAbertos++; return; } // janela ainda não fechou
        rotulosDe(g, r).forEach(function (rot) {
          var l = mapa[rot] || (mapa[rot] = { rotulo: rot, n: 0, nausea: { casos: 0, pct: 0 }, tontura: { casos: 0, pct: 0 }, pressao: { casos: 0, pct: 0 }, algum: { casos: 0, pct: 0 }, poucos: false });
          l.n++;
          var algum = false;
          DESFECHOS.forEach(function (d) {
            var achou = desf[d[0]].some(function (td) { return td >= t && td <= t + janelaMs; });
            if (achou) { l[d[0]].casos++; algum = true; }
          });
          if (algum) l.algum.casos++;
        });
      });
      var linhas = Object.keys(mapa).map(function (k) {
        var l = mapa[k];
        ['nausea', 'tontura', 'pressao', 'algum'].forEach(function (c) { l[c].pct = pct(l[c].casos, l.n); });
        l.poucos = ehPoucos(l.n, minimoN);
        return l;
      }).sort(function (a, b) { return b.n - a.n || (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : 0); });
      saida.grupos.push({ id: g.id, titulo: g.titulo, linhas: linhas });
    });
    saida.aindaAbertos = aindaAbertos;
    return saida;
  }

  /* T-0035-3: insulina e glicose só como registro. Devolve contagem, lista (mais recente primeiro) e valores anotados.
     Não usa janela, não cruza com sintomas, não calcula média/soma/mínimo/máximo e não classifica nada.
     opcoes: {pessoa, minimoN} */
  function anotados(registros, opcoes) {
    opcoes = opcoes || {};
    var minimoN = opcoes.minimoN > 0 ? opcoes.minimoN : MINIMO_N;
    var lista = filtrar(registros, opcoes);
    var recentesPrimeiro = function (a, b) { return ms(b.dataHora) - ms(a.dataHora); };

    var ins = lista.filter(function (r) { return r.tipo === 'insulina'; }).sort(recentesPrimeiro);
    var porNome = {};
    var itensIns = ins.map(function (r) {
      var d = r.dados || {};
      var qual = typeof d.qual === 'string' && d.qual.trim() ? d.qual.trim() : 'sem nome';
      var k = norm(qual);
      var g = porNome[k] || (porNome[k] = { rotulo: qual, n: 0, quantidades: [], poucos: false });
      g.n++;
      if (typeof d.quantidade === 'number') g.quantidades.push(d.quantidade);
      return { dataHora: r.dataHora, pessoa: r.pessoa, qual: qual, quantidade: typeof d.quantidade === 'number' ? d.quantidade : null,
        unidade: d.unidade || 'U', tipo: d.tipoInsulina ? rotuloEscolha('insulina', 'tipoInsulina', d.tipoInsulina) : null };
    });
    var nomes = Object.keys(porNome).map(function (k) {
      var g = porNome[k]; g.poucos = ehPoucos(g.n, minimoN); return g;
    }).sort(function (a, b) { return b.n - a.n || (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : 0); });

    var gli = lista.filter(function (r) { return r.tipo === 'glicose'; }).sort(recentesPrimeiro);
    var itensGli = gli.map(function (r) {
      var d = r.dados || {};
      return { dataHora: r.dataHora, pessoa: r.pessoa, valor: typeof d.valor === 'number' ? d.valor : null, unidade: 'mg/dL',
        momento: d.momento ? rotuloEscolha('glicose', 'momento', d.momento) : null,
        origem: d.origem ? rotuloEscolha('glicose', 'origem', d.origem) : null };
    });

    return {
      minimoN: minimoN,
      insulina: { total: itensIns.length, poucos: ehPoucos(itensIns.length, minimoN), porNome: nomes, lista: itensIns },
      glicose: { total: itensGli.length, poucos: ehPoucos(itensGli.length, minimoN), lista: itensGli }
    };
  }

  function textoJanela(min) {
    if (min % 60 === 0) return min / 60 + ' h';
    return min + ' min';
  }
  function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }
  function numBr(v) { return String(v).replace('.', ','); }

  /* Frase curta e neutra para uma linha (n sempre aparece). */
  function frase(linha, janelaMin) {
    var partes = DESFECHOS.map(function (d) {
      return d[1] + ' em ' + linha[d[0]].casos + ' de ' + linha.n + ' (' + String(linha[d[0]].pct).replace('.', ',') + '%)';
    });
    var t = '«' + linha.rotulo + '»: ' + plural(linha.n, 'vez registrada', 'vezes registradas') +
      '. Em até ' + textoJanela(janelaMin) + ' depois, apareceu junto: ' + partes.join('; ') + '.';
    if (linha.poucos) t += ' Poucos casos (n=' + linha.n + '): ainda não dá para tirar conclusão.';
    return t;
  }

  /* Textos neutros de insulina e glicose: só o que foi anotado. */
  function fraseInsulina(item) {
    var t = item.qual + (item.quantidade !== null ? ' — ' + numBr(item.quantidade) + ' ' + item.unidade : '');
    if (item.tipo) t += ' — ' + item.tipo;
    return t;
  }
  function fraseGlicose(item) {
    var t = item.valor !== null ? numBr(item.valor) + ' ' + item.unidade : 'sem número';
    if (item.momento) t += ' — ' + item.momento;
    if (item.origem) t += ' — origem: ' + item.origem;
    return t;
  }
  function avisoPoucos(n) {
    return 'Poucos casos (n=' + n + '): ainda não dá para tirar conclusão.';
  }

  var AVISO_LEITURA = 'Isto só mostra o que apareceu junto nos registros, em até a janela escolhida depois de cada anotação. ' +
    'Não diz o motivo e não é avaliação médica. Leve estes números ao médico.';
  var AVISO_ANOTADOS = 'Insulina e glicose aparecem aqui só como foram anotadas. Não são comparadas com nada nem avaliadas.';

  var api = { JANELA_PADRAO: JANELA_PADRAO, MINIMO_N: MINIMO_N, DESFECHOS: DESFECHOS, GRUPOS: GRUPOS, AVISO_LEITURA: AVISO_LEITURA,
    AVISO_ANOTADOS: AVISO_ANOTADOS, calcular: calcular, anotados: anotados, frase: frase, fraseInsulina: fraseInsulina,
    fraseGlicose: fraseGlicose, avisoPoucos: avisoPoucos, ehPoucos: ehPoucos, textoJanela: textoJanela, janelaValida: janelaValida };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioEstatisticas = api;
})(typeof self !== 'undefined' ? self : globalThis);
