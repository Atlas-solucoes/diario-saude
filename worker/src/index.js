/* Diário de Saúde (Atlas Saúde): servidor da família no Cloudflare (Worker + banco D1). Uma família por instalação.
   Porta do servidor/nucleo.js com os ajustes do Engenheiro (ANALISE-SYNC.md, parecer de 22/11):
   S1 código inicial (24+), uso único por código, troca do código revoga o responsável antigo sozinha;
   S2 tentativas erradas no D1 (por IP com hash + teto global do código inicial); S3 papéis (só o responsável convida,
   lista e revoga; não revoga a si mesmo); S4 token de 32 bytes, só o SHA-256 no banco, busca por índice;
   S5 OPTIONS + CORS só para a origem exata; S6 limites de tamanho antes do JSON; S7 nenhum log de dado;
   Y1 seq reservado e gravado no MESMO db.batch() (transação); regra de conflito única (regras.cjs).
   Regra de ouro: o servidor só guarda e devolve. Não calcula, não classifica, não sugere. */
import regras from './regras.cjs';

const TIPOS = ['alimentacao', 'exercicio', 'emocao', 'sono', 'diferente', 'nausea', 'tontura', 'pressao', 'insulina', 'glicose', 'personalizado', 'emergencia'];
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;
const ID_PESSOA = /^[a-z0-9_-]{1,40}$/;
const LOTE_MAX = 200;
const PAGINA = 500;
const VALIDADE_CONVITE = 48 * 3600 * 1000;
const JANELA = 15 * 60 * 1000;
const MAX_ERROS = 10;
const MAX_ERROS_INICIAL_DIA = 30;
const CORPO_MAX = 1100 * 1024;
const DADOS_MAX = 5000;
const FOTO_MAX = 60 * 1024;
const FAMILIA_MAX = 64 * 1024;
const CODIGO_MIN = 24;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inteiro = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const emLista = (v, lista) => typeof v === 'string' && lista.indexOf(v) >= 0;
const dataOk = (s) => typeof s === 'string' && s.length <= 40 && !isNaN(Date.parse(s));
const so = (d, chaves) => Object.keys(d).every((k) => chaves.indexOf(k) >= 0);
const idPessoa = (v) => typeof v === 'string' && ID_PESSOA.test(v);

async function sha(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t)));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}
/* Compara dois hashes hex do mesmo tamanho sem sair cedo (tempo constante). */
function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function aleatorio(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function novoCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[b[i] % ALFABETO.length];
  return c;
}

