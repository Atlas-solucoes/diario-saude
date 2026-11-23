/* Teste do servidor da família NO CLOUDFLARE DE VERDADE (Worker e banco de TESTE, nunca o da família).
   Roda no GitHub Actions depois de publicar o Worker de teste. Lê API_TESTE e CODIGO_TESTE do ambiente.
   Simula 2 celulares: responsável (pai) e mãe. Sai com erro se qualquer passo falhar. Não imprime token nem código. */
const API = (process.env.API_TESTE || '').replace(/\/+$/, '');
const CODIGO = process.env.CODIGO_TESTE || '';
const ORIGEM = 'https://atlas-solucoes.github.io';
if (!API || !CODIGO) { console.error('Faltam API_TESTE ou CODIGO_TESTE'); process.exit(1); }

let falhas = 0;
function ok(cond, texto) { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + texto); if (!cond) falhas++; }
async function chamar(caminho, corpo, token, metodo = 'POST', origem = ORIGEM) {
  const h = { 'Content-Type': 'application/json' };
  if (origem) h.Origin = origem;
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + caminho, { method: metodo, headers: h, body: metodo === 'POST' ? JSON.stringify(corpo || {}) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, corpo: j, h: r.headers };
}
const agora = new Date().toISOString();
const reg = (id, extra) => Object.assign({ id, tipo: 'sono', dataHora: agora, dados: {}, anotadoPor: 'mae', sobre: 'acompanhada',
  versao: 1, criadoEm: agora, atualizadoEm: agora, apagado: false }, extra);

const pre = await chamar('/api/sync', null, null, 'OPTIONS');
ok(pre.status === 204 && pre.h.get('access-control-allow-origin') === ORIGEM, 'preflight CORS só para o app');
ok((await chamar('/api/sync', {}, null, 'POST', 'https://outro.site')).status === 403, 'outra origem recusada');
ok((await chamar('/api/responsavel', { codigo: 'errado' })).status === 401, 'código inicial errado recusado');
const resp = await chamar('/api/responsavel', { codigo: CODIGO, papel: 'pai', nome: 'teste' });
ok(resp.status === 200 && resp.corpo.responsavel === true, 'código inicial certo: vira responsável');
ok((await chamar('/api/responsavel', { codigo: CODIGO })).status === 409, 'o mesmo código não serve 2 vezes');
const pai = resp.corpo && resp.corpo.token;
const cv = await chamar('/api/convites', { papel: 'mae' }, pai);
ok(cv.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(cv.corpo.codigo), 'responsável cria convite');
const ent = await chamar('/api/entrar', { codigo: cv.corpo.codigo, nome: 'teste' });
ok(ent.status === 200 && ent.corpo.papel === 'mae', 'mãe entra com o convite');
ok((await chamar('/api/entrar', { codigo: cv.corpo.codigo })).status === 401, 'convite não serve 2 vezes');
const mae = ent.corpo && ent.corpo.token;
ok((await chamar('/api/convites', { papel: 'filha' }, mae)).status === 403, 'mãe não pode convidar');
const s1 = await chamar('/api/sync', { registros: [reg('teste-real-0001'), reg('teste-real-0002', { tipo: 'emocao', dados: { texto: 'oi' } })], desde: 0 }, mae);
ok(s1.status === 200 && s1.corpo.aceitos.length === 2, 'mãe envia 2 registros');
const s2 = await chamar('/api/sync', { desde: 0 }, pai);
ok(s2.status === 200 && s2.corpo.registros.length === 2, 'pai recebe os 2 registros');
await chamar('/api/sync', { registros: [reg('teste-real-0001', { versao: 2, dados: { qualidade: 'bem' } })] }, mae);
await chamar('/api/sync', { registros: [reg('teste-real-0001', { versao: 2, apagado: true })] }, pai);
const s3 = await chamar('/api/sync', { desde: 0 }, mae);
const fica = s3.corpo.registros.find((r) => r.id === 'teste-real-0001');
ok(fica && fica.apagado === true && fica.versao === 2, 'conflito: empate de versão, apagado vence');
ok((await chamar('/api/familia', { doc: { acompanhada: { apelido: 'Teste' }, familia: [] }, versao: 1 }, pai)).status === 200, 'responsável grava a família');
const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]).toString('base64');
ok((await chamar('/api/foto', { base64: jpeg, versao: 1 }, pai)).status === 200, 'responsável grava a foto');
const s4 = await chamar('/api/sync', { desde: s3.corpo.marca }, mae);
ok(s4.corpo.familia && s4.corpo.familia.doc.acompanhada.apelido === 'Teste' && s4.corpo.foto && s4.corpo.foto.mime === 'image/jpeg', 'mãe recebe família e foto');
const lista = await chamar('/api/aparelhos', {}, pai);
const dela = lista.corpo.aparelhos.find((a) => !a.esteCelular);
ok((await chamar('/api/aparelhos/revogar', { id: dela.id }, pai)).status === 200, 'responsável desconecta a mãe');
ok((await chamar('/api/sync', {}, mae)).status === 401, 'celular desconectado recebe 401');

console.log(falhas ? falhas + ' falha(s)' : 'Tudo certo no Cloudflare de verdade.');
process.exit(falhas ? 1 : 0);
