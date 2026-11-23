/* Telas: início, registro rápido (10 tipos, com insulina e glicose) e lista do dia. Usa textContent (nunca innerHTML com dados).
   T-0036-1: cada registro tem data e hora; vários por dia; lista do dia em ordem de horário; Mudar/Apagar em cada registro;
   navegação entre dias (#/dia/AAAA-MM-DD). Insulina e glicose sem campo obrigatório. */
(function () {
  'use strict';
  var R = DiarioRegistros;
  var store = DiarioDB.criarStore(DiarioDB.criarIndexedDB('diario-saude'));
  var tela = document.getElementById('tela');
  var statusEl = document.getElementById('status');
  var pessoaSel = document.getElementById('pessoa');
  var CHAVE_NOMES = 'diario-saude-nomes-insulina';
  var DIA_HASH = /^#\/dia(?:\/(\d{4}-\d{2}-\d{2}))?$/;

  function el(tag, texto, attrs) {
    var e = document.createElement(tag);
    if (texto) e.textContent = texto;
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function hojeLocal() { return DiarioDB.diaLocal(new Date().toISOString()); }
  function limpar() { while (tela.firstChild) tela.removeChild(tela.firstChild); }
  function dizer(t) { statusEl.textContent = t; }
  function irPara(hash) { if (location.hash === hash) rotear(); else location.hash = hash; }
  function dataBr(dia) { var p = dia.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  /* Lista de nomes de insulina guardada neste celular (só nomes que a família digitou; começa vazia) */
  function lerNomes() {
    try { return R.limparNomes(JSON.parse(localStorage.getItem(CHAVE_NOMES) || '[]')); } catch (e) { return []; }
  }
  function gravarNomes(lista) {
    try { localStorage.setItem(CHAVE_NOMES, JSON.stringify(R.limparNomes(lista))); } catch (e) { dizer('Não deu para guardar a lista de nomes.'); }
  }


  /* ---------- Voz (falar para anotar / o app fala) ----------
     Os dois começam DESLIGADOS. Falar para anotar usa o reconhecimento do navegador: no Chrome do Android
     o áudio vai para o Google transcrever (aviso na tela). Nada é salvo sem tocar em Salvar. */
  var CHAVE_VOZ = 'diario-saude-voz';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var TEM_FALA = 'speechSynthesis' in window;
  function lerVoz() { try { var v = JSON.parse(localStorage.getItem(CHAVE_VOZ) || '{}'); return { entrada: !!v.entrada, saida: !!v.saida }; } catch (e) { return { entrada: false, saida: false }; } }
  function gravarVoz(v) { try { localStorage.setItem(CHAVE_VOZ, JSON.stringify(v)); } catch (e) { dizer('Não deu para guardar o ajuste de voz.'); } }

  function falar(texto) {
    if (!TEM_FALA || !texto) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      var vs = speechSynthesis.getVoices().filter(function (v) { return /^pt[-_]BR/i.test(v.lang); });
      if (vs.length) u.voice = vs[0];
      speechSynthesis.speak(u);
    } catch (e) { /* sem voz neste aparelho */ }
  }
  function falarSeLigado(texto) { if (lerVoz().saida) falar(texto); }

  function botaoOuvir(rotulo, textoFn) {
    var b = el('button', '🔊 ' + rotulo, { type: 'button', 'class': 'secundario ouvir' });
    if (!TEM_FALA) { b.disabled = true; b.title = 'Este navegador não fala.'; }
    b.addEventListener('click', function () { falar(textoFn()); });
    return b;
  }

  function ouvirPorVoz(botao) {
    if (!SR) { dizer('Este navegador não reconhece fala. Use o microfone do teclado.'); return; }
    var rec = new SR();
    rec.lang = 'pt-BR'; rec.interimResults = false; rec.maxAlternatives = 1;
    var ouviu = false;
    botao.disabled = true; botao.textContent = '🎙️ Ouvindo… pode falar';
    dizer('Ouvindo…');
    rec.onresult = function (ev) {
      ouviu = true;
      var texto = ev.results[0][0].transcript;
      telaEntendi(DiarioVoz.interpretar(texto, { nomesInsulina: lerNomes() }));
    };
    rec.onerror = function (ev) {
      var m = { 'not-allowed': 'O microfone está bloqueado. Libere o microfone para este site.', 'no-speech': 'Não ouvi nada. Tente de novo.',
        'network': 'Sem internet: o reconhecimento de fala precisa de conexão.', 'audio-capture': 'Não achei o microfone.' }[ev.error];
      dizer(m || 'Não deu para ouvir (' + ev.error + ').');
    };
    rec.onend = function () { botao.disabled = false; botao.textContent = '🎤 Falar para anotar'; if (!ouviu) falarSeLigado(statusEl.textContent); };
    try { rec.start(); } catch (e) { botao.disabled = false; botao.textContent = '🎤 Falar para anotar'; dizer('Não deu para abrir o microfone.'); }
  }

  function blocoFalar() {
    var v = lerVoz();
    var cx = el('section', '', { 'class': 'voz' });
    if (SR && v.entrada) {
      var b = el('button', '🎤 Falar para anotar', { type: 'button', 'class': 'falar' });
      b.addEventListener('click', function () { ouvirPorVoz(b); });
      cx.appendChild(b);
      cx.appendChild(el('p', 'Ex.: “glicose cento e dez antes do almoço”, “insulina quatro unidades”, “comi arroz e feijão”.', { 'class': 'dica' }));
    } else if (SR) {
      cx.appendChild(el('p', '🎤 Quer anotar falando? Ligue em “⚙️ Voz”, no fim desta tela.', { 'class': 'dica' }));
    }
    return cx;
  }

  function blocoAjustesVoz() {
    var v = lerVoz();
    var d = el('details', '', { 'class': 'detalhes ajustes' });
    d.appendChild(el('summary', '⚙️ Voz: falar e ouvir'));
    function chave(rotulo, aviso, ligado, aoMudar, disponivel, semRecurso) {
      var l = el('label', '', { 'class': 'chave' });
      var c = el('input', '', { type: 'checkbox' });
      c.checked = ligado && disponivel; c.disabled = !disponivel;
      c.addEventListener('change', function () { aoMudar(c.checked); });
      l.appendChild(c);
      var t = el('span', rotulo);
      l.appendChild(t);
      d.appendChild(l);
      d.appendChild(el('p', disponivel ? aviso : semRecurso, { 'class': 'dica' }));
    }
    chave('Falar para anotar', 'O áudio da sua fala vai para o Google transformar em texto. Nada é salvo sem você tocar em Salvar.',
      v.entrada, function (on) { var x = lerVoz(); x.entrada = on; gravarVoz(x); telaInicio(); }, !!SR,
      'Este navegador não reconhece fala. Use o microfone do teclado nos campos.');
    chave('O app fala comigo', 'Lê em voz alta o que entendeu e o que foi anotado. Cuidado em lugar público: são dados de saúde.',
      v.saida, function (on) { var x = lerVoz(); x.saida = on; gravarVoz(x); if (on) falar('Pronto. Vou falar com você.'); }, TEM_FALA,
      'Este navegador não tem voz.');
    return d;
  }

  /* Cartão "Entendi" — mostra, fala (se ligado) e só salva com toque */
  function telaEntendi(res) {
    limpar();
    tela.appendChild(el('h2', 'Entendi:'));
    tela.appendChild(el('p', 'Você disse: “' + res.frase + '”', { 'class': 'dica' }));
    var acoes = el('div', '', { 'class': 'acoes' });
    var de = el('button', '🎤 Falar de novo', { type: 'button', 'class': 'secundario' });
    de.addEventListener('click', function () { if (SR) ouvirPorVoz(de); });
    var volta = el('button', 'Voltar', { type: 'button', 'class': 'secundario' });
    volta.addEventListener('click', function () { irPara('#/inicio'); });

    if (!res.tipo) {
      var msg = 'Não entendi o que anotar. Tente: “glicose cento e dez”, “insulina quatro unidades” ou “comi arroz e feijão”.';
      tela.appendChild(el('p', msg, { 'class': 'erro' }));
      acoes.appendChild(de); acoes.appendChild(volta); tela.appendChild(acoes);
      falarSeLigado(DiarioVoz.falaEntendi(res));
      return;
    }
    var esq = R.ESQUEMAS[res.tipo];
    var cartao = el('section', '', { 'class': 'entendi' });
    cartao.appendChild(el('p', esq.icone + ' ' + esq.nome, { 'class': 'tipo-entendi' }));
    if (res.destaque) cartao.appendChild(el('p', res.destaque, { 'class': 'destaque' }));
    else if (res.faltou.indexOf('confira') >= 0 && (res.entrada.valor || res.entrada.quantidade))
      cartao.appendChild(el('p', 'Ouvi: ' + (res.entrada.valor || res.entrada.quantidade) + ' ?', { 'class': 'destaque duvida' }));
    cartao.appendChild(el('p', res.resumo));
    cartao.appendChild(el('p', 'Quem: ' + pessoaSel.options[pessoaSel.selectedIndex].text + ' · Agora, ' + R.horaLocal(new Date().toISOString()), { 'class': 'dica' }));
    tela.appendChild(cartao);

    var podeSalvar = res.dadosOk && res.faltou.indexOf('confira') < 0 && res.faltou.indexOf('valor') < 0 && res.faltou.indexOf('quantidade') < 0;
    if (res.faltou.indexOf('confira') >= 0) tela.appendChild(el('p', 'Confira o número: ' + res.erros.join('. ') + '. Toque em Corrigir para digitar.', { 'class': 'erro' }));
    else if (res.faltou.indexOf('valor') >= 0 || res.faltou.indexOf('quantidade') >= 0) tela.appendChild(el('p', 'Não entendi o número. Toque em Corrigir para digitar.', { 'class': 'erro' }));
    else if (!res.dadosOk || res.faltou.length) tela.appendChild(el('p', 'Faltou um detalhe. Toque em Corrigir para completar.', { 'class': 'erro' }));

    var erroEl = el('p', '', { 'class': 'erro', role: 'alert' });
    var ok = el('button', 'Salvar', { type: 'button', 'class': 'principal' });
    var corr = el('button', '✏️ Corrigir', { type: 'button', 'class': 'secundario' });
    corr.addEventListener('click', function () { telaForm(res.tipo, null, hojeLocal(), res.entrada); });
    ok.addEventListener('click', async function () {
      ok.disabled = true;
      var agora = new Date().toISOString();
      try {
        await store.adicionar({ tipo: res.tipo, dataHora: agora, pessoa: pessoaSel.value, dados: res.dados });
        DiarioAjustesTela.sincronizarQuieto();
        dizer('Anotado! Salvo neste celular.');
        falarSeLigado(DiarioVoz.falaAnotado(res.resumo, R.horaLocal(agora)));
        irPara('#/dia/' + DiarioDB.diaLocal(agora));
      } catch (e) { ok.disabled = false; erroEl.textContent = 'Não salvou: ' + e.message; }
    });
    tela.appendChild(erroEl);
    if (podeSalvar) acoes.appendChild(ok);
    acoes.appendChild(corr); acoes.appendChild(botaoOuvir('Ouvir', function () { return DiarioVoz.falaEntendi(res); }));
    acoes.appendChild(de); acoes.appendChild(volta);
    tela.appendChild(acoes);
    falarSeLigado(DiarioVoz.falaEntendi(res));
  }

  function telaInicio() {
    limpar();
    var cuida = el('a', '', { href: '#/ajustes', 'class': 'cuidando' });
    cuida.appendChild(DiarioAjustesTela.rosto(52));
    var fc = DiarioFamilia.atual();
    cuida.appendChild(el('span', fc.acompanhada.apelido ? 'Cuidando de ' + fc.acompanhada.apelido : 'Toque aqui para pôr o apelido e a foto de quem a gente cuida'));
    tela.appendChild(cuida);
    tela.appendChild(blocoFalar());
    tela.appendChild(el('h2', 'O que você quer anotar?'));
    var g = el('div', '', { 'class': 'grade' });
    R.TIPOS.forEach(function (t) {
      var b = el('button', '', { type: 'button', 'class': 'tipo' });
      b.appendChild(el('span', R.ESQUEMAS[t].icone, { 'aria-hidden': 'true', 'class': 'icone' }));
      b.appendChild(el('span', R.ESQUEMAS[t].nome));
      b.addEventListener('click', function () { telaForm(t, null, hojeLocal()); });
      g.appendChild(b);
    });
    tela.appendChild(g);
    tela.appendChild(blocoAjustesVoz());
  }

  /* Botões grandes de escolha. Selecionado = fundo escuro + "✓" (não depende só de cor). Tocar de novo desmarca (se não obrigatório). */
  function criarEscolha(campo, estado, aoMudar) {
    var caixa = el('div', '', { 'class': 'opcoes', role: 'group', 'aria-label': campo.rotulo });
    var botoes = [];
    function pintar() {
      botoes.forEach(function (x) {
        var sel = estado[campo.id] === x.valor;
        x.b.setAttribute('aria-pressed', sel ? 'true' : 'false');
        x.b.className = 'opcao' + (sel ? ' sel' : '');
        x.b.textContent = (sel ? '✓ ' : '') + x.rotulo;
      });
    }
    campo.opcoes.forEach(function (o) {
      var b = el('button', o[1], { type: 'button' });
      b.addEventListener('click', function () {
        if (estado[campo.id] === o[0] && !campo.obrigatorio) delete estado[campo.id];
        else estado[campo.id] = o[0];
        pintar(); aoMudar();
      });
      botoes.push({ b: b, valor: o[0], rotulo: o[1] });
      caixa.appendChild(b);
    });
    pintar();
    return caixa;
  }

  /* Vários alimentos: digita, toca "Mais um" (ou Enter); cada item vira uma etiqueta que some ao tocar */
  function criarItens(campo, estado) {
    var caixa = el('div');
    var chips = el('div', '', { 'class': 'chips' });
    var entrada = el('input', '', { type: 'text', maxlength: '60', placeholder: 'Ex.: arroz', 'aria-label': campo.rotulo });
    var mais = el('button', 'Mais um', { type: 'button', 'class': 'secundario' });
    estado[campo.id] = estado[campo.id] || [];
    function pintar() {
      while (chips.firstChild) chips.removeChild(chips.firstChild);
      estado[campo.id].forEach(function (nome, i) {
        var c = el('button', nome + '  ✕', { type: 'button', 'class': 'chip', 'aria-label': 'Tirar ' + nome });
        c.addEventListener('click', function () { estado[campo.id].splice(i, 1); pintar(); });
        chips.appendChild(c);
      });
    }
    function adicionar() {
      var t = entrada.value.trim();
      if (t && estado[campo.id].length < 20) estado[campo.id].push(t);
      entrada.value = ''; pintar(); entrada.focus();
    }
    mais.addEventListener('click', adicionar);
    entrada.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); adicionar(); } });
    caixa.appendChild(chips); caixa.appendChild(entrada); caixa.appendChild(mais);
    caixa.lerPendente = function () { var t = entrada.value.trim(); if (t) { adicionar(); } };
    pintar();
    return caixa;
  }

  /* Nome da insulina: toca num nome guardado (1 toque) OU digita livre (ou deixa vazio).
     "Guardar este nome" põe na lista deste celular; "✕" ao lado tira da lista (não apaga registros antigos). */
  function criarLista(campo, estado) {
    var caixa = el('div');
    var nomes = lerNomes();
    var chips = el('div', '', { 'class': 'chips' });
    var entrada = el('input', '', { type: 'text', maxlength: '60', placeholder: 'Escreva o nome da insulina', 'aria-label': campo.rotulo });
    var guardar = el('button', 'Guardar este nome na lista', { type: 'button', 'class': 'secundario' });
    if (estado[campo.id] !== undefined) entrada.value = estado[campo.id];
    entrada.addEventListener('input', function () { estado[campo.id] = entrada.value; });
    function pintar() {
      while (chips.firstChild) chips.removeChild(chips.firstChild);
      nomes.forEach(function (n) {
        var linha = el('span', '', { 'class': 'linha' });
        var usa = el('button', n, { type: 'button', 'class': 'chip', 'aria-label': 'Usar ' + n });
        usa.addEventListener('click', function () { entrada.value = n; estado[campo.id] = n; });
        var tira = el('button', '✕', { type: 'button', 'class': 'chip', 'aria-label': 'Tirar ' + n + ' da lista' });
        tira.addEventListener('click', function () { nomes = R.removerNome(nomes, n); gravarNomes(nomes); pintar(); });
        linha.appendChild(usa); linha.appendChild(tira);
        chips.appendChild(linha);
      });
    }
    guardar.addEventListener('click', function () {
      nomes = R.adicionarNome(nomes, entrada.value); gravarNomes(nomes); pintar();
    });
    caixa.appendChild(chips); caixa.appendChild(entrada); caixa.appendChild(guardar);
    pintar();
    return caixa;
  }

  function criarCampo(campo, estado, aoMudar) {
    var bloco = el('div', '', { 'class': 'campo' });
    var rot = el('p', campo.rotulo, { 'class': 'rotulo' });
    bloco.appendChild(rot);
    var entrada;
    if (campo.tipo === 'escolha') entrada = criarEscolha(campo, estado, aoMudar);
    else if (campo.tipo === 'itens') { entrada = criarItens(campo, estado); bloco.lerPendente = entrada.lerPendente; }
    else if (campo.tipo === 'lista') entrada = criarLista(campo, estado);
    else {
      var tipoHtml = campo.tipo === 'hora' ? 'time' : campo.tipo === 'numero' ? 'number' : 'text';
      var attrs = { type: tipoHtml, 'aria-label': campo.rotulo };
      if (campo.tipo === 'numero') {
        attrs.inputmode = campo.decimal ? 'decimal' : 'numeric'; attrs.min = campo.min; attrs.max = campo.max;
        if (campo.decimal) attrs.step = '0.5';
      }
      if (campo.tipo === 'texto') attrs.maxlength = '300';
      entrada = el('input', '', attrs);
      if (estado[campo.id] !== undefined) entrada.value = estado[campo.id];
      entrada.addEventListener('input', function () { estado[campo.id] = entrada.value; });
    }
    bloco.appendChild(entrada);
    return bloco;
  }

  /* reg = null (novo, no dia `diaNovo`) ou registro existente (editar qualquer um da lista) */
  function telaForm(tipo, reg, diaNovo, pre) {
    var esq = R.ESQUEMAS[tipo];
    limpar();
    tela.appendChild(el('h2', (reg ? 'Mudar: ' : '') + esq.nome));
    tela.appendChild(el('p', esq.pergunta, { 'class': 'pergunta' }));

    var estado = {};
    esq.campos.forEach(function (c) {
      if (reg && reg.dados && reg.dados[c.id] !== undefined) estado[c.id] = reg.dados[c.id];
      else if (!reg && pre && pre[c.id] !== undefined) {
        var pv = pre[c.id];
        // campo numérico do navegador não aceita vírgula: "4,5" vira "4.5" para aparecer no campo
        if (c.tipo === 'numero' && typeof pv === 'string') pv = pv.replace(',', '.');
        estado[c.id] = Array.isArray(pv) ? pv.slice() : pv;
      }
      else if (!reg && c.padrao) estado[c.id] = c.padrao;
    });

    var blocos = [];
    var aoMudar = function () { blocos.forEach(function (x) { x.bloco.hidden = !R.visivel(x.campo, estado); }); };
    var detalhes = el('details', '', { 'class': 'detalhes' });
    detalhes.appendChild(el('summary', 'Adicionar detalhes'));
    var temDetalheUsado = false;

    // data e hora (automáticas = agora, editáveis): valem para todos os tipos
    var baseIso = reg ? reg.dataHora : new Date().toISOString();
    var diaInicial = reg ? DiarioDB.diaLocal(reg.dataHora) : (diaNovo || hojeLocal());
    var ld = el('label', 'Que dia?', { 'class': 'rotulo' });
    var data = el('input', '', { type: 'date' });
    data.value = diaInicial;
    ld.appendChild(data);
    var lh = el('label', tipo === 'insulina' ? 'Que horas foi aplicada?' : tipo === 'glicose' ? 'Que horas foi?' : 'Que horas?', { 'class': 'rotulo' });
    var hora = el('input', '', { type: 'time' });
    hora.value = R.horaLocal(baseIso);
    lh.appendChild(hora);

    esq.campos.forEach(function (c) {
      var bloco = criarCampo(c, estado, aoMudar);
      blocos.push({ campo: c, bloco: bloco });
      if (c.detalhe) {
        detalhes.appendChild(bloco);
        if (estado[c.id] !== undefined && !(c.padrao && estado[c.id] === c.padrao)) temDetalheUsado = true;
      } else tela.appendChild(bloco);
    });
    tela.appendChild(ld); tela.appendChild(lh);
    if (detalhes.children.length > 1) tela.appendChild(detalhes);
    if (temDetalheUsado) detalhes.open = true;
    aoMudar();

    var erroEl = el('p', '', { 'class': 'erro', role: 'alert' });
    var ok = el('button', 'Salvar', { type: 'button', 'class': 'principal' });
    var volta = el('button', 'Voltar', { type: 'button', 'class': 'secundario' });
    tela.appendChild(erroEl); tela.appendChild(ok); tela.appendChild(volta);
    volta.addEventListener('click', function () { irPara(reg ? '#/dia/' + diaInicial : '#/inicio'); });

    ok.addEventListener('click', async function () {
      blocos.forEach(function (x) { if (x.bloco.lerPendente) x.bloco.lerPendente(); });
      var res = R.montarDados(tipo, estado);
      if (!res.ok) { erroEl.textContent = res.erros.join('. ') + '.'; return; }
      var dataHora;
      try { dataHora = R.combinarDiaHora(data.value, hora.value); }
      catch (e) { erroEl.textContent = 'Confira o dia e a hora.'; return; }
      ok.disabled = true;
      try {
        if (reg) await store.atualizar(reg.id, { dataHora: dataHora, dados: res.dados });
        else await store.adicionar({ tipo: tipo, dataHora: dataHora, pessoa: pessoaSel.value, dados: res.dados });
        DiarioAjustesTela.sincronizarQuieto();
        dizer('Anotado! Salvo neste celular.');
        falarSeLigado(DiarioVoz.falaAnotado(R.resumo({ tipo: tipo, dados: res.dados }), R.horaLocal(dataHora)));
        irPara('#/dia/' + DiarioDB.diaLocal(dataHora));
      } catch (e) { ok.disabled = false; erroEl.textContent = 'Não salvou: ' + e.message; }
    });
  }

  /* Mudar / Apagar de UM registro da lista (confirmação em 2 toques, sem janela do navegador) */
  function botoesRegistro(r) {
    var linha = el('div', '', { 'class': 'linha' });
    var ed = el('button', 'Mudar', { type: 'button', 'aria-label': 'Mudar: ' + R.resumo(r) });
    var ap = el('button', 'Apagar', { type: 'button', 'class': 'perigo', 'aria-label': 'Apagar: ' + R.resumo(r) });
    ed.addEventListener('click', function () { telaForm(r.tipo, r); });
    ap.addEventListener('click', function () {
      while (linha.firstChild) linha.removeChild(linha.firstChild);
      linha.appendChild(el('span', 'Apagar mesmo?'));
      var sim = el('button', 'Sim, apagar', { type: 'button', 'class': 'perigo' });
      var nao = el('button', 'Não', { type: 'button' });
      sim.addEventListener('click', async function () {
        try { await store.apagar(r.id); dizer('Registro apagado.'); DiarioAjustesTela.sincronizarQuieto(); } catch (e) { dizer('Não apagou: ' + e.message); }
        rotear();
      });
      nao.addEventListener('click', rotear);
      linha.appendChild(sim); linha.appendChild(nao);
    });
    linha.appendChild(ed); linha.appendChild(ap);
    return linha;
  }

  async function telaDia(dia) {
    limpar();
    var hoje = hojeLocal();
    tela.appendChild(el('h2', dia === hoje ? 'Hoje — ' + dataBr(dia) : dataBr(dia)));

    // navegar entre os dias do mês
    var nav = el('div', '', { 'class': 'linha' });
    var ant = el('button', '‹ Anterior', { type: 'button', 'class': 'secundario', 'aria-label': 'Dia anterior' });
    var prox = el('button', 'Seguinte ›', { type: 'button', 'class': 'secundario', 'aria-label': 'Dia seguinte' });
    var ir = el('input', '', { type: 'date', 'aria-label': 'Ir para o dia' });
    ir.value = dia;
    ant.addEventListener('click', function () { irPara('#/dia/' + R.somarDias(dia, -1)); });
    prox.addEventListener('click', function () { irPara('#/dia/' + R.somarDias(dia, 1)); });
    ir.addEventListener('change', function () { if (ir.value) irPara('#/dia/' + ir.value); });
    var lir = el('label', 'Ir para o dia', { 'class': 'rotulo' });
    lir.appendChild(ir);
    nav.appendChild(ant); nav.appendChild(prox);
    tela.appendChild(lir); tela.appendChild(nav);

    var lista = await store.listarDoDia(dia); // já vem em ordem de horário, todos os tipos misturados
    var pend = (await store.pendentes()).length;
    if (pend) tela.appendChild(el('p', 'Salvo só neste celular (' + pend + ' ainda não compartilhado com a família).'));
    if (!lista.length) tela.appendChild(el('p', dia === hoje ? 'Nada anotado hoje ainda.' : 'Nada anotado neste dia.'));
    if (lista.length) tela.appendChild(botaoOuvir('Ouvir o dia', function () {
      return (dia === hoje ? 'Hoje' : 'Dia ' + dataBr(dia)) + ', ' + lista.length + (lista.length === 1 ? ' registro. ' : ' registros. ') +
        lista.map(function (r) { return R.horaLocal(r.dataHora) + ': ' + R.resumo(r) + '.'; }).join(' ');
    }));
    var ul = el('ul');
    lista.forEach(function (r) {
      var li = el('li', R.resumo(r));
      li.appendChild(el('small', R.horaLocal(r.dataHora) + ' — ' + DiarioFamilia.rotuloDe(r.anotadoPor || r.pessoa)));
      li.appendChild(botoesRegistro(r));
      ul.appendChild(li);
    });
    tela.appendChild(ul);
  }

  function rotear() {
    var h = location.hash || '#/inicio';
    var m = DIA_HASH.exec(h);
    document.getElementById('nav-inicio').className = m ? '' : 'ativo';
    document.getElementById('nav-dia').className = m ? 'ativo' : '';
    var ne = document.getElementById('nav-estat'); if (ne) ne.className = h === '#/estatisticas' ? 'ativo' : '';
    var nr = document.getElementById('nav-rel'); if (nr) nr.className = h === '#/relatorio' ? 'ativo' : '';
    var na = document.getElementById('nav-ajustes'); if (na) na.className = h === '#/ajustes' ? 'ativo' : '';
    if (h === '#/estatisticas' || h === '#/relatorio' || h === '#/ajustes') document.getElementById('nav-inicio').className = '';
    if (h === '#/ajustes') DiarioAjustesTela.mostrar();
    else if (h === '#/estatisticas') DiarioEstatisticasTela.mostrar();
    else if (h === '#/relatorio') DiarioRelatorioTela.mostrar();
    else if (m) telaDia(m[1] || hojeLocal()).catch(function (e) { dizer('Erro: ' + e.message); });
    else telaInicio();
  }
  window.addEventListener('hashchange', rotear);

  // Topo com a família deste aparelho (selo "📱 Mãe" ou seletor), depois a migração do banco local; se falhar, o app abre mesmo assim.
  DiarioAjustesTela.atualizarTopo();
  DiarioAjustesTela.iniciarSincronizacao();
  store.migrar().catch(function () {}).then(rotear);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { dizer('Modo offline indisponível neste navegador.'); });
  }
})();