/* ---------- validação (igual ao nucleo.js; mensagens não repetem o que chegou) ---------- */
export function validarDados(tipo, d) {
  if (!ehObjeto(d)) return 'dados deve ser um objeto';
  if (JSON.stringify(d).length > DADOS_MAX) return 'dados grandes demais';
  if (tipo === 'insulina') {
    if (!so(d, ['qual', 'quantidade', 'unidade', 'tipoInsulina'])) return 'insulina: campo não aceito';
    if (typeof d.qual !== 'string' || !d.qual.trim() || d.qual.length > 60) return 'insulina: informe qual (até 60 letras)';
    const q = d.quantidade;
    if (typeof q !== 'number' || !isFinite(q) || q < 0.5 || q > 200 || Math.abs(Math.round(q * 10) - q * 10) > 1e-9) {
      return 'insulina: a quantidade deve ser um número de 0,5 a 200, com até 1 casa';
    }
    if (d.unidade !== 'U') return 'insulina: a unidade deve ser U';
    if (d.tipoInsulina !== undefined && !emLista(d.tipoInsulina, ['basal', 'rapida'])) return 'insulina: tipo inválido';
  } else if (tipo === 'glicose') {
    if (!so(d, ['valor', 'momento', 'origem'])) return 'glicose: campo não aceito';
    if (!inteiro(d.valor, 20, 600)) return 'glicose: use um número inteiro de 20 a 600';
    if (d.momento !== undefined && !emLista(d.momento, ['antes', 'depois'])) return 'glicose: momento inválido';
    if (d.origem !== undefined && !emLista(d.origem, ['sensor', 'dedo', 'nao_sei'])) return 'glicose: origem inválida';
  } else if (tipo === 'emergencia') {
    // Botão "Não estou bem" (só no celular da paciente): pediu ajuda ou avisou que está bem.
    if (!so(d, ['estado', 'avisados'])) return 'emergência: campo não aceito';
    if (!emLista(d.estado, ['pediu', 'bem'])) return 'emergência: estado inválido';
    if (d.avisados !== undefined && !inteiro(d.avisados, 0, 20)) return 'emergência: avisados inválido';
  } else if (tipo === 'personalizado') {
    // Botão criado pela família: o esquema está no documento da família; aqui só a forma segura dos dados.
    if (typeof d.botao !== 'string' || !/^b-[a-z0-9]{6}$/.test(d.botao)) return 'botão inválido';
    const chaves = Object.keys(d).filter((k) => k !== 'botao');
    if (chaves.length > 8) return 'respostas demais';
    for (const k of chaves) {
      if (!/^q-[a-z0-9]{4,8}$/.test(k)) return 'pergunta inválida';
      const v = d[k];
      if (!((typeof v === 'string' && v.length <= 300) || (typeof v === 'number' && isFinite(v)))) return 'resposta inválida';
    }
  }
  return null;
}
export function validarRegistro(r) {
  if (!ehObjeto(r)) return 'registro inválido';
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return 'id inválido';
  if (!emLista(r.tipo, TIPOS)) return 'tipo inválido';
  const anot = r.anotadoPor !== undefined ? r.anotadoPor : r.pessoa;
  if (!idPessoa(anot)) return 'anotadoPor inválido';
  if (r.sobre !== undefined && !idPessoa(r.sobre)) return 'sobre inválido';
  if (!dataOk(r.dataHora) || !dataOk(r.atualizadoEm) || !dataOk(r.criadoEm)) return 'data inválida';
  if (!inteiro(r.versao, 1, 1000000)) return 'versão inválida';
  if (typeof r.apagado !== 'boolean') return 'apagado inválido';
  return validarDados(r.tipo, r.dados);
}
function limpar(r) {
  const anot = r.anotadoPor !== undefined ? r.anotadoPor : r.pessoa;
  return { id: r.id, tipo: r.tipo, dataHora: r.dataHora, dados: r.dados, anotadoPor: anot, pessoa: anot,
    sobre: r.sobre !== undefined ? r.sobre : 'acompanhada', versao: r.versao,
    modeloVersao: inteiro(r.modeloVersao, 1, 1000) ? r.modeloVersao : 3,
    criadoEm: r.criadoEm, atualizadoEm: new Date(Date.parse(r.atualizadoEm)).toISOString(), apagado: r.apagado };
}
function deLinha(x) {
  return { id: x.id, tipo: x.tipo, dataHora: x.data_hora, dados: JSON.parse(x.dados), anotadoPor: x.anotado_por,
    pessoa: x.anotado_por, sobre: x.sobre, versao: x.versao, modeloVersao: x.modelo_versao, criadoEm: x.criado_em,
    atualizadoEm: x.atualizado_em, apagado: x.apagado === 1 };
}
/* Foto: confere o tipo pelos primeiros bytes, não pelo que foi dito. */
function tipoDaImagem(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF'
    && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP') return 'image/webp';
  return null;
}

/* ---------- resposta e CORS ---------- */
function origensPermitidas(env) { return String(env.ORIGEM || '').split(',').map((s) => s.trim()).filter(Boolean); }
function cabecalhos(req, env) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  const o = req.headers.get('Origin');
  if (o && origensPermitidas(env).indexOf(o) >= 0) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

/* ---------- tentativas (S2) ---------- */
async function ipDe(req) { return sha('ip:' + (req.headers.get('CF-Connecting-IP') || 'desconhecido')); }
async function bloqueado(db, ip, tipo, agora) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM tentativas WHERE ip = ? AND em > ?').bind(ip, agora - JANELA).first();
  if (r && r.n >= MAX_ERROS) return true;
  if (tipo === 'inicial') {
    const g = await db.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE tipo = 'inicial' AND em > ?").bind(agora - 86400000).first();
    if (g && g.n >= MAX_ERROS_INICIAL_DIA) return true;
  }
  return false;
}
async function falhar(db, ip, tipo, agora) {
  await db.batch([
    db.prepare('INSERT INTO tentativas (ip, tipo, em) VALUES (?, ?, ?)').bind(ip, tipo, agora),
    db.prepare('DELETE FROM tentativas WHERE em < ?').bind(agora - 86400000)
  ]);
}

