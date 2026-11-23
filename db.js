/* Armazenamento local do Diário de Saúde. Sem dados pessoais. Funciona no navegador (IndexedDB) e em testes (memória).
   T-0035-1: tipos 'insulina' e 'glicose'; modelo versão 2; banco IndexedDB versão 2 (só acrescenta, não apaga nada);
   migrar() marca registros antigos com modeloVersao 2 sem mexer nos dados, sem subir versão e sem recolocar na fila.
   T-0036-1: sem limite de registros por dia; ordem do dia por horário (desempate estável); agruparPorDia().
   Nenhuma mudança de formato: registros já guardados continuam valendo, então não há migração nova. */
(function (root) {
  'use strict';
  var VERSAO_MODELO = 2;
  var VERSAO_BANCO = 2;
  var TIPOS = ['alimentacao', 'exercicio', 'emocao', 'sono', 'diferente', 'nausea', 'tontura', 'pressao', 'insulina', 'glicose'];
  var PESSOAS = ['filha', 'pai', 'mae']; // papéis, nunca nomes

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

  function criarMemoria() {
    var s = { registros: new Map(), fila: new Map() };
    return {
      get: async function (st, id) { var v = s[st].get(id); return v ? copia(v) : undefined; },
      put: async function (st, v) { s[st].set(v.id, copia(v)); },
      getAll: async function (st) { return Array.from(s[st].values()).map(copia); },
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
      if (PESSOAS.indexOf(r.pessoa) < 0) throw new Error('pessoa inválida: ' + r.pessoa);
      if (isNaN(new Date(r.dataHora).getTime())) throw new Error('data/hora inválida');
      if (r.dados === null || typeof r.dados !== 'object' || Array.isArray(r.dados)) throw new Error('dados deve ser um objeto');
    }

    return {
      /* Cria registro: {id, tipo, dataHora(ISO), dados, pessoa, versao} + controle de sincronização.
         Cada chamada cria um registro novo (id próprio): pode haver quantos do mesmo tipo e dia forem precisos. */
      adicionar: async function (e) {
        var r = {
          id: novoId(), tipo: e.tipo, dataHora: e.dataHora || agora(),
          dados: e.dados || {}, pessoa: e.pessoa, versao: 1,
          modeloVersao: VERSAO_MODELO, criadoEm: agora(), atualizadoEm: agora(),
          apagado: false, sincronizado: false
        };
        validar(r);
        await backend.put('registros', r);
        await enfileirar(r, 'salvar');
        return r;
      },
      atualizar: async function (id, mudancas) {
        var r = await backend.get('registros', id);
        if (!r) throw new Error('registro não existe');
        ['tipo', 'dataHora', 'dados', 'pessoa'].forEach(function (k) { if (k in mudancas) r[k] = mudancas[k]; });
        validar(r);
        r.versao += 1; r.atualizadoEm = agora(); r.sincronizado = false;
        r.modeloVersao = VERSAO_MODELO;
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
      /* Migração para o modelo 2: só carimba modeloVersao. Dados, versão, sincronizado e fila ficam como estavam.
         Seguro rodar várias vezes. Devolve quantos registros foram carimbados. */
      migrar: async function () {
        var todos = await backend.getAll('registros');
        var n = 0;
        for (var i = 0; i < todos.length; i++) {
          var r = todos[i];
          if (!(r.modeloVersao >= VERSAO_MODELO)) { r.modeloVersao = VERSAO_MODELO; await backend.put('registros', r); n++; }
        }
        return n;
      }
    };
  }

  var api = { TIPOS: TIPOS, PESSOAS: PESSOAS, VERSAO_MODELO: VERSAO_MODELO, VERSAO_BANCO: VERSAO_BANCO, diaLocal: diaLocal,
    ordenar: ordenar, agruparPorDia: agruparPorDia,
    criarMemoria: criarMemoria, criarIndexedDB: criarIndexedDB, criarStore: criarStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioDB = api;
})(typeof self !== 'undefined' ? self : globalThis);
