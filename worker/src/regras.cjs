/* Regra de conflito ÚNICA do Diário de Saúde, usada pelo app (navegador) e pelo servidor (Worker).
   O Worker usa uma cópia idêntica, worker/src/regras.cjs (um teste confere que são iguais, byte a byte).
   Conflito: vence a versão maior; no empate, apagado vence; depois, o mais novo (atualizadoEm). Empate total: fica o que já está. */
(function (root) {
  'use strict';
  function tempo(s) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }
  /* true se "novo" deve substituir "atual". */
  function vence(novo, atual) {
    if (!atual) return true;
    if (novo.versao !== atual.versao) return novo.versao > atual.versao;
    if (!!novo.apagado !== !!atual.apagado) return !!novo.apagado;
    return tempo(novo.atualizadoEm) > tempo(atual.atualizadoEm);
  }
  /* true se os dois são o mesmo conteúdo (reenvio): não duplica nem vai para o histórico. */
  function mesma(a, b) {
    return !!a && !!b && a.versao === b.versao && !!a.apagado === !!b.apagado && tempo(a.atualizadoEm) === tempo(b.atualizadoEm)
      && a.tipo === b.tipo && a.dataHora === b.dataHora && (a.anotadoPor || a.pessoa) === (b.anotadoPor || b.pessoa)
      && (a.sobre || 'acompanhada') === (b.sobre || 'acompanhada') && JSON.stringify(a.dados) === JSON.stringify(b.dados);
  }
  var api = { vence: vence, mesma: mesma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioRegras = api;
})(typeof self !== 'undefined' ? self : this);