/* ---------- aparelho do token (S3, S4, S1) ---------- */
function codigoAtual(env) {
  const c = typeof env.CODIGO_INICIAL === 'string' ? env.CODIGO_INICIAL : '';
  return c.length >= CODIGO_MIN ? c : null;
}
async function aparelhoDe(db, env, auth) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(auth || '');
  if (!m) return null;
  const a = await db.prepare('SELECT id, papel, responsavel, nome, revogado, codigo_hash FROM aparelhos WHERE hash = ?').bind(await sha(m[1])).first();
  if (!a || a.revogado) return null;
  if (a.responsavel) {
    // Trocaram o código inicial: o responsável antigo deixa de valer sozinho.
    const atual = codigoAtual(env);
    if (!atual || !iguais(a.codigo_hash || '', await sha(atual))) return null;
  }
  return a;
}

/* ---------- condições de conflito em SQL (mesma regra de regras.cjs) ---------- */
// "novo vence atual": versão maior; empate: apagado vence; depois o mais novo (ms).
const NOVO_VENCE = '(?1 > versao OR (?1 = versao AND (?2 > apagado OR (?2 = apagado AND ?3 > atualizado_ms))))';
const MESMA = '(versao = ?1 AND apagado = ?2 AND atualizado_ms = ?3 AND tipo = ?4 AND data_hora = ?5 AND anotado_por = ?6 AND sobre = ?7 AND dados = ?8)';

async function sincronizar(db, corpo, aparelho, agoraIso) {
  const lista = corpo.registros === undefined ? [] : corpo.registros;
  if (!Array.isArray(lista) || lista.length > LOTE_MAX) return [400, { erro: 'lote inválido' }];
  if (corpo.desde !== undefined && !inteiro(corpo.desde, 0, Number.MAX_SAFE_INTEGER)) return [400, { erro: 'marca inválida' }];
  const aceitos = [], rejeitados = [], cmds = [];
  for (const bruto of lista) {
    const erro = validarRegistro(bruto);
    if (erro) { rejeitados.push({ id: bruto && typeof bruto.id === 'string' ? bruto.id.slice(0, 80) : null, erro }); continue; }
    const n = limpar(bruto);
    const ms = Date.parse(n.atualizadoEm), ap = n.apagado ? 1 : 0, dados = JSON.stringify(n.dados);
    const comp = [n.versao, ap, ms, n.tipo, n.dataHora, n.anotadoPor, n.sobre, dados];
    // Y1: tudo de um registro no mesmo batch (transação): reserva o seq, guarda quem perde e grava.
    cmds.push(db.prepare('UPDATE contador SET seq = seq + 1 WHERE id = 1'));
    // a versão guardada perde → vai para o histórico
    cmds.push(db.prepare(`INSERT INTO historico (rid, conteudo, em) SELECT id, json_object('id', id, 'tipo', tipo, 'dataHora', data_hora,
      'dados', json(dados), 'anotadoPor', anotado_por, 'sobre', sobre, 'versao', versao, 'atualizadoEm', atualizado_em, 'apagado', apagado),
      ?9 FROM registros WHERE id = ?10 AND ${NOVO_VENCE} AND NOT ${MESMA}`).bind(...comp, agoraIso, n.id));
    // a versão que chegou perde → também vai para o histórico (nada se perde)
    cmds.push(db.prepare(`INSERT INTO historico (rid, conteudo, em) SELECT ?10, ?11, ?9 WHERE EXISTS
      (SELECT 1 FROM registros WHERE id = ?10 AND NOT ${NOVO_VENCE} AND NOT ${MESMA})`).bind(...comp, agoraIso, n.id, JSON.stringify(n)));
    cmds.push(db.prepare(`INSERT INTO registros (id, tipo, data_hora, dados, anotado_por, sobre, versao, modelo_versao, criado_em,
      atualizado_em, atualizado_ms, apagado, seq, origem)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, (SELECT seq FROM contador WHERE id = 1), ?13)
      ON CONFLICT(id) DO UPDATE SET tipo = excluded.tipo, data_hora = excluded.data_hora, dados = excluded.dados,
        anotado_por = excluded.anotado_por, sobre = excluded.sobre, versao = excluded.versao, modelo_versao = excluded.modelo_versao,
        atualizado_em = excluded.atualizado_em, atualizado_ms = excluded.atualizado_ms, apagado = excluded.apagado,
        seq = excluded.seq, origem = excluded.origem
      WHERE excluded.versao > registros.versao OR (excluded.versao = registros.versao AND (excluded.apagado > registros.apagado
        OR (excluded.apagado = registros.apagado AND excluded.atualizado_ms > registros.atualizado_ms)))`)
      .bind(n.id, n.tipo, n.dataHora, dados, n.anotadoPor, n.sobre, n.versao, n.modeloVersao, n.criadoEm, n.atualizadoEm, ms, ap, aparelho.id));
    aceitos.push({ id: n.id, versao: n.versao });
  }
  if (cmds.length) await db.batch(cmds);
  const saida = { aceitos, rejeitados };
  if (corpo.desde !== undefined) {
    const r = await db.prepare(`SELECT id, tipo, data_hora, dados, anotado_por, sobre, versao, modelo_versao, criado_em, atualizado_em, apagado, seq
      FROM registros WHERE seq > ? ORDER BY seq LIMIT ?`).bind(corpo.desde, PAGINA + 1).all();
    const linhas = r.results || [];
    const pagina = linhas.slice(0, PAGINA);
    saida.registros = pagina.map(deLinha);
    saida.marca = pagina.length ? pagina[pagina.length - 1].seq : corpo.desde;
    saida.mais = linhas.length > PAGINA;
  }
  // Família e foto: só vão quando o celular tem versão menor.
  const fam = await db.prepare('SELECT doc, versao FROM familia WHERE id = 1').first();
  if (fam && !(inteiro(corpo.familiaVersao, 0, Number.MAX_SAFE_INTEGER) && corpo.familiaVersao >= fam.versao)) {
    saida.familia = { versao: fam.versao, doc: JSON.parse(fam.doc) };
  }
  const ft = await db.prepare('SELECT mime, base64, versao FROM foto WHERE id = 1').first();
  if (ft && !(inteiro(corpo.fotoVersao, 0, Number.MAX_SAFE_INTEGER) && corpo.fotoVersao >= ft.versao)) {
    saida.foto = { versao: ft.versao, mime: ft.mime, base64: ft.base64 };
  }
  return [200, saida];
}

