/* Etapa A (Ajustes): quem a gente cuida, família que anota e "este celular é de…".
   Tudo fica SÓ neste aparelho (localStorage). Os registros guardam apenas ids; apelido, emoji e foto ficam aqui.
   Funções puras recebem o "armazenamento" por parâmetro para dar para testar sem navegador. */
(function (root) {
  'use strict';
  var CHAVE = 'diario-saude:familia';
  var EMOJIS_FAMILIA = ['👩', '👨', '👧', '👦', '👵', '👴', '🧑', '👩‍⚕️', '🦸', '🐻', '🦊', '🐼'];
  var EMOJIS_CUIDADO = ['⭐', '🌈', '🦄', '🐱', '🐶', '🦋', '🌻', '🐢', '🐰', '🦁'];
  var ID_PESSOA = /^[a-z0-9_-]{1,40}$/;
  // Etapa 2 dos Ajustes (ANALISE-AJUSTES-2.md): telefone e "anota" por pessoa, botões da tela inicial,
  // botões criados pela família (tipo 'personalizado') e configuração de mensagens. Tudo no documento da família.
  var ID_BOTAO = /^b-[a-z0-9]{6}$/;
  var ID_PERGUNTA = /^q-[a-z0-9]{4,8}$/;
  var ID_OPCAO = /^o-[a-z0-9]{4,8}$/;
  var ID_BOTAO_PADRAO = /^[a-z]{3,20}$/;
  var TIPOS_PERGUNTA = ['simnao', 'numero', 'escolha', 'texto'];
  var LIM = { ativos: 10, guardados: 20, perguntas: 4, opcoesMin: 2, opcoesMax: 6, nome: 20, rotulo: 40 };
  var VIDA_HORAS = [0, 1, 2, 4, 8];
  var EMOJIS_BOTAO = ['🌡️', '💊', '🤧', '🩹', '😮‍💨', '🫀', '🦷', '👁️', '🧠', '🩸', '💧', '🚽', '😴', '🤒', '📝', '⭐'];

  function padrao() {
    return {
      versao: 1,
      acompanhada: { id: 'acompanhada', apelido: '', emoji: '⭐', fotoId: null },
      familia: [
        { id: 'filha', apelido: 'Filha', emoji: '👧' },
        { id: 'pai', apelido: 'Pai', emoji: '👨' },
        { id: 'mae', apelido: 'Mãe', emoji: '👩' }
      ],
      esteCelular: ''
    };
  }
  function texto(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function aleatorio(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }

  /* Telefone: só celular brasileiro. Aceita DDD + celular com ou sem máscara e com ou sem +55.
     Devolve "+55DD9XXXXXXXX" ou '' se inválido. */
  function normTelefone(v) {
    if (typeof v !== 'string') return '';
    var d = v.replace(/\D/g, '');
    if (d.length === 13 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length !== 11) return '';
    var ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99 || d[2] !== '9') return '';
    return '+55' + d;
  }
  function mostrarTelefone(t) {
    if (!t) return '';
    var d = t.slice(3);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 3) + ' ' + d.slice(3, 7) + '-' + d.slice(7);
  }
  function normPessoa(f) {
    return { id: f.id, apelido: texto(f.apelido, 30) || f.id, emoji: texto(f.emoji, 8) || '🧑',
      telefone: normTelefone(f.telefone), anota: f.anota !== false };
  }
  function normPergunta(q) {
    if (!q || !ID_PERGUNTA.test(q.id) || TIPOS_PERGUNTA.indexOf(q.tipo) < 0) return null;
    var n = { id: q.id, rotulo: texto(q.rotulo, LIM.rotulo) || 'Pergunta', tipo: q.tipo, obrigatoria: q.obrigatoria === true, apagado: q.apagado === true };
    if (q.tipo === 'numero') {
      n.unidade = texto(q.unidade, 10);
      var min = Number(q.min), max = Number(q.max);
      n.min = isFinite(min) && q.min !== '' && q.min !== null && q.min !== undefined ? min : 0;
      n.max = isFinite(max) && q.max !== '' && q.max !== null && q.max !== undefined ? max : 10000;
      if (n.max <= n.min) { n.min = 0; n.max = 10000; }
    }
    if (q.tipo === 'escolha') {
      n.opcoes = (Array.isArray(q.opcoes) ? q.opcoes : []).filter(function (o) { return Array.isArray(o) && ID_OPCAO.test(o[0]); })
        .map(function (o) { return [o[0], texto(o[1], LIM.rotulo) || '?']; }).slice(0, LIM.opcoesMax);
      if (n.opcoes.length < LIM.opcoesMin) return null;
    }
    return n;
  }
  function normBotao(b) {
    if (!b || !ID_BOTAO.test(b.id)) return null;
    var perguntas = (Array.isArray(b.perguntas) ? b.perguntas : []).map(normPergunta).filter(Boolean).slice(0, 12);
    var vivas = perguntas.filter(function (q) { return !q.apagado; });
    if (!vivas.length) return null;
    if (vivas.length > LIM.perguntas) {
      var ok = vivas.slice(0, LIM.perguntas).map(function (q) { return q.id; });
      perguntas.forEach(function (q) { if (!q.apagado && ok.indexOf(q.id) < 0) q.apagado = true; });
    }
    if (!perguntas.some(function (q) { return !q.apagado && q.obrigatoria; })) {
      for (var i = 0; i < perguntas.length; i++) if (!perguntas[i].apagado) { perguntas[i].obrigatoria = true; break; }
    }
    return { id: b.id, nome: texto(b.nome, LIM.nome) || 'Meu botão', icone: texto(b.icone, 8) || '⭐', apagado: b.apagado === true, perguntas: perguntas };
  }
  function normMensagens(m, ids) {
    m = m && typeof m === 'object' ? m : {};
    var rec = {};
    if (m.recebem && typeof m.recebem === 'object') Object.keys(m.recebem).forEach(function (id) {
      if (ids.indexOf(id) < 0) return;
      var r = m.recebem[id] || {};
      rec[id] = { alertas: r.alertas === true, vida: r.vida === true };
    });
    var c = m.conteudo || {};
    return { recebem: rec, vidaHoras: VIDA_HORAS.indexOf(m.vidaHoras) >= 0 ? m.vidaHoras : 0,
      conteudo: { valor: c.valor !== false, seta: c.seta !== false, hora: c.hora !== false, apelido: c.apelido === true } };
  }

  function normalizar(c) {
    var p = padrao();
    if (!c || typeof c !== 'object') return Object.assign(p, { botoes: [], ocultos: [], botoesPersonalizados: [], mensagens: normMensagens(null, []) });
    var a = c.acompanhada || {};
    var vistos = {};
    var fam = Array.isArray(c.familia) ? c.familia.filter(function (f) {
      if (!f || !ID_PESSOA.test(f.id) || vistos[f.id]) return false; vistos[f.id] = 1; return true;
    }).map(normPessoa) : p.familia.map(normPessoa);
    if (!fam.some(function (f) { return f.anota; })) fam = fam.length ? fam : p.familia.map(normPessoa);
    if (!fam.some(function (f) { return f.anota; })) fam[0].anota = true; // sempre fica 1 pessoa que anota
    var anotam = fam.filter(function (f) { return f.anota; }).map(function (f) { return f.id; });
    var bp = (Array.isArray(c.botoesPersonalizados) ? c.botoesPersonalizados : []).map(normBotao).filter(Boolean);
    var vivos = bp.filter(function (b) { return !b.apagado; });
    if (vivos.length > LIM.ativos) vivos.slice(LIM.ativos).forEach(function (b) { b.apagado = true; });
    if (bp.length > LIM.guardados) bp = bp.filter(function (b) { return !b.apagado; }).concat(bp.filter(function (b) { return b.apagado; })).slice(0, LIM.guardados);
    var idsBotao = function (l) { return (Array.isArray(l) ? l : []).filter(function (x) { return typeof x === 'string' && (ID_BOTAO.test(x) || ID_BOTAO_PADRAO.test(x)); }); };
    var unicos = function (l) { var v = {}; return l.filter(function (x) { if (v[x]) return false; v[x] = 1; return true; }); };
    return {
      versao: 1,
      acompanhada: { id: 'acompanhada', apelido: texto(a.apelido, 30), emoji: texto(a.emoji, 8) || '⭐',
        fotoId: typeof a.fotoId === 'string' ? a.fotoId : null },
      familia: fam,
      esteCelular: anotam.indexOf(c.esteCelular) >= 0 ? c.esteCelular : '',
      botoes: unicos(idsBotao(c.botoes)),
      ocultos: unicos(idsBotao(c.ocultos)),
      botoesPersonalizados: bp,
      mensagens: normMensagens(c.mensagens, fam.filter(function (f) { return !!f.telefone; }).map(function (f) { return f.id; }))
    };
  }

  /* Botões da tela inicial na ordem escolhida. padraoTipos = R.TIPOS + esquemas (de registros.js).
     Devolve [{id, nome, icone, visivel, personalizado}] com: ids que não existem fora, faltantes no fim, ≥1 visível. */
  function listaBotoes(c, tipos, esquemas) {
    var n = normalizar(c);
    var todos = tipos.map(function (t) { return { id: t, nome: esquemas[t].nome, icone: esquemas[t].icone, personalizado: false }; })
      .concat(n.botoesPersonalizados.filter(function (b) { return !b.apagado; }).map(function (b) { return { id: b.id, nome: b.nome, icone: b.icone, personalizado: true }; }));
    var porId = {}; todos.forEach(function (b) { porId[b.id] = b; });
    var ordem = n.botoes.filter(function (id) { return porId[id]; });
    todos.forEach(function (b) { if (ordem.indexOf(b.id) < 0) ordem.push(b.id); });
    var lista = ordem.map(function (id) { var b = porId[id]; b.visivel = n.ocultos.indexOf(id) < 0; return b; });
    if (!lista.some(function (b) { return b.visivel; }) && lista.length) lista[0].visivel = true;
    return lista;
  }
  function moverBotao(c, tipos, esquemas, id, passo) {
    var n = normalizar(c);
    var ordem = listaBotoes(n, tipos, esquemas).map(function (b) { return b.id; });
    var i = ordem.indexOf(id), j = i + passo;
    if (i < 0 || j < 0 || j >= ordem.length) return n;
    ordem[i] = ordem[j]; ordem[j] = id;
    n.botoes = ordem;
    return n;
  }
  function mostrarBotao(c, tipos, esquemas, id, visivel) {
    var n = normalizar(c);
    var lista = listaBotoes(n, tipos, esquemas);
    if (!visivel && lista.filter(function (b) { return b.visivel && b.id !== id; }).length === 0) throw new Error('Deixe pelo menos um botão na tela inicial.');
    n.ocultos = n.ocultos.filter(function (x) { return x !== id; });
    if (!visivel) n.ocultos.push(id);
    return n;
  }
  function botaoPersonalizado(c, id) {
    var n = normalizar(c);
    for (var i = 0; i < n.botoesPersonalizados.length; i++) if (n.botoesPersonalizados[i].id === id) return n.botoesPersonalizados[i];
    return null;
  }
  /* Cria ou atualiza um botão. Ids de pergunta e de opção nunca mudam; o tipo de uma pergunta já criada não muda. */
  function salvarBotao(c, b) {
    var n = normalizar(c);
    var velho = b.id ? botaoPersonalizado(n, b.id) : null;
    if (!velho && n.botoesPersonalizados.filter(function (x) { return !x.apagado; }).length >= LIM.ativos) throw new Error('Já existem ' + LIM.ativos + ' botões criados. Apague um antes.');
    var nome = texto(b.nome, LIM.nome);
    if (!nome) throw new Error('Dê um nome ao botão.');
    var perguntas = (b.perguntas || []).map(function (q) {
      var antiga = velho && q.id ? velho.perguntas.filter(function (x) { return x.id === q.id; })[0] : null;
      var tipo = antiga ? antiga.tipo : q.tipo;
      var nq = { id: antiga ? antiga.id : 'q-' + aleatorio(6), rotulo: texto(q.rotulo, LIM.rotulo), tipo: tipo, obrigatoria: q.obrigatoria === true, apagado: q.apagado === true };
      if (tipo === 'numero') {
        var base = antiga || {};
        nq.unidade = q.unidade !== undefined ? q.unidade : base.unidade;
        nq.min = q.min !== undefined ? q.min : base.min;
        nq.max = q.max !== undefined ? q.max : base.max;
      }
      if (tipo === 'escolha') nq.opcoes = (q.opcoes || []).map(function (o) { return [o[0] && ID_OPCAO.test(o[0]) ? o[0] : 'o-' + aleatorio(6), o[1]]; })
        .filter(function (o) { return texto(o[1], LIM.rotulo); });
      return nq;
    });
    // perguntas antigas que sumiram da edição ficam guardadas como apagadas (o registro antigo continua legível)
    if (velho) {
      velho.perguntas.forEach(function (q) { if (!perguntas.some(function (x) { return x.id === q.id; })) { q.apagado = true; perguntas.push(q); } });
      // mantém a ordem original das perguntas antigas; as novas vão para o fim
      var pos = {}; velho.perguntas.forEach(function (q, i) { pos[q.id] = i; });
      perguntas.sort(function (a, b) { return (a.id in pos ? pos[a.id] : 999) - (b.id in pos ? pos[b.id] : 999); });
    }
    var vivas = perguntas.filter(function (q) { return !q.apagado; });
    if (!vivas.length) throw new Error('O botão precisa de pelo menos uma pergunta.');
    if (vivas.length > LIM.perguntas) throw new Error('No máximo ' + LIM.perguntas + ' perguntas por botão.');
    for (var i = 0; i < vivas.length; i++) {
      if (!vivas[i].rotulo) throw new Error('Escreva o texto de cada pergunta.');
      if (vivas[i].tipo === 'escolha' && (vivas[i].opcoes.length < LIM.opcoesMin || vivas[i].opcoes.length > LIM.opcoesMax)) throw new Error('"' + vivas[i].rotulo + '": de ' + LIM.opcoesMin + ' a ' + LIM.opcoesMax + ' opções.');
    }
    var novo = normBotao({ id: velho ? velho.id : 'b-' + aleatorio(6), nome: nome, icone: b.icone, perguntas: perguntas });
    if (!novo) throw new Error('Botão inválido.');
    if (velho) n.botoesPersonalizados = n.botoesPersonalizados.map(function (x) { return x.id === novo.id ? novo : x; });
    else n.botoesPersonalizados.push(novo);
    return normalizar(n);
  }
  function apagarBotao(c, id) {
    var n = normalizar(c);
    n.botoesPersonalizados.forEach(function (b) { if (b.id === id) b.apagado = true; });
    n.ocultos = n.ocultos.filter(function (x) { return x !== id; });
    n.botoes = n.botoes.filter(function (x) { return x !== id; });
    return n;
  }
  /* Esquema no formato de registros.js (ESQUEMAS) para um botão criado: reaproveita formulário, resumo, PDF e estatística.
     Perguntas apagadas entram como "detalhe" escondido só para ler registros antigos. */
  function esquemaDoBotao(b) {
    if (!b) return null;
    return { nome: b.nome, icone: b.icone, pergunta: b.nome, personalizado: true, campos: b.perguntas.map(function (q) {
      var campo = { id: q.id, rotulo: q.rotulo, curto: q.rotulo.toLowerCase(), obrigatorio: q.obrigatoria && !q.apagado, apagado: q.apagado };
      if (q.tipo === 'simnao') { campo.tipo = 'escolha'; campo.opcoes = [['sim', 'Sim'], ['nao', 'Não']]; }
      else if (q.tipo === 'escolha') { campo.tipo = 'escolha'; campo.opcoes = q.opcoes; }
      else if (q.tipo === 'numero') { campo.tipo = 'numero'; campo.min = q.min; campo.max = q.max; campo.decimal = true; campo.unidade = q.unidade; if (q.unidade) campo.rotulo = q.rotulo + ' (' + q.unidade + ')'; }
      else { campo.tipo = 'texto'; }
      return campo;
    }) };
  }
  function semEmoji(t) { return String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim(); }

  /* Família: incluir/editar com telefone e "anota". */
  function editarPessoa(c, id, campos) {
    var n = normalizar(c);
    var tel = campos.telefone !== undefined ? String(campos.telefone || '').trim() : undefined;
    if (tel && !normTelefone(tel)) throw new Error('Telefone inválido. Use DDD + celular, ex.: (48) 9 9999-9999.');
    n.familia.forEach(function (f) {
      if (f.id !== id) return;
      if (texto(campos.apelido, 30)) f.apelido = texto(campos.apelido, 30);
      if (texto(campos.emoji, 8)) f.emoji = texto(campos.emoji, 8);
      if (tel !== undefined) f.telefone = normTelefone(tel);
      if (campos.anota !== undefined) f.anota = campos.anota !== false;
    });
    if (!n.familia.some(function (f) { return f.anota; })) throw new Error('Pelo menos uma pessoa precisa anotar no app.');
    return normalizar(n);
  }
  function ler(armazem) {
    try { return normalizar(JSON.parse(armazem.getItem(CHAVE) || 'null')); } catch (e) { return padrao(); }
  }
  function gravar(armazem, c) { armazem.setItem(CHAVE, JSON.stringify(normalizar(c))); }

  function novoId(existentes) {
    var id;
    do { id = 'p-' + Math.random().toString(36).slice(2, 8); } while (existentes.indexOf(id) >= 0);
    return id;
  }
  /* Acrescenta quem anota. O id é aleatório: nunca deriva do apelido. Devolve a config nova. */
  function adicionar(c, apelido, emoji, extras) {
    var ap = texto(apelido, 30);
    if (!ap) throw new Error('Escreva um apelido.');
    extras = extras || {};
    var tel = String(extras.telefone || '').trim();
    if (tel && !normTelefone(tel)) throw new Error('Telefone inválido. Use DDD + celular, ex.: (48) 9 9999-9999.');
    var n = normalizar(c);
    var id = novoId(n.familia.map(function (f) { return f.id; }));
    n.familia.push({ id: id, apelido: ap, emoji: texto(emoji, 8) || '🧑', telefone: normTelefone(tel), anota: extras.anota !== false });
    return normalizar(n);
  }
  function renomear(c, id, apelido, emoji) {
    var n = normalizar(c);
    n.familia.forEach(function (f) {
      if (f.id === id) { if (texto(apelido, 30)) f.apelido = texto(apelido, 30); if (texto(emoji, 8)) f.emoji = texto(emoji, 8); }
    });
    return n;
  }
  /* Remove da lista. Os registros antigos continuam com o id e passam a aparecer como "Alguém que saiu". Sempre fica 1. */
  function remover(c, id) {
    var n = normalizar(c);
    if (n.familia.length <= 1) throw new Error('A família precisa de pelo menos uma pessoa.');
    if (!n.familia.some(function (f) { return f.id !== id && f.anota; })) throw new Error('Pelo menos uma pessoa precisa anotar no app.');
    n.familia = n.familia.filter(function (f) { return f.id !== id; }); // o telefone vai junto: não fica guardado
    if (n.esteCelular === id) n.esteCelular = '';
    return normalizar(n);
  }
  function quemAnota(c) { return normalizar(c).familia.filter(function (f) { return f.anota; }); }
  /* Mensagens (só configuração por enquanto; quem envia será o app Android). */
  function salvarMensagens(c, m) { var n = normalizar(c); n.mensagens = m; return normalizar(n); }
  function smsPorDia(c) {
    var n = normalizar(c);
    var h = n.mensagens.vidaHoras;
    if (!h) return 0;
    var pessoas = Object.keys(n.mensagens.recebem).filter(function (id) { return n.mensagens.recebem[id].vida; }).length;
    return pessoas * Math.floor(24 / h);
  }
  function previaMensagem(c, ex) {
    var n = normalizar(c), k = n.mensagens.conteudo, partes = ['Atlas Saúde:'];
    if (k.apelido && n.acompanhada.apelido) partes.push(n.acompanhada.apelido);
    if (k.valor) partes.push(ex.valor + ' mg/dL');
    if (k.seta) partes.push(ex.seta);
    if (k.hora) partes.push('às ' + ex.hora);
    return partes.join(' ');
  }
  function pessoa(c, id) {
    var n = normalizar(c);
    for (var i = 0; i < n.familia.length; i++) if (n.familia[i].id === id) return n.familia[i];
    return null;
  }
  /* Texto para tela (com emoji) e para o PDF (sem emoji, porque a fonte do PDF não tem). */
  function rotulo(c, id) { var p = pessoa(c, id); return p ? p.emoji + ' ' + p.apelido : 'Alguém que saiu'; }
  function rotuloTexto(c, id) { var p = pessoa(c, id); return p ? semEmoji(p.apelido) || p.apelido : 'Alguém que saiu'; }
  function nomeAcompanhada(c) { var a = normalizar(c).acompanhada; return a.apelido || 'quem a gente cuida'; }

  var api = { CHAVE: CHAVE, EMOJIS_FAMILIA: EMOJIS_FAMILIA, EMOJIS_CUIDADO: EMOJIS_CUIDADO,
    EMOJIS_BOTAO: EMOJIS_BOTAO, LIM: LIM, VIDA_HORAS: VIDA_HORAS, TIPOS_PERGUNTA: TIPOS_PERGUNTA,
    padrao: padrao, normalizar: normalizar, ler: ler, gravar: gravar, adicionar: adicionar, renomear: renomear,
    remover: remover, pessoa: pessoa, rotulo: rotulo, rotuloTexto: rotuloTexto, nomeAcompanhada: nomeAcompanhada,
    normTelefone: normTelefone, mostrarTelefone: mostrarTelefone, editarPessoa: editarPessoa, quemAnota: quemAnota,
    listaBotoes: listaBotoes, moverBotao: moverBotao, mostrarBotao: mostrarBotao, botaoPersonalizado: botaoPersonalizado,
    salvarBotao: salvarBotao, apagarBotao: apagarBotao, esquemaDoBotao: esquemaDoBotao, semEmoji: semEmoji,
    salvarMensagens: salvarMensagens, smsPorDia: smsPorDia, previaMensagem: previaMensagem };

  /* Atalhos do navegador: usam o localStorage deste aparelho. */
  if (root.localStorage) {
    api.atual = function () { return ler(root.localStorage); };
    api.salvar = function (c) { gravar(root.localStorage, c); };
    api.rotuloDe = function (id) { return rotulo(ler(root.localStorage), id); };
    api.textoDe = function (id) { return rotuloTexto(ler(root.localStorage), id); };
    api.opcoesFiltro = function () {
      return [['', 'Todos']].concat(quemAnota(ler(root.localStorage)).map(function (f) { return [f.id, f.emoji + ' ' + f.apelido]; }));
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioFamilia = api;
})(typeof self !== 'undefined' ? self : this);
