/* Etapa A (Ajustes): quem a gente cuida, família que anota e "este celular é de…".
   Tudo fica SÓ neste aparelho (localStorage). Os registros guardam apenas ids; apelido, emoji e foto ficam aqui.
   Funções puras recebem o "armazenamento" por parâmetro para dar para testar sem navegador. */
(function (root) {
  'use strict';
  var CHAVE = 'diario-saude:familia';
  var EMOJIS_FAMILIA = ['👩', '👨', '👧', '👦', '👵', '👴', '🧑', '👩‍⚕️', '🦸', '🐻', '🦊', '🐼'];
  var EMOJIS_CUIDADO = ['⭐', '🌈', '🦄', '🐱', '🐶', '🦋', '🌻', '🐢', '🐰', '🦁'];
  var ID_PESSOA = /^[a-z0-9_-]{1,40}$/;

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
  function normalizar(c) {
    var p = padrao();
    if (!c || typeof c !== 'object') return p;
    var a = c.acompanhada || {};
    var fam = Array.isArray(c.familia) ? c.familia.filter(function (f) { return f && ID_PESSOA.test(f.id); })
      .map(function (f) { return { id: f.id, apelido: texto(f.apelido, 30) || f.id, emoji: texto(f.emoji, 8) || '🧑' }; }) : p.familia;
    if (!fam.length) fam = p.familia; // lista vazia ou estragada: volta para Filha, Pai e Mãe
    var ids = fam.map(function (f) { return f.id; });
    return {
      versao: 1,
      acompanhada: { id: 'acompanhada', apelido: texto(a.apelido, 30), emoji: texto(a.emoji, 8) || '⭐',
        fotoId: typeof a.fotoId === 'string' ? a.fotoId : null },
      familia: fam,
      esteCelular: ids.indexOf(c.esteCelular) >= 0 ? c.esteCelular : ''
    };
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
  function adicionar(c, apelido, emoji) {
    var ap = texto(apelido, 30);
    if (!ap) throw new Error('Escreva um apelido.');
    var n = normalizar(c);
    var id = novoId(n.familia.map(function (f) { return f.id; }));
    n.familia.push({ id: id, apelido: ap, emoji: texto(emoji, 8) || '🧑' });
    return n;
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
    n.familia = n.familia.filter(function (f) { return f.id !== id; });
    if (n.esteCelular === id) n.esteCelular = '';
    return n;
  }
  function pessoa(c, id) {
    var n = normalizar(c);
    for (var i = 0; i < n.familia.length; i++) if (n.familia[i].id === id) return n.familia[i];
    return null;
  }
  /* Texto para tela (com emoji) e para o PDF (sem emoji, porque a fonte do PDF não tem). */
  function rotulo(c, id) { var p = pessoa(c, id); return p ? p.emoji + ' ' + p.apelido : 'Alguém que saiu'; }
  function rotuloTexto(c, id) { var p = pessoa(c, id); return p ? p.apelido : 'Alguém que saiu'; }
  function nomeAcompanhada(c) { var a = normalizar(c).acompanhada; return a.apelido || 'quem a gente cuida'; }

  var api = { CHAVE: CHAVE, EMOJIS_FAMILIA: EMOJIS_FAMILIA, EMOJIS_CUIDADO: EMOJIS_CUIDADO,
    padrao: padrao, normalizar: normalizar, ler: ler, gravar: gravar, adicionar: adicionar, renomear: renomear,
    remover: remover, pessoa: pessoa, rotulo: rotulo, rotuloTexto: rotuloTexto, nomeAcompanhada: nomeAcompanhada };

  /* Atalhos do navegador: usam o localStorage deste aparelho. */
  if (root.localStorage) {
    api.atual = function () { return ler(root.localStorage); };
    api.salvar = function (c) { gravar(root.localStorage, c); };
    api.rotuloDe = function (id) { return rotulo(ler(root.localStorage), id); };
    api.textoDe = function (id) { return rotuloTexto(ler(root.localStorage), id); };
    api.opcoesFiltro = function () {
      return [['', 'Todos']].concat(ler(root.localStorage).familia.map(function (f) { return [f.id, f.emoji + ' ' + f.apelido]; }));
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioFamilia = api;
})(typeof self !== 'undefined' ? self : this);
