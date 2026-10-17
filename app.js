'use strict';
// Modo web (publicado): config.js define window.TABLERO_WEB y los datos llegan de Supabase tras iniciar sesión.
// Modo local: datos/datos.js define window.TABLERO_DATOS.
const WEB = window.TABLERO_WEB || null;
let D = WEB ? null : window.TABLERO_DATOS;
let SB = null, YO = null;
const SEG = new Map();
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

// ------------------------------------------------------------------ utilidades
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOY = new Date(); HOY.setHours(0, 0, 0, 0);
const vacio = (v) => v === undefined || v === null || v === '' || /^(n\/?d|n\/?a|no aplica|no disponible|no detectad[ao]|undefined|-)$/i.test(String(v).trim());
const val = (v) => (vacio(v) ? null : v);
const fmt = (v) => (vacio(v) ? '<span class="muted">—</span>' : esc(v));
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; };
const fMes = (ym) => { if (!ym) return '—'; const [y, m] = ym.split('-'); return `${MESES_L[+m - 1]} ${y}`; };
const pct = (x) => { if (vacio(x)) return null; if (typeof x === 'number') return (x <= 1 ? +(x * 100).toFixed(2) : x) + ' %'; return String(x); };
function aFecha(v) {
  if (vacio(v)) return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(String(v));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
function memoria(v) {
  if (vacio(v)) return null;
  if (typeof v === 'number') return v >= 1024 ? (v / 1024).toFixed(0) + ' GB' : v + ' GB';
  return String(v);
}
const ORDEN = { rojo: 4, amarillo: 3, 'sin-datos': 1, desconocido: 1, verde: 2, null: 0 };
const ETQ = { rojo: 'Crítico', amarillo: 'Advertencia', verde: 'Saludable', 'sin-datos': 'Sin datos', desconocido: 'Sin calificar' };
const COLOR = { rojo: 'var(--crit)', amarillo: 'var(--warn)', verde: 'var(--good)', 'sin-datos': 'var(--none)', desconocido: 'var(--none)' };
const st = (c, txt) => c ? `<span class="st ${c}"><i></i>${esc(txt || ETQ[c])}</span>` : '<span class="muted">—</span>';
function normRate(v) {
  if (vacio(v)) return null;
  const s = String(v).toLowerCase();
  if (/red|rojo/.test(s)) return 'rojo';
  if (/yellow|amarillo/.test(s)) return 'amarillo';
  if (/green|verde/.test(s)) return 'verde';
  if (/no rating|undefined|sin/.test(s)) return 'sin-datos';
  return 'desconocido';
}
const CATS = ['Seguridad', 'Mantenimiento y versiones', 'Respaldo y recuperación', 'Base de datos', 'Rendimiento y capacidad', 'Operación y configuración'];
const KPI_EWA = {
  disponibilidad: 'Disponibilidad semanal', respDialogo: 'Resp. diálogo', respPicoDialogo: 'Resp. diálogo (pico)', respRFC: 'Resp. RFC',
  respPicoRFC: 'Resp. RFC (pico)', cpuApp: 'CPU máx. App', cpuBD: 'CPU máx. BD', bdDialogo: 'BD en diálogo', bdRFC: 'BD en RFC',
  bdUpdate: 'BD en update', tamanoBD: 'Tamaño BD', crecimientoBD: 'Crecimiento BD (mes)', usuariosActivos: 'Usuarios activos',
  usuariosFiori: 'Usuarios Fiori', pasosDialogoHora: 'Pasos diálogo/hora máx.', rfcHora: 'RFC/hora máx.',
};
const plural = (n, p, pl = p + 's') => `${n} ${n === 1 ? p : pl}`;
const num = (s) => { if (vacio(s)) return null; const m = /-?[\d.,]+/.exec(String(s)); return m ? parseFloat(m[0].replace(/,/g, '')) : null; };

// ------------------------------------------------------------------ aplicación (se arranca cuando hay datos)
function arrancar() {
// ------------------------------------------------------------------ modelo
const inv = D.inventario || { hosts: [], infra: [] };
const reportes = (D.reportes || []).filter((r) => r.sid);
const meses = [...new Set(reportes.map((r) => r.mes).filter(Boolean))].sort().reverse();
const familiaDe = (sid) => (D.familias && D.familias[sid]) || sid.slice(0, 2);
const nombreFam = (f) => (D.nombresFamilia && D.nombresFamilia[f]) || null;

const invPorSid = {};
for (const h of inv.hosts) (invPorSid[h.sid] ||= []).push(h);
const infraPorSid = {};
for (const h of inv.infra || []) if (h.sid && h.sid !== 'N/A') (infraPorSid[h.sid] ||= []).push(h);
const SIDS = [...new Set([...Object.keys(invPorSid), ...reportes.map((r) => r.sid)])].sort();

let estado = { mes: meses[0] || null };
try { const m = localStorage.getItem('tablero.mes'); if (m && meses.includes(m)) estado.mes = m; } catch {}

function primero(lista, campo) { for (const x of lista) if (!vacio(x[campo])) return x[campo]; return null; }

function sistema(sid, mes = estado.mes) {
  const todos = reportes.filter((r) => r.sid === sid);
  const delMes = todos.filter((r) => r.mes === mes);
  const hosts = invPorSid[sid] || [];
  const s = { sid, familia: familiaDe(sid), hosts, infra: infraPorSid[sid] || [], reportes: delMes, historia: todos };
  // Calificación: peor de los EWAs del mes; si no hay EWA, la del inventario.
  if (delMes.length) {
    s.calif = delMes.map((r) => r.calificacion).sort((a, b) => ORDEN[b] - ORDEN[a])[0];
    s.fuenteCalif = 'EWA';
  } else {
    s.calif = normRate(primero(hosts, 'ewaRate'));
    s.fuenteCalif = s.calif ? 'Inventario' : null;
  }
  const vistos = new Map();
  for (const r of delMes) for (const a of r.alertas || []) {
    const k = a.texto;
    if (!vistos.has(k)) vistos.set(k, { ...a, origen: [] });
    vistos.get(k).origen.push(r.tipo);
  }
  s.alertas = [...vistos.values()];
  s.prioritarias = s.alertas.filter((a) => a.prioritaria).length;
  const app = delMes.find((r) => /ABAP/.test(r.tipo)) || delMes.find((r) => /Aplicación/.test(r.tipo)) || delMes[0];
  s.principal = app || null;
  s.producto = (app && app.producto) || primero(hosts, 'producto') || '';
  s.version = primero(hosts, 'versionProducto');
  const AMB = { productive: 'Productivo', 'not productive': 'No productivo', test: 'Pruebas', development: 'Desarrollo' };
  const amb = primero(hosts, 'ambiente') || (app && app.estado) || null;
  s.ambiente = amb ? AMB[String(amb).toLowerCase()] || amb : null;
  s.kpis = Object.assign({}, ...delMes.filter((r) => r.kpis).map((r) => r.kpis).reverse());
  return s;
}
let CACHE = {};
const sis = (sid) => (CACHE[sid] ||= sistema(sid));

// ------------------------------------------------------------------ componentes
function kpi(lbl, v, foot, src) {
  return `<div class="card kpi"><div class="lbl">${esc(lbl)} ${src ? `<span class="src">${esc(src)}</span>` : ''}</div><div class="val">${v ?? '<span class="muted">—</span>'}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
}
function bars(items, max, total) {
  max = max || Math.max(1, ...items.map((i) => i.n));
  return `<div class="bars">${items.map((i) => `<div class="bar" data-tip="${esc(i.tip || i.t + ': ' + i.n)}"><div class="t" title="${esc(i.t)}">${i.href ? `<a href="${i.href}">${esc(i.t)}</a>` : esc(i.t)}</div><div class="track"><div class="fill" style="width:${(i.n / max) * 100}%"></div></div><div class="n">${i.n}</div></div>`).join('')}</div>`;
}
function tabla(id, cols, filas, opts = {}) {
  // cols: [{k, t, num, html:(fila)=>string, csv:(fila)=>string}]
  const st0 = TABLAS[id] || { orden: opts.orden || null, dir: opts.dir || 1 };
  TABLAS[id] = { cols, filas, st: st0 };
  let fs = filas.slice();
  if (st0.orden) {
    const c = cols.find((x) => x.k === st0.orden);
    const g = c && (c.sort || ((f) => f[c.k]));
    if (g) fs.sort((a, b) => { const x = g(a), y = g(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * st0.dir; });
  }
  const head = cols.map((c) => `<th data-t="${id}" data-k="${c.k}" style="${c.num ? 'text-align:right;' : ''}${c.w ? 'min-width:' + c.w + 'px' : ''}">${esc(c.t)}${st0.orden === c.k ? (st0.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = fs.length ? fs.map((f) => `<tr ${opts.fila ? opts.fila(f) : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(f) : fmt(f[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:24px">Sin registros</td></tr>`;
  return `<div class="tbl-wrap" id="tw-${id}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const TABLAS = {};
function csv(id, nombre) {
  const t = TABLAS[id]; if (!t) return;
  const limpia = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/&mdash;|—/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const filas = [t.cols.map((c) => c.t), ...t.filas.map((f) => t.cols.map((c) => (c.csv ? c.csv(f) : limpia(c.html ? c.html(f) : f[c.k]))))];
  const txt = '﻿' + filas.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const linkSid = (sid) => `<a href="#/sistema/${encodeURIComponent(sid)}"><b>${esc(sid)}</b></a>`;
const fHora = (t) => (t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
// En la versión web los EWAs originales no están publicados: solo se muestra el nombre del archivo.
const linkArchivo = (r) => !WEB && r.ruta && !/^[a-z][a-z0-9+.-]*:/i.test(r.ruta) ? `<a href="${esc(r.ruta.replace(/\\/g, '/'))}" target="_blank" rel="noopener" title="Abrir el EWA original">${esc(r.archivo)}</a>` : esc(r.archivo);

// Ciclo de vida: fechas de fin de soporte del inventario + fin de mantenimiento del EWA.
const EOL_CAMPOS = [['hwEolStd', 'Hardware', 'Estándar'], ['hwEolExt', 'Hardware', 'Extendido'], ['osEolStd', 'Sistema operativo', 'Estándar'], ['osEolExt', 'Sistema operativo', 'Extendido'], ['prodEolStd', 'Producto SAP', 'Estándar'], ['prodEolExt', 'Producto SAP', 'Extendido'], ['bdEolStd', 'Base de datos', 'Estándar'], ['bdEolExt', 'Base de datos', 'Extendido']];
function eolEstado(iso) {
  if (!iso) return null;
  const meses = (new Date(iso) - HOY) / (864e5 * 30.44);
  if (meses < 0) return { c: 'rojo', t: 'Vencido', m: meses };
  if (meses <= 6) return { c: 'rojo', t: '≤ 6 meses', m: meses };
  if (meses <= 18) return { c: 'amarillo', t: '6–18 meses', m: meses };
  return { c: 'verde', t: '> 18 meses', m: meses };
}
function eolDe(sid) {
  const s = sis(sid), out = [], vistos = new Set();
  for (const [k, comp, tipo] of EOL_CAMPOS) {
    for (const h of s.hosts) {
      const f = aFecha(h[k]); if (!f) continue;
      const clave = comp + tipo + f; if (vistos.has(clave)) continue; vistos.add(clave);
      const ref = comp === 'Hardware' ? h.hwDescripcion || h.hwTipo : comp === 'Sistema operativo' ? h.osVersion || h.so || h.os : comp === 'Base de datos' ? h.bd : [val(h.producto), val(h.versionProducto)].filter((x) => x != null).join(' · ') || null;
      out.push({ sid, componente: comp, tipo, fecha: f, ref: val(ref), fuente: 'Inventario', est: eolEstado(f) });
    }
  }
  for (const r of s.historia.filter((r) => r.finMantenimiento)) {
    const clave = 'EWA' + r.producto + r.finMantenimiento; if (vistos.has(clave)) continue; vistos.add(clave);
    out.push({ sid, componente: 'Producto SAP', tipo: 'Mainstream', fecha: r.finMantenimiento, ref: r.producto, fuente: 'EWA', est: eolEstado(r.finMantenimiento) });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ------------------------------------------------------------------ seguimiento de hallazgos (solo versión web)
const EST = { abierto: 'Abierto', en_atencion: 'En atención', resuelto: 'Resuelto', aceptado: 'Riesgo aceptado' };
const segDe = (sid, texto) => SEG.get(sid + '|' + texto);
const estadoSeg = (sid, texto) => (segDe(sid, texto) || {}).estado || 'abierto';
const puedeEditar = () => !!(YO && ['admin', 'editor'].includes(YO.rol));
function chipSeg(sid, a) {
  if (!WEB) return '';
  const s = segDe(sid, a.texto), e = (s && s.estado) || 'abierto';
  const tip = s ? `${EST[e]}${s.responsable ? ' · ' + s.responsable : ''}${s.fecha_compromiso ? ' · compromiso ' + fFecha(s.fecha_compromiso) : ''}\nActualizó ${s.actualizado_por} el ${new Date(s.actualizado_en).toLocaleString('es-MX')}${s.comentario ? '\n' + s.comentario : ''}` : 'Sin seguimiento registrado';
  return `<button type="button" class="pill seg seg-${e}" data-seg="${esc(sid)}" data-h="${esc(a.texto)}" data-tip="${esc(tip)}" ${puedeEditar() ? '' : 'disabled'}>${esc(EST[e])}${s && s.responsable ? ' · ' + esc(s.responsable) : ''}</button>`;
}
function editarSeg(sid, texto) {
  const s = segDe(sid, texto) || {};
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" id="fSeg" class="dlg-form">
    <div class="eyebrow">Seguimiento · ${esc(sid)}</div>
    <h2 style="margin:6px 0 4px">${esc(traduccionDe(texto))}</h2>
    <p class="muted small" style="margin:0 0 14px">${esc(texto)}</p>
    <label>Estado<select class="field" name="estado">${Object.entries(EST).map(([k, v]) => `<option value="${k}" ${k === (s.estado || 'abierto') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Responsable<input class="field" name="responsable" maxlength="120" value="${esc(s.responsable || '')}" placeholder="Nombre o equipo"></label>
    <label>Fecha compromiso<input class="field" type="date" name="fecha" value="${esc(s.fecha_compromiso || '')}"></label>
    <label>Comentario<textarea class="field" name="comentario" maxlength="2000" rows="4" placeholder="Acción tomada, ticket, justificación…">${esc(s.comentario || '')}</textarea></label>
    ${s.actualizado_por ? `<p class="muted small">Última actualización: ${esc(s.actualizado_por)} · ${esc(new Date(s.actualizado_en).toLocaleString('es-MX'))}</p>` : ''}
    <p class="msg small" id="segMsg"></p>
    <div class="toolbar" style="justify-content:flex-end;margin:0"><button class="btn" value="cancelar" formnovalidate>Cancelar</button><button class="btn primary" value="guardar" id="segGuardar">Guardar</button></div>
  </form>`;
  dlg.showModal();
  $('#segGuardar').addEventListener('click', async (e) => {
    e.preventDefault();
    const f = new FormData($('#fSeg'));
    const fila = { sid, hallazgo: texto, estado: f.get('estado'), responsable: (f.get('responsable') || '').trim() || null,
      fecha_compromiso: f.get('fecha') || null, comentario: (f.get('comentario') || '').trim() || null, actualizado_por: YO.email };
    $('#segGuardar').disabled = true;
    const { data, error } = await SB.from('tablero_seguimiento').upsert(fila, { onConflict: 'sid,hallazgo' }).select().single();
    if (error) { $('#segMsg').textContent = 'No se pudo guardar: ' + error.message; $('#segGuardar').disabled = false; return; }
    SEG.set(sid + '|' + texto, data);
    CACHE = {};
    dlg.close();
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
}
function traduccionDe(texto) {
  for (const r of reportes) for (const a of r.alertas || []) if (a.texto === texto) return a.es || a.generico;
  return texto;
}

// ------------------------------------------------------------------ puntaje de atención (0–100)
// Calificación (rojo 40 · amarillo 20 · sin calificación 10) + hallazgos prioritarios abiertos (6 c/u, máx 30)
// + otros hallazgos abiertos (1 c/u, máx 10) + peor fin de soporte estándar (vencido 20 · ≤6 m 12 · 6–18 m 5).
const PESO_CAL = { rojo: 40, amarillo: 20, 'sin-datos': 10, desconocido: 10, verde: 0 };
const grupoCal = (c) => (['rojo', 'amarillo', 'verde'].includes(c) ? c : 'sin-datos');
const abiertas = (s) => s.alertas.filter((a) => !['resuelto', 'aceptado'].includes(estadoSeg(s.sid, a.texto)));
function soportePeor(sid) {
  const e = eolDe(sid).filter((x) => x.tipo !== 'Extendido');
  return e.sort((a, b) => a.est.m - b.est.m)[0] || null;
}
function puntaje(s) {
  if (s._p) return s._p;
  const ab = abiertas(s), pr = ab.filter((a) => a.prioritaria).length, ot = ab.length - pr, sp = soportePeor(s.sid);
  const partes = [
    ['Calificación', PESO_CAL[s.calif] ?? 10],
    ['Hallazgos prioritarios', Math.min(30, pr * 6)],
    ['Otros hallazgos', Math.min(10, ot)],
    ['Fin de soporte', !sp ? 0 : sp.est.m < 0 ? 20 : sp.est.m <= 6 ? 12 : sp.est.m <= 18 ? 5 : 0],
  ];
  return (s._p = { total: Math.min(100, partes.reduce((a, [, n]) => a + n, 0)), partes, pr, ot, sp });
}
const nivel = (n) => (n >= 60 ? ['rojo', 'Alta'] : n >= 35 ? ['amarillo', 'Media'] : ['verde', 'Baja']);
const METODO = 'Puntaje de atención (0–100) = calificación EWA (crítico 40 · advertencia 20 · sin calificación 10) + hallazgos prioritarios abiertos (6 c/u, máx. 30) + otros hallazgos abiertos (1 c/u, máx. 10) + peor fin de soporte estándar (vencido 20 · ≤ 6 meses 12 · 6–18 meses 5). Los hallazgos marcados como resueltos o riesgo aceptado no suman.';

// ------------------------------------------------------------------ piezas visuales
const cnt = (n, dec = 0) => `<span data-cnt="${n}" data-dec="${dec}">0</span>`;
function anillo(n, grande) {
  const sz = grande ? 88 : 46, r = grande ? 38 : 19, c = 2 * Math.PI * r, [cl, t] = nivel(n);
  return `<div class="anillo ${grande ? 'g' : ''}" data-tip="Puntaje de atención ${n}/100 · prioridad ${t.toLowerCase()}"><svg viewBox="0 0 ${sz} ${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="var(--surface-3)"/><circle class="v" cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="${COLOR[cl]}" stroke-linecap="round" stroke-dasharray="0 ${c}" data-dash="${(c * n) / 100} ${c}"/></svg><b>${cnt(n)}</b></div>`;
}
function dona(segs, centro, etiqueta) {
  const r = 70, c = 2 * Math.PI * r, tot = segs.reduce((a, s) => a + s.n, 0) || 1, vis = segs.filter((s) => s.n);
  let off = 0;
  const arcos = vis.map((s) => {
    const len = (c * s.n) / tot, gap = vis.length > 1 ? 4 : 0;
    const el = `<circle class="seg" cx="88" cy="88" r="${r}" stroke="${s.color}" stroke-dasharray="0 ${c}" data-dash="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" data-tip="${esc(s.t)}: ${s.n} sistemas"/>`;
    off += len; return el;
  }).join('');
  return `<div class="dona"><svg viewBox="0 0 176 176"><circle cx="88" cy="88" r="${r}" stroke="var(--surface-3)"/>${arcos}</svg><div class="centro"><b>${cnt(centro)}</b><span>${esc(etiqueta)}</span></div></div>`;
}
const chipSid = (sid, extra = '') => { const s = sis(sid); return `<button type="button" class="chip" data-drawer="${esc(sid)}" data-tip="${esc(sid + ' · ' + (ETQ[s.calif] || 'Sin calificación') + (s.producto ? '\n' + s.producto : ''))}"><span class="d ${grupoCal(s.calif)}"></span>${esc(sid)}${extra}</button>`; };
const etqSoporte = (sp) => (!sp ? '—' : sp.est.m < 0 ? 'Vencido' : sp.est.m <= 6 ? '≤ 6 m' : sp.est.m <= 18 ? '6–18 m' : '> 18 m');
const qLink = (q, cambios) => { const p = new URLSearchParams(q); for (const [k, v] of Object.entries(cambios)) (v == null || v === '' ? p.delete(k) : p.set(k, v)); return p.toString(); };
const segm = (q, k, opciones) => `<div class="segm">${opciones.map(([v, t, n]) => `<button type="button" class="${(q.get(k) || '') === v ? 'on' : ''}" data-qk="${k}" data-qv="${esc(v)}">${esc(t)}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`;
const valorSrc = (v, src) => (v == null ? '<span class="muted">—</span>' : `${esc(v)} ${src ? `<span class="src">${esc(src)}</span>` : ''}`);

// indicadores combinados (EWA si existe; si no, inventario) — una sola fuente por valor
const IND = [
  ['disponibilidad', 'Disponibilidad semanal', 'dispSemanal', pct, (n) => n < 99],
  ['respDialogo', 'Resp. promedio diálogo', 'respDialogo', null, (n) => n > 1000],
  ['respRFC', 'Resp. promedio RFC', 'respRFC', null, (n) => n > 1000],
  ['cpuApp', 'CPU máx. servidor App', 'maxCpu', pct, (n) => n > 70],
  ['cpuBD', 'CPU máx. servidor BD', null, null, (n) => n > 70],
  ['tamanoBD', 'Tamaño de BD', 'tamanoBD', null, null],
  ['crecimientoBD', 'Crecimiento BD (mes)', 'crecimientoBD', null, null],
  ['usuariosActivos', 'Usuarios activos', 'usuariosActivos', null, null],
  ['respPicoDialogo', 'Diálogo en hora pico', null, null, (n) => n > 1000],
  ['respPicoRFC', 'RFC en hora pico', null, null, (n) => n > 1000],
  ['bdDialogo', 'Tiempo BD en diálogo', null, null, null],
  ['bdRFC', 'Tiempo BD en RFC', null, null, null],
  ['bdUpdate', 'Tiempo BD en update', null, null, null],
  ['pasosDialogoHora', 'Pasos diálogo/hora máx.', null, null, null],
  ['rfcHora', 'RFC/hora máx.', null, null, null],
  ['usuariosFiori', 'Usuarios Fiori', null, null, null],
  ['respHTTP', 'Resp. promedio HTTP', 'respHTTP', null, (n) => n > 1000],
  ['usuariosTotales', 'Usuarios totales', 'usuariosTotales', null, null],
  ['dumps', 'Dumps', 'dumpsSemana', null, null],
];
const CLAVE = ['disponibilidad', 'respDialogo', 'cpuApp', 'tamanoBD'];
function indicador(s, k) {
  const d = IND.find((x) => x[0] === k); if (!d) return { v: null };
  const e = val(s.kpis[k]); if (e != null) return { v: e, src: 'EWA', n: num(e), d };
  if (d[2]) { let i = val(primero(s.hosts, d[2])); if (i == null && k === 'dumps') i = val(primero(s.hosts, 'dumpsMes')); if (i != null) { if (d[3]) i = d[3](i); return { v: i, src: 'Inventario', n: num(i), d }; } }
  return { v: null, d };
}
const alto = (x) => x.v != null && x.d && x.d[4] && x.n != null && x.d[4](x.n);

// ------------------------------------------------------------------ vistas
const VISTAS = {};

VISTAS.panorama = () => {
  const lista = SIDS.map(sis);
  if (!lista.length) return `<div class="pagehead"><div><div class="eyebrow">Panorama</div><h1>Aún no hay datos publicados</h1>
    <p class="sub">${puedeEditar() ? 'Publica el archivo <span class="mono">datos/datos.json</span> desde <a href="#/publicar">Publicar datos</a>.' : 'El administrador todavía no ha publicado información.'}</p></div></div>`;
  const dist = [['rojo', 'Crítico'], ['amarillo', 'Advertencia'], ['verde', 'Saludable'], ['sin-datos', 'Sin calificación']].map(([c, t]) => ({ c, t, n: lista.filter((s) => grupoCal(s.calif) === c).length, color: COLOR[c] }));
  const conEwa = lista.filter((s) => s.reportes.length).length;
  const ab = lista.flatMap((s) => abiertas(s).map((a) => ({ s, a })));
  const prio = ab.filter((x) => x.a.prioritaria), sisPrio = new Set(prio.map((x) => x.s.sid)).size;
  const temas = CATS.map((c) => {
    const it = ab.filter((x) => x.a.categoria === c), por = {};
    for (const x of it) (por[x.a.es || x.a.generico] ||= new Set()).add(x.s.sid);
    const top = Object.entries(por).sort((a, b) => b[1].size - a[1].size)[0];
    return { c, n: new Set(it.map((x) => x.s.sid)).size, h: it.length, top: top && top[0], topN: top && top[1].size };
  }).filter((t) => t.n).sort((a, b) => b.n - a.n);
  const maxT = Math.max(1, ...temas.map((t) => t.n));
  const eol = SIDS.flatMap(eolDe).filter((e) => e.tipo !== 'Extendido' && e.est.m <= 6), eolSids = new Set(eol.map((e) => e.sid)).size;
  const rank = lista.map((s) => ({ s, p: puntaje(s) })).sort((a, b) => b.p.total - a.p.total || a.s.sid.localeCompare(b.s.sid));
  const altaN = rank.filter((x) => x.p.total >= 60).length;
  const resueltos = WEB ? lista.reduce((a, s) => a + s.alertas.length - abiertas(s).length, 0) : 0;
  const crit = dist[0].n, dom = temas[0];
  const pub = D.publicacion;
  return `
  <div class="card hero">
    <div>
      <div class="eyebrow">Estado del landscape · EWA ${esc(fMes(estado.mes))}</div>
      <h1>${crit ? `<span class="crit">${crit} ${crit === 1 ? 'sistema crítico' : 'sistemas críticos'}</span> y ` : ''}<em>${prio.length} hallazgos de atención prioritaria</em> en ${sisPrio} sistemas.${dom ? ` El riesgo dominante es <em>${esc(dom.c.toLowerCase())}</em>, presente en ${dom.n} sistemas.` : ''}</h1>
      <div class="hero-meta"><span><b>${SIDS.length}</b> sistemas monitoreados</span><span><b>${reportes.filter((r) => r.mes === estado.mes).length}</b> EarlyWatch Alerts del periodo</span><span><b>${inv.hosts.length}</b> servidores inventariados</span>${pub ? `<span>Publicado por <b>${esc(pub.publicado_por)}</b> · ${esc(fHora(pub.publicado_en))}</span>` : ''}</div>
    </div>
    <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
      ${dona(dist, SIDS.length, 'sistemas')}
      <div class="leyenda">${dist.map((d) => `<div class="lnk" data-href="#/sistemas?est=${d.c}">${st(d.c, d.t)}<b>${cnt(d.n)}</b></div>`).join('')}</div>
    </div>
  </div>

  <div class="grid g-kpi section">
    <div class="card kpi link" data-href="#/cobertura"><div class="lbl">Cobertura de EWA</div><div class="val">${cnt(Math.round((conEwa / SIDS.length) * 100))}<small>%</small></div><div class="foot">${conEwa} de ${SIDS.length} sistemas con EWA en el periodo</div><div class="prog"><span style="width:${(conEwa / SIDS.length) * 100}%"></span></div></div>
    <div class="card kpi link" data-href="#/hallazgos?prio=si"><div class="lbl">Hallazgos prioritarios abiertos</div><div class="val" style="color:var(--crit)">${cnt(prio.length)}</div><div class="foot">en ${sisPrio} sistemas${WEB ? ` · ${resueltos} resueltos o aceptados` : ''}</div></div>
    <div class="card kpi link" data-href="#/ciclo?e=riesgo"><div class="lbl">Soporte vencido o por vencer (≤ 6 meses)</div><div class="val" style="color:${eol.length ? 'var(--warn)' : 'var(--good)'}">${cnt(eol.length)}</div><div class="foot">componentes en ${eolSids} sistemas</div></div>
    <div class="card kpi link" data-href="#/sistemas?orden=puntaje"><div class="lbl">Sistemas con prioridad alta</div><div class="val">${cnt(altaN)}</div><div class="foot">puntaje de atención ≥ 60 de 100</div></div>
  </div>

  <div class="grid g12 section">
    <div class="card s7">
      <div class="card-h"><h2>Dónde actuar primero</h2><a href="#/sistemas?orden=puntaje" class="small">Ver los ${SIDS.length} sistemas →</a></div>
      <div class="rank">${rank.slice(0, 10).map((x, i) => `<div class="rank-row" data-drawer="${esc(x.s.sid)}">
        <span class="pos">${String(i + 1).padStart(2, '0')}</span>
        <div><div class="sid">${st(x.s.calif, ' ')}${esc(x.s.sid)}</div><div class="prod">${esc(x.s.producto || '—')}</div></div>
        <div class="pila" data-tip="${esc(x.p.partes.map(([t, n]) => `${t}: ${n}`).join('\n'))}">${x.p.partes.map(([, n], j) => (n ? `<span class="p${j + 1}" style="width:${n}%;animation-delay:${i * 40}ms"></span>` : '')).join('')}</div>
        <span class="score">${cnt(x.p.total)}</span></div>`).join('')}</div>
      <div class="ley-pila">${['Calificación', 'Hallazgos prioritarios', 'Otros hallazgos', 'Fin de soporte'].map((t, j) => `<span><i class="p${j + 1}"></i>${t}</span>`).join('')}</div>
    </div>
    <div class="card s5">
      <div class="card-h"><h2>Riesgo por tema</h2><span class="muted">sistemas afectados</span></div>
      ${temas.map((t, i) => `<div class="tema" data-href="#/hallazgos?cat=${encodeURIComponent(t.c)}" data-tip="${esc(`${t.c}: ${t.h} hallazgos abiertos en ${t.n} sistemas`)}">
        <div><div class="t1">${esc(t.c)}</div><div class="t2">${t.top ? `Principal: ${esc(t.top)} (${t.topN})` : ''}</div></div>
        <div class="barra"><span style="width:${(t.n / maxT) * 100}%;animation-delay:${i * 60}ms"></span></div><span class="n">${cnt(t.n)}</span></div>`).join('') || '<div class="empty">Sin hallazgos abiertos</div>'}
    </div>
  </div>
  <p class="metodo">${esc(METODO)}</p>`;
};

VISTAS.sistemas = (_, q) => {
  const todos = SIDS.map(sis);
  const tipoDe = (s) => (s.reportes.length ? [...new Set(s.reportes.map((r) => (/HANA/.test(r.tipo) ? 'HANA' : /Java/.test(r.tipo) ? 'Java' : /ABAP/.test(r.tipo) ? 'ABAP' : /Business/.test(r.tipo) ? 'BODS' : 'Otro')))] : []);
  const txt = (q.get('q') || '').toLowerCase(), est = q.get('est') || '', fuente = q.get('fuente') || '', vista = q.get('vista') || 'tarjetas', orden = q.get('orden') || 'puntaje';
  const pasa = (s, sinEst) => (!txt || (s.sid + ' ' + s.producto + ' ' + s.hosts.map((h) => h.hostname).join(' ')).toLowerCase().includes(txt))
    && (sinEst || !est || grupoCal(s.calif) === est) && (!fuente || (fuente === 'ewa' ? s.reportes.length : !s.reportes.length));
  const base = todos.filter((s) => pasa(s, true));
  const lista = base.filter((s) => pasa(s)).sort((a, b) => (orden === 'sid' ? a.sid.localeCompare(b.sid) : orden === 'hallazgos' ? abiertas(b).length - abiertas(a).length : puntaje(b).total - puntaje(a).total) || a.sid.localeCompare(b.sid));
  const n = (c) => base.filter((s) => grupoCal(s.calif) === c).length;
  const tarjeta = (s, i) => { const p = puntaje(s); return `<div class="tsis ${grupoCal(s.calif)}" data-drawer="${esc(s.sid)}" style="animation-delay:${Math.min(i, 30) * 18}ms">
      <div class="top1"><div style="min-width:0"><div class="sid">${esc(s.sid)}</div><div class="prod">${esc(s.producto || 'Producto no identificado')}</div><div style="margin-top:8px">${st(s.calif)}</div></div>${anillo(p.total)}</div>
      <div class="mini"><div><span>Prioritarios</span><b style="color:${p.pr ? 'var(--crit)' : 'inherit'}">${p.pr}</b></div><div><span>Hallazgos</span><b>${s.reportes.length ? abiertas(s).length : '—'}</b></div><div><span>Soporte</span><b>${etqSoporte(p.sp)}</b></div></div></div>`; };
  const maxC = Math.max(1, ...lista.flatMap((s) => CATS.map((c) => abiertas(s).filter((a) => a.categoria === c).length)));
  const heat = (k) => (k ? `<span class="celda-heat" style="background:color-mix(in oklab,var(--brand) ${Math.round(18 + (k / maxC) * 70)}%,var(--surface-2))">${k}</span>` : '<span class="muted">·</span>');
  return `<div class="pagehead"><div><div class="eyebrow">Sistemas · EWA ${esc(fMes(estado.mes))}</div><h1>${lista.length} de ${SIDS.length} sistemas</h1><p class="sub">Clic en un sistema para ver su resumen; desde ahí abres la ficha completa.</p></div>
    ${segm(q, 'vista', [['tarjetas', 'Tarjetas'], ['matriz', 'Matriz de riesgo']])}</div>
  <div class="card">
    <div class="toolbar">
      <input class="field" data-qtext="q" placeholder="Filtrar por SID, producto o host…" value="${esc(q.get('q') || '')}" style="min-width:250px">
      ${segm(q, 'est', [['', 'Todos', base.length], ['rojo', 'Crítico', n('rojo')], ['amarillo', 'Advertencia', n('amarillo')], ['verde', 'Saludable', n('verde')], ['sin-datos', 'Sin calificación', n('sin-datos')]])}
      ${segm(q, 'fuente', [['', 'Toda fuente'], ['ewa', 'Con EWA'], ['inv', 'Solo inventario']])}
      <span class="spacer"></span>
      <select class="field" data-qsel="orden"><option value="puntaje" ${orden === 'puntaje' ? 'selected' : ''}>Orden: puntaje de atención</option><option value="hallazgos" ${orden === 'hallazgos' ? 'selected' : ''}>Orden: hallazgos</option><option value="sid" ${orden === 'sid' ? 'selected' : ''}>Orden: SID</option></select>
    </div>
    ${!lista.length ? '<div class="empty">Ningún sistema coincide con el filtro</div>' : vista === 'matriz'
      ? tabla('matriz', [
        { k: 'sid', t: 'SID', html: (s) => `${st(s.calif, ' ')}<b>${esc(s.sid)}</b>`, sort: (s) => s.sid },
        { k: 'producto', t: 'Producto', w: 180 },
        { k: 'tipo', t: 'EWA', html: (s) => tipoDe(s).map((t) => `<span class="chip">${t}</span>`).join('') || '<span class="muted small">sin EWA</span>', csv: (s) => tipoDe(s).join(' + ') },
        { k: 'p', t: 'Puntaje', num: true, sort: (s) => puntaje(s).total, html: (s) => `<span class="bullet"><span class="b"><span style="width:${puntaje(s).total}%"></span></span><b>${puntaje(s).total}</b></span>`, csv: (s) => puntaje(s).total },
        ...CATS.map((c) => ({ k: 'c' + c, t: ({ 'Mantenimiento y versiones': 'Mantenim.', 'Respaldo y recuperación': 'Respaldo', 'Base de datos': 'Base datos', 'Rendimiento y capacidad': 'Rendim.', 'Operación y configuración': 'Operación' })[c] || c, num: true, sort: (s) => abiertas(s).filter((a) => a.categoria === c).length, html: (s) => heat(abiertas(s).filter((a) => a.categoria === c).length), csv: (s) => abiertas(s).filter((a) => a.categoria === c).length })),
        { k: 'sp', t: 'Soporte', html: (s) => { const sp = puntaje(s).sp; return sp ? st(sp.est.c, etqSoporte(sp)) : '<span class="muted">—</span>'; }, sort: (s) => (puntaje(s).sp ? puntaje(s).sp.est.m : 999), csv: (s) => etqSoporte(puntaje(s).sp) },
      ], lista, { orden: 'p', dir: -1, fila: (s) => `data-drawer="${esc(s.sid)}"` }) + `<div class="toolbar" style="margin:12px 0 0"><span class="muted small">Columnas de tema: hallazgos abiertos por categoría. Más oscuro = más hallazgos.</span><span class="spacer"></span><button class="btn" data-csv="matriz" data-n="matriz_riesgo">Exportar CSV</button></div>`
      : `<div class="tarjetas">${lista.map(tarjeta).join('')}</div>`}
  </div>
  <p class="metodo">${esc(METODO)}</p>`;
};

// ---------- ficha de sistema
function resumenSistema(s, compacto) {
  const p = puntaje(s), sp = p.sp;
  const kv = CLAVE.map((k) => ({ k, ...indicador(s, k) }));
  return `<div class="ikpi ${compacto ? 'c' : ''}">
    ${kv.map((x) => `<div style="background:var(--surface-2);border-radius:12px;padding:12px 14px"><div class="muted small">${esc(x.d[1])}</div><div style="font-size:${compacto ? 18 : 22}px;font-weight:700;margin-top:2px;color:${alto(x) ? 'var(--warn)' : 'inherit'}">${x.v != null ? esc(x.v) : '<span class="muted">—</span>'}</div>${x.src ? `<span class="src">${esc(x.src)}</span>` : ''}</div>`).join('')}
  </div>`;
}
VISTAS.sistema = (sid, q) => {
  sid = (sid || '').toUpperCase();
  if (!sid || !SIDS.includes(sid)) { location.replace('#/sistemas'); return ''; }
  const s = sis(sid), p = puntaje(s), sp = p.sp, ab = abiertas(s), t = q.get('t') || 'resumen';
  const rel = SIDS.filter((x) => x !== sid && familiaDe(x) === s.familia);
  const eol = eolDe(sid);
  const tipos = [...new Set(s.reportes.map((r) => r.tipo))];
  const pestañas = [['resumen', 'Resumen'], ['hallazgos', 'Hallazgos', ab.length], ['rendimiento', 'Rendimiento'], ['infraestructura', 'Infraestructura', s.hosts.length + s.infra.length || null], ['ciclo', 'Ciclo de vida', eol.length || null], ['reportes', 'Reportes EWA', s.historia.length || null]];
  const generales = [
    ['Ambiente', s.ambiente], ['Despliegue', primero(s.hosts, 'despliegue')], ['Versión', s.version],
    ['NetWeaver', primero(s.hosts, 'versionNW')], ['Kernel', primero(s.hosts, 'kernel')],
    ['Base de datos', val(primero(s.hosts, 'bd')) || (s.principal && s.principal.baseDatos)],
    ['Sistema operativo', val(primero(s.hosts, 'osVersion')) || val(primero(s.hosts, 'so')) || s.reportes.flatMap((r) => r.so || [])[0]],
    ['Hardware', val(primero(s.hosts, 'hwTipo')) || val(primero(s.hosts, 'hwDescripcion'))],
    ['Servidores App / BD', [val(primero(s.hosts, 'servidoresApp')), val(primero(s.hosts, 'servidoresBD'))].filter((x) => x != null).join(' / ')],
    ['Periodo EWA', s.principal ? `${fFecha(s.principal.desde)} – ${fFecha(s.principal.hasta)}` : null],
    ['Landscape', nombreFam(s.familia)],
  ].filter(([, v]) => val(v) != null);
  let cuerpo = '';
  if (t === 'resumen') {
    cuerpo = `${!s.reportes.length ? `<div class="note" style="margin-bottom:16px">Sin EarlyWatch Alert de <b>${esc(sid)}</b> en ${esc(fMes(estado.mes))}: calificación e indicadores provienen del inventario.</div>` : ''}
    <div class="grid g12">
      <div class="card s7"><div class="card-h"><h2>Indicadores clave</h2><a href="#/sistema/${esc(sid)}?t=rendimiento" class="small">Todos los indicadores →</a></div>${resumenSistema(s)}
        <div class="atajos">
          <a class="atajo" href="#/sistema/${esc(sid)}?t=hallazgos"><div><div class="muted">Hallazgos abiertos</div><span class="small" style="color:var(--crit)">${p.pr} prioritarios</span></div><b>${cnt(ab.length)}</b></a>
          <a class="atajo" href="#/sistema/${esc(sid)}?t=ciclo"><div><div class="muted">Soporte más próximo</div><span class="small">${sp ? esc(sp.componente) + ' · ' + fFecha(sp.fecha) : 'Sin fechas'}</span></div><b style="font-size:15px">${sp ? st(sp.est.c, sp.est.t) : '—'}</b></a>
          <a class="atajo" href="#/sistema/${esc(sid)}?t=infraestructura"><div><div class="muted">Servidores</div><span class="small">${s.infra.length ? s.infra.length + ' de infraestructura' : 'inventario'}</span></div><b>${cnt(s.hosts.length)}</b></a>
        </div></div>
      <div class="card s5"><div class="card-h"><h2>Datos generales</h2></div>
        ${generales.length ? `<div class="dl">${generales.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : '<div class="empty">Sin datos generales en el inventario</div>'}
        ${rel.length ? `<div style="margin-top:16px"><div class="muted small" style="margin-bottom:4px">Mismo landscape</div>${rel.map((x) => chipSid(x)).join('')}</div>` : ''}
      </div>
    </div>
    ${val(primero(s.hosts, 'comentarios')) ? `<div class="note section"><b>Comentarios del inventario:</b> ${esc(primero(s.hosts, 'comentarios'))}</div>` : ''}`;
  } else if (t === 'hallazgos') {
    const porCat = CATS.map((c) => ({ c, a: s.alertas.filter((x) => x.categoria === c).sort((x, y) => (y.prioritaria ? 1 : 0) - (x.prioritaria ? 1 : 0)) })).filter((x) => x.a.length);
    cuerpo = `<div class="card">${porCat.length ? porCat.map((g) => `<div class="card-h" style="margin:${g === porCat[0] ? 0 : 18}px 0 2px"><h3>${esc(g.c)}</h3><span class="pill">${g.a.length}</span></div>
      ${g.a.map((a) => { const cerrado = ['resuelto', 'aceptado'].includes(estadoSeg(sid, a.texto)); return `<div class="fila-h" style="${cerrado ? 'opacity:.55' : ''}"><span class="dot ${a.prioritaria ? 'p' : ''}" title="${a.prioritaria ? 'Atención prioritaria' : 'Advertencia'}"></span>
        <div>${esc(a.es || a.generico)}${a.objeto ? ` <span class="chip mono">${esc(a.objeto)}</span>` : ''}${a.es ? `<details class="en" style="padding-left:0"><summary>Texto original del EWA</summary>${esc(a.generico)}</details>` : ''}</div>
        <div>${chipSeg(sid, a)}</div></div>`; }).join('')}`).join('') : `<div class="empty">${s.reportes.length ? 'El EWA no reporta hallazgos' : 'Sin EWA en el periodo'}</div>`}</div>`;
  } else if (t === 'rendimiento') {
    const filas = IND.filter(([k]) => !CLAVE.includes(k)).map(([k]) => ({ k, ...indicador(s, k) })).filter((x) => x.v != null);
    const med = (k) => { const v = SIDS.map((x) => indicador(sis(x), k).n).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    cuerpo = `<div class="card"><div class="card-h"><h2>Indicadores de rendimiento</h2><span class="muted">los 4 indicadores clave están en Resumen · comparación contra la mediana del landscape</span></div>
      ${filas.length ? `<div class="tbl-wrap"><table><thead><tr><th>Indicador</th><th style="text-align:right">Valor</th><th>Fuente</th><th style="text-align:right">Mediana landscape</th><th style="text-align:right">vs. mediana</th></tr></thead><tbody>
      ${filas.map((x) => { const m = med(x.k), r = m && x.n != null ? x.n / m : null; return `<tr><td>${esc(x.d[1])}</td><td class="num" style="color:${alto(x) ? 'var(--warn)' : 'inherit'}"><b>${esc(x.v)}</b></td><td><span class="src">${esc(x.src)}</span></td><td class="num muted">${m != null ? m.toLocaleString('es-MX') : '—'}</td><td class="num">${r != null ? `<span class="bullet ${r > 1.5 ? 'alto' : ''}"><span class="b"><span style="width:${Math.min(100, r * 50)}%"></span></span>${r.toFixed(1)}×</span>` : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">Sin indicadores adicionales para este sistema</div>'}</div>`;
  } else if (t === 'infraestructura') {
    const ewaHosts = [...new Set(s.reportes.flatMap((r) => r.hosts || []))].filter((h) => !s.hosts.some((x) => String(x.hostname || '').toLowerCase() === h));
    cuerpo = `${s.hosts.length ? `<div class="card"><div class="card-h"><h2>Servidores del inventario</h2><span class="muted">${s.hosts.length}</span></div>${tabla('hosts-' + sid, [
        { k: 'hostname', t: 'Host', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>${h.componente ? ` <span class="chip">${esc(h.componente)}</span>` : ''}` }, { k: 'ip', t: 'IP', html: (h) => `<span class="mono">${fmt(h.ip)}</span>` },
        { k: 'cpu', t: 'CPU' }, { k: 'memoria', t: 'Memoria', html: (h) => fmt(memoria(h.memoria)), sort: (h) => num(h.memoria) },
        { k: 'osVersion', t: 'Sistema operativo', html: (h) => fmt(val(h.osVersion) || h.so) }, { k: 'hwTipo', t: 'Hardware', html: (h) => fmt(val(h.hwTipo) || h.hwDescripcion) },
      ], s.hosts)}</div>` : ''}
      ${ewaHosts.length ? `<div class="card section"><div class="card-h"><h2>Hosts reportados por el EWA</h2><span class="muted">no registrados en el inventario</span></div>${ewaHosts.map((h) => `<span class="chip mono">${esc(h)}</span>`).join('')}</div>` : ''}
      ${s.infra.length ? `<div class="card section"><div class="card-h"><h2>Infraestructura asociada</h2><span class="muted">${s.infra.length}</span></div>${tabla('infra-' + sid, [{ k: 'hostname', t: 'Host', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>` }, { k: 'ip', t: 'IP' }, { k: 'tipo', t: 'Tipo' }, { k: 'so', t: 'SO' }, { k: 'ramMB', t: 'RAM', html: (h) => fmt(memoria(h.ramMB)) }, { k: 'ubicacion', t: 'Ubicación' }, { k: 'descripcion', t: 'Descripción', w: 240 }], s.infra)}</div>` : ''}
      ${!s.hosts.length && !ewaHosts.length && !s.infra.length ? '<div class="card empty">Sin servidores registrados</div>' : ''}`;
  } else if (t === 'ciclo') {
    cuerpo = `<div class="card">${eol.length ? lineaTiempo(eol, true) + `<div class="section">${tabla('eol-' + sid, [{ k: 'componente', t: 'Componente' }, { k: 'ref', t: 'Referencia', w: 220 }, { k: 'tipo', t: 'Soporte' }, { k: 'fecha', t: 'Fecha', html: (e) => fFecha(e.fecha) }, { k: 'est', t: 'Estado', html: (e) => st(e.est.c, e.est.t), sort: (e) => e.est.m }, { k: 'fuente', t: 'Fuente' }], eol, { orden: 'fecha' })}</div>` : '<div class="empty">Sin fechas de fin de soporte registradas</div>'}
      ${['mesesSinKernel', 'mesesSinComponentes', 'mesesSinBD'].some((x) => val(primero(s.hosts, x)) != null) ? `<div class="dl section"><div><span>Meses sin actualizar kernel</span><b>${fmt(primero(s.hosts, 'mesesSinKernel'))}</b></div><div><span>Meses sin actualizar componentes</span><b>${fmt(primero(s.hosts, 'mesesSinComponentes'))}</b></div><div><span>Meses sin actualizar BD</span><b>${fmt(primero(s.hosts, 'mesesSinBD'))}</b></div></div>` : ''}</div>`;
  } else {
    const porMes = {}; for (const r of s.historia) (porMes[r.mes] ||= []).push(r);
    const areas = {}; for (const r of s.reportes) for (const a of r.areas || []) { const k = a.tema.replace(new RegExp(`\\b${sid}\\b`, 'g'), '').trim(); (areas[k] ||= new Set()); for (const x of a.sub) areas[k].add(x); }
    cuerpo = `<div class="card"><div class="card-h"><h2>Reportes del periodo</h2><span class="muted">aplicación y bases de datos HANA</span></div>${s.reportes.length ? tabla('rep-' + sid, [
        { k: 'tipo', t: 'Tipo' }, { k: 'producto', t: 'Producto' }, { k: 'baseDatos', t: 'Base de datos' },
        { k: 'periodo', t: 'Periodo', html: (r) => `${fFecha(r.desde)} – ${fFecha(r.hasta)}`, sort: (r) => r.desde },
        { k: 'calificacion', t: 'Calificación', html: (r) => st(r.calificacion), sort: (r) => -ORDEN[r.calificacion] },
        { k: 'alertas', t: 'Hallazgos', num: true, html: (r) => r.alertas.length, sort: (r) => r.alertas.length },
        { k: 'archivo', t: 'Archivo', html: (r) => linkArchivo(r) + (r.duplicados ? `<div class="muted small">duplicados: ${esc(r.duplicados.join(', '))}</div>` : '') },
      ], s.reportes) : '<div class="empty">Sin EWA en el periodo</div>'}</div>
      <div class="grid g-2 section">
        <div class="card"><div class="card-h"><h2>Histórico mensual</h2></div>${Object.keys(porMes).length ? `<div class="tbl-wrap"><table><thead><tr><th>Mes</th><th>Calificación</th><th style="text-align:right">Hallazgos</th></tr></thead><tbody>${Object.keys(porMes).sort().reverse().map((m) => { const x = sistema(sid, m); return `<tr><td>${esc(fMes(m))}</td><td>${st(x.calif)}</td><td class="num">${x.alertas.length}</td></tr>`; }).join('')}</tbody></table></div>${Object.keys(porMes).length === 1 ? '<p class="muted small">La tendencia aparecerá al publicar los EWAs de los siguientes meses.</p>' : ''}` : '<div class="empty">Sin EWAs</div>'}</div>
        <div class="card"><div class="card-h"><h2>Áreas revisadas por el EWA</h2></div>${Object.keys(areas).length ? Object.entries(areas).map(([k, v]) => `<details style="margin-bottom:6px"><summary><b class="small">${esc(k)}</b> <span class="muted small">${v.size}</span></summary><div style="margin-top:6px">${[...v].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></details>`).join('') : '<div class="empty">Sin detalle</div>'}</div>
      </div>`;
  }
  return `<div class="card ficha-h">
      <div style="min-width:0"><div class="eyebrow"><a href="#/sistemas" style="color:inherit">Sistemas</a> · EWA ${esc(fMes(estado.mes))}</div>
        <div class="sidbig" style="margin-top:8px">${esc(sid)}</div>
        <div class="prodl">${esc(s.producto || 'Producto no identificado')}</div>
        <div class="chips">${st(s.calif)} <span class="muted small">· fuente ${esc(s.fuenteCalif || '—')}</span> ${tipos.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>
      <div class="ficha-score">${anillo(p.total, true)}<div class="desg"><div><span class="muted">Prioridad de atención</span><b>${nivel(p.total)[1]}</b></div>${p.partes.map(([k, n]) => `<div><span class="muted">${esc(k)}</span><b>${n}</b></div>`).join('')}</div></div>
    </div>
    <nav class="ftabs">${pestañas.map(([k, txt, n]) => `<a href="#/sistema/${esc(sid)}?t=${k}" class="${t === k ? 'on' : ''}">${txt}${n ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</nav>
    ${cuerpo}`;
};

// ---------- panel lateral (vista rápida)
function contenidoDrawer(sid) {
  const s = sis(sid), p = puntaje(s), ab = abiertas(s);
  const top = ab.filter((a) => a.prioritaria).concat(ab.filter((a) => !a.prioritaria)).slice(0, 4);
  return `<button class="btn cerrar" data-cerrar aria-label="Cerrar">✕</button>
    <div class="eyebrow">Vista rápida</div>
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:8px">
      <div><div style="font-size:34px;font-weight:800;letter-spacing:.02em">${esc(sid)}</div><div class="muted">${esc(s.producto || '—')}</div><div style="margin-top:6px">${st(s.calif)} <span class="muted small">· ${esc(s.fuenteCalif || 'sin fuente')}</span></div></div>
      ${anillo(p.total, true)}
    </div>
    <div class="pila" style="margin:16px 0 6px" data-tip="${esc(p.partes.map(([t, n]) => `${t}: ${n}`).join('\n'))}">${p.partes.map(([, n], j) => (n ? `<span class="p${j + 1}" style="width:${n}%"></span>` : '')).join('')}</div>
    <div class="ley-pila" style="margin-top:4px">${p.partes.map(([t, n], j) => `<span><i class="p${j + 1}"></i>${esc(t)} ${n}</span>`).join('')}</div>
    <h3 style="margin:20px 0 8px">Indicadores clave</h3>${resumenSistema(s, true)}
    <h3 style="margin:20px 0 4px">Hallazgos a atender <span class="muted small">(${ab.length} abiertos · ${p.pr} prioritarios)</span></h3>
    ${top.length ? top.map((a) => `<div class="fila-h"><span class="dot ${a.prioritaria ? 'p' : ''}"></span><div class="small">${esc(a.es || a.generico)}</div><span></span></div>`).join('') : `<div class="muted small">${s.reportes.length ? 'Sin hallazgos abiertos' : 'Sin EWA en el periodo'}</div>`}
    <h3 style="margin:20px 0 6px">Soporte más próximo</h3>
    ${p.sp ? `<div class="small">${st(p.sp.est.c, p.sp.est.t)} · ${esc(p.sp.componente)} ${p.sp.ref ? '· ' + esc(p.sp.ref) : ''} · ${fFecha(p.sp.fecha)}</div>` : '<div class="muted small">Sin fechas registradas</div>'}
    <a class="btn primary" style="margin-top:24px;width:100%;justify-content:center;height:42px" href="#/sistema/${esc(sid)}">Abrir ficha completa →</a>`;
}

// ---------- hallazgos agrupados por tema
VISTAS.hallazgos = (_, q) => {
  const inst = [];
  for (const sid of SIDS) { const s = sis(sid); for (const a of s.alertas) inst.push({ sid, calif: s.calif, ...a, seg: estadoSeg(sid, a.texto) }); }
  const cat = q.get('cat') || '', pr = q.get('prio') || '', sg = q.get('seg') || '', txt = (q.get('q') || '').toLowerCase(), vista = q.get('vista') || 'temas';
  const pasa = (x, sinCat) => (sinCat || !cat || x.categoria === cat) && (!pr || (pr === 'si') === x.prioritaria) && (!sg || x.seg === sg)
    && (!txt || (x.sid + ' ' + x.texto + ' ' + (x.es || '') + ' ' + ((segDe(x.sid, x.texto) || {}).responsable || '')).toLowerCase().includes(txt));
  const base = inst.filter((x) => pasa(x, true)), f = base.filter((x) => pasa(x));
  const grupos = {};
  for (const x of f) { const k = x.generico; (grupos[k] ||= { k, es: x.es, categoria: x.categoria, prioritaria: x.prioritaria, items: [] }).items.push(x); }
  const lista = Object.values(grupos).sort((a, b) => (b.prioritaria - a.prioritaria) || (new Set(b.items.map((i) => i.sid)).size - new Set(a.items.map((i) => i.sid)).size));
  const nCat = (c) => new Set(base.filter((x) => !c || x.categoria === c).map((x) => x.generico)).size;
  const colorSeg = { abierto: 'var(--surface-3)', en_atencion: 'var(--brand)', resuelto: 'var(--good)', aceptado: 'var(--muted)' };
  const tarjeta = (g, i) => {
    const sids = [...new Set(g.items.map((x) => x.sid))];
    const est = Object.keys(EST).map((k) => [k, g.items.filter((x) => x.seg === k).length]);
    return `<div class="hgrupo" style="animation-delay:${Math.min(i, 20) * 25}ms">
      <div class="h1r"><span class="ico ${g.prioritaria ? 'p' : ''}">${g.prioritaria ? '!' : '•'}</span>
        <div><div class="tt">${esc(g.es || g.k)}</div><div class="meta"><span>${esc(g.categoria)}</span><span>${g.prioritaria ? '<span style="color:var(--crit)">Atención prioritaria</span>' : 'Advertencia'}</span>${g.items.length > sids.length ? `<span>${g.items.length} objetos (tenants / componentes)</span>` : ''}</div></div>
        <div class="cnt"><b>${cnt(sids.length)}</b><span>${sids.length === 1 ? 'sistema' : 'sistemas'}</span>${WEB ? `<div class="seguir" data-tip="${esc(est.map(([k, n]) => `${EST[k]}: ${n}`).join('\n'))}">${est.map(([k, n]) => (n ? `<span style="width:${(n / g.items.length) * 100}%;background:${colorSeg[k]}"></span>` : '')).join('')}</div>` : ''}</div></div>
      <div class="sids">${sids.map((sid) => { const it = g.items.find((x) => x.sid === sid); const marca = WEB && it.seg !== 'abierto' ? (it.seg === 'resuelto' ? ' ✓' : it.seg === 'aceptado' ? ' ⊘' : ' ◔') : '';
        return puedeEditar() ? `<button type="button" class="chip" data-seg="${esc(sid)}" data-h="${esc(it.texto)}" data-tip="${esc(sid + ' · ' + EST[it.seg] + '\nClic para registrar seguimiento')}"><span class="d ${grupoCal(sis(sid).calif)}"></span>${esc(sid)}${marca}</button>` : chipSid(sid, marca); }).join('')}</div>
      ${g.es ? `<details class="en"><summary>Texto original del EWA</summary>${esc(g.k)}</details>` : ''}</div>`;
  };
  return `<div class="pagehead"><div><div class="eyebrow">Hallazgos · EWA ${esc(fMes(estado.mes))}</div><h1>${lista.length} tipos de hallazgo en ${new Set(f.map((x) => x.sid)).size} sistemas</h1>
    <p class="sub">Cada hallazgo aparece una sola vez con los sistemas donde se presenta.${WEB && puedeEditar() ? ' Clic en un sistema para registrar su seguimiento.' : ''}</p></div>
    ${segm(q, 'vista', [['temas', 'Por tema'], ['detalle', 'Detalle por sistema']])}</div>
  <div class="card">
    <div class="toolbar">${segm(q, 'cat', [['', 'Todas', nCat('')], ...CATS.map((c) => [c, c, nCat(c)])])}</div>
    <div class="toolbar"><input class="field" data-qtext="q" placeholder="Buscar SID, texto o responsable…" value="${esc(q.get('q') || '')}" style="min-width:250px">
      ${segm(q, 'prio', [['', 'Toda prioridad'], ['si', 'Prioritarios'], ['no', 'Advertencias']])}
      ${WEB ? segm(q, 'seg', [['', 'Todo seguimiento'], ...Object.entries(EST)]) : ''}
      <span class="spacer"></span>${vista === 'detalle' ? '<button class="btn" data-csv="hall" data-n="hallazgos_ewa">Exportar CSV</button>' : ''}</div>
    ${vista === 'detalle' ? tabla('hall', [
      { k: 'sid', t: 'SID', html: (x) => `${st(x.calif, ' ')}<b>${esc(x.sid)}</b>`, sort: (x) => x.sid },
      { k: 'categoria', t: 'Categoría' }, { k: 'prioritaria', t: 'Prioridad', html: (x) => (x.prioritaria ? '<span class="pill prio">Prioritaria</span>' : '<span class="pill">Advertencia</span>'), sort: (x) => (x.prioritaria ? 0 : 1) },
      { k: 'es', t: 'Hallazgo', w: 320, html: (x) => esc(x.es || x.generico), csv: (x) => x.es || x.generico },
      { k: 'objeto', t: 'Objeto', html: (x) => (x.objeto ? `<span class="mono">${esc(x.objeto)}</span>` : '') },
      ...(WEB ? [{ k: 'seg', t: 'Seguimiento', html: (x) => chipSeg(x.sid, x), sort: (x) => x.seg, csv: (x) => { const s = segDe(x.sid, x.texto) || {}; return [EST[s.estado || 'abierto'], s.responsable, s.fecha_compromiso, s.comentario].filter(Boolean).join(' · '); } }] : []),
    ], f, { orden: 'prioritaria' }) : (lista.map(tarjeta).join('') || '<div class="empty">Sin hallazgos con estos filtros</div>')}
  </div>
  <p class="metodo">La categoría y la marca de atención prioritaria se asignan por palabras clave del texto del EWA (riesgo de seguridad, soporte vencido, autorizaciones críticas); complementan, no sustituyen, la calificación de SAP.</p>`;
};

// ---------- rendimiento comparativo
VISTAS.rendimiento = () => {
  const cols = ['disponibilidad', 'respDialogo', 'respRFC', 'cpuApp', 'cpuBD', 'tamanoBD', 'crecimientoBD', 'usuariosActivos'];
  const filas = SIDS.map(sis).map((s) => { const o = { sid: s.sid, calif: s.calif, s }; let n = 0; for (const k of cols) { o[k] = indicador(s, k); if (o[k].v != null) n++; } o.n = n; return o; }).filter((o) => o.n);
  const max = Object.fromEntries(cols.map((k) => [k, Math.max(1, ...filas.map((o) => o[k].n || 0))]));
  const destaca = (k, t, inv) => { const c = filas.filter((o) => o[k].n != null).sort((a, b) => (inv ? a[k].n - b[k].n : b[k].n - a[k].n))[0]; return c ? `<div class="card kpi link" data-drawer="${esc(c.sid)}"><div class="lbl">${esc(t)}</div><div class="val" style="font-size:24px">${esc(c[k].v)}</div><div class="foot"><b>${esc(c.sid)}</b> · <span class="src">${esc(c[k].src)}</span></div></div>` : ''; };
  const celda = (o, k) => { const x = o[k]; if (x.v == null) return '<span class="muted">—</span>'; const pc = x.n != null ? (x.n / max[k]) * 100 : 0; return `<span class="bullet ${alto(x) ? 'alto' : ''}" data-tip="${esc(x.d[1] + ': ' + x.v + ' (' + x.src + ')')}"><span class="b"><span style="width:${k === 'disponibilidad' ? x.n : pc}%"></span></span>${esc(x.v)}</span>`; };
  return `<div class="pagehead"><div><div class="eyebrow">Rendimiento · EWA ${esc(fMes(estado.mes))}</div><h1>Rendimiento comparado</h1><p class="sub">${filas.length} sistemas con indicadores. EWA cuando existe; si no, inventario. En ámbar, valores fuera de umbral (diálogo/RFC &gt; 1 s, CPU &gt; 70 %, disponibilidad &lt; 99 %).</p></div></div>
  <div class="grid g-kpi">${destaca('respDialogo', 'Mayor tiempo de diálogo')}${destaca('cpuApp', 'Mayor CPU en servidor App')}${destaca('tamanoBD', 'Base de datos más grande')}${destaca('crecimientoBD', 'Mayor crecimiento mensual')}</div>
  <div class="card section"><div class="toolbar"><span class="muted small">Barras relativas al máximo de cada columna.</span><span class="spacer"></span><button class="btn" data-csv="perf" data-n="rendimiento">Exportar CSV</button></div>
  ${tabla('perf', [{ k: 'sid', t: 'SID', html: (o) => `${st(o.calif, ' ')}<b>${esc(o.sid)}</b>`, sort: (o) => o.sid },
    ...cols.map((k) => ({ k, t: IND.find((d) => d[0] === k)[1].replace('Resp. promedio ', 'Resp. ').replace('CPU máx. servidor ', 'CPU '), num: true, sort: (o) => o[k].n, html: (o) => celda(o, k), csv: (o) => o[k].v || '' }))],
    filas, { orden: 'respDialogo', dir: -1, fila: (o) => `data-drawer="${esc(o.sid)}"` })}</div>`;
};

// ---------- ciclo de vida
function lineaTiempo(items, unSid) {
  const ini = new Date(HOY); ini.setMonth(ini.getMonth() - 12);
  const fin = new Date(HOY); fin.setMonth(fin.getMonth() + 36);
  const x = (iso) => Math.max(0, Math.min(100, ((new Date(iso) - ini) / (fin - ini)) * 100));
  const xh = x(HOY.toISOString());
  const marcas = []; for (let a = ini.getFullYear(); a <= fin.getFullYear() + 1; a++) { const d = new Date(a, 0, 1); if (d >= ini && d <= fin) marcas.push([x(d.toISOString()), a]); }
  const filas = ['Producto SAP', 'Base de datos', 'Sistema operativo', 'Hardware'].map((c) => {
    const g = {};
    for (const e of items.filter((e) => e.componente === c && e.tipo !== 'Extendido')) (g[e.fecha] ||= { fecha: e.fecha, est: e.est, items: [] }).items.push(e);
    return [c, Object.values(g).sort((a, b) => a.fecha.localeCompare(b.fecha))];
  }).filter(([, v]) => v.length);
  const burbuja = (b, i, c) => {
    const sids = [...new Set(b.items.map((e) => e.sid))], n = sids.length, d = Math.round(14 + Math.min(18, Math.sqrt(n) * 5));
    const refs = [...new Set(b.items.map((e) => e.ref).filter(Boolean))].slice(0, 3);
    const tipTxt = `${c} · ${fFecha(b.fecha)} · ${b.est.t}${new Date(b.fecha) < ini ? ' (antes del rango mostrado)' : ''}${refs.length ? '\n' + refs.join(' | ') : ''}${unSid ? '' : '\n' + n + (n === 1 ? ' sistema: ' : ' sistemas: ') + sids.slice(0, 12).join(', ') + (n > 12 ? '…' : '')}`;
    const accion = unSid ? '' : n === 1 ? `data-drawer="${esc(sids[0])}"` : `data-href="#/ciclo?vista=tabla&f=${b.fecha}&c=${encodeURIComponent(c)}"`;
    return `<span class="tl-p ${b.est.c}" style="left:${x(b.fecha)}%;width:${d}px;height:${d}px;margin:-${d / 2}px 0 0 -${d / 2}px;animation-delay:${i * 40}ms" ${accion} data-tip="${esc(tipTxt)}">${n > 1 ? n : ''}</span>`;
  };
  return `<div class="tl"><div class="tl-eje">${marcas.map(([p, a]) => `<span style="left:${p}%">${a}</span>`).join('')}<span class="hoy-l" style="left:${xh}%">Hoy</span></div>
    ${filas.map(([c, v]) => `<div class="tl-row"><div class="lbl">${esc(c)} <span class="muted small">${v.reduce((a, b) => a + b.items.length, 0)}</span></div><div class="pista"><div class="tl-zona" style="left:0;width:${xh}%"></div><div class="tl-hoy" style="left:${xh}%"></div>${v.map((b, i) => burbuja(b, i, c)).join('')}</div></div>`).join('')}</div>
    <div class="ley-pila"><span>${st('rojo', 'Vencido o ≤ 6 meses')}</span><span>${st('amarillo', '6–18 meses')}</span><span>${st('verde', '> 18 meses')}</span><span class="muted">Tamaño y número = sistemas con esa fecha · zona sombreada = pasado · soporte estándar / mainstream${unSid ? '' : ' · clic para ver el detalle'}</span></div>`;
}
VISTAS.ciclo = (_, q) => {
  const todos = SIDS.flatMap(eolDe), e = q.get('e') || '', vista = q.get('vista') || 'linea';
  const grupo = (x) => (x.est.m <= 6 ? 'riesgo' : x.est.m <= 18 ? 'medio' : 'ok');
  const ff = q.get('f'), fc = q.get('c');
  const f = todos.filter((x) => (!e || grupo(x) === e) && (!ff || x.fecha === ff) && (!fc || x.componente === fc));
  const n = (g) => todos.filter((x) => x.tipo !== 'Extendido' && grupo(x) === g).length;
  return `<div class="pagehead"><div><div class="eyebrow">Ciclo de vida</div><h1>Fin de soporte de componentes</h1><p class="sub">Producto SAP, base de datos, sistema operativo y hardware · fechas del inventario y del EWA · hoy ${fFecha(HOY.toISOString().slice(0, 10))}</p></div>
    ${segm(q, 'vista', [['linea', 'Línea de tiempo'], ['tabla', 'Tabla']])}</div>
  <div class="card"><div class="toolbar">${segm(q, 'e', [['', 'Todo'], ['riesgo', 'Vencido o ≤ 6 meses', n('riesgo')], ['medio', '6–18 meses', n('medio')], ['ok', '> 18 meses', n('ok')]])}${ff || fc ? `<span class="chip">${esc(fc || '')} ${ff ? '· ' + fFecha(ff) : ''} <a href="#/ciclo?vista=tabla" style="margin-left:4px">✕</a></span>` : ''}<span class="spacer"></span>${vista === 'tabla' ? '<button class="btn" data-csv="eol" data-n="ciclo_de_vida">Exportar CSV</button>' : ''}</div>
  ${!f.length ? '<div class="empty">Sin fechas con este filtro</div>' : vista === 'tabla'
    ? tabla('eol', [{ k: 'sid', t: 'SID', html: (x) => `<b>${esc(x.sid)}</b>` }, { k: 'componente', t: 'Componente' }, { k: 'ref', t: 'Referencia', w: 220 }, { k: 'tipo', t: 'Soporte' },
      { k: 'fecha', t: 'Fecha', html: (x) => fFecha(x.fecha) }, { k: 'est', t: 'Estado', html: (x) => st(x.est.c, x.est.t), sort: (x) => x.est.m, csv: (x) => x.est.t }, { k: 'fuente', t: 'Fuente' }], f, { orden: 'fecha', fila: (x) => `data-drawer="${esc(x.sid)}"` })
    : lineaTiempo(f, false)}</div>`;
};

VISTAS.inventario = (_, q) => {
  const vista = q.get('v') || 'sap';
  const txt = (q.get('q') || '').toLowerCase();
  const m = (o) => !txt || Object.values(o).join(' ').toLowerCase().includes(txt);
  const hosts = inv.hosts.filter(m), infra = (inv.infra || []).filter(m);
  return `<div class="pagehead"><div><div class="eyebrow">Inventario</div><h1>Inventario de servidores</h1><p class="sub">Fuente: ${esc(inv.archivo || '—')} ${inv.modificado ? '· modificado ' + fFecha(inv.modificado.slice(0, 10)) : ''}</p></div></div>
  <div class="card"><div class="toolbar">
    <a class="btn ${vista === 'sap' ? 'primary' : ''}" href="#/inventario?v=sap${txt ? '&q=' + encodeURIComponent(txt) : ''}" style="display:inline-flex;align-items:center;text-decoration:none;color:inherit">Sistemas SAP (${inv.hosts.length})</a>
    <a class="btn ${vista === 'infra' ? 'primary' : ''}" href="#/inventario?v=infra${txt ? '&q=' + encodeURIComponent(txt) : ''}" style="display:inline-flex;align-items:center;text-decoration:none;color:inherit">Infraestructura (${(inv.infra || []).length})</a>
    <input class="field" data-qtext="q" placeholder="Buscar host, IP, SID, SO…" value="${esc(q.get('q') || '')}" style="min-width:260px">
    <span class="spacer"></span><button class="btn" data-csv="${vista === 'sap' ? 'inv' : 'infra'}" data-n="inventario_${vista}">Exportar CSV</button></div>
  ${vista === 'sap' ? tabla('inv', [{ k: 'sid', t: 'SID', html: (h) => linkSid(h.sid) + (h.componente ? ` <span class="chip">${esc(h.componente)}</span>` : '') }, { k: 'ambiente', t: 'Ambiente' }, { k: 'hostname', t: 'Host', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>` },
    { k: 'ip', t: 'IP', html: (h) => `<span class="mono">${fmt(h.ip)}</span>` }, { k: 'producto', t: 'Producto' }, { k: 'versionProducto', t: 'Versión' }, { k: 'kernel', t: 'Kernel' }, { k: 'cpu', t: 'CPU' },
    { k: 'memoria', t: 'Memoria', html: (h) => fmt(memoria(h.memoria)), sort: (h) => num(h.memoria) }, { k: 'osVersion', t: 'SO', html: (h) => fmt(val(h.osVersion) || h.so) }, { k: 'bd', t: 'BD' },
    { k: 'ewaRate', t: 'EWA', html: (h) => st(normRate(h.ewaRate), h.ewaRate), sort: (h) => -ORDEN[normRate(h.ewaRate)] }, { k: 'despliegue', t: 'Despliegue' }], hosts, { orden: 'sid' })
  : tabla('infra', [{ k: 'sid', t: 'SID' }, { k: 'hostname', t: 'Host', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>` }, { k: 'ip', t: 'IP', html: (h) => `<span class="mono">${fmt(h.ip)}</span>` }, { k: 'tipo', t: 'Tipo' },
    { k: 'despliegue', t: 'On-prem / Cloud' }, { k: 'so', t: 'SO' }, { k: 'osVersion', t: 'Versión SO' }, { k: 'ramMB', t: 'RAM', html: (h) => fmt(memoria(h.ramMB)), sort: (h) => num(h.ramMB) }, { k: 'clasificacion', t: 'Clasificación' }, { k: 'ubicacion', t: 'Ubicación' }, { k: 'descripcion', t: 'Descripción', w: 260 }], infra, { orden: 'tipo' })}
  </div>`;
};

VISTAS.cobertura = () => {
  const sinEwa = Object.keys(invPorSid).filter((s) => !reportes.some((r) => r.sid === s));
  const sinInv = [...new Set(reportes.map((r) => r.sid))].filter((s) => !invPorSid[s]).sort();
  const campos = ['cpu', 'memoria', 'ip', 'producto', 'versionProducto', 'kernel', 'osVersion', 'bd', 'tamanoBD', 'ewaRate', 'dispSemanal', 'respDialogo', 'maxCpu', 'usuariosTotales', 'hwEolStd', 'osEolStd', 'prodEolStd', 'bdEolStd'];
  const compl = Object.entries(invPorSid).map(([sid, hs]) => {
    const vac = campos.filter((c) => hs.every((h) => vacio(h[c])));
    return { sid, hosts: hs.length, pct: Math.round(((campos.length - vac.length) / campos.length) * 100), faltan: vac };
  });
  const NOM = { cpu: 'CPU', memoria: 'Memoria', ip: 'IP', producto: 'Producto', versionProducto: 'Versión producto', kernel: 'Kernel', osVersion: 'Versión SO', bd: 'BD', tamanoBD: 'Tamaño BD', ewaRate: 'EWA rate', dispSemanal: 'Disponibilidad', respDialogo: 'Resp. diálogo', maxCpu: 'Max CPU', usuariosTotales: 'Usuarios totales', hwEolStd: 'EOL HW', osEolStd: 'EOL SO', prodEolStd: 'EOL producto', bdEolStd: 'EOL BD' };
  const dups = reportes.filter((r) => r.duplicados);
  return `<div class="pagehead"><div><div class="eyebrow">Calidad de la información</div><h1>Cobertura de datos</h1><p class="sub">Qué falta para que el tablero esté completo.</p></div></div>
  <div class="grid g-kpi">
    ${kpi('SIDs sin EWA', sinEwa.length, 'están en el inventario')}
    ${kpi('EWAs sin inventario', sinInv.length, 'SID no capturado en el Excel')}
    ${kpi('Completitud del inventario', compl.length ? Math.round(compl.reduce((a, x) => a + x.pct, 0) / compl.length) + '<small>%</small>' : '—', 'promedio de campos clave')}
    ${kpi('Archivos con incidencia', (D.incidencias || []).length, 'no se pudieron leer')}
  </div>
  <div class="grid g-2 section">
    <div class="card"><div class="card-h"><h2>Sistemas del inventario sin EWA</h2><span class="muted">solicitar a SolMan</span></div>${sinEwa.length ? sinEwa.map((s) => `<a class="chip" href="#/sistema/${encodeURIComponent(s)}">${esc(s)}</a>`).join('') : '<div class="empty">Todos tienen EWA</div>'}</div>
    <div class="card"><div class="card-h"><h2>EWAs cuyo SID no está en el inventario</h2><span class="muted">agregar al Excel</span></div>${sinInv.length ? sinInv.map((s) => `<a class="chip" href="#/sistema/${encodeURIComponent(s)}">${esc(s)}</a>`).join('') : '<div class="empty">Todos están inventariados</div>'}</div>
  </div>
  <div class="card section"><div class="card-h"><h2>Completitud del inventario por SID</h2><button class="btn" data-csv="compl" data-n="completitud_inventario">Exportar CSV</button></div>
  ${tabla('compl', [{ k: 'sid', t: 'SID', html: (x) => linkSid(x.sid) }, { k: 'hosts', t: 'Hosts', num: true }, { k: 'pct', t: 'Completitud', num: true, html: (x) => `<span style="color:${x.pct >= 80 ? 'var(--good)' : x.pct >= 50 ? 'var(--warn)' : 'var(--crit)'}">${x.pct}%</span>` },
    { k: 'faltan', t: 'Campos vacíos (N/D, N/A)', w: 300, html: (x) => x.faltan.map((c) => `<span class="chip">${esc(NOM[c])}</span>`).join(''), csv: (x) => x.faltan.map((c) => NOM[c]).join('; '), sort: (x) => x.faltan.length }], compl, { orden: 'pct' })}</div>
  ${(D.incidencias || []).length || dups.length ? `<div class="card section"><div class="card-h"><h2>Archivos</h2></div>
    ${(D.incidencias || []).map((i) => `<div class="finding"><span class="dot p"></span><div><b class="mono">${esc(i.archivo)}</b> — ${esc(i.motivo)}</div></div>`).join('')}
    ${dups.map((r) => `<div class="finding"><span class="dot"></span><div><b class="mono">${esc(r.duplicados.join(', '))}</b> — mismo contenido que <span class="mono">${esc(r.archivo)}</span> (${esc(r.sid)}); se contó una sola vez.</div></div>`).join('')}</div>` : ''}`;
};


// ------------------------------------------------------------------ administración (versión web)
const ROLES = { admin: 'Administrador', editor: 'Edición', consulta: 'Consulta' };
const aviso = (id, txt, ok) => { const el = document.getElementById(id); if (el) { el.textContent = txt; el.style.color = ok ? 'var(--good)' : 'var(--crit)'; } };

VISTAS.publicar = () => `<div class="pagehead"><div><div class="eyebrow">Administración</div><h1>Publicar datos</h1>
  <p class="sub">Sube el archivo <span class="mono">datos/datos.json</span> que genera <b>Actualizar tablero.cmd</b> en tu equipo. Todos los usuarios verán la publicación más reciente.</p></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>Nueva publicación</h2></div>
      <input type="file" id="pubArchivo" accept=".json,application/json" class="field" style="width:100%;padding:6px">
      <div id="pubResumen" class="muted small" style="margin:12px 0"></div>
      <input class="field" id="pubNota" maxlength="500" placeholder="Nota (opcional): p.ej. EWAs de octubre + inventario v2" style="width:100%">
      <div class="toolbar" style="margin:12px 0 0"><button class="btn primary" id="pubBoton" disabled>Publicar</button><span id="pubMsg" class="small"></span></div>
    </div>
    <div class="card"><div class="card-h"><h2>Qué se publica</h2></div><p class="muted" style="margin:0">El contenido analizado de los EWAs (calificación, hallazgos, indicadores, hosts) y el inventario del Excel. <b>No</b> se suben los PDF/Word originales. La información queda en la base de datos protegida por políticas RLS: solo la ven las cuentas autorizadas en <i>Accesos</i>.</p></div>
  </div>
  <div class="card section"><div class="card-h"><h2>Historial de publicaciones</h2><span class="muted">la más reciente es la vigente</span></div><div id="pubHist" class="muted">Cargando…</div></div>`;
VISTAS.publicar.roles = ['admin', 'editor'];
VISTAS.publicar.despues = async () => {
  let datos = null;
  $('#pubArchivo').addEventListener('change', async (e) => {
    datos = null; $('#pubBoton').disabled = true; aviso('pubMsg', '');
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { $('#pubResumen').textContent = 'El archivo supera 20 MB.'; return; }
    try {
      const j = JSON.parse(await f.text());
      if (!j || !Array.isArray(j.reportes) || !j.inventario || !Array.isArray(j.inventario.hosts)) throw new Error('no tiene la estructura del tablero (reportes / inventario)');
      datos = j;
      const ms = [...new Set(j.reportes.map((r) => r.mes).filter(Boolean))].sort();
      $('#pubResumen').innerHTML = `✓ Generado el <b>${esc(fHora(j.generado))}</b> · ${j.reportes.length} EWAs · meses ${esc(ms.map(fMes).join(', ') || '—')} · ${j.inventario.hosts.length} hosts · ${(j.inventario.infra || []).length} activos de infraestructura`;
      $('#pubBoton').disabled = false;
    } catch (err) { $('#pubResumen').textContent = 'Archivo no válido: ' + err.message; }
  });
  $('#pubBoton').addEventListener('click', async () => {
    if (!datos) return;
    $('#pubBoton').disabled = true; aviso('pubMsg', 'Publicando…', true);
    const ms = [...new Set(datos.reportes.map((r) => r.mes).filter(Boolean))].sort();
    const { error } = await SB.from('tablero_publicaciones').insert({ periodo: ms[ms.length - 1] || null, generado: datos.generado || null, datos, nota: $('#pubNota').value.trim() || null, publicado_por: YO.email });
    if (error) { aviso('pubMsg', 'No se pudo publicar: ' + error.message); $('#pubBoton').disabled = false; return; }
    aviso('pubMsg', 'Publicado. Recargando…', true);
    setTimeout(() => location.reload(), 800);
  });
  const { data, error } = await SB.from('tablero_publicaciones').select('id,periodo,generado,nota,publicado_por,publicado_en').order('publicado_en', { ascending: false }).limit(50);
  if (error) { $('#pubHist').textContent = 'Error: ' + error.message; return; }
  $('#pubHist').innerHTML = tabla('pubs', [{ k: 'id', t: '#', num: true }, { k: 'periodo', t: 'Periodo EWA', html: (p) => esc(fMes(p.periodo)) }, { k: 'generado', t: 'Generado', html: (p) => esc(fHora(p.generado)) },
    { k: 'publicado_en', t: 'Publicado', html: (p) => esc(fHora(p.publicado_en)) }, { k: 'publicado_por', t: 'Por' }, { k: 'nota', t: 'Nota' },
    ...(YO.rol === 'admin' ? [{ k: 'x', t: '', html: (p) => `<button class="btn" data-borrapub="${p.id}" style="height:28px">Eliminar</button>` }] : [])], data);
  $('#pubHist').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-borrapub]'); if (!b) return;
    if (!confirm(`¿Eliminar la publicación #${b.dataset.borrapub}? No se puede deshacer.`)) return;
    const { error: er } = await SB.from('tablero_publicaciones').delete().eq('id', b.dataset.borrapub);
    if (er) alert('No se pudo eliminar: ' + er.message); else location.reload();
  });
};

// Gestión de cuentas: llama a la Edge Function "tablero-admin" (la service_role vive solo en el servidor).
async function adminCuentas(cuerpo) {
  const { data, error } = await SB.functions.invoke('tablero-admin', { body: cuerpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const claveSegura = (p) => p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
function generarClave() {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '.-_!#%'];
  const todos = grupos.join('');
  const r = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const c = grupos.map((g) => g[r(g.length)]);
  while (c.length < 16) c.push(todos[r(todos.length)]);
  for (let i = c.length - 1; i > 0; i--) { const j = r(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
const usarGenerador = (e) => { const g = e.target.closest('[data-generar]'); if (!g) return; const inp = g.parentElement.querySelector('input'); inp.value = generarClave(); inp.select(); };
const campoClave = (nombre, ph = 'Contraseña temporal') => `<span class="clave-campo"><input class="field" name="${nombre}" type="text" minlength="12" maxlength="72" required placeholder="${ph}" autocomplete="new-password" spellcheck="false"><button type="button" class="btn" data-generar="${nombre}" title="Generar contraseña segura">Generar</button></span>`;

VISTAS.accesos = () => `<div class="pagehead"><div><div class="eyebrow">Administración</div><h1>Usuarios y accesos</h1>
  <p class="sub">Crea cuentas, asigna roles, bloquea o desbloquea y restablece contraseñas. Cada acción queda en la bitácora (sin contraseñas).</p></div></div>
  <div class="grid g-3">
    ${kpi('Administrador', 'Todo', 'Usuarios, publicaciones, seguimiento y bitácora')}
    ${kpi('Edición', 'Publica y da seguimiento', 'Sube datos y actualiza el estado de hallazgos')}
    ${kpi('Consulta', 'Solo lectura', 'Ve el tablero completo')}
  </div>
  <div class="card section"><div class="card-h"><h2>Agregar usuario</h2><span class="muted">la cuenta queda activa de inmediato</span></div>
    <form id="accForm" class="toolbar" style="margin:0" autocomplete="off">
      <input class="field" name="email" type="email" required placeholder="correo@dxc.com" style="min-width:230px" autocomplete="off">
      <input class="field" name="nombre" maxlength="120" placeholder="Nombre" style="min-width:180px">
      <select class="field" name="rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'consulta' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      ${campoClave('clave')}
      <button class="btn primary">Crear usuario</button>
    </form>
    <p class="muted small" style="margin:10px 0 0">Mínimo 12 caracteres con mayúscula, minúscula y número. Comparte la contraseña temporal por un canal seguro y pide a la persona que la cambie con el botón 🔑 al entrar.</p>
    <p id="accMsg" class="small msg"></p></div>
  <div class="card section"><div class="card-h"><h2>Usuarios</h2><span class="muted" id="accCuenta"></span></div>
    <div class="toolbar"><input class="field" id="accBusca" placeholder="Buscar correo o nombre…" style="min-width:240px"><span class="spacer"></span><button class="btn" data-csv="acc" data-n="usuarios_tablero">Exportar CSV</button></div>
    <div id="accTabla" class="muted">Cargando…</div></div>
  <div class="card section"><div class="card-h"><h2>Bitácora</h2><span class="muted">últimos 100 movimientos</span></div><div id="bitTabla" class="muted">Cargando…</div></div>`;
VISTAS.accesos.roles = ['admin'];
VISTAS.accesos.despues = async () => {
  const msg = (t, ok) => aviso('accMsg', t, ok);
  let filas = [];
  const pintar = () => {
    const q = ($('#accBusca')?.value || '').toLowerCase();
    const f = filas.filter((a) => !q || (a.email + ' ' + (a.nombre || '')).toLowerCase().includes(q));
    const y = window.scrollY;
    $('#accTabla').innerHTML = tabla('acc', [
      { k: 'email', t: 'Correo', html: (a) => `<span class="mono">${esc(a.email)}</span>${a.email === YO.email ? ' <span class="chip">tú</span>' : ''}` },
      { k: 'nombre', t: 'Nombre' },
      { k: 'rol', t: 'Rol', html: (a) => (a.rol ? `<select class="field" data-accrol="${esc(a.email)}" style="height:30px">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === a.rol ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : '<span class="muted">sin acceso</span>'), csv: (a) => ROLES[a.rol] || 'sin acceso' },
      { k: 'estado', t: 'Estado', html: (a) => st(a.estadoC, a.estado), sort: (a) => a.estado, csv: (a) => a.estado },
      { k: 'ultimo', t: 'Último acceso', html: (a) => esc(a.ultimo ? fHora(a.ultimo) : 'Nunca'), sort: (a) => a.ultimo || '' },
      { k: 'alta', t: 'Alta', html: (a) => `${esc(fHora(a.alta))}${a.creado_por ? `<div class="muted small">${esc(a.creado_por)}</div>` : ''}`, sort: (a) => a.alta || '' },
      { k: 'acc', t: 'Acciones', html: (a) => {
        const yoMismo = a.email === YO.email;
        if (!a.rol && !a.cuenta) return '';
        return `<span class="acciones">${!yoMismo ? (a.bloqueado ? `<button class="btn" data-acc="desbloquear" data-email="${esc(a.email)}">Desbloquear</button>` : `<button class="btn" data-acc="bloquear" data-email="${esc(a.email)}">Bloquear</button>`) : ''}
          ${a.cuenta ? `<button class="btn" data-acc="password" data-email="${esc(a.email)}">Contraseña</button>` : `<button class="btn" data-acc="crearcuenta" data-email="${esc(a.email)}" data-rol="${esc(a.rol || 'consulta')}" data-nombre="${esc(a.nombre || '')}">Crear cuenta</button>`}
          ${!yoMismo ? `<button class="btn" data-acc="eliminar" data-email="${esc(a.email)}">Eliminar</button>` : ''}</span>`;
      }, csv: () => '' },
    ], f, { orden: 'email' });
    window.scrollTo(0, y);
    $('#accCuenta').textContent = `${filas.filter((x) => x.estado === 'Activo').length} activos · ${filas.filter((x) => x.bloqueado).length} bloqueados · ${filas.length} en total`;
  };
  const cargar = async () => {
    const [acc, cuentas] = await Promise.all([
      SB.from('tablero_accesos').select('*'),
      adminCuentas({ accion: 'listar' }).catch((e) => ({ error: e.message })),
    ]);
    if (acc.error) { $('#accTabla').textContent = 'Error: ' + acc.error.message; return; }
    if (cuentas.error) msg('No se pudo consultar las cuentas (función tablero-admin): ' + cuentas.error);
    const porEmail = new Map((cuentas.usuarios || []).map((u) => [u.email, u]));
    const correos = new Set([...acc.data.map((a) => a.email), ...porEmail.keys()]);
    filas = [...correos].map((email) => {
      const a = acc.data.find((x) => x.email === email) || {}, u = porEmail.get(email);
      const bloqueado = (u && u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) || a.activo === false;
      let estado, estadoC;
      if (!a.rol) { estado = 'Cuenta sin acceso'; estadoC = 'sin-datos'; }
      else if (bloqueado) { estado = 'Bloqueado'; estadoC = 'rojo'; }
      else if (!u && cuentas.usuarios) { estado = 'Sin cuenta'; estadoC = 'amarillo'; }
      else if (u && !u.confirmado) { estado = 'Sin confirmar'; estadoC = 'amarillo'; }
      else { estado = 'Activo'; estadoC = 'verde'; }
      return { email, nombre: a.nombre, rol: a.rol, bloqueado, estado, estadoC, cuenta: !!u, ultimo: u && u.ultimo_acceso, alta: a.creado_en || (u && u.creado), creado_por: a.creado_por };
    });
    pintar();
    const b = await SB.from('tablero_bitacora').select('*').order('fecha', { ascending: false }).limit(100);
    const ACC = { 'tablero_accesos.insert': 'Alta de acceso', 'tablero_accesos.update': 'Cambio de acceso', 'tablero_accesos.delete': 'Baja de acceso',
      'tablero_publicaciones.insert': 'Publicación de datos', 'tablero_publicaciones.delete': 'Eliminó publicación',
      'tablero_seguimiento.insert': 'Seguimiento nuevo', 'tablero_seguimiento.update': 'Seguimiento actualizado', 'tablero_seguimiento.delete': 'Seguimiento eliminado',
      'auth.crear': 'Creó cuenta', 'auth.bloquear': 'Bloqueó cuenta', 'auth.desbloquear': 'Desbloqueó cuenta', 'auth.password': 'Restableció contraseña', 'auth.eliminar': 'Eliminó cuenta' };
    const resumir = (x) => { const d = x.detalle || {}; const o = d.despues || d; const a = d.antes;
      if (x.accion.startsWith('auth.')) return `${d.email || ''}${d.rol ? ' → ' + (ROLES[d.rol] || d.rol) : ''}`;
      if (x.accion.startsWith('tablero_accesos')) return `${o.email || ''} → ${ROLES[o.rol] || o.rol || ''}${o.activo === false ? ' (bloqueado)' : ''}${a && a.rol !== o.rol ? ` (antes ${ROLES[a.rol]})` : ''}${a && a.activo !== o.activo ? (o.activo ? ' (desbloqueado)' : '') : ''}`;
      if (x.accion.startsWith('tablero_publicaciones')) return `#${d.id} · ${fMes(d.periodo)}${d.nota ? ' · ' + d.nota : ''}`;
      return `${o.sid || ''} · ${EST[o.estado] || ''} · ${String(o.hallazgo || '').slice(0, 90)}`; };
    $('#bitTabla').innerHTML = b.error ? 'Error: ' + esc(b.error.message) : tabla('bit', [{ k: 'fecha', t: 'Fecha', html: (x) => esc(fHora(x.fecha)) }, { k: 'usuario', t: 'Usuario', html: (x) => `<span class="mono">${esc(x.usuario)}</span>` },
      { k: 'accion', t: 'Acción', html: (x) => esc(ACC[x.accion] || x.accion) }, { k: 'detalle', t: 'Detalle', w: 300, html: (x) => esc(resumir(x)), csv: (x) => resumir(x) }], b.data);
  };
  const ejecutar = async (cuerpo, okTxt, boton) => {
    if (boton) boton.disabled = true;
    try { await adminCuentas(cuerpo); msg(okTxt, true); await cargar(); return true; }
    catch (e) { msg('No se pudo completar: ' + e.message); return false; }
    finally { if (boton) boton.disabled = false; }
  };
  const dialogoClave = (email, crear) => {
    const dlg = $('#dlg');
    dlg.innerHTML = `<form method="dialog" id="fClave" class="dlg-form" autocomplete="off">
      <div class="eyebrow">${crear ? 'Crear cuenta' : 'Restablecer contraseña'}</div>
      <h2 style="margin:6px 0 14px" class="mono">${esc(email)}</h2>
      <label>Nueva contraseña ${campoClave('clave', 'Mínimo 12: mayúscula, minúscula y número')}</label>
      <p class="muted small">Se aplica de inmediato. Compártela por un canal seguro; la persona puede cambiarla con 🔑.</p>
      <p class="msg small" id="claveMsg"></p>
      <div class="toolbar" style="justify-content:flex-end;margin:0"><button class="btn" value="cancelar" formnovalidate>Cancelar</button><button class="btn primary" id="claveOk">${crear ? 'Crear cuenta' : 'Guardar contraseña'}</button></div></form>`;
    dlg.showModal();
    $('#fClave').addEventListener('click', usarGenerador);
    return new Promise((res) => {
      dlg.addEventListener('close', () => res(null), { once: true });
      $('#claveOk').addEventListener('click', (e) => {
        e.preventDefault();
        const v = $('#fClave').clave.value;
        if (!claveSegura(v)) { $('#claveMsg').textContent = 'Debe tener 12+ caracteres con mayúscula, minúscula y número.'; $('#claveMsg').style.color = 'var(--crit)'; return; }
        res(v); dlg.close();
      });
    });
  };

  await cargar();
  app.querySelector('#accBusca').addEventListener('input', pintar);
  $('#accForm').addEventListener('click', usarGenerador);
  $('#accForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email')).trim().toLowerCase(), clave = String(f.get('clave'));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Correo inválido.');
    if (!claveSegura(clave)) return msg('La contraseña debe tener 12+ caracteres con mayúscula, minúscula y número.');
    const ok = await ejecutar({ accion: 'crear', email, nombre: String(f.get('nombre')).trim(), rol: f.get('rol'), password: clave }, `✓ Usuario ${email} creado como ${ROLES[f.get('rol')]}. Ya puede entrar con su contraseña temporal.`, e.target.querySelector('button.primary'));
    if (ok) e.target.reset();
  });
  $('#accTabla').addEventListener('change', async (e) => {
    const s = e.target.closest('[data-accrol]'); if (!s) return;
    const { error } = await SB.from('tablero_accesos').update({ rol: s.value }).eq('email', s.dataset.accrol);
    if (error) msg('No se pudo cambiar el rol: ' + error.message); else msg(`✓ Rol de ${s.dataset.accrol} cambiado a ${ROLES[s.value]}.`, true);
    await cargar();
  });
  $('#accTabla').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const { acc, email } = b.dataset;
    if (acc === 'bloquear' && confirm(`¿Bloquear a ${email}? Perderá el acceso de inmediato.`)) await ejecutar({ accion: 'bloquear', email }, `✓ ${email} bloqueado.`, b);
    if (acc === 'desbloquear') await ejecutar({ accion: 'desbloquear', email }, `✓ ${email} desbloqueado.`, b);
    if (acc === 'password') { const c = await dialogoClave(email, false); if (c) await ejecutar({ accion: 'password', email, password: c }, `✓ Contraseña de ${email} actualizada.`, b); }
    if (acc === 'crearcuenta') { const c = await dialogoClave(email, true); if (c) await ejecutar({ accion: 'crear', email, nombre: b.dataset.nombre, rol: b.dataset.rol, password: c }, `✓ Cuenta de ${email} creada.`, b); }
    if (acc === 'eliminar' && confirm(`¿Eliminar a ${email}? Se borra su cuenta y su acceso. No se puede deshacer.`)) await ejecutar({ accion: 'eliminar', email }, `✓ ${email} eliminado.`, b);
  });
};

// ------------------------------------------------------------------ router, animación y eventos
const ALIAS = { resumen: 'panorama' };
function ruta() {
  const h = location.hash.replace(/^#\/?/, '') || 'panorama';
  const [p, qs] = h.split('?');
  let [v, arg] = p.split('/');
  v = ALIAS[v] || v;
  return { v: VISTAS[v] ? v : 'panorama', arg: arg ? decodeURIComponent(arg) : '', q: new URLSearchParams(qs || '') };
}
// Animaciones: conteo de cifras y trazo de anillos/donas.
function animar(raiz) {
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  raiz.querySelectorAll('[data-cnt]').forEach((el) => {
    const fin = +el.dataset.cnt, dec = +el.dataset.dec || 0, f = (v) => v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reducir || !fin) { el.textContent = f(fin); return; }
    const t0 = performance.now(), dur = 900;
    const paso = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = f(fin * e); if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => raiz.querySelectorAll('[data-dash]').forEach((c) => c.setAttribute('stroke-dasharray', c.dataset.dash))));
}
let rutaPrevia = '';
function render() {
  const r = ruta();
  const permitida = !VISTAS[r.v].roles || (YO && VISTAS[r.v].roles.includes(YO.rol));
  const html = permitida ? VISTAS[r.v](r.arg, r.q) : '<div class="card empty">No tienes permiso para esta sección.</div>';
  const misma = rutaPrevia === r.v + '/' + r.arg;
  app.innerHTML = `<div class="${misma ? '' : 'vista'}">${html}</div>`;
  rutaPrevia = r.v + '/' + r.arg;
  if (permitida && VISTAS[r.v].despues) VISTAS[r.v].despues(r);
  const tab = r.v === 'sistema' ? 'sistemas' : r.v;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.r === tab));
  document.title = (r.v === 'sistema' && r.arg ? r.arg.toUpperCase() + ' · ' : '') + 'Salud de Sistemas SAP';
  animar(app);
}
window.addEventListener('hashchange', () => { cerrarDrawer(); render(); window.scrollTo(0, 0); });
const navegar = (hash, reemplazar) => { if (reemplazar) { history.replaceState(null, '', hash); const y = window.scrollY; render(); window.scrollTo(0, y); } else location.hash = hash; };

// periodo
const selMes = $('#selMes');
selMes.innerHTML = meses.length ? meses.map((m) => `<option value="${m}" ${m === estado.mes ? 'selected' : ''}>EWA ${esc(fMes(m))}</option>`).join('') : '<option>Sin EWAs</option>';
selMes.addEventListener('change', () => { estado.mes = selMes.value; CACHE = {}; try { localStorage.setItem('tablero.mes', estado.mes); } catch {} render(); pintarVivo(); });

// tema
const aplicarTema = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('tablero.tema', t); } catch {} };
try { aplicarTema(localStorage.getItem('tablero.tema') || 'dark'); } catch { aplicarTema('dark'); }
$('#btnTema').addEventListener('click', () => aplicarTema(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));

// indicador "en vivo"
function hace(t) {
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'hace un momento'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`; const d = Math.floor(s / 86400); return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
function pintarVivo() {
  const v = $('#vivo'), cuando = D.publicacion ? D.publicacion.publicado_en : D.generado;
  v.classList.toggle('local', !WEB);
  $('#vivoTxt').textContent = `${WEB ? 'En línea' : 'Local'} · EWA ${fMes(estado.mes)}${cuando ? ' · ' + (WEB ? 'publicado ' : 'generado ') + hace(cuando) : ''}`;
  v.dataset.tip = WEB ? `Conectado a la base de datos con acceso controlado.\n${D.publicacion ? `Publicación #${D.publicacion.id} por ${D.publicacion.publicado_por}\n${fHora(D.publicacion.publicado_en)}` : ''}${D.publicacion && D.publicacion.nota ? '\n' + D.publicacion.nota : ''}` : 'Datos locales de este equipo (datos/datos.js).';
}
pintarVivo();
setInterval(pintarVivo, 60000);

// panel lateral
const drawer = $('#drawer'), velo = $('#velo');
function abrirDrawer(sid) { drawer.innerHTML = contenidoDrawer(sid); drawer.classList.add('on'); velo.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); drawer.scrollTop = 0; animar(drawer); }
function cerrarDrawer() { drawer.classList.remove('on'); velo.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); }
velo.addEventListener('click', cerrarDrawer);
drawer.addEventListener('click', (e) => {
  if (e.target.closest('[data-cerrar]')) return cerrarDrawer();
  const d = e.target.closest('[data-drawer]'); if (d) abrirDrawer(d.dataset.drawer);
  if (e.target.closest('a[href^="#/sistema/"]')) cerrarDrawer();
});

// paleta de comandos (Ctrl+K)
const paleta = $('#paleta'), pIn = $('#paletaIn'), pRes = $('#paletaRes');
let pAct = 0, pOps = [];
const SECCIONES = [['Panorama', '#/panorama'], ['Sistemas', '#/sistemas'], ['Matriz de riesgo', '#/sistemas?vista=matriz'], ['Hallazgos', '#/hallazgos'], ['Hallazgos prioritarios', '#/hallazgos?prio=si'], ['Rendimiento', '#/rendimiento'], ['Ciclo de vida', '#/ciclo'], ['Inventario de servidores', '#/inventario'], ['Calidad de datos', '#/cobertura']];
function opcionesPaleta(t) {
  t = t.trim().toLowerCase();
  const sids = SIDS.map(sis).filter((s) => !t || s.sid.toLowerCase().includes(t) || (s.producto || '').toLowerCase().includes(t)).sort((a, b) => (b.sid.toLowerCase().startsWith(t) ? 1 : 0) - (a.sid.toLowerCase().startsWith(t) ? 1 : 0)).slice(0, t ? 8 : 6)
    .map((s) => ({ g: 'Sistemas', t: s.sid, d: s.producto, h: '#/sistema/' + encodeURIComponent(s.sid), st: s.calif }));
  const hosts = t.length < 2 ? [] : inv.hosts.filter((h) => String(h.hostname || '').toLowerCase().includes(t) || String(h.ip || '').includes(t)).slice(0, 5).map((h) => ({ g: 'Servidores', t: h.hostname, d: `${h.sid} · ${h.ip || ''}`, h: '#/sistema/' + encodeURIComponent(h.sid) + '?t=infraestructura' }));
  const vistos = new Set(), hall = [];
  if (t.length >= 3) for (const r of reportes) for (const a of r.alertas || []) { const k = a.es || a.generico; if (!vistos.has(k) && k.toLowerCase().includes(t)) { vistos.add(k); hall.push({ g: 'Hallazgos', t: k, d: a.categoria, h: '#/hallazgos?q=' + encodeURIComponent(t) }); } }
  const sec = SECCIONES.filter(([n]) => !t || n.toLowerCase().includes(t)).map(([n, h]) => ({ g: 'Secciones', t: n, h }));
  return [...sids, ...hosts, ...hall.slice(0, 5), ...sec];
}
function pintarPaleta() {
  pOps = opcionesPaleta(pIn.value); pAct = Math.min(pAct, Math.max(0, pOps.length - 1));
  let g = '';
  pRes.innerHTML = pOps.length ? pOps.map((o, i) => `${o.g !== g ? `<div class="grupo-t">${esc((g = o.g))}</div>` : ''}<div class="op ${i === pAct ? 'act' : ''}" data-i="${i}"><span>${o.st !== undefined ? st(o.st, ' ') : ''}<b>${esc(o.t)}</b> ${o.d ? `<small>${esc(o.d)}</small>` : ''}</span><small>↵</small></div>`).join('') : '<div class="muted" style="padding:14px">Sin coincidencias</div>';
}
function abrirPaleta() { paleta.classList.add('on'); pIn.value = ''; pAct = 0; pintarPaleta(); setTimeout(() => pIn.focus(), 10); }
function cerrarPaleta() { paleta.classList.remove('on'); }
$('#btnBuscar').addEventListener('click', abrirPaleta);
pIn.addEventListener('input', () => { pAct = 0; pintarPaleta(); });
pIn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { pAct = Math.min(pAct + 1, pOps.length - 1); pintarPaleta(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { pAct = Math.max(pAct - 1, 0); pintarPaleta(); e.preventDefault(); }
  else if (e.key === 'Enter' && pOps[pAct]) { cerrarPaleta(); location.hash = pOps[pAct].h; }
});
pRes.addEventListener('click', (e) => { const o = e.target.closest('[data-i]'); if (o) { cerrarPaleta(); location.hash = pOps[+o.dataset.i].h; } });
paleta.addEventListener('click', (e) => { if (e.target === paleta) cerrarPaleta(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paleta.classList.contains('on') ? cerrarPaleta() : abrirPaleta(); }
  else if (e.key === 'Escape') { cerrarPaleta(); cerrarDrawer(); }
  else if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); abrirPaleta(); }
});

// filtros por URL, orden de tablas, CSV, navegación
let tFiltro;
app.addEventListener('input', (e) => {
  const el = e.target.closest('[data-qtext]'); if (!el) return;
  clearTimeout(tFiltro);
  tFiltro = setTimeout(() => {
    const r = ruta(), k = el.dataset.qtext, pos = el.selectionStart;
    navegar(`#/${r.v}${r.arg ? '/' + encodeURIComponent(r.arg) : ''}?${qLink(r.q, { [k]: el.value })}`, true);
    const nuevo = app.querySelector(`[data-qtext="${k}"]`); if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
  }, 220);
});
app.addEventListener('change', (e) => {
  const s = e.target.closest('[data-qsel]'); if (!s) return;
  const r = ruta(); navegar(`#/${r.v}?${qLink(r.q, { [s.dataset.qsel]: s.value })}`, true);
});
app.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-t]');
  if (th) { const t = TABLAS[th.dataset.t]; if (!t) return; t.st.dir = t.st.orden === th.dataset.k ? -t.st.dir : 1; t.st.orden = th.dataset.k; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  const qk = e.target.closest('[data-qk]');
  if (qk) { const r = ruta(), actual = r.q.get(qk.dataset.qk) || ''; navegar(`#/${r.v}${r.arg ? '/' + encodeURIComponent(r.arg) : ''}?${qLink(r.q, { [qk.dataset.qk]: actual === qk.dataset.qv ? '' : qk.dataset.qv })}`, true); return; }
  const b = e.target.closest('[data-csv]'); if (b) return csv(b.dataset.csv, b.dataset.n);
  if (e.target.closest('[data-print]')) return window.print();
  const sg = e.target.closest('[data-seg]'); if (sg && puedeEditar()) return editarSeg(sg.dataset.seg, sg.dataset.h);
  const dr = e.target.closest('[data-drawer]'); if (dr && !e.target.closest('a')) return abrirDrawer(dr.dataset.drawer);
  const hr = e.target.closest('[data-href]'); if (hr) return (location.hash = hr.dataset.href);
});

// tooltip
const tip = $('#tip');
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el || !el.dataset.tip) { tip.style.display = 'none'; return; }
  tip.innerHTML = esc(el.dataset.tip).replace(/\n/g, '<br>');
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
  tip.style.top = (e.clientY + 16 + h > innerHeight ? e.clientY - h - 10 : e.clientY + 16) + 'px';
});

