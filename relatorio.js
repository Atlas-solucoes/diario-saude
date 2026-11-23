/* Relatório em PDF por período, para levar ao médico.
   Gerado inteiro no aparelho: nenhum dado sai daqui (sem rede, sem biblioteca externa, sem serviço de terceiros).
   Escreve o PDF direto (fonte Courier, que todo leitor de PDF já traz), então funciona offline.
   T-0035-4: entram INSULINA e GLICOSE em tabelas de registros (só o que foi anotado, na ordem do horário),
   os campos saem com nomes amigáveis e o resumo mostra quantos registros de pressão têm medida.
   Regra de ouro: nenhum texto interpreta (alto/baixo/normal), não há meta, alerta, cálculo, média nem sugestão de dose.
   O aviso fixo aparece no topo, no fim e em todo rodapé. */
(function (root) {
  'use strict';
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var E = isNode ? require('./estatisticas.js') : root.DiarioEstatisticas;
  var R = isNode ? require('./registros.js') : root.DiarioRegistros;

  var AVISO = 'Aviso: este aplicativo NÃO sugere dose de insulina nem decide tratamento. ' +
    'Doses e tratamento são decididos só pelo médico. Os números abaixo apenas mostram o que apareceu junto nos registros da família.';
  var AVISO_RODAPE = 'App nao sugere dose nem tratamento - isso e com o medico.';
  var SEM_INFO = 'Sem informação';

  var TIPOS = {
    alimentacao: 'Alimentação', exercicio: 'Exercício', emocao: 'Emoção', sono: 'Sono',
    diferente: 'Situação diferente', nausea: 'Náusea', tontura: 'Tontura', pressao: 'Pressão baixa',
    insulina: 'Insulina', glicose: 'Glicose'
  };
  var PESSOAS = { filha: 'filha', pai: 'pai', mae: 'mãe', 'mãe': 'mãe' };

  /* Nomes amigáveis dos campos (o PDF nunca mostra o nome técnico). */
  var ROTULOS = {
    alimentacao: { itens: 'O que comeu', passouMal: 'Passou mal depois', porcao: 'Quanto' },
    exercicio: { atividade: 'O que fez', minutos: 'Minutos', esforco: 'Esforço' },
    emocao: { emocao: 'Como se sentiu', intensidade: 'Quanto', texto: 'O que aconteceu' },
    sono: { qualidade: 'Como dormiu', dormiu: 'Dormiu às', acordou: 'Acordou às' },
    diferente: { situacao: 'O que foi', texto: 'O que aconteceu' },
    nausea: { intensidade: 'Quanto', vomito: 'Vômito', texto: 'Estava fazendo' },
    tontura: { intensidade: 'Quanto', desmaio: 'Desmaio', texto: 'Estava fazendo' },
    pressao: { sintoma: 'O que sentiu', medida: 'Medimos a pressão' },
    insulina: { qual: 'Insulina', quantidade: 'Quantidade', tipoInsulina: 'Tipo' },
    glicose: { valor: 'Glicose', momento: 'Momento', origem: 'Origem' }
  };

  var COLS = 90;           // caracteres por linha (Courier 9 pt = 5,4 pt cada)
  var LINHAS_POR_PAGINA = 56;

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtData(d) { return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fmtDataHora(d) { return fmtData(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function numeroBr(v) { return String(v).replace('.', ','); }
  function vazio(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }

  /* 'AAAA-MM-DD' -> Date local. Inválido => null. */
  function parseDia(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /* Período em dias inteiros, com o primeiro e o último dia incluídos (00:00 do início até 23:59:59.999 do fim), hora do aparelho. */
  function intervalo(de, ate) {
    var a = parseDia(de), b = parseDia(ate);
    if (!a || !b) throw new Error('Período inválido: use datas AAAA-MM-DD.');
    if (a.getTime() > b.getTime()) throw new Error('Período inválido: a data inicial é depois da final.');
    var fim = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999);
    return { inicio: a, fim: fim };
  }

  function filtrarPeriodo(registros, de, ate, pessoa) {
    var iv = intervalo(de, ate);
    return (registros || []).filter(function (r) {
      if (!r || !r.dataHora) return false;
      var t = new Date(r.dataHora).getTime();
      if (isNaN(t)) return false;
      if (pessoa && r.pessoa !== pessoa) return false;
      return t >= iv.inicio.getTime() && t <= iv.fim.getTime();
    }).sort(function (x, y) { return new Date(x.dataHora) - new Date(y.dataHora); });
  }

  function medida(r) {
    var d = r.dados || {};
    return d.sistolica !== undefined && d.diastolica !== undefined;
  }

  function resumir(lista) {
    var porTipo = {}, dias = {}, pressaoMedida = 0;
    lista.forEach(function (r) {
      porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
      var d = new Date(r.dataHora);
      dias[d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate()] = 1;
      if (r.tipo === 'pressao' && medida(r)) pressaoMedida++;
    });
    return { total: lista.length, diasComRegistro: Object.keys(dias).length, porTipo: porTipo, pressaoMedida: pressaoMedida };
  }

  /* ---------- valores com nome amigável ---------- */
  function rotuloCampo(tipo, c) {
    if (ROTULOS[tipo] && ROTULOS[tipo][c.id]) return ROTULOS[tipo][c.id];
    return String(c.curto || c.rotulo || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/[?…]/g, '').trim() || 'Outro dado';
  }
  function rotuloOpcao(c, v) {
    for (var i = 0; i < c.opcoes.length; i++) if (c.opcoes[i][0] === v) return c.opcoes[i][1];
    return String(v);
  }
  function valorCampo(tipo, c, d) {
    var v = d[c.id];
    if (vazio(v)) return null;
    if (c.tipo === 'escolha') return rotuloOpcao(c, v);
    if (c.tipo === 'itens') return v.join(', ');
    if (c.tipo === 'numero') {
      var t = numeroBr(v);
      if (tipo === 'insulina' && c.id === 'quantidade') return t + ' ' + (d.unidade || 'U');
      if (c.sufixo) return t + ' ' + c.sufixo;
      if (c.id === 'minutos') return t + ' min';
      return t;
    }
    return String(v);
  }

  /* Detalhes de um registro, com os nomes amigáveis. Só mostra o que foi anotado. */
  function detalhe(r) {
    var d = r.dados || {};
    var esq = R.ESQUEMAS[r.tipo];
    var partes = [];
    if (esq) {
      esq.campos.forEach(function (c) {
        if (c.id === 'sistolica' || c.id === 'diastolica') return;
        var v = valorCampo(r.tipo, c, d);
        if (v !== null) partes.push(rotuloCampo(r.tipo, c) + ': ' + v);
      });
      if (r.tipo === 'pressao') {
        partes.push(medida(r) ? 'Pressão medida: ' + d.sistolica + '/' + d.diastolica + ' mmHg' : 'Sem medida de pressão registrada');
      }
    }
    if (!partes.length && d.texto) partes.push(String(d.texto));
    return partes.join('; ') || '-';
  }

  /* ---------- texto em linhas ---------- */
  function quebrar(texto, larg) {
    var saida = [], atual = '';
    String(texto).split(/\s+/).forEach(function (w) {
      while (w.length > larg) {
        if (atual) { saida.push(atual); atual = ''; }
        saida.push(w.slice(0, larg)); w = w.slice(larg);
      }
      if (!w) return;
      if (!atual) atual = w;
      else if ((atual + ' ' + w).length <= larg) atual += ' ' + w;
      else { saida.push(atual); atual = w; }
    });
    if (atual) saida.push(atual);
    return saida.length ? saida : [''];
  }
  function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + new Array(n - s.length + 1).join(' '); }
  function celula(c) { return c.casos + ' (' + String(c.pct).replace('.', ',') + '%)'; }

  /* Tabela com colunas de largura fixa; cada célula quebra em várias linhas se for longa. */
  function linhasDeTabela(larg, celulas) {
    var partes = celulas.map(function (c, i) { return quebrar(c, larg[i] - 1); });
    var altura = Math.max.apply(null, partes.map(function (p) { return p.length; }));
    var saida = [];
    for (var k = 0; k < altura; k++) {
      var t = '';
      partes.forEach(function (p, i) { t += pad(p[k] || '', larg[i]); });
      saida.push(t.replace(/\s+$/, ''));
    }
    return saida;
  }

  function quem(r) { return PESSOAS[r.pessoa] || r.pessoa || '-'; }
  function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }

  /* Monta as linhas do relatório: [{t: texto, n: negrito?}] */
  function montarLinhas(registros, opcoes) {
    opcoes = opcoes || {};
    var lista = filtrarPeriodo(registros, opcoes.de, opcoes.ate, opcoes.pessoa);
    var janela = E.janelaValida(opcoes.janelaMin);
    var L = [];
    function tit(t) { L.push({ t: '' }); L.push({ t: t, n: true }); }
    function par(t) { quebrar(t, COLS).forEach(function (x) { L.push({ t: x }); }); }
    function tabela(larg, cab, linhas) {
      linhasDeTabela(larg, cab).forEach(function (x) { L.push({ t: x, n: true }); });
      linhas.forEach(function (c) { linhasDeTabela(larg, c).forEach(function (x) { L.push({ t: x }); }); });
    }

    L.push({ t: 'RELATÓRIO DO DIÁRIO DE SAÚDE', n: true });
    par('Período: ' + fmtData(parseDia(opcoes.de)) + ' a ' + fmtData(parseDia(opcoes.ate)) +
      ' | Registros de: ' + (opcoes.pessoa ? (PESSOAS[opcoes.pessoa] || opcoes.pessoa) : 'todos da família'));
    par('Gerado em: ' + fmtDataHora(opcoes.agora ? new Date(opcoes.agora) : new Date()) + ' (no próprio aparelho)');
    L.push({ t: '' });
    par(AVISO);

    var res = resumir(lista);
    tit('1. RESUMO');
    par('Total de registros no período: ' + res.total + '. Dias com registro: ' + res.diasComRegistro + '.');
    Object.keys(TIPOS).forEach(function (k) { if (res.porTipo[k]) par('- ' + TIPOS[k] + ': ' + res.porTipo[k]); });
    Object.keys(res.porTipo).forEach(function (k) { if (!TIPOS[k]) par('- Outros registros: ' + res.porTipo[k]); });
    if (res.porTipo.pressao) par('Registros de pressão baixa com pressão medida: ' + res.pressaoMedida + ' de ' + res.porTipo.pressao + '.');
    if (!res.total) par('Nenhum registro neste período.');

    tit('2. CRUZAMENTOS (o que apareceu junto)');
    par('Para cada item: n = quantas vezes foi registrado. Depois, em quantas dessas vezes apareceu náusea, tontura ou pressão baixa em até ' +
      E.textoJanela(janela) + ' depois. Só considera registros deste período. Insulina e glicose não entram nestes cruzamentos.');
    var est = E.calcular(lista, { janelaMin: janela, agora: opcoes.agora, minimoN: opcoes.minimoN });
    var temLinha = false, temPoucos = false;
    est.grupos.forEach(function (g) {
      if (!g.linhas.length) return;
      temLinha = true;
      L.push({ t: '' });
      L.push({ t: g.titulo, n: true });
      L.push({ t: pad('Item', 26) + pad('n', 4) + pad('Náusea', 15) + pad('Tontura', 15) + pad('Pressão baixa', 15) + 'Algum' });
      g.linhas.forEach(function (l) {
        if (l.poucos) temPoucos = true;
        L.push({ t: pad(l.rotulo, 25) + (l.poucos ? '*' : ' ') + pad(l.n, 4) + pad(celula(l.nausea), 15) + pad(celula(l.tontura), 15) + pad(celula(l.pressao), 15) + celula(l.algum) });
      });
    });
    if (!temLinha) par('Sem dados para cruzar neste período.');
    if (temPoucos) { L.push({ t: '' }); par('* Poucos casos (n de ' + est.minimoN + ' ou menos): ainda não dá para tirar conclusão.'); }
    if (est.aindaAbertos) par(est.aindaAbertos + ' registro(s) recente(s) ficaram de fora dos cruzamentos porque a janela ainda não fechou.');
    par(E.AVISO_LEITURA);

    /* ---- 3. Insulina: só o que foi anotado, na ordem do horário ---- */
    var minimoN = est.minimoN;
    var ins = lista.filter(function (r) { return r.tipo === 'insulina'; });
    tit('3. INSULINA ANOTADA');
    par(E.AVISO_ANOTADOS);
    if (!ins.length) par('Nenhuma insulina anotada neste período.');
    else {
      par('Total anotado: ' + plural(ins.length, 'vez', 'vezes') + '.');
      if (E.ehPoucos(ins.length, minimoN)) par('! ' + E.avisoPoucos(ins.length));
      L.push({ t: '' });
      var LI = [17, 7, 30, 12, 24];
      tabela(LI, ['Data e hora', 'Quem', 'Qual insulina', 'Quantidade', 'Tipo'], ins.map(function (r) {
        var d = r.dados || {};
        var campoTipo = R.ESQUEMAS.insulina.campos[2];
        return [fmtDataHora(new Date(r.dataHora)), quem(r),
          typeof d.qual === 'string' && d.qual.trim() ? d.qual.trim() : SEM_INFO,
          typeof d.quantidade === 'number' ? numeroBr(d.quantidade) + ' ' + (d.unidade || 'U') : SEM_INFO,
          d.tipoInsulina ? rotuloOpcao(campoTipo, d.tipoInsulina) : SEM_INFO];
      }));
    }

    /* ---- 4. Glicose anotada ---- */
    var gli = lista.filter(function (r) { return r.tipo === 'glicose'; });
    tit('4. GLICOSE ANOTADA');
    par(E.AVISO_ANOTADOS);
    if (!gli.length) par('Nenhuma glicose anotada neste período.');
    else {
      par('Total anotado: ' + plural(gli.length, 'vez', 'vezes') + '.');
      if (E.ehPoucos(gli.length, minimoN)) par('! ' + E.avisoPoucos(gli.length));
      L.push({ t: '' });
      var LG = [17, 7, 14, 20, 32];
      var cMomento = R.ESQUEMAS.glicose.campos[1], cOrigem = R.ESQUEMAS.glicose.campos[2];
      tabela(LG, ['Data e hora', 'Quem', 'Valor', 'Momento', 'Origem do número'], gli.map(function (r) {
        var d = r.dados || {};
        return [fmtDataHora(new Date(r.dataHora)), quem(r),
          typeof d.valor === 'number' ? numeroBr(d.valor) + ' mg/dL' : SEM_INFO,
          d.momento ? rotuloOpcao(cMomento, d.momento) : SEM_INFO,
          d.origem ? rotuloOpcao(cOrigem, d.origem) : SEM_INFO];
      }));
    }

    /* ---- 5. Todos os registros, em ordem de horário ---- */
    tit('5. REGISTROS DO PERÍODO');
    if (!lista.length) par('Nenhum registro.');
    else {
      tabela([17, 7, 20, 46], ['Data e hora', 'Quem', 'Tipo', 'Detalhes'], lista.map(function (r) {
        return [fmtDataHora(new Date(r.dataHora)), quem(r), TIPOS[r.tipo] || 'Outro registro', detalhe(r)];
      }));
    }

    tit('6. PERGUNTAS PARA A CONSULTA');
    par('- Que informações ajudariam a entender os episódios?');
    par('- Quais horários, combinações de alimentos ou situações vale discutir na consulta?');

    L.push({ t: '' });
    par(AVISO);
    return { linhas: L, total: res.total };
  }

  /* ---------- escrita do PDF ---------- */
  var TROCAS = { '⚠': '!', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '•': '-' };
  function pdfTexto(s) {
    var o = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), k = s.charCodeAt(i);
      if (TROCAS[c]) c = TROCAS[c];
      else if (k < 32 || (k > 126 && k < 160) || k > 255) c = '?';
      if (c === '\\' || c === '(' || c === ')') c = '\\' + c;
      o += c;
    }
    return o;
  }

  function montarPDF(linhas) {
    var paginas = [];
    for (var i = 0; i < linhas.length; i += LINHAS_POR_PAGINA) paginas.push(linhas.slice(i, i + LINHAS_POR_PAGINA));
    if (!paginas.length) paginas.push([]);
    var objs = [];                       // índice 0 = objeto 1
    var kids = paginas.map(function (_, i) { return (5 + 2 * i) + ' 0 R'; }).join(' ');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + paginas.length + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
    paginas.forEach(function (pg, idx) {
      var y = 800, c = '';
      pg.forEach(function (l) {
        if (l.t !== '') c += 'BT /' + (l.n ? 'F2' : 'F1') + ' 9 Tf 1 0 0 1 40 ' + y + ' Tm (' + pdfTexto(l.t) + ') Tj ET\n';
        y -= 13;
      });
      c += 'BT /F1 8 Tf 1 0 0 1 40 30 Tm (' + pdfTexto(AVISO_RODAPE + '   Pagina ' + (idx + 1) + ' de ' + paginas.length) + ') Tj ET\n';
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + 2 * idx) + ' 0 R >>');
      objs.push('<< /Length ' + c.length + ' >>\nstream\n' + c + 'endstream');
    });
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);       // cada caractere já é 1 byte (0-255)
    for (var j = 0; j < out.length; j++) bytes[j] = out.charCodeAt(j) & 255;
    return bytes;
  }

  /* opcoes: {de:'AAAA-MM-DD', ate:'AAAA-MM-DD', pessoa?, janelaMin?, minimoN?, agora?} -> {bytes, total} */
  function gerarPDF(registros, opcoes) {
    var m = montarLinhas(registros, opcoes);
    return { bytes: montarPDF(m.linhas), total: m.total };
  }

  /* Só no navegador: salva/abre o PDF no próprio aparelho (Blob local; nada é enviado). */
  function baixarPDF(registros, opcoes, nome) {
    var r = gerarPDF(registros, opcoes);
    var url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = nome || ('relatorio-' + opcoes.de + '-a-' + opcoes.ate + '.pdf');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return r;
  }

  var api = { AVISO: AVISO, filtrarPeriodo: filtrarPeriodo, resumir: resumir, detalhe: detalhe, montarLinhas: montarLinhas,
    montarPDF: montarPDF, gerarPDF: gerarPDF, baixarPDF: baixarPDF, intervalo: intervalo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioRelatorio = api;
})(typeof self !== 'undefined' ? self : globalThis);
