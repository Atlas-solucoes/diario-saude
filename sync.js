/* Etapa C: família conectada. Envia a fila e recebe o que mudou no servidor da família (Cloudflare Worker).
   Primeiro envia, depois baixa (regra Y2 do Engenheiro). Sem internet, nada muda: a fila espera.
   O token fica só neste aparelho (localStorage). Nada de dado em URL; o token vai no cabeçalho Authorization.
   criar({store, armazem, rede, familia, api}) devolve o motor; no navegador, window.DiarioSync.motor() usa o padrão. */
(function (root) {
  'use strict';
  var CHAVE = 'diario-saude:conexao';
  var LOTE = 200;
  var MAX_VOLTAS = 20;

  function criar(o) {
    var store = o.store, armazem = o.armazem, rede = o.rede, F = o.familia;
    var api = (o.api || '').replace(/\/+$/, '');
    var rodando = null;

    function ler() { try { return JSON.parse(armazem.getItem(CHAVE) || 'null') || {}; } catch (e) { return {}; } }
    function gravar(c) { armazem.setItem(CHAVE, JSON.stringify(c)); }
    function mudar(fn) { var c = ler(); fn(c); gravar(c); return c; }
    function conectado() { var c = ler(); return !!(c.token && !c.desconectado); }

    async function pedir(caminho, corpo, comToken) {
      if (!api) throw new Error('O servidor da família ainda não está configurado.');
      var h = { 'Content-Type': 'application/json' };
      if (comToken) h.Authorization = 'Bearer ' + ler().token;
      var resp;
      try { resp = await rede(api + caminho, { method: 'POST', headers: h, body: JSON.stringify(corpo || {}) }); }
      catch (e) { var semNet = new Error('Sem internet agora. Fica tudo guardado e sobe depois.'); semNet.semInternet = true; throw semNet; }
      var dados = null;
      try { dados = await resp.json(); } catch (e) { dados = {}; }
      if (resp.status === 401 && comToken && dados && dados.desconectado) {
        mudar(function (c) { c.desconectado = true; });
        var d = new Error('Este celular foi desconectado da família. Os registros dele continuam aqui.'); d.desconectado = true; throw d;
      }
      if (!resp.ok) { var e2 = new Error((dados && dados.erro) || 'O servidor recusou (' + resp.status + ').'); e2.status = resp.status; throw e2; }
      return dados;
    }

    /* Aplica o documento da família vindo do servidor (só o responsável edita; os outros recebem). */
    function aplicarFamilia(doc) {
      var atual = F.ler(armazem);
      var n = F.normalizar({ acompanhada: Object.assign({}, doc.acompanhada || {}, { fotoId: atual.acompanhada.fotoId }),
        familia: doc.familia, esteCelular: atual.esteCelular });
      F.gravar(armazem, n);
    }
    function base64ParaBlob(b64, mime) {
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    async function blobParaBase64(blob) {
      var bytes = new Uint8Array(await blob.arrayBuffer()), s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }
    async function aplicarFoto(foto) {
      var f = F.ler(armazem);
      var velha = f.acompanhada.fotoId;
      if (!foto.base64) { f.acompanhada.fotoId = null; }
      else {
        var a = await store.salvarArquivo({ tipo: 'foto', mime: foto.mime, conteudo: base64ParaBlob(foto.base64, foto.mime), titulo: 'Foto' });
        f.acompanhada.fotoId = a.id;
      }
      F.gravar(armazem, f);
      if (velha && velha !== f.acompanhada.fotoId) await store.apagarArquivo(velha);
    }

    async function umaVolta() {
      var c = ler();
      var fila = (await store.pendentes()).slice(0, LOTE);
      var envio = [];
      for (var i = 0; i < fila.length; i++) {
        var r = await store.obter(fila[i].registroId || fila[i].id);
        if (r) envio.push({ id: r.id, tipo: r.tipo, dataHora: r.dataHora, dados: r.dados, anotadoPor: r.anotadoPor || r.pessoa,
          sobre: r.sobre, versao: r.versao, modeloVersao: r.modeloVersao, criadoEm: r.criadoEm, atualizadoEm: r.atualizadoEm, apagado: !!r.apagado });
      }
      var resp = await pedir('/api/sync', { registros: envio, desde: c.marca || 0, familiaVersao: c.familiaVersao || 0, fotoVersao: c.fotoVersao || 0 }, true);
      for (var a = 0; a < (resp.aceitos || []).length; a++) await store.marcarSincronizado(resp.aceitos[a].id, resp.aceitos[a].versao);
      for (var j = 0; j < (resp.rejeitados || []).length; j++) if (resp.rejeitados[j].id) await store.marcarRejeitado(resp.rejeitados[j].id, resp.rejeitados[j].erro);
      var novos = 0;
      for (var k = 0; k < (resp.registros || []).length; k++) if (await store.aplicarRemoto(resp.registros[k])) novos++;
      if (resp.familia) aplicarFamilia(resp.familia.doc);
      if (resp.foto) await aplicarFoto(resp.foto);
      mudar(function (x) {
        if (typeof resp.marca === 'number') x.marca = resp.marca;
        if (resp.familia) x.familiaVersao = resp.familia.versao;
        if (resp.foto) x.fotoVersao = resp.foto.versao;
      });
      return { novos: novos, mais: !!resp.mais || fila.length === LOTE };
    }

    /* Envia e recebe até acabar (no máximo 20 voltas). Uma de cada vez. */
    function sincronizar() {
      if (!conectado()) return Promise.resolve({ novos: 0, pulou: true });
      if (rodando) return rodando;
      rodando = (async function () {
        var total = 0;
        try {
          for (var v = 0; v < MAX_VOLTAS; v++) { var r = await umaVolta(); total += r.novos; if (!r.mais) break; }
          mudar(function (c) { c.ultimo = new Date().toISOString(); c.erro = ''; });
          return { novos: total };
        } catch (e) {
          mudar(function (c) { c.erro = e.message; });
          throw e;
        } finally { rodando = null; }
      })();
      return rodando;
    }

    async function guardarConexao(d) {
      gravar({ token: d.token, aparelhoId: d.aparelhoId, papel: d.papel, responsavel: !!d.responsavel, marca: 0, familiaVersao: 0, fotoVersao: 0 });
      var f = F.ler(armazem);
      if (F.pessoa(f, d.papel)) { f.esteCelular = d.papel; F.gravar(armazem, f); }
    }

    return {
      CHAVE: CHAVE,
      estado: ler,
      conectado: conectado,
      temServidor: function () { return !!api; },
      sincronizar: sincronizar,
      /* Responsável: o código inicial do Daniel. Depois de entrar, já sobe a família (apelidos) e a foto deste celular. */
      virarResponsavel: async function (codigo, papel, nome) {
        var d = await pedir('/api/responsavel', { codigo: codigo, papel: papel, nome: nome }, false);
        await guardarConexao(d);
        await this.enviarFamilia();
        await this.enviarFoto();
        return d;
      },
      entrar: async function (codigo, nome) {
        var d = await pedir('/api/entrar', { codigo: codigo, nome: nome }, false);
        await guardarConexao(d);
        return d;
      },
      convidar: function (papel) { return pedir('/api/convites', { papel: papel }, true); },
      aparelhos: async function () { return (await pedir('/api/aparelhos', {}, true)).aparelhos; },
      revogar: function (id) { return pedir('/api/aparelhos/revogar', { id: id }, true); },
      /* Só o responsável: sobe apelidos/emojis (nunca a foto aqui, nunca "este celular é de"). */
      enviarFamilia: async function () {
        var c = ler();
        if (!c.responsavel || !conectado()) return;
        var f = F.ler(armazem);
        var v = (c.familiaVersao || 0) + 1;
        var doc = { acompanhada: { apelido: f.acompanhada.apelido, emoji: f.acompanhada.emoji }, familia: f.familia };
        var r = await pedir('/api/familia', { doc: doc, versao: v }, true);
        // Responsável novo (código trocado) começa da versão 0: o servidor ignora e conta a dele; reenvia uma vez acima dela.
        if (!r.aceito) r = await pedir('/api/familia', { doc: doc, versao: r.versao + 1 }, true);
        mudar(function (x) { x.familiaVersao = r.versao; });
      },
      enviarFoto: async function () {
        var c = ler();
        if (!c.responsavel || !conectado()) return;
        var f = F.ler(armazem);
        var v = (c.fotoVersao || 0) + 1;
        var a = f.acompanhada.fotoId ? await store.obterArquivo(f.acompanhada.fotoId) : null;
        var corpo = a && a.conteudo ? { base64: await blobParaBase64(a.conteudo), versao: v } : { apagar: true, versao: v };
        var r = await pedir('/api/foto', corpo, true);
        if (!r.aceito) { corpo.versao = r.versao + 1; r = await pedir('/api/foto', corpo, true); }
        mudar(function (x) { x.fotoVersao = r.versao; });
      },
      /* Desliga só este celular da família (os registros ficam). */
      sair: function () { armazem.removeItem(CHAVE); }
    };
  }

  var api = { CHAVE: CHAVE, criar: criar };
  /* No navegador: um motor só, com o endereço de config.js. */
  if (root.localStorage && root.DiarioDB) {
    var unico = null;
    api.motor = function () {
      if (!unico) unico = criar({ store: root.DiarioDB.criarStore(root.DiarioDB.criarIndexedDB('diario-saude')), armazem: root.localStorage,
        rede: root.fetch.bind(root), familia: root.DiarioFamilia, api: root.DIARIO_API || '' });
      return unico;
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioSync = api;
})(typeof self !== 'undefined' ? self : this);
