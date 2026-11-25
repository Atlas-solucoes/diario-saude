/* Tela "Ajustes" (#/ajustes), a 5ª aba. Carregue ANTES de app.js, depois de familia.js.
   Cartões: Quem a gente cuida (apelido + foto + emoji), Este celular é de…, Família que anota,
   Cópia de segurança (com aviso de "sem senha") e Sobre e aviso (com "Apagar tudo" em 2 toques).
   Tudo fica neste aparelho. Usa textContent (nunca innerHTML com dados). */
(function () {
  'use strict';
  var F = DiarioFamilia;
  var store = DiarioDB.criarStore(DiarioDB.criarIndexedDB('diario-saude'));
  var tela = document.getElementById('tela');
  var VERSAO_APP = '1.1 (ajustes: botões, família, mensagens)';
  var FOTO_LADO = 256;
  var FOTO_MAX = 40 * 1024;
  var DATA_URL = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+\/=]+)$/;
  var urlFoto = null;

  function el(tag, texto, attrs) {
    var e = document.createElement(tag);
    if (texto) e.textContent = texto;
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function botao(texto, classe, aoTocar) {
    var b = el('button', texto, { type: 'button', 'class': classe || '' });
    b.addEventListener('click', aoTocar);
    return b;
  }
  var ultimoAviso = 0;
  function dizer(t) { var s = document.getElementById('status'); if (s) s.textContent = t; ultimoAviso = Date.now(); }
  function cartao(titulo) { var c = el('section', '', { 'class': 'cartao' }); c.appendChild(el('h3', titulo)); return c; }
  function salvar(c, msg) {
    F.salvar(c); atualizarTopo(); dizer(msg || 'Guardado! ⭐');
    var m = motor(); if (m && m.conectado() && m.estado().responsavel) m.enviarFamilia().catch(function () {});
  }
  /* ---------- Família conectada (etapa C) ---------- */
  function motor() { return window.DiarioSync && DiarioSync.motor ? DiarioSync.motor() : null; }
  function somenteLeitura() { var m = motor(); return !!(m && m.conectado() && !m.estado().responsavel); }
  function horaCurta(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  /* Sincroniza sem atrapalhar: erros ficam no cartão, não em alerta. */
  function sincronizarQuieto() {
    var m = motor();
    if (!m || !m.conectado()) return Promise.resolve();
    return m.sincronizar().then(function (r) {
      if (r && r.novos && location.hash.indexOf('#/dia') === 0) window.dispatchEvent(new HashChangeEvent('hashchange'));
    }).catch(function () {});
  }
  var relogio = null;
  function iniciarSincronizacao() {
    sincronizarQuieto();
    if (relogio) return;
    relogio = setInterval(function () { if (document.visibilityState === 'visible') sincronizarQuieto(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sincronizarQuieto(); });
    window.addEventListener('online', sincronizarQuieto);
  }

  /* Escolha de emoji por botões grandes. */
  function escolherEmoji(lista, atual, aoEscolher) {
    var d = el('div', '', { 'class': 'emojis', role: 'group', 'aria-label': 'Escolha um desenho' });
    lista.forEach(function (e) {
      var b = botao(e, 'emoji' + (e === atual ? ' sel' : ''), function () {
        Array.prototype.forEach.call(d.children, function (x) { x.className = 'emoji'; x.setAttribute('aria-pressed', 'false'); });
        b.className = 'emoji sel'; b.setAttribute('aria-pressed', 'true'); aoEscolher(e);
      });
      b.setAttribute('aria-pressed', e === atual ? 'true' : 'false');
      d.appendChild(b);
    });
    return d;
  }

  /* Foto: recorta o meio em quadrado e reduz para 256×256 JPEG no próprio celular. Nada sai do aparelho. */
  function reduzirFoto(arquivo) {
    return new Promise(function (ok, erro) {
      var img = new Image();
      var u = URL.createObjectURL(arquivo);
      img.onload = function () {
        var lado = Math.min(img.naturalWidth, img.naturalHeight);
        var cv = document.createElement('canvas'); cv.width = FOTO_LADO; cv.height = FOTO_LADO;
        cv.getContext('2d').drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
        URL.revokeObjectURL(u);
        // Até uns 40 KB: tenta qualidades menores se passar.
        (function tentar(q) {
          cv.toBlob(function (b) {
            if (!b) return erro(new Error('Não deu para ler a foto.'));
            if (b.size > FOTO_MAX && q > 0.35) return tentar(q - 0.15);
            ok(b);
          }, 'image/jpeg', q);
        })(0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(u); erro(new Error('Não deu para abrir essa foto.')); };
      img.src = u;
    });
  }
  /* Devolve um endereço para mostrar a foto da pessoa acompanhada, ou null. */
  async function fotoAcompanhada() {
    var id = F.atual().acompanhada.fotoId;
    if (!id) return null;
    var a = await store.obterArquivo(id);
    if (!a || !a.conteudo) return null;
    if (urlFoto) URL.revokeObjectURL(urlFoto);
    urlFoto = URL.createObjectURL(a.conteudo);
    return urlFoto;
  }
  /* Rosto da pessoa acompanhada: foto, ou o emoji como reserva. */
  function rosto(tamanho) {
    var c = F.atual();
    var r = el('span', c.acompanhada.emoji, { 'class': 'rosto', 'aria-hidden': 'true', style: 'width:' + tamanho + 'px;height:' + tamanho + 'px;font-size:' + Math.round(tamanho * 0.6) + 'px' });
    fotoAcompanhada().then(function (u) {
      if (!u) return;
      r.textContent = '';
      r.appendChild(el('img', '', { src: u, alt: '' }));
    }).catch(function () {});
    return r;
  }

  /* Topo: "📱 Mãe" quando o celular já tem dono; senão, o seletor "Quem está usando?". */
  function atualizarTopo() {
    var c = F.atual();
    var sel = document.getElementById('pessoa');
    var quem = document.querySelector('header .quem');
    var selo = document.getElementById('selo');
    if (sel) {
      var antes = sel.value;
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      F.quemAnota(c).forEach(function (f) { sel.appendChild(el('option', f.emoji + ' ' + f.apelido, { value: f.id })); });
      sel.value = c.esteCelular || (c.familia.some(function (f) { return f.id === antes; }) ? antes : c.familia[0].id);
    }
    if (quem) quem.hidden = !!c.esteCelular;
    if (selo) {
      selo.hidden = !c.esteCelular;
      selo.textContent = c.esteCelular ? '📱 ' + F.textoDe(c.esteCelular) : '';
    }
  }

  function cartaoCuidado(c) {
    var k = cartao('👧 Quem a gente cuida');
    var topo = el('div', '', { 'class': 'cuidado' });
    topo.appendChild(rosto(96));
    k.appendChild(topo);
    var rot = el('label', 'Apelido', { 'class': 'rotulo' });
    var ap = el('input', '', { type: 'text', maxlength: '30', autocomplete: 'off', placeholder: 'Ex.: Estrelinha' });
    ap.value = c.acompanhada.apelido;
    rot.appendChild(ap); k.appendChild(rot);
    k.appendChild(el('p', 'Use um apelido. O nome verdadeiro não precisa entrar aqui.', { 'class': 'dica' }));
    var emoji = c.acompanhada.emoji;
    k.appendChild(escolherEmoji(F.EMOJIS_CUIDADO, emoji, function (e) { emoji = e; }));
    k.appendChild(botao('Guardar apelido e desenho', 'principal', function () {
      var n = F.atual(); n.acompanhada.apelido = ap.value; n.acompanhada.emoji = emoji; salvar(n); mostrar();
    }));
    var entrada = el('input', '', { type: 'file', accept: 'image/*', hidden: '' });
    entrada.addEventListener('change', async function () {
      var arq = entrada.files && entrada.files[0];
      if (!arq) return;
      try {
        dizer('Arrumando a foto…');
        var blob = await reduzirFoto(arq);
        var n = F.atual();
        var velha = n.acompanhada.fotoId;
        var a = await store.salvarArquivo({ tipo: 'foto', mime: 'image/jpeg', conteudo: blob, titulo: 'Foto' });
        n.acompanhada.fotoId = a.id; salvar(n, 'Foto guardada neste celular! ⭐');
        if (velha) await store.apagarArquivo(velha);
        var mf = motor(); if (mf && mf.conectado() && mf.estado().responsavel) mf.enviarFoto().catch(function () {});
        mostrar();
      } catch (e) { dizer(e.message); }
    });
    k.appendChild(entrada);
    k.appendChild(botao(c.acompanhada.fotoId ? '📷 Trocar a foto' : '📷 Pôr uma foto', 'secundario', function () { entrada.click(); }));
    if (c.acompanhada.fotoId) {
      k.appendChild(botao('Tirar a foto', 'secundario', async function () {
        var n = F.atual(); var id = n.acompanhada.fotoId; n.acompanhada.fotoId = null; salvar(n, 'Foto tirada.');
        await store.apagarArquivo(id);
        var mf = motor(); if (mf && mf.conectado() && mf.estado().responsavel) mf.enviarFoto().catch(function () {});
        mostrar();
      }));
    }
    k.appendChild(el('p', 'A foto fica só neste celular. Quando a família estiver conectada, ela vai para os celulares da família (com aviso antes).', { 'class': 'dica' }));
    return k;
  }

  function cartaoCelular(c) {
    var k = cartao('📱 Este celular é de…');
    k.appendChild(el('p', 'Escolha uma vez. Assim o app já sabe quem está anotando.', { 'class': 'dica' }));
    var g = el('div', '', { 'class': 'opcoes' });
    F.quemAnota(c).forEach(function (f) {
      var b = botao(f.emoji + ' ' + f.apelido + (c.esteCelular === f.id ? ' ✓' : ''), c.esteCelular === f.id ? 'sel' : '', function () {
        var n = F.atual(); n.esteCelular = f.id; salvar(n, 'Pronto! Este celular é de ' + f.apelido + '. ⭐'); mostrar();
      });
      b.setAttribute('aria-pressed', c.esteCelular === f.id ? 'true' : 'false');
      g.appendChild(b);
    });
    k.appendChild(g);
    if (c.esteCelular) k.appendChild(botao('Celular usado por várias pessoas', 'secundario', function () {
      var n = F.atual(); n.esteCelular = ''; salvar(n, 'O app vai perguntar quem está usando.'); mostrar();
    }));
    return k;
  }

  /* ---------- Família: quem anota e quem recebe mensagens (etapa 2) ---------- */
  function cartaoFamilia(c) {
    var k = cartao('👨‍👩‍👧 Família');
    k.appendChild(el('p', 'Quem anota no app e quem pode receber mensagens. O telefone é opcional e só serve para as mensagens.', { 'class': 'dica' }));
    k.appendChild(el('p', '🔒 Os telefones ficam neste celular, nos celulares da família conectada e na cópia de segurança.', { 'class': 'dica' }));
    var ul = el('ul', '', { 'class': 'familia' });
    c.familia.forEach(function (f) {
      var li = el('li');
      li.appendChild(el('span', f.emoji + ' ' + f.apelido, { 'class': 'quem-nome' }));
      var info = [f.anota ? '✍️ anota no app' : '👀 só recebe'];
      if (f.telefone) info.push('📞 ' + F.mostrarTelefone(f.telefone));
      li.appendChild(el('p', info.join(' · '), { 'class': 'dica' }));
      var acoes = el('div', '', { 'class': 'linha' });
      acoes.appendChild(botao('Editar', 'secundario', function () {
        while (li.firstChild) li.removeChild(li.firstChild);
        li.appendChild(formPessoa(f, function (campos) { salvar(F.editarPessoa(F.atual(), f.id, campos)); mostrar('familia'); }));
      }));
      if (c.familia.length > 1) {
        var tira = botao('Excluir', 'secundario perigo', function () {
          if (tira.dataset.confirmar !== '1') { tira.dataset.confirmar = '1'; tira.textContent = 'Tocar de novo para excluir'; return; }
          try { salvar(F.remover(F.atual(), f.id), f.apelido + ' saiu da lista. Os registros dele(a) continuam.'); mostrar('familia'); } catch (e) { dizer(e.message); }
        });
        acoes.appendChild(tira);
      }
      li.appendChild(acoes);
      ul.appendChild(li);
    });
    k.appendChild(ul);
    k.appendChild(el('h4', '➕ Incluir alguém'));
    k.appendChild(formPessoa(null, function (campos) {
      salvar(F.adicionar(F.atual(), campos.apelido, campos.emoji, campos), 'Bem-vindo(a) à família! ⭐'); mostrar('familia');
    }));
    return k;
  }
  /* Formulário de pessoa (incluir ou editar): apelido, desenho, telefone, anota no app. */
  function formPessoa(f, aoSalvar) {
    var box = el('div', '', { 'class': 'form-pessoa' });
    var ap = el('input', '', { type: 'text', maxlength: '30', autocomplete: 'off', placeholder: 'Apelido (ex.: Vó, Dinda, Irmão)', 'aria-label': 'Apelido' });
    ap.value = f ? f.apelido : '';
    box.appendChild(ap);
    var em = f ? f.emoji : '🧑';
    box.appendChild(escolherEmoji(F.EMOJIS_FAMILIA, f ? f.emoji : '', function (e) { em = e; }));
    var tel = el('input', '', { type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: 'Celular com DDD (opcional)', 'aria-label': 'Celular com DDD' });
    tel.value = f && f.telefone ? F.mostrarTelefone(f.telefone) : '';
    box.appendChild(tel);
    var rot = el('label', '', { 'class': 'chave' });
    var anota = el('input', '', { type: 'checkbox' }); anota.checked = f ? f.anota : true;
    rot.appendChild(anota); rot.appendChild(document.createTextNode('Anota no app (tem o app no celular)'));
    box.appendChild(rot);
    box.appendChild(botao(f ? 'Guardar' : '➕ Incluir', 'principal', function () {
      try { aoSalvar({ apelido: ap.value, emoji: em, telefone: tel.value, anota: anota.checked }); } catch (e) { dizer(e.message); }
    }));
    return box;
  }

  /* ---------- Botões da tela inicial (etapa 2) ---------- */
  function cartaoBotoes(c) {
    var R = DiarioRegistros;
    var k = cartao('🔘 Botões da tela inicial');
    k.appendChild(el('p', 'Escolha quais botões aparecem e em que ordem. ↑ e ↓ mudam a posição.', { 'class': 'dica' }));
    var lista = F.listaBotoes(c, R.TIPOS, R.ESQUEMAS);
    var ul = el('ul', '', { 'class': 'familia botoes-lista' });
    lista.forEach(function (b, i) {
      var li = el('li', '', { 'class': b.visivel ? '' : 'oculto' });
      li.appendChild(el('span', b.icone + ' ' + b.nome + (b.visivel ? '' : ' (escondido)'), { 'class': 'quem-nome' }));
      var acoes = el('div', '', { 'class': 'linha' });
      var sobe = botao('↑', 'secundario seta', function () { salvar(F.moverBotao(F.atual(), R.TIPOS, R.ESQUEMAS, b.id, -1)); mostrar('botoes'); });
      sobe.setAttribute('aria-label', 'Subir ' + b.nome); sobe.disabled = i === 0;
      var desce = botao('↓', 'secundario seta', function () { salvar(F.moverBotao(F.atual(), R.TIPOS, R.ESQUEMAS, b.id, 1)); mostrar('botoes'); });
      desce.setAttribute('aria-label', 'Descer ' + b.nome); desce.disabled = i === lista.length - 1;
      acoes.appendChild(sobe); acoes.appendChild(desce);
      acoes.appendChild(botao(b.visivel ? 'Esconder' : 'Mostrar', 'secundario', function () {
        try { salvar(F.mostrarBotao(F.atual(), R.TIPOS, R.ESQUEMAS, b.id, !b.visivel)); mostrar('botoes'); } catch (e) { dizer(e.message); }
      }));
      if (b.personalizado) acoes.appendChild(botao('Editar', 'secundario', function () { location.hash = '#/ajustes/botao-' + b.id; }));
      li.appendChild(acoes);
      ul.appendChild(li);
    });
    k.appendChild(ul);
    k.appendChild(el('h4', 'Criar um botão novo'));
    k.appendChild(el('p', 'Para anotar outra coisa além do diabetes (ex.: febre, alergia, dor). Até ' + F.LIM.perguntas + ' perguntas por botão.', { 'class': 'dica' }));
    k.appendChild(botao('➕ Criar botão', 'principal', function () { location.hash = '#/ajustes/botao-novo'; }));
    return k;
  }

  /* Editor de botão criado pela família. Ids nunca mudam; o tipo de uma pergunta já criada não muda. */
  var NOMES_TIPO = { simnao: 'Sim / Não', numero: 'Número', escolha: 'Escolha', texto: 'Texto curto' };
  function telaEditorBotao(id) {
    var velho = id ? F.botaoPersonalizado(F.atual(), id) : null;
    if (id && (!velho || velho.apagado)) { location.hash = '#/ajustes/botoes'; return el('p', ''); }
    var k = cartao(velho ? '✏️ Editar botão' : '➕ Novo botão');
    var est = { nome: velho ? velho.nome : '', icone: velho ? velho.icone : '⭐',
      perguntas: velho ? velho.perguntas.filter(function (q) { return !q.apagado; }).map(function (q) { return JSON.parse(JSON.stringify(q)); }) : [] };
    if (!est.perguntas.length) est.perguntas.push({ rotulo: '', tipo: 'simnao', obrigatoria: true });
    var nome = el('input', '', { type: 'text', maxlength: String(F.LIM.nome), placeholder: 'Nome do botão (ex.: Febre)', 'aria-label': 'Nome do botão' });
    nome.value = est.nome;
    nome.addEventListener('input', function () { est.nome = nome.value; });
    k.appendChild(nome);
    k.appendChild(escolherEmoji(F.EMOJIS_BOTAO, est.icone, function (e) { est.icone = e; }));
    var area = el('div');
    k.appendChild(area);
    function pintar() {
      while (area.firstChild) area.removeChild(area.firstChild);
      est.perguntas.forEach(function (q, i) {
        var box = el('div', '', { 'class': 'pergunta-box' });
        box.appendChild(el('h4', 'Pergunta ' + (i + 1)));
        var rot = el('input', '', { type: 'text', maxlength: String(F.LIM.rotulo), placeholder: 'Texto da pergunta (ex.: Temperatura)', 'aria-label': 'Texto da pergunta ' + (i + 1) });
        rot.value = q.rotulo || '';
        rot.addEventListener('input', function () { q.rotulo = rot.value; });
        box.appendChild(rot);
        if (q.id) box.appendChild(el('p', 'Tipo: ' + NOMES_TIPO[q.tipo] + ' (não muda depois de criada)', { 'class': 'dica' }));
        else {
          var g = el('div', '', { 'class': 'opcoes' });
          Object.keys(NOMES_TIPO).forEach(function (t) {
            var b = botao(NOMES_TIPO[t] + (q.tipo === t ? ' ✓' : ''), q.tipo === t ? 'sel' : '', function () {
              q.tipo = t; if (t === 'escolha' && !q.opcoes) q.opcoes = [[null, ''], [null, '']]; pintar();
            });
            b.setAttribute('aria-pressed', q.tipo === t ? 'true' : 'false');
            g.appendChild(b);
          });
          box.appendChild(g);
        }
        if (q.tipo === 'numero') {
          var un = el('input', '', { type: 'text', maxlength: '10', placeholder: 'Unidade (opcional, ex.: °C)', 'aria-label': 'Unidade' });
          un.value = q.unidade || ''; un.addEventListener('input', function () { q.unidade = un.value; });
          var mi = el('input', '', { type: 'number', inputmode: 'decimal', placeholder: 'Mínimo (opcional)', 'aria-label': 'Mínimo' });
          mi.value = q.min !== undefined && !(q.min === 0 && q.max === 10000) ? q.min : ''; mi.addEventListener('input', function () { q.min = mi.value === '' ? undefined : Number(mi.value); });
          var ma = el('input', '', { type: 'number', inputmode: 'decimal', placeholder: 'Máximo (opcional)', 'aria-label': 'Máximo' });
          ma.value = q.max !== undefined && !(q.min === 0 && q.max === 10000) ? q.max : ''; ma.addEventListener('input', function () { q.max = ma.value === '' ? undefined : Number(ma.value); });
          [['Unidade', un], ['Mínimo', mi], ['Máximo', ma]].forEach(function (par) {
            var l = el('label', par[0], { 'class': 'rotulo' }); l.appendChild(par[1]); box.appendChild(l);
          });
          box.appendChild(el('p', 'Mínimo e máximo só evitam erro de digitação. O app não diz se o número é bom ou ruim.', { 'class': 'dica' }));
        }
        if (q.tipo === 'escolha') {
          q.opcoes = q.opcoes || [[null, ''], [null, '']];
          q.opcoes.forEach(function (o, j) {
            var oi = el('input', '', { type: 'text', maxlength: String(F.LIM.rotulo), placeholder: 'Opção ' + (j + 1), 'aria-label': 'Opção ' + (j + 1) });
            oi.value = o[1] || ''; oi.addEventListener('input', function () { o[1] = oi.value; });
            box.appendChild(oi);
          });
          if (q.opcoes.length < F.LIM.opcoesMax) box.appendChild(botao('+ opção', 'secundario', function () { q.opcoes.push([null, '']); pintar(); }));
        }
        var ob = el('label', '', { 'class': 'chave' });
        var obc = el('input', '', { type: 'checkbox' }); obc.checked = !!q.obrigatoria;
        obc.addEventListener('change', function () { q.obrigatoria = obc.checked; });
        ob.appendChild(obc); ob.appendChild(document.createTextNode('Resposta obrigatória'));
        box.appendChild(ob);
        if (est.perguntas.length > 1) box.appendChild(botao('Tirar esta pergunta', 'secundario perigo', function () { est.perguntas.splice(i, 1); pintar(); }));
        area.appendChild(box);
      });
      if (est.perguntas.length < F.LIM.perguntas) area.appendChild(botao('+ pergunta', 'secundario', function () { est.perguntas.push({ rotulo: '', tipo: 'simnao' }); pintar(); }));
    }
    pintar();
    k.appendChild(botao('💾 Guardar botão', 'principal', function () {
      try {
        salvar(F.salvarBotao(F.atual(), { id: velho ? velho.id : null, nome: est.nome, icone: est.icone, perguntas: est.perguntas }), 'Botão guardado! Ele já está na tela inicial. ⭐');
        location.hash = '#/ajustes/botoes';
      } catch (e) { dizer(e.message); }
    }));
    if (velho) {
      var ap = botao('🗑️ Apagar botão', 'secundario perigo', function () {
        if (ap.dataset.confirmar !== '1') { ap.dataset.confirmar = '1'; ap.textContent = 'Tocar de novo para apagar (os registros antigos continuam)'; return; }
        salvar(F.apagarBotao(F.atual(), velho.id), 'Botão apagado. Os registros antigos continuam no diário.'); location.hash = '#/ajustes/botoes';
      });
      k.appendChild(ap);
    }
    k.appendChild(botao('Cancelar', 'secundario', function () { location.hash = '#/ajustes/botoes'; }));
    return k;
  }

  /* ---------- Mensagens (só configuração: quem envia será o app Android) ---------- */
  function cartaoMensagens(c) {
    var k = cartao('📩 Mensagens para a família');
    var quem = F.textoDe(c.esteCelular) || F.nomeAcompanhada(c);
    k.appendChild(el('p', 'ℹ️ Nada é enviado ainda. As mensagens começam quando o app Android estiver instalado no celular de ' + F.nomeAcompanhada(c) + '.', { 'class': 'alerta' }));
    var m = JSON.parse(JSON.stringify(c.mensagens));
    var comTel = c.familia.filter(function (f) { return !!f.telefone; });
    k.appendChild(el('h4', 'Quem recebe'));
    if (!comTel.length) k.appendChild(el('p', 'Ninguém tem telefone ainda. Ponha o celular das pessoas em Ajustes → Família.', { 'class': 'dica' }));
    var custo = el('p', '', { 'class': 'alerta' });
    var previa = el('p', '', { 'class': 'destaque previa' });
    function atualizar() {
      var tmp = F.normalizar(Object.assign({}, c, { mensagens: m }));
      var n = F.smsPorDia(tmp);
      custo.textContent = '💰 Cada mensagem é um SMS do plano de ' + F.nomeAcompanhada(c) + '. Do jeito que está: cerca de ' + n +
        ' SMS por dia de "tudo bem", mais os alertas. Se o plano não tiver SMS ilimitado, isso gera custo.';
      previa.textContent = F.previaMensagem(tmp, { valor: 120, seta: '→', hora: '14:30' });
    }
    comTel.forEach(function (f) {
      var r = m.recebem[f.id] || (m.recebem[f.id] = { alertas: false, vida: false });
      var li = el('div', '', { 'class': 'pergunta-box' });
      li.appendChild(el('span', f.emoji + ' ' + f.apelido + ' · ' + F.mostrarTelefone(f.telefone), { 'class': 'quem-nome' }));
      [['alertas', 'Recebe os alertas'], ['vida', 'Recebe o "está tudo funcionando"']].forEach(function (par) {
        var l = el('label', '', { 'class': 'chave' });
        var cb = el('input', '', { type: 'checkbox' }); cb.checked = !!r[par[0]];
        cb.addEventListener('change', function () { r[par[0]] = cb.checked; atualizar(); });
        l.appendChild(cb); l.appendChild(document.createTextNode(par[1]));
        li.appendChild(l);
      });
      k.appendChild(li);
    });
    k.appendChild(el('h4', 'De quanto em quanto tempo: "está tudo funcionando"'));
    k.appendChild(el('p', 'Uma mensagem curta para saber que o celular e o app estão ligados. Se ela parar de chegar, algo está errado (bateria, sinal, app fechado).', { 'class': 'dica' }));
    var g = el('div', '', { 'class': 'opcoes' });
    F.VIDA_HORAS.forEach(function (h) {
      var b = botao((h ? 'a cada ' + h + ' h' : 'Desligado') + (m.vidaHoras === h ? ' ✓' : ''), m.vidaHoras === h ? 'sel' : '', function () {
        m.vidaHoras = h; Array.prototype.forEach.call(g.children, function (x) { x.className = ''; x.textContent = x.textContent.replace(' ✓', ''); x.setAttribute('aria-pressed', 'false'); });
        b.className = 'sel'; b.textContent += ' ✓'; b.setAttribute('aria-pressed', 'true'); atualizar();
      });
      b.setAttribute('aria-pressed', m.vidaHoras === h ? 'true' : 'false');
      g.appendChild(b);
    });
    k.appendChild(g);
    k.appendChild(el('h4', 'O que vai na mensagem'));
    [['valor', 'Valor da glicose'], ['seta', 'Seta (subindo/descendo)'], ['hora', 'Hora da leitura'], ['apelido', 'Apelido de ' + F.nomeAcompanhada(c)]].forEach(function (par) {
      var l = el('label', '', { 'class': 'chave' });
      var cb = el('input', '', { type: 'checkbox' }); cb.checked = !!m.conteudo[par[0]];
      cb.addEventListener('change', function () { m.conteudo[par[0]] = cb.checked; atualizar(); });
      l.appendChild(cb); l.appendChild(document.createTextNode(par[1]));
      k.appendChild(l);
    });
    k.appendChild(el('p', 'O SMS passa pela operadora sem proteção: nunca vai nome completo nem localização.', { 'class': 'dica' }));
    k.appendChild(el('p', 'Exemplo de mensagem:', { 'class': 'dica' }));
    k.appendChild(previa);
    k.appendChild(el('p', 'Os limites para os alertas (abaixo de / acima de) ainda vão ser decididos com o médico, numa próxima etapa.', { 'class': 'dica' }));
    k.appendChild(custo);
    atualizar();
    var guarda = botao('💾 Guardar mensagens', 'principal', function () {
      var n = F.smsPorDia(F.normalizar(Object.assign({}, c, { mensagens: m })));
      if (n > 0 && guarda.dataset.confirmar !== '1') {
        guarda.dataset.confirmar = '1'; guarda.textContent = 'Entendi que pode gerar custo (cerca de ' + n + ' SMS/dia): guardar'; return;
      }
      salvar(F.salvarMensagens(F.atual(), m), 'Mensagens guardadas. ⭐'); mostrar('mensagens');
    });
    k.appendChild(guarda);
    return k;
  }

  /* Cópia de segurança: um arquivo .json. Fotos e documentos vão em texto (base64) só aqui dentro. */
  function blobParaTexto(b) {
    return new Promise(function (ok, erro) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { erro(r.error); }; r.readAsDataURL(b); });
  }
  async function baixarCopia(comArquivos) {
    var d = await store.exportarTudo(comArquivos);
    var arqs = [];
    for (var i = 0; i < d.arquivos.length; i++) {
      var a = d.arquivos[i];
      arqs.push({ id: a.id, tipo: a.tipo, mime: a.mime, titulo: a.titulo, data: a.data, base64: await blobParaTexto(a.conteudo) });
    }
    var copia = { app: 'diario-saude', formato: 1, feitaEm: new Date().toISOString(), familia: F.atual(), registros: d.registros, arquivos: arqs };
    var nome = 'diario-saude-copia-' + DiarioDB.diaLocal(new Date().toISOString()) + '.json';
    var blob = new Blob([JSON.stringify(copia)], { type: 'application/json' });
    var kb = Math.max(1, Math.round(blob.size / 1024)) + ' KB';
    // No celular (principalmente iPhone instalado na tela inicial), "Compartilhar" é o jeito que funciona: salvar em Arquivos, Drive…
    var arq = typeof File === 'function' ? new File([blob], nome, { type: 'application/json' }) : null;
    if (arq && navigator.canShare && navigator.canShare({ files: [arq] })) {
      try { await navigator.share({ files: [arq], title: 'Cópia do Diário de Saúde' }); dizer('Cópia pronta (' + kb + '). Guarde num lugar seguro.'); return; }
      catch (e) { if (e && e.name === 'AbortError') { dizer('Cópia cancelada.'); return; } }
    }
    var u = URL.createObjectURL(blob);
    var link = el('a', '', { href: u, download: nome });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    dizer('Cópia pronta (' + kb + '). Guarde num lugar seguro.');
  }
  /* Só aceita data:<formato permitido>;base64 e o formato precisa ser o mesmo do campo mime. Nunca busca endereço de fora. */
  function textoParaBlob(texto, mime) {
    var m = typeof texto === 'string' ? DATA_URL.exec(texto) : null;
    if (!m || m[1] !== mime) throw new Error('arquivo inválido na cópia');
    var bin = atob(m[2]), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  async function lerCopia(arquivo) {
    var dados;
    try { dados = JSON.parse(await arquivo.text()); } catch (e) { throw new Error('Esse arquivo está estragado.'); }
    if (!dados || dados.app !== 'diario-saude') throw new Error('Esse arquivo não é uma cópia do Diário de Saúde.');
    return dados;
  }
  async function restaurar(dados) {
    var arqs = [];
    for (var i = 0; i < (dados.arquivos || []).length; i++) {
      var a = dados.arquivos[i];
      try { arqs.push({ id: a.id, tipo: a.tipo, mime: a.mime, titulo: a.titulo, data: a.data, conteudo: textoParaBlob(a.base64, a.mime) }); } catch (e) { /* pula */ }
    }
    var n = await store.importarTudo({ registros: dados.registros || [], arquivos: arqs });
    var atual = F.atual();
    if (dados.familia) {
      var vinda = F.normalizar(dados.familia);
      vinda.familia.forEach(function (f) { if (!F.pessoa(atual, f.id)) atual.familia.push(f); });
      if (!atual.acompanhada.apelido) atual.acompanhada.apelido = vinda.acompanhada.apelido;
      if (!atual.acompanhada.fotoId && vinda.acompanhada.fotoId) atual.acompanhada.fotoId = vinda.acompanhada.fotoId;
      F.salvar(atual); atualizarTopo();
    }
    mostrar();
    dizer(n + ' registro(s) recuperado(s). Nada foi apagado nem duplicado. ⭐');
  }

  function cartaoCopia() {
    var k = cartao('💾 Cópia de segurança');
    k.appendChild(el('p', '⚠️ A cópia é um arquivo SEM SENHA, com dados de saúde. Guarde só em lugar seu e não mande para quem não é da família.', { 'class': 'alerta' }));
    k.appendChild(el('p', 'Serve para trocar de celular e para não perder nada. No iPhone, o Safari pode apagar os dados depois de uns 7 dias sem abrir o app: faça cópia de vez em quando.', { 'class': 'dica' }));
    var rot = el('label', '', { 'class': 'chave' });
    var com = el('input', '', { type: 'checkbox' }); com.checked = true;
    rot.appendChild(com); rot.appendChild(document.createTextNode('Levar fotos e documentos junto'));
    k.appendChild(rot);
    var faz = botao('⬇️ Fazer cópia agora', 'principal', async function () {
      if (faz.dataset.confirmar !== '1') {
        var tam = com.checked ? await store.espacoArquivos() : 0;
        faz.dataset.confirmar = '1';
        faz.textContent = 'Entendi que é SEM SENHA: fazer a cópia' + (tam ? ' (fotos e documentos: ' + Math.max(1, Math.round(tam / 1024)) + ' KB)' : '');
        return;
      }
      faz.dataset.confirmar = ''; faz.textContent = '⬇️ Fazer cópia agora';
      baixarCopia(com.checked).catch(function (e) { dizer('Erro: ' + e.message); });
    });
    k.appendChild(faz);
    var confirma = el('div', '', { 'class': 'acoes', hidden: '' });
    var entrada = el('input', '', { type: 'file', accept: 'application/json,.json', hidden: '' });
    entrada.addEventListener('change', async function () {
      var a = entrada.files && entrada.files[0];
      entrada.value = ''; // escolher o mesmo arquivo de novo também funciona
      if (!a) return;
      try {
        var dados = await lerCopia(a);
        while (confirma.firstChild) confirma.removeChild(confirma.firstChild);
        var quando = typeof dados.feitaEm === 'string' && !isNaN(Date.parse(dados.feitaEm)) ? new Date(dados.feitaEm).toLocaleString('pt-BR') : 'data desconhecida';
        confirma.appendChild(el('p', 'Cópia de ' + quando + ', com ' + ((dados.registros || []).length) + ' registro(s). Recuperar junta com o que já está aqui: não apaga nem duplica nada.', { 'class': 'alerta' }));
        confirma.appendChild(botao('Sim, recuperar', 'principal', function () {
          confirma.hidden = true;
          restaurar(dados).catch(function (e) { dizer(e.message); });
        }));
        confirma.appendChild(botao('Não', 'secundario', function () { confirma.hidden = true; dizer('Nada foi mudado.'); }));
        confirma.hidden = false;
      } catch (e) { dizer(e.message); }
    });
    k.appendChild(entrada);
    k.appendChild(botao('⬆️ Recuperar de uma cópia', 'secundario', function () { entrada.click(); }));
    k.appendChild(confirma);
    return k;
  }

  function cartaoSobre() {
    var k = cartao('ℹ️ Sobre e aviso');
    k.appendChild(el('p', 'Este app só registra e mostra. A dose de insulina e as decisões sobre o tratamento são do médico. Dúvida? Fale com a equipe de saúde.'));
    k.appendChild(el('p', 'Atlas Saúde · Diário de Saúde · versão ' + VERSAO_APP, { 'class': 'dica' }));
    k.appendChild(el('p', '"Apagar tudo" apaga só ESTE celular e o desliga da família. O que já subiu continua no servidor da família.', { 'class': 'dica' }));
    var apaga = botao('🗑️ Apagar tudo deste celular', 'secundario perigo', async function () {
      if (apaga.dataset.confirmar !== '1') { apaga.dataset.confirmar = '1'; apaga.textContent = 'Tem certeza? Toque de novo para apagar TUDO'; return; }
      try {
        await store.apagarTudo();
        try { [F.CHAVE, 'diario-saude-nomes-insulina', 'diario-saude-voz', 'diario-saude:conexao'].forEach(function (c) { localStorage.removeItem(c); }); } catch (e) { /* ignora */ }
        atualizarTopo(); dizer('Tudo deste celular foi apagado.'); mostrar();
      } catch (e) { dizer('Erro: ' + e.message); }
    });
    k.appendChild(apaga);
    return k;
  }

  /* Ajustes é um menu; cada parte abre em #/ajustes/<parte>. */
  var PARTES = [
    ['cuidado', '👧 Quem a gente cuida'], ['familia', '👨‍👩‍👧 Família'], ['botoes', '🔘 Botões da tela inicial'],
    ['mensagens', '📩 Mensagens para a família'], ['conectada', '🔗 Família conectada'], ['celular', '📱 Este celular é de…'],
    ['copia', '💾 Cópia de segurança'], ['sobre', 'ℹ️ Sobre e aviso']
  ];
  function travar(k) {
    Array.prototype.forEach.call(k.querySelectorAll('button, input'), function (b) { b.disabled = true; });
    k.appendChild(el('p', '🔒 Quem muda isso é o responsável da família. As mudanças dele chegam aqui sozinhas.', { 'class': 'dica' }));
    return k;
  }
  function mostrar(parte) {
    var mudouDeTela = parte !== undefined;
    while (tela.firstChild) tela.removeChild(tela.firstChild);
    // aviso antigo de outra tela não fica pendurado; o que acabou de ser dito (ex.: "Botão guardado!") fica
    if (mudouDeTela && Date.now() - ultimoAviso > 1500) { var st = document.getElementById('status'); if (st) st.textContent = ''; }
    var c = F.atual();
    if (parte === undefined) parte = (location.hash.split('/')[2] || ''); // sem parâmetro: redesenha a parte atual
    if (!parte) {
      tela.appendChild(el('h2', '⚙️ Ajustes'));
      var nav = el('nav', '', { 'class': 'menu-ajustes', 'aria-label': 'Partes dos Ajustes' });
      PARTES.forEach(function (p) {
        if (p[0] === 'celular' && motor() && motor().conectado()) return; // conectado: definido pelo convite
        nav.appendChild(el('a', p[1], { href: '#/ajustes/' + p[0], 'class': 'item-menu' }));
      });
      tela.appendChild(nav);
      return;
    }
    tela.appendChild(el('a', '← Ajustes', { href: '#/ajustes', 'class': 'voltar' }));
    var trava = somenteLeitura();
    var k;
    if (parte === 'cuidado') k = cartaoCuidado(c);
    else if (parte === 'familia') k = cartaoFamilia(c);
    else if (parte === 'botoes') k = cartaoBotoes(c);
    else if (parte === 'botao-novo') k = telaEditorBotao(null);
    else if (parte.indexOf('botao-') === 0) k = telaEditorBotao(parte.slice(6));
    else if (parte === 'mensagens') k = cartaoMensagens(c);
    else if (parte === 'conectada') k = cartaoConectada(c);
    else if (parte === 'celular') k = cartaoCelular(c);
    else if (parte === 'copia') k = cartaoCopia();
    else if (parte === 'sobre') k = cartaoSobre();
    else { location.hash = '#/ajustes'; return; }
    if (trava && ['cuidado', 'familia', 'botoes', 'mensagens', 'botao-novo'].indexOf(parte) >= 0 || (trava && parte.indexOf('botao-') === 0)) k = travar(k);
    tela.appendChild(k);
  }

  function cartaoConectada(c) {
    var k = cartao('🔗 Família conectada');
    var m = motor();
    if (!m || !m.temServidor()) {
      k.appendChild(el('p', 'Em preparação. Por enquanto, cada celular guarda o próprio diário.', { 'class': 'dica' }));
      return k;
    }
    var e = m.estado();
    if (!m.conectado()) {
      if (e.desconectado) k.appendChild(el('p', '⚠️ Este celular foi desconectado da família. Os registros dele continuam aqui.', { 'class': 'alerta' }));
      k.appendChild(el('p', 'Junta o diário de todos: o que um anota, os outros veem. Funciona sem internet e sobe depois.', { 'class': 'dica' }));
      k.appendChild(el('p', '⚠️ Ao conectar, os registros, os apelidos e a foto passam a ficar também no servidor da família (Cloudflare), para os celulares da família verem.', { 'class': 'alerta' }));
      var cod = el('input', '', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'Código do convite (ex.: ABCD-2345)', 'aria-label': 'Código do convite' });
      k.appendChild(cod);
      k.appendChild(botao('📩 Entrar com convite', 'principal', function () {
        dizer('Entrando…');
        m.entrar(cod.value, 'Celular de ' + F.textoDe(F.atual().esteCelular || 'mae')).then(function (d) {
          atualizarTopo(); dizer('Bem-vindo(a) à família conectada! ⭐'); return m.sincronizar();
        }).then(function () { mostrar(); }).catch(function (x) { dizer(x.message); mostrar(); });
      }));
      var det = el('details', '', { 'class': 'detalhes' });
      det.appendChild(el('summary', 'Sou o responsável (primeira vez)'));
      det.appendChild(el('p', 'Digite o código inicial que você guardou no GitHub. Ele serve uma vez só.', { 'class': 'dica' }));
      var ini = el('input', '', { type: 'password', autocomplete: 'off', 'aria-label': 'Código inicial' });
      det.appendChild(ini);
      var quem = c.esteCelular || 'pai';
      det.appendChild(el('p', 'Este celular vai anotar como: ' + F.rotuloDe(quem) + ' (mude em "Este celular é de…").', { 'class': 'dica' }));
      det.appendChild(botao('Virar o responsável', 'principal', function () {
        dizer('Conectando…');
        m.virarResponsavel(ini.value, quem, 'Celular de ' + F.textoDe(quem)).then(function () {
          ini.value = ''; atualizarTopo(); dizer('Pronto! Você é o responsável da família. ⭐'); return m.sincronizar();
        }).then(function () { mostrar(); }).catch(function (x) { ini.value = ''; dizer(x.message); });
      }));
      k.appendChild(det);
      return k;
    }
    // Conectado
    var info = el('p', '', { 'class': 'estado-sync' });
    function pintarEstado() {
      var s = m.estado();
      Promise.all([store.pendentes(), store.rejeitados()]).then(function (r) {
        var partes = [s.ultimo ? '✅ Sincronizado às ' + horaCurta(s.ultimo) : '⏳ Ainda não sincronizou'];
        if (r[0].length) partes.push('📤 ' + r[0].length + ' esperando internet');
        if (r[1].length) partes.push('⚠️ ' + r[1].length + ' não subiu (edite para tentar de novo)');
        if (s.erro) partes.push(s.erro);
        info.textContent = partes.join(' · ');
      });
    }
    pintarEstado();
    k.appendChild(el('p', (e.responsavel ? '👑 Responsável da família · ' : '') + '📱 ' + F.textoDe(e.papel), { 'class': 'quem-nome' }));
    k.appendChild(info);
    k.appendChild(botao('🔄 Sincronizar agora', 'principal', function () {
      dizer('Sincronizando…');
      m.sincronizar().then(function (r) { dizer(r.novos ? r.novos + ' registro(s) novo(s) da família. ⭐' : 'Tudo em dia. ⭐'); pintarEstado(); })
        .catch(function (x) { dizer(x.message); if (x.desconectado) mostrar(); else pintarEstado(); });
    }));
    if (e.responsavel) {
      k.appendChild(el('h4', 'Convidar alguém da família'));
      var g = el('div', '', { 'class': 'opcoes' });
      var saida = el('div', '', { 'class': 'convite' });
      F.quemAnota(F.atual()).forEach(function (f) {
        if (f.id === e.papel) return;
        g.appendChild(botao(f.emoji + ' ' + f.apelido, '', function () {
          m.convidar(f.id).then(function (cv) {
            while (saida.firstChild) saida.removeChild(saida.firstChild);
            saida.appendChild(el('p', 'Código para ' + f.apelido + ' (vale 48 h, uma vez):'));
            saida.appendChild(el('p', cv.codigo, { 'class': 'destaque' }));
            saida.appendChild(el('p', 'No celular dela(e): instalar o app → Ajustes → Família conectada → Entrar com convite. Avise que o apelido e a foto vão aparecer lá também.', { 'class': 'dica' }));
          }).catch(function (x) { dizer(x.message); });
        }));
      });
      k.appendChild(g); k.appendChild(saida);
      var lista = el('ul', '', { 'class': 'familia' });
      k.appendChild(botao('📱 Ver celulares conectados', 'secundario', function () {
        m.aparelhos().then(function (ap) {
          while (lista.firstChild) lista.removeChild(lista.firstChild);
          ap.forEach(function (a) {
            var li = el('li');
            li.appendChild(el('span', (a.esteCelular ? '⭐ ' : '') + F.rotuloDe(a.papel) + (a.nome ? ' · ' + a.nome : '') + (a.revogado ? ' · desconectado' : ''), { 'class': 'quem-nome' }));
            if (!a.esteCelular && !a.revogado) {
              var b = botao('Desconectar', 'secundario perigo', function () {
                if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Tocar de novo para desconectar'; return; }
                m.revogar(a.id).then(function () { dizer('Celular desconectado.'); b.remove(); }).catch(function (x) { dizer(x.message); });
              });
              li.appendChild(b);
            }
            lista.appendChild(li);
          });
        }).catch(function (x) { dizer(x.message); });
      }));
      k.appendChild(lista);
    }
    return k;
  }

  window.DiarioAjustesTela = { mostrar: mostrar, atualizarTopo: atualizarTopo, rosto: rosto, sincronizarQuieto: sincronizarQuieto, iniciarSincronizacao: iniciarSincronizacao };
})();