async function tratar(req, env) {
  const db = env.DB;
  const agora = Date.now();
  const agoraIso = new Date(agora).toISOString();
  const tam = Number(req.headers.get('Content-Length') || 0);
  if (tam > CORPO_MAX) return [413, { erro: 'pedido grande demais' }];
  const bruto = await req.arrayBuffer();
  if (bruto.byteLength > CORPO_MAX) return [413, { erro: 'pedido grande demais' }];
  let corpo = {};
  if (bruto.byteLength) {
    try { corpo = JSON.parse(new TextDecoder().decode(bruto)); } catch (e) { return [400, { erro: 'JSON inválido' }]; }
  }
  if (!ehObjeto(corpo)) corpo = {};
  const caminho = new URL(req.url).pathname;
  const ip = await ipDe(req);

  if (caminho === '/api/responsavel') {
    const atual = codigoAtual(env);
    if (!atual) return [503, { erro: 'servidor sem código inicial configurado' }];
    if (await bloqueado(db, ip, 'inicial', agora)) return [429, { erro: 'muitas tentativas; tente mais tarde' }];
    const hAtual = await sha(atual);
    if (typeof corpo.codigo !== 'string' || !iguais(await sha(corpo.codigo), hAtual)) {
      await falhar(db, ip, 'inicial', agora);
      return [401, { erro: 'código errado' }];
    }
    const papel = idPessoa(corpo.papel) ? corpo.papel : 'pai';
    const token = aleatorio(32), id = aleatorio(6), lance = aleatorio(16);
    const nome = typeof corpo.nome === 'string' ? corpo.nome.slice(0, 40) : '';
    // Uso único por código: só um pedido "ganha" a linha do hash (INSERT OR IGNORE). Quem ganha revoga o responsável antigo.
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO reivindicacoes (codigo_hash, lance, em) VALUES (?, ?, ?)').bind(hAtual, lance, agoraIso),
      db.prepare('UPDATE aparelhos SET revogado = 1 WHERE responsavel = 1 AND (SELECT lance FROM reivindicacoes WHERE codigo_hash = ?1) = ?2')
        .bind(hAtual, lance),
      db.prepare(`INSERT INTO aparelhos (id, hash, papel, responsavel, nome, criado_em, revogado, codigo_hash)
        SELECT ?1, ?2, ?3, 1, ?4, ?5, 0, ?6 WHERE (SELECT lance FROM reivindicacoes WHERE codigo_hash = ?6) = ?7`)
        .bind(id, await sha(token), papel, nome, agoraIso, hAtual, lance)
    ]);
    const meu = await db.prepare('SELECT lance FROM reivindicacoes WHERE codigo_hash = ?').bind(hAtual).first();
    if (!meu || meu.lance !== lance) return [409, { erro: 'este código já foi usado; para trocar o responsável, troque o código no GitHub' }];
    return [200, { token, aparelhoId: id, papel, responsavel: true }];
  }

  if (caminho === '/api/entrar') {
    if (await bloqueado(db, ip, 'convite', agora)) return [429, { erro: 'muitas tentativas; tente mais tarde' }];
    const cod = String(corpo.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cv = cod.length === 8
      ? await db.prepare('UPDATE convites SET usado = 1 WHERE hash = ? AND usado = 0 AND expira > ? RETURNING papel').bind(await sha(cod), agora).first()
      : null;
    if (!cv) { await falhar(db, ip, 'convite', agora); return [401, { erro: 'convite inválido ou vencido' }]; }
    const token = aleatorio(32), id = aleatorio(6);
    await db.prepare('INSERT INTO aparelhos (id, hash, papel, responsavel, nome, criado_em, revogado) VALUES (?, ?, ?, 0, ?, ?, 0)')
      .bind(id, await sha(token), cv.papel, typeof corpo.nome === 'string' ? corpo.nome.slice(0, 40) : '', agoraIso).run();
    return [200, { token, aparelhoId: id, papel: cv.papel, responsavel: false }];
  }

  // Daqui para baixo: precisa de token válido.
  const ap = await aparelhoDe(db, env, req.headers.get('Authorization'));
  if (!ap) return [401, { erro: 'este celular foi desconectado', desconectado: true }];

  if (caminho === '/api/eu') return [200, { aparelhoId: ap.id, papel: ap.papel, responsavel: !!ap.responsavel }];
  // Sentinela (app Android): só a configuração da família (Ajustes → Família e Mensagens), para guardar e usar sem internet.
  if (caminho === '/api/config') {
    const fam = await db.prepare('SELECT doc, versao FROM familia WHERE id = 1').first();
    return [200, { familia: fam ? { versao: fam.versao, doc: JSON.parse(fam.doc) } : null }];
  }
  if (caminho === '/api/sync') return sincronizar(db, corpo, ap, agoraIso);

  // Só o responsável (S3).
  const soResponsavel = ['/api/convites', '/api/aparelhos', '/api/aparelhos/revogar', '/api/familia', '/api/foto'];
  if (soResponsavel.indexOf(caminho) >= 0 && !ap.responsavel) return [403, { erro: 'só o responsável pode fazer isso' }];

  if (caminho === '/api/convites') {
    if (!idPessoa(corpo.papel)) return [400, { erro: 'papel inválido' }];
    const cod = novoCodigo();
    await db.batch([
      db.prepare('DELETE FROM convites WHERE expira < ?').bind(agora),
      db.prepare('INSERT INTO convites (hash, papel, expira, usado) VALUES (?, ?, ?, 0)').bind(await sha(cod), corpo.papel, agora + VALIDADE_CONVITE)
    ]);
    return [201, { codigo: cod.slice(0, 4) + '-' + cod.slice(4), validoPorHoras: 48 }];
  }
  if (caminho === '/api/aparelhos') {
    const r = await db.prepare('SELECT id, papel, responsavel, nome, criado_em, revogado FROM aparelhos ORDER BY criado_em').all();
    return [200, { aparelhos: (r.results || []).map((a) => ({ id: a.id, papel: a.papel, responsavel: !!a.responsavel, nome: a.nome,
      criadoEm: a.criado_em, revogado: !!a.revogado, esteCelular: a.id === ap.id })) }];
  }
  if (caminho === '/api/aparelhos/revogar') {
    if (typeof corpo.id !== 'string') return [400, { erro: 'aparelho inválido' }];
    if (corpo.id === ap.id) return [400, { erro: 'o responsável não pode desconectar o próprio celular' }];
    const r = await db.prepare('UPDATE aparelhos SET revogado = 1 WHERE id = ? AND responsavel = 0').bind(corpo.id).run();
    if (!r.meta || !r.meta.changes) return [404, { erro: 'aparelho não encontrado' }];
    return [200, { ok: true }];
  }
  if (caminho === '/api/familia') {
    if (!ehObjeto(corpo.doc) || !inteiro(corpo.versao, 1, Number.MAX_SAFE_INTEGER)) return [400, { erro: 'família inválida' }];
    const doc = JSON.stringify(corpo.doc);
    if (doc.length > FAMILIA_MAX) return [413, { erro: 'família grande demais' }];
    const w = await db.prepare(`INSERT INTO familia (id, doc, versao, atualizado_em) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, versao = excluded.versao, atualizado_em = excluded.atualizado_em
      WHERE excluded.versao > familia.versao`).bind(doc, corpo.versao, agoraIso).run();
    const f = await db.prepare('SELECT versao FROM familia WHERE id = 1').first();
    return [200, { versao: f ? f.versao : 0, aceito: !!(w.meta && w.meta.changes) }];
  }
  if (caminho === '/api/foto') {
    if (!inteiro(corpo.versao, 1, Number.MAX_SAFE_INTEGER)) return [400, { erro: 'versão inválida' }];
    if (corpo.apagar === true) {
      const w = await db.prepare(`INSERT INTO foto (id, mime, base64, versao, atualizado_em) VALUES (1, '', '', ?1, ?2)
        ON CONFLICT(id) DO UPDATE SET mime = '', base64 = '', versao = ?1, atualizado_em = ?2 WHERE ?1 > foto.versao`).bind(corpo.versao, agoraIso).run();
      const fa = await db.prepare('SELECT versao FROM foto WHERE id = 1').first();
      return [200, { versao: fa ? fa.versao : 0, aceito: !!(w.meta && w.meta.changes) }];
    }
    if (typeof corpo.base64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(corpo.base64)) return [400, { erro: 'foto inválida' }];
    let bytes;
    try { bytes = Uint8Array.from(atob(corpo.base64), (c) => c.charCodeAt(0)); } catch (e) { return [400, { erro: 'foto inválida' }]; }
    if (bytes.length > FOTO_MAX) return [413, { erro: 'foto grande demais' }];
    const mime = tipoDaImagem(bytes);
    if (!mime) return [400, { erro: 'foto inválida' }];
    const w = await db.prepare(`INSERT INTO foto (id, mime, base64, versao, atualizado_em) VALUES (1, ?1, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET mime = ?1, base64 = ?2, versao = ?3, atualizado_em = ?4 WHERE ?3 > foto.versao`)
      .bind(mime, corpo.base64, corpo.versao, agoraIso).run();
    const fv = await db.prepare('SELECT versao FROM foto WHERE id = 1').first();
    return [200, { versao: fv ? fv.versao : 0, aceito: !!(w.meta && w.meta.changes) }];
  }
  return [404, { erro: 'não encontrado' }];
}

export default {
  async fetch(req, env) {
    const h = cabecalhos(req, env);
    const o = req.headers.get('Origin');
    if (o && origensPermitidas(env).indexOf(o) < 0) return new Response(JSON.stringify({ erro: 'origem não permitida' }), { status: 403, headers: h });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'método não permitido' }), { status: 405, headers: h });
    try {
      const [status, corpo] = await tratar(req, env);
      return new Response(JSON.stringify(corpo), { status, headers: h });
    } catch (e) {
      // S7: nada de corpo, token ou IP no log; só a mensagem curta.
      return new Response(JSON.stringify({ erro: 'erro interno' }), { status: 500, headers: h });
    }
  }
};