$('#pie').innerHTML = `${reportes.length} EarlyWatch Alerts en histórico · ${inv.archivo ? 'inventario ' + esc(inv.archivo) + ' · ' : ''}${WEB ? 'acceso controlado por roles' : 'procesamiento local en este equipo'} · Información confidencial DXC / KOF`;
document.querySelectorAll('#tabs [data-rol]').forEach((a) => { a.hidden = !(YO && a.dataset.rol.split(',').includes(YO.rol)); });
render();
} // fin arrancar

// ------------------------------------------------------------------ versión web: sesión y carga de datos
const ROL_ETQ = { admin: 'Administrador', editor: 'Edición', consulta: 'Consulta' };
const INACTIVIDAD_MIN = 30;

function pantallaLogin(modo = 'entrar', msg = '') {
  document.body.classList.add('sin-sesion');
  const titulos = { entrar: 'Iniciar sesión', activar: 'Activar mi acceso', olvido: 'Recuperar contraseña', nueva: 'Define tu nueva contraseña' };
  const subt = {
    entrar: 'Acceso para el equipo de operaciones SAP DXC y KOF.',
    activar: 'Usa el correo que el administrador autorizó. Te llegará un correo para confirmarlo.',
    olvido: 'Te enviaremos un enlace para definir una nueva contraseña.',
    nueva: 'Mínimo 12 caracteres.',
  };
  const correo = modo !== 'nueva' ? `<label>Correo<input class="field" name="email" type="email" required autocomplete="username"></label>` : '';
  const clave = modo !== 'olvido' ? `<label>Contraseña<input class="field" name="clave" type="password" required minlength="${modo === 'entrar' ? 1 : 12}" autocomplete="${modo === 'entrar' ? 'current-password' : 'new-password'}"></label>` : '';
  const clave2 = modo === 'activar' || modo === 'nueva' ? `<label>Confirma la contraseña<input class="field" name="clave2" type="password" required minlength="12" autocomplete="new-password"></label>` : '';
  const boton = { entrar: 'Entrar', activar: 'Crear mi acceso', olvido: 'Enviar enlace', nueva: 'Guardar contraseña' }[modo];
  app.innerHTML = `<div class="login">
    <div class="login-hero"><div class="eyebrow">EarlyWatch Alert · Inventario · Ciclo de vida</div><h1>Salud de sistemas SAP</h1>
      <p class="sub">Visibilidad ejecutiva del estado de cada SID del landscape SAP de Coca-Cola FEMSA: calificación del EWA, hallazgos, rendimiento y fin de soporte.</p></div>
    <form class="card login-form" id="fLogin" novalidate>
      <h2>${titulos[modo]}</h2><p class="muted small" style="margin:4px 0 16px">${subt[modo]}</p>
      ${correo}${clave}${clave2}
      <p class="msg small" id="lMsg">${msg}</p>
      <button class="btn primary" style="width:100%;height:42px" id="lBtn">${boton}</button>
      <div class="login-links">
        ${modo === 'nueva' && YO ? '<a href="#" data-cancelar>Cancelar</a>' : modo !== 'entrar' ? '<a href="#" data-modo="entrar">Ya tengo acceso: iniciar sesión</a>' : '<a href="#" data-modo="activar">Primera vez: activar mi acceso</a><a href="#" data-modo="olvido">Olvidé mi contraseña</a>'}
      </div>
      <p class="muted small" style="margin:16px 0 0">🔒 Los accesos los otorga el administrador del tablero. Información confidencial.</p>
    </form></div>`;
  app.querySelectorAll('[data-modo]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); pantallaLogin(a.dataset.modo); }));
  const cancelar = app.querySelector('[data-cancelar]');
  if (cancelar) cancelar.addEventListener('click', (e) => { e.preventDefault(); location.reload(); });
  const form = $('#fLogin');
  const m = (t, ok) => { const el = $('#lMsg'); el.textContent = t; el.style.color = ok ? 'var(--good)' : 'var(--crit)'; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const email = String(f.get('email') || '').trim().toLowerCase(), clave = String(f.get('clave') || '');
    if (modo !== 'nueva' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return m('Escribe un correo válido.');
    if ((modo === 'activar' || modo === 'nueva') && clave.length < 12) return m('La contraseña debe tener al menos 12 caracteres.');
    if ((modo === 'activar' || modo === 'nueva') && clave !== f.get('clave2')) return m('Las contraseñas no coinciden.');
    $('#lBtn').disabled = true;
    const volver = location.origin + location.pathname;
    let r;
    if (modo === 'entrar') r = await SB.auth.signInWithPassword({ email, password: clave });
    else if (modo === 'activar') r = await SB.auth.signUp({ email, password: clave, options: { emailRedirectTo: volver } });
    else if (modo === 'olvido') r = await SB.auth.resetPasswordForEmail(email, { redirectTo: volver + '?recuperar=1' });
    else r = await SB.auth.updateUser({ password: clave });
    $('#lBtn').disabled = false;
    if (r.error) {
      const t = /invalid login/i.test(r.error.message) ? 'Correo o contraseña incorrectos.' : /not confirmed/i.test(r.error.message) ? 'Primero confirma tu correo con el enlace que te enviamos.' : /banned/i.test(r.error.message) ? 'Tu acceso está bloqueado. Contacta al administrador del tablero.' : r.error.message;
      return m(t);
    }
    if (modo === 'activar') return pantallaLogin('entrar', '✓ Revisa tu correo y confirma la cuenta; después inicia sesión.');
    if (modo === 'olvido') return m('✓ Si el correo existe, recibirás un enlace en unos minutos.', true);
    if (modo === 'nueva') { history.replaceState(null, '', location.pathname); return location.reload(); }
    cargarWeb();
  });
  const msgEl = $('#lMsg'); if (msg) msgEl.style.color = msg.startsWith('✓') ? 'var(--good)' : 'var(--crit)';
}

function chipUsuario() {
  const u = $('#usuario');
  u.hidden = false;
  u.innerHTML = `<span class="pill" title="${esc(YO.email)}"><b>${esc(YO.nombre || YO.email.split('@')[0])}</b> · ${esc(ROL_ETQ[YO.rol])}</span><button class="btn" id="btnClave" title="Cambiar mi contraseña">🔑</button><button class="btn" id="btnSalir">Salir</button>`;
  $('#btnSalir').addEventListener('click', salir);
  $('#btnClave').addEventListener('click', () => pantallaLogin('nueva'));
}
async function salir() { try { await SB.auth.signOut(); } finally { location.hash = ''; location.reload(); } }

function vigilarInactividad() {
  let t;
  const reinicia = () => { clearTimeout(t); t = setTimeout(async () => { await SB.auth.signOut(); location.reload(); }, INACTIVIDAD_MIN * 60 * 1000); };
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, reinicia, { passive: true }));
  reinicia();
}

