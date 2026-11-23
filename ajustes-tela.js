/* Tela "Ajustes" (#/ajustes), a 5ª aba. Carregue ANTES de app.js, depois de familia.js.
   Cartões: Quem a gente cuida (apelido + foto + emoji), Este celular é de…, Família que anota,
   Cópia de segurança (com aviso de "sem senha") e Sobre e aviso (com "Apagar tudo" em 2 toques).
   Tudo fica neste aparelho. Usa textContent (nunca innerHTML com dados). */
(function () {
  'use strict';
  var F = DiarioFamilia;
  var store = DiarioDB.criarStore(DiarioDB.criarIndexedDB('diario-saude'));
  var tela = document.getElementById('tela');
  var VERSAO_APP = '0.9 (etapa A)';
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
  function dizer(t) { var s = document.getElementById('status'); if (s) s.textContent = t; }
  function cartao(titulo) { var c = el('section', '', { 'class': 'cartao' }); c.appendChild(el('h3', titulo)); return c; }
  function salvar(c, msg) { F.salvar(c); atualizarTopo(); dizer(msg || 'Guardado! ⭐'); }

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
      c.familia.forEach(function (f) { sel.appendChild(el('option', f.emoji + ' ' + f.apelido, { value: f.id })); });
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
        mostrar();
      } catch (e) { dizer(e.message); }
    });
    k.appendChild(entrada);
    k.appendChild(botao(c.acompanhada.fotoId ? '📷 Trocar a foto' : '📷 Pôr uma foto', 'secundario', function () { entrada.click(); }));
    if (c.acompanhada.fotoId) {
      k.appendChild(botao('Tirar a foto', 'secundario', async function () {
        var n = F.atual(); var id = n.acompanhada.fotoId; n.acompanhada.fotoId = null; salvar(n, 'Foto tirada.');
        await store.apagarArquivo(id); mostrar();
      }));
    }
    k.appendChild(el('p', 'A foto fica só neste celular. Quando a família estiver conectada, ela vai para os celulares da família (com aviso antes).', { 'class': 'dica' }));
    return k;
  }

  function cartaoCelular(c) {
    var k = cartao('📱 Este celular é de…');
    k.appendChild(el('p', 'Escolha uma vez. Assim o app já sabe quem está anotando.', { 'class': 'dica' }));
    var g = el('div', '', { 'class': 'opcoes' });
    c.familia.forEach(function (f) {
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

  function cartaoFamilia(c) {
    var k = cartao('👨‍👩‍👧 Família que anota');
    var ul = el('ul', '', { 'class': 'familia' });
    c.familia.forEach(function (f) {
      var li = el('li');
      li.appendChild(el('span', f.emoji + ' ' + f.apelido, { 'class': 'quem-nome' }));
      var acoes = el('div', '', { 'class': 'linha' });
      acoes.appendChild(botao('Mudar nome', 'secundario', function () {
        while (li.firstChild) li.removeChild(li.firstChild);
        var i = el('input', '', { type: 'text', maxlength: '30', 'aria-label': 'Novo apelido' }); i.value = f.apelido;
        var em = f.emoji;
        li.appendChild(i);
        li.appendChild(escolherEmoji(F.EMOJIS_FAMILIA, em, function (e) { em = e; }));
        li.appendChild(botao('Guardar', 'principal', function () { salvar(F.renomear(F.atual(), f.id, i.value, em)); mostrar(); }));
        i.focus();
      }));
      if (c.familia.length > 1) {
        var tira = botao('Tirar', 'secundario perigo', function () {
          if (tira.dataset.confirmar !== '1') { tira.dataset.confirmar = '1'; tira.textContent = 'Tocar de novo para tirar'; return; }
          try { salvar(F.remover(F.atual(), f.id), f.apelido + ' saiu da lista. Os registros dele(a) continuam.'); mostrar(); } catch (e) { dizer(e.message); }
        });
        acoes.appendChild(tira);
      }
      li.appendChild(acoes);
      ul.appendChild(li);
    });
    k.appendChild(ul);
    k.appendChild(el('h4', 'Pôr mais alguém'));
    var ap = el('input', '', { type: 'text', maxlength: '30', autocomplete: 'off', placeholder: 'Ex.: Vó, Babá, Tio', 'aria-label': 'Apelido de quem vai anotar' });
    k.appendChild(ap);
    var emoji = '🧑';
    k.appendChild(escolherEmoji(F.EMOJIS_FAMILIA, '', function (e) { emoji = e; }));
    k.appendChild(botao('➕ Adicionar', 'principal', function () {
      try { salvar(F.adicionar(F.atual(), ap.value, emoji), 'Bem-vindo(a) à família que anota! ⭐'); mostrar(); } catch (e) { dizer(e.message); }
    }));
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
    k.appendChild(el('p', 'Por enquanto, cada celular guarda o próprio diário. Juntar o diário da família vem na próxima etapa.', { 'class': 'dica' }));
    var apaga = botao('🗑️ Apagar tudo deste celular', 'secundario perigo', async function () {
      if (apaga.dataset.confirmar !== '1') { apaga.dataset.confirmar = '1'; apaga.textContent = 'Tem certeza? Toque de novo para apagar TUDO'; return; }
      try {
        await store.apagarTudo();
        try { [F.CHAVE, 'diario-saude-nomes-insulina', 'diario-saude-voz'].forEach(function (c) { localStorage.removeItem(c); }); } catch (e) { /* ignora */ }
        atualizarTopo(); dizer('Tudo deste celular foi apagado.'); mostrar();
      } catch (e) { dizer('Erro: ' + e.message); }
    });
    k.appendChild(apaga);
    return k;
  }

  function mostrar() {
    while (tela.firstChild) tela.removeChild(tela.firstChild);
    var c = F.atual();
    tela.appendChild(el('h2', '⚙️ Ajustes'));
    tela.appendChild(cartaoCuidado(c));
    tela.appendChild(cartaoCelular(c));
    tela.appendChild(cartaoFamilia(c));
    tela.appendChild(cartaoCopia());
    tela.appendChild(cartaoSobre());
  }

  window.DiarioAjustesTela = { mostrar: mostrar, atualizarTopo: atualizarTopo, rosto: rosto };
})();
