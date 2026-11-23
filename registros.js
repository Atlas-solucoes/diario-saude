/* Definição dos 10 registros rápidos + validação + resumo. Sem tela aqui (testável em Node).
   Regra de ouro: insulina e glicose são SÓ registro do que a família anotou. Nenhum texto interpreta o valor
   (nada de alto/baixo/normal), não há alerta, meta, cálculo nem sugestão de dose ou tratamento.
   Os limites de número abaixo só evitam erro de digitação; não dizem se o valor é bom ou ruim.
   T-0036-1: insulina e glicose são SEMPRE opcionais (nenhum campo delas é obrigatório) e podem ser
   registradas quantas vezes for, cada uma com sua data e hora. */
(function (root) {
  'use strict';

  var SNN = [['sim', 'Sim'], ['nao', 'Não'], ['nao_sei', 'Não sei']];
  var ESCALA = [['pouco', 'Pouco'], ['mais_ou_menos', 'Mais ou menos'], ['muito', 'Muito']];

  var ESQUEMAS = {
    alimentacao: { nome: 'Comi', icone: '🍽️', pergunta: 'O que eu comi?', campos: [
      { id: 'itens', rotulo: 'O que eu comi?', tipo: 'itens', obrigatorio: true },
      { id: 'passouMal', rotulo: 'Passou mal depois?', curto: 'passou mal depois', tipo: 'escolha',
        opcoes: [['sim', 'Sim'], ['nao', 'Não'], ['nao_sei', 'Ainda não sei']], padrao: 'nao_sei' },
      { id: 'porcao', rotulo: 'Quanto? (ex.: 1 fatia)', curto: 'quanto', tipo: 'texto', detalhe: true }
    ] },
    exercicio: { nome: 'Exercício', icone: '👟', pergunta: 'Mexi meu corpo', campos: [
      { id: 'atividade', rotulo: 'O que eu fiz?', tipo: 'escolha', obrigatorio: true, opcoes: [
        ['brincou', 'Brinquei'], ['caminhou', 'Caminhei'], ['correu', 'Corri'], ['dancou', 'Dancei'],
        ['esporte', 'Fiz esporte'], ['outro', 'Outro']] },
      { id: 'minutos', rotulo: 'Quantos minutos?', curto: 'min', tipo: 'numero', min: 1, max: 600, detalhe: true },
      { id: 'esforco', rotulo: 'Foi…', curto: 'esforço', tipo: 'escolha', detalhe: true,
        opcoes: [['leve', 'Leve'], ['medio', 'Médio'], ['forte', 'Forte']] }
    ] },
    emocao: { nome: 'Emoção', icone: '🙂', pergunta: 'Como eu me senti?', campos: [
      { id: 'emocao', rotulo: 'Como eu me senti?', tipo: 'escolha', obrigatorio: true, opcoes: [
        ['feliz', 'Feliz'], ['tranquila', 'Tranquila'], ['triste', 'Triste'], ['preocupada', 'Preocupada'],
        ['brava', 'Brava'], ['outra', 'Outra']] },
      { id: 'intensidade', rotulo: 'Quanto?', curto: 'quanto', tipo: 'escolha', opcoes: ESCALA, detalhe: true },
      { id: 'texto', rotulo: 'O que aconteceu? (opcional)', tipo: 'texto', detalhe: true }
    ] },
    sono: { nome: 'Sono', icone: '🌙', pergunta: 'Como dormi?', campos: [
      { id: 'qualidade', rotulo: 'Como dormi?', tipo: 'escolha', obrigatorio: true,
        opcoes: [['bem', 'Bem'], ['mais_ou_menos', 'Mais ou menos'], ['mal', 'Mal']] },
      { id: 'dormiu', rotulo: 'Dormi às', curto: 'dormiu às', tipo: 'hora', detalhe: true },
      { id: 'acordou', rotulo: 'Acordei às', curto: 'acordou às', tipo: 'hora', detalhe: true }
    ] },
    diferente: { nome: 'Algo diferente', icone: '📅', pergunta: 'Aconteceu algo diferente?', campos: [
      { id: 'situacao', rotulo: 'O que foi?', tipo: 'escolha', obrigatorio: true, opcoes: [
        ['escola', 'Na escola'], ['passeio', 'Passeio'], ['festa', 'Festa'], ['viagem', 'Viagem'],
        ['rotina', 'Mudança na rotina'], ['outra', 'Outra coisa']] },
      { id: 'texto', rotulo: 'Conta um pouco (opcional)', tipo: 'texto', detalhe: true }
    ] },
    nausea: { nome: 'Náusea', icone: '🤢', pergunta: 'Estou enjoada', campos: [
      { id: 'intensidade', rotulo: 'Quanto?', tipo: 'escolha', obrigatorio: true, opcoes: ESCALA },
      { id: 'vomito', rotulo: 'Vomitei?', curto: 'vômito', tipo: 'escolha', opcoes: SNN, detalhe: true },
      { id: 'texto', rotulo: 'O que eu estava fazendo? (opcional)', tipo: 'texto', detalhe: true }
    ] },
    tontura: { nome: 'Tontura', icone: '😵‍💫', pergunta: 'Estou tonta', campos: [
      { id: 'intensidade', rotulo: 'Quanto?', tipo: 'escolha', obrigatorio: true, opcoes: ESCALA },
      { id: 'desmaio', rotulo: 'Desmaiei?', curto: 'desmaio', tipo: 'escolha', detalhe: true,
        opcoes: [['nao', 'Não'], ['quase', 'Quase desmaiei'], ['sim', 'Desmaiei']] },
      { id: 'texto', rotulo: 'O que eu estava fazendo? (opcional)', tipo: 'texto', detalhe: true }
    ] },
    pressao: { nome: 'Pressão baixa', icone: '🪑', pergunta: 'Senti fraqueza', campos: [
      { id: 'sintoma', rotulo: 'O que senti?', tipo: 'escolha', obrigatorio: true,
        opcoes: [['fraqueza', 'Senti fraqueza'], ['quase_desmaio', 'Quase desmaiei']] },
      { id: 'medida', rotulo: 'Medimos a pressão?', curto: 'medimos a pressão', tipo: 'escolha', opcoes: SNN, detalhe: true },
      { id: 'sistolica', rotulo: 'Número de cima (mmHg)', tipo: 'numero', min: 40, max: 300, detalhe: true,
        mostrarSe: { campo: 'medida', valor: 'sim' } },
      { id: 'diastolica', rotulo: 'Número de baixo (mmHg)', tipo: 'numero', min: 20, max: 200, detalhe: true,
        mostrarSe: { campo: 'medida', valor: 'sim' } }
    ] },
    /* T-0035-1: só anota o que já foi aplicado. A unidade (U) é gravada junto, sem pedir toque.
       T-0036-1: nenhum campo é obrigatório; vários registros por dia, cada um com data e hora. */
    insulina: { nome: 'Insulina', icone: '💉', pergunta: 'Anotar a insulina que foi aplicada (tudo opcional)', campos: [
      { id: 'qual', rotulo: 'Qual insulina?', tipo: 'lista' },
      { id: 'quantidade', rotulo: 'Quantas unidades (U)?', curto: 'quantidade', tipo: 'numero', decimal: true,
        min: 0.5, max: 200 },
      { id: 'tipoInsulina', rotulo: 'Que tipo?', curto: 'tipo', tipo: 'escolha', detalhe: true,
        opcoes: [['basal', 'Basal (de base)'], ['rapida', 'Rápida (da refeição)']] }
    ] },
    glicose: { nome: 'Glicose', icone: '🩸', pergunta: 'Anotar o número que apareceu (tudo opcional)', campos: [
      { id: 'valor', rotulo: 'Número que apareceu (mg/dL)', tipo: 'numero', min: 20, max: 600,
        sufixo: 'mg/dL' },
      { id: 'momento', rotulo: 'Foi antes ou depois de comer? (opcional)', tipo: 'escolha',
        opcoes: [['antes', 'Antes de comer'], ['depois', 'Depois de comer']] },
      { id: 'origem', rotulo: 'De onde veio o número?', curto: 'origem', tipo: 'escolha', detalhe: true,
        opcoes: [['sensor', 'Sensor'], ['dedo', 'Ponta do dedo'], ['nao_sei', 'Não sei']] }
    ] }
  };
  var TIPOS = ['alimentacao', 'exercicio', 'emocao', 'sono', 'diferente', 'nausea', 'tontura', 'pressao', 'insulina', 'glicose'];
  var HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var UNIDADE_INSULINA = 'U';
  var MAX_NOMES = 12;

  function visivel(campo, entrada) {
    return !campo.mostrarSe || entrada[campo.mostrarSe.campo] === campo.mostrarSe.valor;
  }
  function vazio(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }

  /* entrada: objeto simples {campoId: valor}. Devolve {ok, dados, erros[]}
     Campo vazio de insulina/glicose nunca dá erro. Valor digitado fora da faixa de digitação ainda é recusado
     (evita erro de dedo, ex.: 4000), mas isso não é "obrigatório": basta apagar o campo para salvar. */
  function montarDados(tipo, entrada) {
    var esq = ESQUEMAS[tipo];
    if (!esq) return { ok: false, dados: {}, erros: ['tipo inválido'] };
    entrada = entrada || {};
    var dados = {}, erros = [];
    esq.campos.forEach(function (c) {
      if (!visivel(c, entrada)) return;
      var v = entrada[c.id];
      if (c.tipo === 'texto' || c.tipo === 'lista') v = typeof v === 'string' ? v.trim() : v;
      if (c.tipo === 'numero' && typeof v === 'string') {
        v = v.trim();
        if (c.decimal) v = v.replace(',', '.');
        v = v === '' ? undefined : Number(v);
      }
      if (c.tipo === 'itens') v = Array.isArray(v) ? v.map(function (s) { return String(s).trim(); }).filter(Boolean) : v;
      if (vazio(v)) { if (c.obrigatorio) erros.push('Falta: ' + c.rotulo); return; }
      if (c.tipo === 'escolha') {
        if (!c.opcoes.some(function (o) { return o[0] === v; })) { erros.push('Opção inválida: ' + c.rotulo); return; }
      } else if (c.tipo === 'numero') {
        var inteiroOk = Math.floor(v) === v;
        var umaCasaOk = Math.abs(Math.round(v * 10) - v * 10) < 1e-9; // até 1 casa depois da vírgula
        if (typeof v !== 'number' || !isFinite(v) || !(c.decimal ? umaCasaOk : inteiroOk) || v < c.min || v > c.max) {
          erros.push(c.rotulo + ': ' + (c.decimal
            ? 'use um número de ' + String(c.min).replace('.', ',') + ' a ' + c.max + ' (pode ter 1 casa, ex.: 2,5)'
            : 'use um número inteiro de ' + c.min + ' a ' + c.max));
          return;
        }
      } else if (c.tipo === 'texto') {
        if (typeof v !== 'string' || v.length > 300) { erros.push(c.rotulo + ': texto muito longo'); return; }
      } else if (c.tipo === 'lista') {
        if (typeof v !== 'string' || v.length > 60) { erros.push(c.rotulo + ': texto muito longo'); return; }
      } else if (c.tipo === 'hora') {
        if (!HORA_RE.test(v)) { erros.push(c.rotulo + ': hora inválida'); return; }
      } else if (c.tipo === 'itens') {
        if (v.length > 20 || v.some(function (s) { return s.length > 60; })) { erros.push('Muitos itens ou item muito longo'); return; }
      }
      dados[c.id] = v;
    });
    if (tipo === 'pressao' && dados.medida === 'sim') {
      if (dados.sistolica === undefined || dados.diastolica === undefined) erros.push('Falta: os dois números da pressão');
      else if (dados.diastolica >= dados.sistolica) erros.push('O número de baixo deve ser menor que o de cima');
    }
    if (tipo === 'insulina' && dados.quantidade !== undefined) dados.unidade = UNIDADE_INSULINA;
    return { ok: !erros.length, dados: dados, erros: erros };
  }

  function rotuloOpcao(c, v) {
    for (var i = 0; i < c.opcoes.length; i++) if (c.opcoes[i][0] === v) return c.opcoes[i][1];
    return String(v);
  }
  function numeroBr(v) { return String(v).replace('.', ','); }

  /* Texto curto para a lista do dia. Mostra só o que foi anotado, sem comentário. */
  function resumo(reg) {
    var esq = ESQUEMAS[reg.tipo];
    var d = reg.dados || {};
    if (!esq) return reg.tipo;
    var partes = [];
    esq.campos.forEach(function (c) {
      if (c.id === 'sistolica' || c.id === 'diastolica') return;
      var v = d[c.id];
      if (vazio(v)) return;
      var t = c.tipo === 'escolha' ? rotuloOpcao(c, v) : c.tipo === 'itens' ? v.join(', ')
        : c.tipo === 'numero' ? numeroBr(v) : String(v);
      if (reg.tipo === 'insulina' && c.id === 'quantidade') t += ' ' + (d.unidade || UNIDADE_INSULINA);
      else if (c.sufixo) t += ' ' + c.sufixo;
      partes.push(c.curto ? c.curto + ': ' + t : t);
    });
    if (reg.tipo === 'pressao') {
      partes.push(d.sistolica !== undefined && d.diastolica !== undefined
        ? 'pressão medida: ' + d.sistolica + '/' + d.diastolica + ' mmHg'
        : 'Sem medida de pressão registrada');
    }
    if (!partes.length && d.texto) partes.push(d.texto); // registros da base T-0031-2
    if (!partes.length && (reg.tipo === 'insulina' || reg.tipo === 'glicose')) partes.push('sem detalhes anotados');
    return esq.nome + (partes.length ? ': ' + partes.join(' — ') : '');
  }

  /* Lista editável de nomes de insulina (guardada no celular pela tela). Funções puras. */
  function limparNomes(lista) {
    var vistos = {}, saida = [];
    (Array.isArray(lista) ? lista : []).forEach(function (n) {
      if (typeof n !== 'string') return;
      var t = n.trim();
      if (!t || t.length > 60 || vistos[t.toLowerCase()] || saida.length >= MAX_NOMES) return;
      vistos[t.toLowerCase()] = true; saida.push(t);
    });
    return saida;
  }
  function adicionarNome(lista, nome) { return limparNomes((lista || []).concat([nome])); }
  function removerNome(lista, nome) {
    return limparNomes((lista || []).filter(function (n) { return String(n).toLowerCase() !== String(nome).trim().toLowerCase(); }));
  }

  /* Mantém o dia do registro e troca só a hora (HH:MM, hora local) */
  function combinarDataHora(baseIso, hhmm) {
    if (!HORA_RE.test(hhmm || '')) throw new Error('hora inválida');
    var d = new Date(baseIso);
    var p = hhmm.split(':');
    d.setHours(+p[0], +p[1], 0, 0);
    return d.toISOString();
  }
  /* T-0036-1: dia escolhido ('AAAA-MM-DD') + hora ('HH:MM'), hora local → ISO. Recusa data que não existe (ex.: 31/02). */
  function combinarDiaHora(dia, hhmm) {
    var m = DIA_RE.exec(dia || '');
    if (!m) throw new Error('data inválida');
    if (!HORA_RE.test(hhmm || '')) throw new Error('hora inválida');
    var a = +m[1], mes = +m[2], di = +m[3], p = hhmm.split(':');
    var d = new Date(a, mes - 1, di, +p[0], +p[1], 0, 0);
    if (d.getFullYear() !== a || d.getMonth() !== mes - 1 || d.getDate() !== di) throw new Error('data inválida');
    return d.toISOString();
  }
  /* Dia seguinte/anterior ('AAAA-MM-DD' + n dias), hora local */
  function somarDias(dia, n) {
    var m = DIA_RE.exec(dia || '');
    if (!m) throw new Error('data inválida');
    var d = new Date(+m[1], +m[2] - 1, +m[3] + n, 12, 0, 0, 0);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function horaLocal(iso) {
    var d = new Date(iso);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* O último registro = o criado por último (entre os não apagados) */
  function ultimoRegistro(lista) {
    var ult = null;
    (lista || []).forEach(function (r) {
      if (!ult || r.criadoEm > ult.criadoEm || (r.criadoEm === ult.criadoEm && r.dataHora > ult.dataHora)) ult = r;
    });
    return ult;
  }

  var api = { ESQUEMAS: ESQUEMAS, TIPOS: TIPOS, visivel: visivel, montarDados: montarDados, resumo: resumo,
    limparNomes: limparNomes, adicionarNome: adicionarNome, removerNome: removerNome,
    combinarDataHora: combinarDataHora, combinarDiaHora: combinarDiaHora, somarDias: somarDias,
    horaLocal: horaLocal, ultimoRegistro: ultimoRegistro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioRegistros = api;
})(typeof self !== 'undefined' ? self : globalThis);
