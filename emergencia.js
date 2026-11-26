/* Perfil paciente: sinal nos botões (o que foi feito hoje e por quem) e o botão "🆘 Não estou bem".
   Funções puras (testadas em node) + telas (só no navegador). Conteúdo sempre por textContent. */
(function (root, fabrica) {
  var m = fabrica(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = m; else root.DiarioEmergencia = m;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SEGURAR_MS = 2000;      // segurar 2 s: toque sem querer (bolso, esbarrão) não dispara
  var CONTAGEM_S = 5;         // depois de segurar: 5 s para cancelar
  var ESPERA_MS = 120000;     // trava contra repetição: 1 pedido a cada 2 min (também no app Android)

  /* ---------- puras ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function horaLocal(iso) { var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function diaLocal(iso) { var d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* Chave do botão de um registro: tipo fixo ou "p:<id do botão criado>". */
  function chaveDoRegistro(r) { return r.tipo === 'personalizado' ? 'p:' + (r.dados && r.dados.botao) : r.tipo; }

  /* Último registro DE HOJE de cada botão: {chave: {hora, quem, iso}} (apagados não contam). */
  function sinaisDeHoje(registros, hoje, nomeDe) {
    var s = {};
    (registros || []).forEach(function (r) {
      if (!r || r.apagado || !r.dataHora || diaLocal(r.dataHora) !== hoje) return;
      var k = chaveDoRegistro(r), atual = s[k];
      if (!atual || r.dataHora > atual.iso) s[k] = { iso: r.dataHora, hora: horaLocal(r.dataHora), quem: nomeDe(r.anotadoPor || r.pessoa) };
    });
    return s;
  }

  /* Situação de emergência de hoje: o último registro 'emergencia' de hoje (pediu ou bem), ou null. */
  function emergenciaDeHoje(registros, hoje, nomeDe) {
    var ult = null;
    (registros || []).forEach(function (r) {
      if (!r || r.apagado || r.tipo !== 'emergencia' || !r.dataHora || diaLocal(r.dataHora) !== hoje) return;
      if (!ult || r.dataHora > ult.dataHora) ult = r;
    });
    if (!ult) return null;
    return { estado: ult.dados && ult.dados.estado, hora: horaLocal(ult.dataHora), quem: nomeDe(ult.anotadoPor || ult.pessoa) };
  }

  /* Textos do SMS (sem acento, curtos, sem nome completo e sem localização: mesma regra do vigia). */
  function textoPedido(hora) { return 'Atlas Saude: EMERGENCIA. Ela apertou "Nao estou bem" as ' + hora + '. Ligue para ela agora.'; }
  function textoBem(hora) { return 'Atlas Saude: ela avisou que esta bem agora (' + hora + ').'; }

  /* Link sms: com vários números e texto pronto (plano B quando o app Android não pode enviar sozinho). */
  function linkSms(telefones, texto) {
    return 'sms:' + telefones.join(',') + '?&body=' + encodeURIComponent(texto);
  }

  /* Pode pedir de novo? (trava de 2 min) */
  function podePedir(ultimoMs, agoraMs) { return !ultimoMs || agoraMs - ultimoMs >= ESPERA_MS; }

  var api = { SEGURAR_MS: SEGURAR_MS, CONTAGEM_S: CONTAGEM_S, ESPERA_MS: ESPERA_MS,
    chaveDoRegistro: chaveDoRegistro, sinaisDeHoje: sinaisDeHoje, emergenciaDeHoje: emergenciaDeHoje,
    textoPedido: textoPedido, textoBem: textoBem, linkSms: linkSms, podePedir: podePedir };
  if (typeof document === 'undefined') return api;

  /* ---------- telas (navegador) ---------- */

  function el(tag, texto, attrs) {
    var e = document.createElement(tag);
    if (texto) e.textContent = texto;
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function nativo() { return root.AtlasNativo && root.AtlasNativo.emergencia ? root.AtlasNativo : null; }
  var CHAVE_ULTIMO = 'diario-emergencia-ultimo';
  function ultimoPedido() { try { return Number(localStorage.getItem(CHAVE_ULTIMO)) || 0; } catch (e) { return 0; } }
  function marcarPedido() { try { localStorage.setItem(CHAVE_ULTIMO, String(Date.now())); } catch (e) { /* sem armazenamento */ } }

  /* Botão vermelho grande: segurar 2 s (anel enche). Toque rápido só explica. */
  function botaoSegurar(aoDisparar) {
    var b = el('button', '', { type: 'button', 'class': 'sos', 'aria-label': 'Não estou bem: segure 2 segundos para pedir ajuda' });
    var anel = el('span', '', { 'class': 'sos-anel', 'aria-hidden': 'true' });
    b.appendChild(anel);
    b.appendChild(el('span', '🆘 Não estou bem', { 'class': 'sos-texto' }));
    var dica = el('span', 'Segure 2 segundos', { 'class': 'sos-dica' });
    b.appendChild(dica);
    var t = null, inicio = 0;
    function parar(curto) {
      if (t) { clearTimeout(t); t = null; }
      b.classList.remove('segurando');
      if (curto) { dica.textContent = 'Continue segurando… (2 segundos)'; setTimeout(function () { dica.textContent = 'Segure 2 segundos'; }, 2500); }
    }
    b.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      inicio = Date.now(); b.classList.add('segurando');
      t = setTimeout(function () { t = null; b.classList.remove('segurando'); if (navigator.vibrate) navigator.vibrate(200); aoDisparar(); }, SEGURAR_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) {
      b.addEventListener(n, function () { if (t) parar(Date.now() - inicio < SEGURAR_MS); });
    });
    b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    // teclado/leitor de tela: Enter abre direto a contagem (que ainda tem o Cancelar)
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aoDisparar(); } });
    return b;
  }

  /* Bloco do topo da tela inicial do celular da paciente. ctx: {F, familia, salvarRegistro(dados)} */
  function blocoPaciente(ctx) {
    var caixa = el('section', '', { 'class': 'sos-caixa' });
    var quem = ctx.F.recebemAlertas(ctx.familia);
    caixa.appendChild(botaoSegurar(function () { contagem(ctx); }));
    caixa.appendChild(el('p', quem.length ? 'Avisa por SMS: ' + quem.map(function (q) { return q.apelido; }).join(', ')
      : '⚠️ Ninguém está marcado para receber. Peça ao responsável: Ajustes → Mensagens → "Recebe os alertas".', { 'class': quem.length ? 'dica' : 'alerta' }));
    return caixa;
  }

  /* Tela cheia: "Avisando a família em 5…" + Cancelar gigante. */
  function contagem(ctx) {
    var capa = el('div', '', { 'class': 'sos-capa', role: 'alertdialog', 'aria-live': 'assertive' });
    var num = el('p', '', { 'class': 'sos-numero' });
    capa.appendChild(el('p', 'Avisando a família em', { 'class': 'sos-titulo' }));
    capa.appendChild(num);
    var cancelar = el('button', 'Cancelar', { type: 'button', 'class': 'sos-cancelar' });
    capa.appendChild(cancelar);
    document.body.appendChild(capa);
    var n = CONTAGEM_S, t = null;
    function pinta() { num.textContent = String(n); }
    function fecha() { if (t) clearInterval(t); capa.remove(); }
    cancelar.addEventListener('click', fecha);
    pinta(); cancelar.focus();
    t = setInterval(function () {
      n--; if (n > 0) { pinta(); return; }
      fecha(); enviar(ctx, 'pediu');
    }, 1000);
  }

  /* Envia: pelo app Android (SMS automático, sem internet); se não der, abre o SMS pronto. Depois registra no diário. */
  function enviar(ctx, estado) {
    var agora = new Date().toISOString(), hora = horaLocal(agora);
    if (estado === 'pediu' && !podePedir(ultimoPedido(), Date.now())) { telaDepois(ctx, null, 'espera'); return; }
    var quem = ctx.F.recebemAlertas(ctx.familia);
    var res = null, n = nativo();
    if (n) { try { res = JSON.parse(estado === 'pediu' ? n.emergencia() : n.estouBem()); } catch (e) { res = null; } }
    if (res && res.espera) { telaDepois(ctx, null, 'espera'); return; } // o app já mandou há menos de 2 min
    var avisados = 0;
    // App Android antigo (sem a função de emergência): ele não abre link de SMS. Não fingir que avisou: só ligar.
    var appAntigo = !!(root.AtlasNativo && !n);
    if (res && res.ok) avisados = res.avisados || 0;
    else if (appAntigo) { res = { ok: false, motivo: 'Este app precisa ser atualizado para mandar o SMS. LIGUE para a família agora:' }; }
    else if (quem.length) {
      // plano B: abre o app de SMS com o texto e os números (ela só toca em enviar)
      location.href = linkSms(quem.map(function (q) { return q.telefone; }), estado === 'pediu' ? textoPedido(hora) : textoBem(hora));
      avisados = quem.length;
    }
    if (estado === 'pediu') marcarPedido();
    ctx.salvarRegistro({ estado: estado, avisados: avisados }, agora);
    telaDepois(ctx, res, estado, hora, quem);
  }

  /* Depois do pedido: quem foi avisado, ligar para cada um, "Estou bem agora". */
  function telaDepois(ctx, res, estado, hora, quem) {
    quem = quem || ctx.F.recebemAlertas(ctx.familia);
    var capa = el('div', '', { 'class': 'sos-capa sos-depois', role: 'dialog' });
    var titulo;
    if (estado === 'espera') titulo = 'Você já pediu ajuda há pouco. A família já foi avisada. Ligue se precisar:';
    else if (estado === 'bem') titulo = (res && !res.ok) || !quem.length ? '💚 Anotado no diário (' + hora + '). O SMS não saiu: avise a família por telefone.'
      : '💚 Avisamos que você está bem (' + hora + ').';
    else if (res && res.ok) titulo = '📨 Avisamos ' + quem.map(function (q) { return q.apelido; }).join(', ') + ' às ' + hora + '.';
    else if (res && res.motivo && /atualizado/.test(res.motivo)) titulo = '⚠️ O SMS NÃO saiu.';
    else if (quem.length) titulo = '📨 Abrimos o SMS pronto: toque em ENVIAR. Depois, se puder, ligue:';
    else titulo = '⚠️ Ninguém está marcado para receber. Ligue para alguém da família agora.';
    capa.appendChild(el('p', titulo, { 'class': 'sos-titulo' }));
    if (res && !res.ok && res.motivo) capa.appendChild(el('p', res.motivo, { 'class': 'sos-motivo' }));
    if (estado !== 'bem') quem.forEach(function (q) {
      var a = el('a', '📞 Ligar para ' + q.apelido, { href: 'tel:' + q.telefone, 'class': 'sos-ligar' });
      capa.appendChild(a);
    });
    if (estado === 'pediu' || estado === 'espera') {
      var bem = el('button', '💚 Estou bem agora', { type: 'button', 'class': 'sos-bem' });
      bem.addEventListener('click', function () { capa.remove(); enviar(ctx, 'bem'); });
      capa.appendChild(bem);
    }
    var fechar = el('button', 'Fechar', { type: 'button', 'class': 'secundario' });
    fechar.addEventListener('click', function () { capa.remove(); if (ctx.aoFechar) ctx.aoFechar(); });
    capa.appendChild(fechar);
    document.body.appendChild(capa);
  }

  /* Faixa no topo de TODOS os celulares quando houve pedido de ajuda hoje. */
  function faixaDeHoje(sit) {
    if (!sit) return null;
    var pediu = sit.estado === 'pediu';
    return el('p', pediu ? '🆘 Hoje às ' + sit.hora + ': ' + sit.quem + ' pediu ajuda ("Não estou bem").'
      : '💚 Hoje às ' + sit.hora + ': ' + sit.quem + ' avisou que está bem.', { 'class': pediu ? 'sos-faixa' : 'sos-faixa ok', role: 'status' });
  }

  api.blocoPaciente = blocoPaciente;
  api.contagem = contagem;
  api.faixaDeHoje = faixaDeHoje;
  return api;
});
