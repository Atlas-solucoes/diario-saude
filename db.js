/* Armazenamento local do Diário de Saúde. Sem dados pessoais. Funciona no navegador (IndexedDB) e em testes (memória).
   T-0035-1: tipos 'insulina' e 'glicose'; modelo versão 2; banco IndexedDB versão 2 (só acrescenta, não apaga nada);
   migrar() marca registros antigos com modeloVersao 2 sem mexer nos dados, sem subir versão e sem recolocar na fila.
   T-0036-1: sem limite de registros por dia; ordem do dia por horário (desempate estável); agruparPorDia().
   Nenhuma mudança de formato: registros já guardados continuam valendo, então não há migração nova.
   Etapa B (Configurações): modelo 3 = cada registro tem 'sobre' (pessoa acompanhada) e 'anotadoPor' (quem registrou),
   sempre ids (nunca nomes; a tabela id → apelido/emoji/foto fica só no aparelho). 'pessoa' continua espelhando
   'anotadoPor' por compatibilidade. Banco 3 acrescenta a store 'arquivos' (fotos e documentos como Blob). */
(function (root) {
  'use strict';
  var VERSAO_MODELO = 3;
  var VERSAO_BANCO = 3;
  var TIPOS = ['alimentacao', 'exercicio', 'emocao', 'sono', 'diferente', 'nausea', 'tontura', 'pressao', 'insulina', 'glicose', 'personalizado'];
  var PESSOAS = ['filha', 'pai', 'mae']; // papéis iniciais, nunca nomes (a família pode acrescentar outros ids)
  var SOBRE_PADRAO = 'acompanhada'; // id da pessoa acompanhada no MVP (1 pessoa)
  var ID_PESSOA = /^[a-z0-9_-]{1,40}$/;
  var ARQ_TIPOS = ['foto', 'documento'];
  var ARQ_MAX = 5 * 1024 * 1024;
  var Regras = (typeof module !== 'undefined' && module.exports) ? require('./regras.js') : root.DiarioRegras;

  function novoId() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function copia(v) { return JSON.parse(JSON.stringify(v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function diaLocal(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* Ordem do dia: pelo instante real (data+hora). Empate no mesmo minuto: quem foi criado primeiro, depois pelo id.
     Compara números (não texto), então não depende do formato do ISO. Não altera a lista recebida. */
  function porHorario(a, b) {
    var ta = new Date(a.dataHora).getTime(), tb = new Date(b.dataHora).getTime();
    if (ta !== tb) return ta < tb ? -1 : 1;
    var ca = a.criadoEm || '', cb = b.criadoEm || '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  function ordenar(lista) { return (lista || []).slice().sort(porHorario); }

  /* Agrupa por dia local: [{dia:'AAAA-MM-DD', registros:[...em ordem de horário]}], dias em ordem. Só organiza, não conta nem avalia. */
  function agruparPorDia(lista) {
    var mapa = {}, dias = [];
    ordenar(lista).forEach(function (r) {
      var d = diaLocal(r.dataHora);
      if (!mapa[d]) { mapa[d] = []; dias.push(d); }
      mapa[d].push(r);
    });
    return dias.map(function (d) { return { dia: d, registros: mapa[d] }; });
  }

  // Arquivos guardam Blob: copia rasa (JSON estragaria o conteúdo).
  function cp(st, v) { return st === 'arquivos' ? Object.assign({}, v) : copia(v); }
  function criarMemoria() {
    var s = { registros: new Map(), fila: new Map(), arquivos: new Map() };
    return {
      get: async function (st, id) { var v = s[st].get(id); return v ? cp(st, v) : undefined; },
      put: async function (st, v) { s[st].set(v.id, cp(st, v)); },
      getAll: async function (st) { return Array.from(s[st].values()).map(function (v) { return cp(st, v); }); },
      delete: async function (st, id) { s[st].delete(id); }
    };
  }

  function criarIndexedDB(nome) {
    var dbp = null;
    function abrir() {
      if (dbp) return dbp;
      dbp = new Promise(function (ok, erro) {
        var r = root.indexedDB.open(nome || 'diario-saude', VERSAO_BANCO);
        r.onupgradeneeded = function () {
          // Só cria o que falta: bancos da versão 1 mantêm todos os registros.
          var db = r.result;
          if (!db.objectStoreNames.contains('registros')) db.createObjectStore('registros', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos', { keyPath: 'id' });
        };
        r.onsuccess = function () { ok(r.result); };
        r.onerror = function () { erro(r.error); };
      });
      return dbp;
    }
    function pedido(st, modo, fn) {
      return abrir().then(function (db) {
        return new Promise(function (ok, erro) {
          var t = db.transaction(st, modo);
          var req = fn(t.objectStore(st));
          t.oncomplete = function () { ok(req ? req.result : undefined); };
          t.onerror = function () { erro(t.error); };
          t.onabort = function () { erro(t.error); };
        });
      });
    }
    return {
      get: function (st, id) { return pedido(st, 'readonly', function (o) { return o.get(id); }); },
      put: function (st, v) { return pedido(st, 'readwrite', function (o) { return o.put(v); }); },
      getAll: function (st) { return pedido(st, 'readonly', function (o) { return o.getAll(); }); },
      delete: function (st, id) { return pedido(st, 'readwrite', function (o) { return o.delete(id); }); }
    };
  }

  function criarStore(backend, agora) {
    agora = agora || function () { return new Date().toISOString(); };

    async function enfileirar(reg, op) {
      await backend.put('fila', { id: reg.id, registroId: reg.id, op: op, versao: reg.versao, em: agora() });
    }
    function validar(r) {
      if (TIPOS.indexOf(r.tipo) < 0) throw new Error('tipo inválido: ' + r.tipo);
      if (typeof r.anotadoPor !== 'string' || !ID_PESSOA.test(r.anotadoPor)) throw new Error('anotadoPor inválido: ' + r.anotadoPor);
      if (typeof r.sobre !== 'string' || !ID_PESSOA.test(r.sobre)) throw new Error('sobre inválido: ' + r.sobre);
      if (isNaN(new Date(r.dataHora).getTime())) throw new Error('data/hora inválida');
      if (r.dados === null || typeof r.dados !== 'object' || Array.isArray(r.dados)) throw new Error('dados deve ser um objeto');
    }

    return {
      /* Cria registro: {id, tipo, dataHora(ISO), dados, pessoa, versao} + controle de sincronização.
         Cada chamada cria um registro novo (id próprio): pode haver quantos do mesmo tipo e dia forem precisos. */
      adicionar: async function (e) {
        var r = {
          id: novoId(), tipo: e.tipo, dataHora: e.dataHora || agora(),
          dados: e.dados || {}, anotadoPor: e.anotadoPor || e.pessoa, sobre: e.sobre || SOBRE_PADRAO, versao: 1,
          modeloVersao: VERSAO_MODELO, criadoEm: agora(), atualizadoEm: agora(),
          apagado: false, sincronizado: false
        };
        r.pessoa = r.anotadoPor;
        validar(r);
        await backend.put('registros', r);
        await enfileirar(r, 'salvar');
        return r;
      },
      atualizar: async function (id, mudancas) {
        var r = await backend.get('registros', id);
        if (!r) throw new Error('registro não existe');
        if ('pessoa' in mudancas && !('anotadoPor' in mudancas)) r.anotadoPor = mudancas.pessoa;
        ['tipo', 'dataHora', 'dados', 'anotadoPor', 'sobre'].forEach(function (k) { if (k in mudancas) r[k] = mudancas[k]; });
        if (!r.anotadoPor && r.pessoa) r.anotadoPor = r.pessoa; // registro antigo, se a migração não rodou
        if (!r.sobre) r.sobre = SOBRE_PADRAO;
        r.pessoa = r.anotadoPor;
        validar(r);
        r.versao += 1; r.atualizadoEm = agora(); r.sincronizado = false;
        r.modeloVersao = VERSAO_MODELO;
        delete r.rejeitado; // editou: tenta enviar de novo
        await backend.put('registros', r);
        await enfileirar(r, 'salvar');
        return r;
      },
      /* Exclusão lógica: some das listas, mas fica para avisar o servidor depois. Mexe só neste registro. */
      apagar: async function (id) {
        var r = await backend.get('registros', id);
        if (!r) throw new Error('registro não existe');
        r.apagado = true; r.versao += 1; r.atualizadoEm = agora(); r.sincronizado = false;
        await backend.put('registros', r);
        await enfileirar(r, 'apagar');
        return r;
      },
      obter: function (id) { return backend.get('registros', id); },
      listarDoDia: async function (dia) { // dia = 'AAAA-MM-DD' (hora local); ordem do início ao fim do dia
        var todos = await backend.getAll('registros');
        return ordenar(todos.filter(function (r) { return !r.apagado && diaLocal(r.dataHora) === dia; }));
      },
      listarTodos: async function () {
        var todos = await backend.getAll('registros');
        return todos.filter(function (r) { return !r.apagado; });
      },
      pendentes: function () { return backend.getAll('fila'); },
      /* Só limpa a fila se o servidor confirmou a mesma versão que está guardada */
      marcarSincronizado: async function (id, versao) {
        var r = await backend.get('registros', id);
        if (!r || r.versao !== versao) return false;
        r.sincronizado = true;
        await backend.put('registros', r);
        await backend.delete('fila', id);
        return true;
      },
      /* Migração para o modelo 3: pessoa → anotadoPor; sobre recebe a pessoa acompanhada padrão; carimba modeloVersao.
         Dados, versão, sincronizado e fila ficam como estavam (não recoloca na fila). Seguro rodar várias vezes.
         Devolve quantos registros foram alterados. */
      migrar: async function () {
        var todos = await backend.getAll('registros');
        var n = 0;
        for (var i = 0; i < todos.length; i++) {
          var r = todos[i], mudou = false;
          if (!r.anotadoPor && r.pessoa) { r.anotadoPor = r.pessoa; mudou = true; }
          if (!r.sobre) { r.sobre = SOBRE_PADRAO; mudou = true; }
          if (r.anotadoPor && r.pessoa !== r.anotadoPor) { r.pessoa = r.anotadoPor; mudou = true; }
          if (!(r.modeloVersao >= VERSAO_MODELO)) { r.modeloVersao = VERSAO_MODELO; mudou = true; }
          if (mudou) { await backend.put('registros', r); n++; }
        }
        return n;
      },
      /* Arquivos (foto da pessoa acompanhada, documentos do médico): guardados como estão, nunca lidos nem interpretados.
         {id, tipo:'foto'|'documento', mime, conteudo(Blob), tamanho, titulo, data, criadoEm}. Não entram na fila nem no cache. */
      salvarArquivo: async function (a) {
        if (ARQ_TIPOS.indexOf(a.tipo) < 0) throw new Error('tipo de arquivo inválido');
        if (typeof a.mime !== 'string' || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(a.mime)) throw new Error('formato não aceito');
        var ehBlob = typeof root.Blob === 'function' && a.conteudo instanceof root.Blob;
        var tam = ehBlob ? a.conteudo.size : 0;
        if (tam <= 0) throw new Error('arquivo vazio');
        if (tam > ARQ_MAX) throw new Error('arquivo grande demais (máximo 5 MB)');
        var reg = { id: a.id || novoId(), tipo: a.tipo, mime: a.mime, conteudo: a.conteudo, tamanho: tam,
          titulo: typeof a.titulo === 'string' ? a.titulo.slice(0, 80) : '', data: a.data || '', criadoEm: agora() };
        await backend.put('arquivos', reg);
        return reg;
      },
      obterArquivo: function (id) { return backend.get('arquivos', id); },
      listarArquivos: async function (tipo) {
        var todos = await backend.getAll('arquivos');
        return todos.filter(function (a) { return !tipo || a.tipo === tipo; })
          .sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0; });
      },
      apagarArquivo: function (id) { return backend.delete('arquivos', id); },
      /* Cópia de segurança: tudo deste aparelho (inclusive apagados, para não ressuscitar nada). Sem senha. */
      exportarTudo: async function (comArquivos) {
        return { registros: await backend.getAll('registros'), arquivos: comArquivos ? await backend.getAll('arquivos') : [] };
      },
      /* Importar: junta pelo id. Não duplica e não apaga: só troca se a cópia tiver versão maior. Devolve quantos entraram. */
      importarTudo: async function (dados) {
        var n = 0, regs = (dados && dados.registros) || [], arqs = (dados && dados.arquivos) || [];
        for (var i = 0; i < regs.length; i++) {
          var v = regs[i];
          if (!v || typeof v.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(v.id) || TIPOS.indexOf(v.tipo) < 0) continue;
          if (typeof v.versao !== 'number' || !Number.isInteger(v.versao) || v.versao < 1) continue;
          // Só os campos conhecidos: nada de estranho do arquivo entra no banco.
          var r = { id: v.id, tipo: v.tipo, dataHora: v.dataHora, dados: v.dados, versao: v.versao,
            anotadoPor: v.anotadoPor || v.pessoa, sobre: v.sobre || SOBRE_PADRAO,
            criadoEm: typeof v.criadoEm === 'string' ? v.criadoEm : agora(),
            atualizadoEm: typeof v.atualizadoEm === 'string' ? v.atualizadoEm : agora(), apagado: v.apagado === true };
          r.pessoa = r.anotadoPor;
          try { validar(r); } catch (e) { continue; }
          var atual = await backend.get('registros', r.id);
          if (atual && !(r.versao > atual.versao)) continue;
          r.sincronizado = false; r.modeloVersao = VERSAO_MODELO;
          await backend.put('registros', r);
          await enfileirar(r, r.apagado ? 'apagar' : 'salvar');
          n++;
        }
        for (var j = 0; j < arqs.length; j++) {
          var a = arqs[j];
          if (a && typeof a.id === 'string' && !(await backend.get('arquivos', a.id))) {
            try { await this.salvarArquivo(a); } catch (e) { /* arquivo inválido: pula */ }
          }
        }
        return n;
      },
      /* Apaga TUDO deste aparelho (registros, fila e arquivos). A tela pede 2 toques antes. */
      apagarTudo: async function () {
        var lojas = ['registros', 'fila', 'arquivos'];
        for (var i = 0; i < lojas.length; i++) {
          var todos = await backend.getAll(lojas[i]);
          for (var k = 0; k < todos.length; k++) await backend.delete(lojas[i], todos[k].id);
        }
      },
      /* Etapa C (família conectada). O que veio do servidor substitui o local, EXCETO se o local ainda está na fila e vence
         pela regra única (regras.js). Ao substituir, sai da fila. Nunca recoloca na fila. Devolve true se gravou. */
      aplicarRemoto: async function (remoto) {
        var local = await backend.get('registros', remoto.id);
        var naFila = local ? await backend.get('fila', remoto.id) : null;
        if (local && Regras.mesma(local, remoto)) {
          if (naFila && naFila.versao === local.versao) await backend.delete('fila', remoto.id);
          if (!local.sincronizado) { local.sincronizado = true; await backend.put('registros', local); }
          return false;
        }
        if (local && naFila && !Regras.vence(remoto, local)) return false; // o local ganha: vai subir no próximo envio
        if (local && !naFila && !Regras.vence(remoto, local)) return false;
        var r = { id: remoto.id, tipo: remoto.tipo, dataHora: remoto.dataHora, dados: remoto.dados, anotadoPor: remoto.anotadoPor,
          pessoa: remoto.anotadoPor, sobre: remoto.sobre || SOBRE_PADRAO, versao: remoto.versao, modeloVersao: VERSAO_MODELO,
          criadoEm: remoto.criadoEm, atualizadoEm: remoto.atualizadoEm, apagado: !!remoto.apagado, sincronizado: true };
        try { validar(r); } catch (e) { return false; }
        await backend.put('registros', r);
        if (naFila) await backend.delete('fila', remoto.id);
        return true;
      },
      /* O servidor recusou: sai da fila (não tenta para sempre) e fica marcado até alguém editar. */
      marcarRejeitado: async function (id, erro) {
        var r = await backend.get('registros', id);
        await backend.delete('fila', id);
        if (!r) return;
        r.rejeitado = String(erro || 'recusado').slice(0, 120);
        await backend.put('registros', r);
      },
      rejeitados: async function () {
        var todos = await backend.getAll('registros');
        return todos.filter(function (r) { return !!r.rejeitado; });
      },
      espacoArquivos: async function () {
        var todos = await backend.getAll('arquivos');
        return todos.reduce(function (t, a) { return t + (a.tamanho || 0); }, 0);
      }
    };
  }

  var api = { TIPOS: TIPOS, PESSOAS: PESSOAS, SOBRE_PADRAO: SOBRE_PADRAO, ID_PESSOA: ID_PESSOA, ARQ_MAX: ARQ_MAX, VERSAO_MODELO: VERSAO_MODELO, VERSAO_BANCO: VERSAO_BANCO, diaLocal: diaLocal,
    ordenar: ordenar, agruparPorDia: agruparPorDia,
    criarMemoria: criarMemoria, criarIndexedDB: criarIndexedDB, criarStore: criarStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioDB = api;
})(typeof self !== 'undefined' ? self : globalThis);
