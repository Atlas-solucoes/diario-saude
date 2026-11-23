/* Voz: entende uma frase falada e transforma em registro (SEM salvar — a tela sempre pede confirmação).
   Função pura, testável no Node. Regra de ouro: só repete o que foi dito/anotado. Nunca avalia valor
   (nada de alto/baixo/normal), nunca sugere dose nem tratamento.
   MVP (parecer do Engenheiro 22/11): entende de verdade glicose, insulina e comida. Nos outros 7 tipos
   reconhece o tipo (e a opção quando a própria palavra diz, ex.: "corri"); o resto se completa no formulário. */
(function (root) {
  'use strict';
  var isNode = typeof require === 'function' && typeof module !== 'undefined';
  var R = isNode ? require('./registros.js') : root.DiarioRegistros;

  /* padrão sem acento -> regex que aceita com ou sem acento */
  var ACENTOS = { a: '[aáàãâ]', e: '[eéê]', i: '[ií]', o: '[oóôõ]', u: '[uúü]', c: '[cç]' };
  function ac(p) { return p.replace(/[aeiouc]/g, function (ch) { return ACENTOS[ch]; }); }
  function rx(p, flags) { return new RegExp('(^|[^\\wáàãâéêíóôõúüç])(' + ac(p) + ')(?=$|[^\\wáàãâéêíóôõúüç])', flags || 'i'); }
  function tem(txt, p) { return rx(p).test(txt); }
  function semAcento(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /* ---------- números falados -> dígitos ---------- */
  var UN = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
    dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
    oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
    quatrocentos: 400, quinhentos: 500, seiscentos: 600 };
  function valorPalavra(w) { var k = semAcento(w.toLowerCase()); return Object.prototype.hasOwnProperty.call(UN, k) ? UN[k] : null; }

  /* "cento e dez" -> "110"; "quatro e meio" -> "4,5"; "4.5" -> "4,5". Devolve o texto com os números trocados. */
  function numerosParaDigitos(frase) {
    var t = String(frase || '').replace(/(\d)\.(\d)/g, '$1,$2').split(/\s+/).filter(Boolean);
    var out = [], i = 0;
    while (i < t.length) {
      var v = valorPalavra(t[i]);
      if (v === null) { out.push(t[i]); i++; continue; }
      var total = v, j = i + 1, meio = false;
      while (j + 1 < t.length && semAcento(t[j].toLowerCase()) === 'e') {
        var prox = semAcento(t[j + 1].toLowerCase());
        if (prox === 'meio' || prox === 'meia') { meio = true; j += 2; break; }
        var v2 = valorPalavra(t[j + 1]);
        if (v2 === null || v2 >= total) break;      // "dois e três" não vira 5
        total += v2; j += 2;
      }
      // "um" sozinho seguido de comida ("um pão") fica como palavra
      if (j === i + 1 && !meio && (v === 1) && t[j] && !/^(unidade|u\b|mg)/i.test(t[j])) { out.push(t[i]); i++; continue; }
      out.push(meio ? total + ',5' : String(total));
      i = j;
    }
    return out.join(' ');
  }

  function primeiroNumero(txt) {
    var m = /(\d+(?:,\d+)?)/.exec(txt);
    return m ? m[1] : undefined;
  }

  /* ---------- tipo ---------- */
  var GATILHOS = [
    ['glicose', ['glicose', 'glicemia', 'glicemia capilar', 'dextro', 'hgt']],
    ['insulina', ['insulina']],
    ['alimentacao', ['comi', 'comeu', 'comemos', 'almocei', 'almocou', 'almoco', 'jantei', 'jantou', 'janta', 'jantar',
      'lanchei', 'lanchou', 'lanche', 'merendei', 'cafe da manha', 'bebi', 'bebeu']],
    ['nausea', ['enjoo', 'enjoada', 'enjoado', 'enjoei', 'nausea', 'vomitei', 'vomitou', 'vomito']],
    ['tontura', ['tonta', 'tonto', 'tontura']],
    ['pressao', ['pressao', 'fraqueza', 'fraca', 'fraco']],
    ['sono', ['dormi', 'dormiu', 'sono', 'acordei', 'acordou']],
    ['exercicio', ['corri', 'correu', 'caminhei', 'caminhou', 'dancei', 'dancou', 'brinquei', 'brincou', 'exercicio',
      'esporte', 'futebol', 'natacao', 'nadei', 'bicicleta', 'pedalei', 'educacao fisica']],
    ['emocao', ['feliz', 'triste', 'preocupada', 'preocupado', 'brava', 'bravo', 'tranquila', 'tranquilo', 'me senti', 'emocao']],
    ['diferente', ['escola', 'festa', 'passeio', 'viagem', 'diferente', 'rotina']]
  ];
  function acharTipo(txt) {
    // "unidade(s)" sozinho só vale como insulina se a frase não fala de comida ("comi 2 unidades de pão")
    if (!tem(txt, 'insulina') && (tem(txt, 'unidades') || tem(txt, 'unidade'))) {
      var comida = GATILHOS.filter(function (g) { return g[0] === 'alimentacao'; })[0][1].some(function (p) { return tem(txt, p); });
      if (!comida) return 'insulina';
    }
    for (var i = 0; i < GATILHOS.length; i++)
      for (var j = 0; j < GATILHOS[i][1].length; j++) if (tem(txt, GATILHOS[i][1][j])) return GATILHOS[i][0];
    return null;
  }

  function escolhaPorPalavra(txt, mapa) {
    for (var k in mapa) for (var j = 0; j < mapa[k].length; j++) if (tem(txt, mapa[k][j])) return k;
    return undefined;
  }
  var ESCALA = { muito: ['muito', 'muita', 'forte'], pouco: ['pouco', 'pouca', 'leve'], mais_ou_menos: ['mais ou menos', 'medio'] };

  /* ---------- comida: itens ---------- */
  var PALAVRAS_COMIDA = /(?:^|\s)(?:eu\s+)?(?:comi|comeu|comemos|almocei|almocou|jantei|jantou|lanchei|lanchou|merendei|bebi|bebeu|tomei\s+caf[eé]\s+da\s+manh[aã]\s+com|tomei|no\s+almo[cç]o|no\s+jantar|no\s+lanche|de\s+almo[cç]o|de\s+janta)\s+/i;
  var ARTIGOS = /^(?:um|uma|uns|umas|o|a|os|as|de|do|da|meu|minha)\s+/i;
  function itensDaFrase(frase) {
    var m = PALAVRAS_COMIDA.exec(frase);
    if (!m) return [];
    var resto = frase.slice(m.index + m[0].length);
    resto = resto.replace(/[,.;]?\s*(?:e\s+)?(?:n[aã]o\s+)?passe[iu]\s+mal.*$/i, '');   // tira "e passei mal"
    return resto.split(/\s*,\s*|\s+e\s+/i).map(function (s) {
      var x = s.trim().replace(/[.!?]+$/, '');
      while (ARTIGOS.test(x)) x = x.replace(ARTIGOS, '');
      return x;
    }).filter(Boolean).slice(0, 20);
  }

  /* ---------- principal ---------- */
  /* opcoes: { nomesInsulina: [] }
     Devolve { tipo|null, entrada, faltou[], destaque, resumo, frase } — entrada no mesmo formato do formulário. */
  function interpretar(frase, opcoes) {
    opcoes = opcoes || {};
    var original = String(frase || '').trim();
    var txt = numerosParaDigitos(original).toLowerCase();
    var tipo = acharTipo(txt);
    var entrada = {}, faltou = [];
    if (!tipo) return { tipo: null, entrada: entrada, faltou: ['tipo'], destaque: '', resumo: '', frase: original };

    if (tipo === 'glicose') {
      var depois = /(?:glicose|glicemia|dextro|hgt)\D{0,12}?(\d+(?:,\d+)?)/i.exec(txt);
      var n = depois ? depois[1] : primeiroNumero(txt);
      if (n && n.indexOf(',') < 0) entrada.valor = n; else faltou.push('valor');
      var mom = escolhaPorPalavra(txt, { antes: ['antes'], depois: ['depois', 'apos'] });
      if (mom) entrada.momento = mom;
      var ori = escolhaPorPalavra(txt, { sensor: ['sensor', 'libre'], dedo: ['dedo', 'ponta do dedo', 'furinho'] });
      if (ori) entrada.origem = ori;
    } else if (tipo === 'insulina') {
      var qd = /(\d+(?:,\d+)?)\s*(?:unidade|u\b)/i.exec(txt);
      var q = qd ? qd[1] : primeiroNumero(txt);
      if (q) entrada.quantidade = q; else faltou.push('quantidade');
      var ti = escolhaPorPalavra(txt, { rapida: ['rapida', 'ultrarrapida', 'ultra rapida', 'da refeicao'], basal: ['basal', 'lenta', 'de base'] });
      if (ti) entrada.tipoInsulina = ti;
      (opcoes.nomesInsulina || []).some(function (nome) {
        if (nome && semAcento(txt).indexOf(semAcento(nome.toLowerCase())) >= 0) { entrada.qual = nome; return true; }
        return false;
      });
    } else if (tipo === 'alimentacao') {
      var itens = itensDaFrase(numerosParaDigitos(original));
      if (itens.length) entrada.itens = itens; else faltou.push('itens');
      if (/n[aã]o\s+passe[iu]\s+mal/i.test(txt)) entrada.passouMal = 'nao';
      else if (/passe[iu]\s+mal/i.test(txt)) entrada.passouMal = 'sim';
      else entrada.passouMal = 'nao_sei';
    } else if (tipo === 'exercicio') {
      var at = escolhaPorPalavra(txt, { correu: ['corri', 'correu'], caminhou: ['caminhei', 'caminhou'], dancou: ['dancei', 'dancou'],
        brincou: ['brinquei', 'brincou'], esporte: ['esporte', 'futebol', 'natacao', 'nadei', 'educacao fisica', 'bicicleta', 'pedalei'] });
      if (at) entrada.atividade = at; else faltou.push('atividade');
      var min = /(\d+)\s*min/.exec(txt); if (min) entrada.minutos = min[1];
    } else if (tipo === 'emocao') {
      var em = escolhaPorPalavra(txt, { feliz: ['feliz'], tranquila: ['tranquila', 'tranquilo', 'calma', 'calmo'], triste: ['triste'],
        preocupada: ['preocupada', 'preocupado', 'nervosa', 'nervoso'], brava: ['brava', 'bravo', 'irritada', 'irritado'] });
      if (em) entrada.emocao = em; else faltou.push('emocao');
    } else if (tipo === 'sono') {
      var sq = escolhaPorPalavra(txt, { mais_ou_menos: ['mais ou menos'], mal: ['mal', 'pouco', 'ruim'], bem: ['bem', 'otimo', 'bom'] });
      if (sq) entrada.qualidade = sq; else faltou.push('qualidade');
    } else if (tipo === 'nausea' || tipo === 'tontura') {
      var it = escolhaPorPalavra(txt, ESCALA);
      if (it) entrada.intensidade = it; else faltou.push('intensidade');
      if (tipo === 'nausea' && tem(txt, 'vomitei')) entrada.vomito = 'sim';
    } else if (tipo === 'pressao') {
      var si = escolhaPorPalavra(txt, { quase_desmaio: ['quase desmaiei', 'quase desmaiou'], fraqueza: ['fraqueza', 'fraca', 'fraco'] });
      if (si) entrada.sintoma = si; else faltou.push('sintoma');
    } else if (tipo === 'diferente') {
      var sit = escolhaPorPalavra(txt, { escola: ['escola'], passeio: ['passeio'], festa: ['festa'], viagem: ['viagem'], rotina: ['rotina'] });
      if (sit) entrada.situacao = sit; else faltou.push('situacao');
    }

    var m = R.montarDados(tipo, entrada);
    // número fora da faixa de digitação: não vale, pede para corrigir
    if (!m.ok) m.erros.forEach(function (e) { if (faltou.indexOf('confira') < 0) faltou.push('confira'); });
    var destaque = '';
    if (tipo === 'glicose' && m.dados.valor !== undefined) destaque = m.dados.valor + ' mg/dL';
    if (tipo === 'insulina' && m.dados.quantidade !== undefined) destaque = String(m.dados.quantidade).replace('.', ',') + ' U';
    return { tipo: tipo, entrada: entrada, dadosOk: m.ok, dados: m.dados, erros: m.erros, faltou: faltou, destaque: destaque,
      resumo: R.resumo({ tipo: tipo, dados: m.dados }), frase: original };
  }

  /* Texto que o app fala depois de entender (só repete o que entendeu) */
  function falaEntendi(res) {
    if (!res.tipo) return 'Não entendi o que anotar. Tente de novo, por exemplo: glicose cento e dez.';
    return 'Entendi: ' + res.resumo + '. Confira e toque em Salvar.';
  }
  function falaAnotado(resumo, hora) { return 'Anotado: ' + resumo + (hora ? ', às ' + hora : '') + '.'; }

  var api = { interpretar: interpretar, numerosParaDigitos: numerosParaDigitos, itensDaFrase: itensDaFrase,
    falaEntendi: falaEntendi, falaAnotado: falaAnotado };
  if (isNode) module.exports = api;
  else root.DiarioVoz = api;
})(typeof window !== 'undefined' ? window : this);