async function cargarWeb() {
  app.innerHTML = '<div class="empty" style="margin-top:40px">Verificando acceso…</div>';
  // Los enlaces de confirmación/recuperación regresan con ?code=… (PKCE); supabase-js lo canjea al iniciar.
  const qs = new URLSearchParams(location.search);
  const { data: { session } } = await SB.auth.getSession();
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  if (qs.get('recuperar') && session) return pantallaLogin('nueva');
  if (!session) {
    if (qs.get('error_description')) return pantallaLogin('entrar', qs.get('error_description'));
    if (qs.get('code')) return pantallaLogin('entrar', qs.get('recuperar') ? 'Abre el enlace de recuperación en el mismo navegador donde lo solicitaste.' : '✓ Correo confirmado. Inicia sesión.');
    return pantallaLogin();
  }
  const rol = await SB.rpc('tablero_mi_rol');
  if (rol.error || !rol.data) {
    document.body.classList.add('sin-sesion');
    app.innerHTML = `<div class="card empty" style="max-width:520px;margin:60px auto"><h2>Tu cuenta no tiene acceso</h2>
      <p>${esc(session.user.email)} no está autorizado o su acceso fue suspendido. Solicítalo al administrador del tablero.</p>
      <button class="btn" id="btnSalir2">Salir</button></div>`;
    $('#btnSalir2').addEventListener('click', salir);
    return;
  }
  YO = { email: String(session.user.email).toLowerCase(), rol: rol.data };
  const yo = await SB.from('tablero_accesos').select('nombre').eq('email', YO.email).maybeSingle();
  if (yo.data) YO.nombre = yo.data.nombre;
  app.innerHTML = '<div class="empty" style="margin-top:40px">Cargando datos…</div>';
  const pub = await SB.from('tablero_publicaciones').select('id,periodo,generado,nota,publicado_por,publicado_en,datos').order('publicado_en', { ascending: false }).limit(1);
  if (pub.error) { app.innerHTML = `<div class="card empty">No se pudieron cargar los datos: ${esc(pub.error.message)}</div>`; return; }
  const p = pub.data[0];
  D = p ? { ...p.datos, publicacion: { id: p.id, periodo: p.periodo, publicado_por: p.publicado_por, publicado_en: p.publicado_en, nota: p.nota } }
    : { generado: null, inventario: { hosts: [], infra: [] }, reportes: [], incidencias: [], familias: {}, nombresFamilia: {} };
  for (let desde = 0; ; desde += 1000) {
    const s = await SB.from('tablero_seguimiento').select('*').range(desde, desde + 999);
    if (s.error) break;
    for (const x of s.data) SEG.set(x.sid + '|' + x.hallazgo, x);
    if (s.data.length < 1000) break;
  }
  document.body.classList.remove('sin-sesion');
  chipUsuario();
  vigilarInactividad();
  arrancar();
}

if (WEB) {
  if (!window.supabase || !WEB.supabaseUrl || !WEB.supabaseKey) {
    app.innerHTML = '<div class="card empty">Configuración incompleta del sitio (config.js).</div>';
  } else {
    SB = window.supabase.createClient(WEB.supabaseUrl, WEB.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    cargarWeb();
  }
} else if (D) {
  arrancar();
} else {
  app.innerHTML = '<div class="card empty" style="margin-top:40px"><h2>No hay datos</h2><p>Ejecuta <b>Actualizar tablero.cmd</b> para generar <span class="mono">datos/datos.js</span>.</p></div>';
}
