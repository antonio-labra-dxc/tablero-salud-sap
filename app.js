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
  s.ambiente = primero(hosts, 'ambiente') || (app && app.estado) || null;
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
  const body = fs.length ? fs.map((f) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(f) : fmt(f[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:24px">Sin registros</td></tr>`;
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
    dlg.close();
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
}
function traduccionDe(texto) {
  for (const r of reportes) for (const a of r.alertas || []) if (a.texto === texto) return a.es || a.generico;
  return texto;
}

// ------------------------------------------------------------------ vistas
const VISTAS = {};

VISTAS.resumen = (_, q) => {
  const lista = SIDS.map(sis);
  const conEwa = lista.filter((s) => s.reportes.length);
  const cuenta = (c) => lista.filter((s) => (c === 'sin-datos' ? ['sin-datos', 'desconocido', null].includes(s.calif) : s.calif === c)).length;
  const dist = ['rojo', 'amarillo', 'verde', 'sin-datos'].map((c) => ({ c, n: cuenta(c) }));
  const totalAl = lista.reduce((a, s) => a + s.alertas.length, 0);
  const totalPr = lista.reduce((a, s) => a + s.prioritarias, 0);
  const ewasMes = reportes.filter((r) => r.mes === estado.mes).length;
  if (!SIDS.length) return `<div class="pagehead"><div><div class="eyebrow">Resumen ejecutivo</div><h1>Aún no hay datos publicados</h1>
    <p class="sub">${puedeEditar() ? 'Publica el archivo <span class="mono">datos/datos.json</span> generado en tu equipo desde <a href="#/publicar">Publicar datos</a>.' : 'El administrador todavía no ha publicado información.'}</p></div></div>`;
  const cerrados = WEB ? lista.reduce((a, s) => a + s.alertas.filter((x) => ['resuelto', 'aceptado'].includes(estadoSeg(s.sid, x.texto))).length, 0) : 0;
  const enAtencion = WEB ? lista.reduce((a, s) => a + s.alertas.filter((x) => estadoSeg(s.sid, x.texto) === 'en_atencion').length, 0) : 0;

  // hallazgos por categoría (# sistemas afectados)
  const porCat = CATS.map((c) => ({ t: c, n: lista.filter((s) => s.alertas.some((a) => a.categoria === c)).length, h: lista.reduce((a, s) => a + s.alertas.filter((x) => x.categoria === c).length, 0) }))
    .map((x) => ({ ...x, tip: `${x.t}: ${x.n} sistemas · ${x.h} hallazgos`, href: '#/hallazgos?cat=' + encodeURIComponent(x.t) }))
    .sort((a, b) => b.n - a.n);
  // hallazgos más recurrentes
  const rec = {};
  for (const s of lista) for (const a of s.alertas) { const k = a.es || a.generico; (rec[k] ||= new Set()).add(s.sid); }
  const top = Object.entries(rec).map(([t, set]) => ({ t, n: set.size, tip: `${t}\nSistemas: ${[...set].join(', ')}` })).sort((a, b) => b.n - a.n).slice(0, 10);

  // mapa de salud por familia
  const fams = {};
  for (const s of lista) (fams[s.familia] ||= []).push(s);
  const famOrden = Object.entries(fams).sort((a, b) => Math.max(...b[1].map((s) => ORDEN[s.calif] || 0)) - Math.max(...a[1].map((s) => ORDEN[s.calif] || 0)) || a[0].localeCompare(b[0]));
  const tile = (s) => `<a class="tile ${s.calif || ''}" href="#/sistema/${encodeURIComponent(s.sid)}" data-tip="${esc(`${s.sid} · ${ETQ[s.calif] || 'Sin calificación'}${s.fuenteCalif ? ' (' + s.fuenteCalif + ')' : ''}\n${s.producto || ''}\n${s.reportes.length ? plural(s.alertas.length, 'hallazgo') + ' · ' + s.prioritarias + ' prioritarios' : 'Sin EWA en el periodo'}${s.hosts.length ? '\n' + plural(s.hosts.length, 'host') + ' en inventario' : ''}`)}">
      <div class="sid">${esc(s.sid)} ${st(s.calif, ' ')}</div>
      <div class="p">${esc(s.producto || 'Producto no identificado')}</div>
      <div class="m"><span>${s.reportes.length ? plural(s.alertas.length, 'hallazgo') : '<span class="muted">sin EWA</span>'}</span>${s.prioritarias ? `<span style="color:var(--crit)">${s.prioritarias}!</span>` : ''}</div></a>`;
  const agrupar = q.get('g') === 'landscape' ? 'landscape' : 'estado';
  const grupos = agrupar === 'estado'
    ? ['rojo', 'amarillo', 'sin-datos', 'verde'].map((c) => [ETQ[c], lista.filter((s) => (c === 'sin-datos' ? ['sin-datos', 'desconocido', null, undefined].includes(s.calif) : s.calif === c)).sort((a, b) => b.alertas.length - a.alertas.length || a.sid.localeCompare(b.sid)), c]).filter((g) => g[1].length)
    : famOrden.map(([f, ss]) => [nombreFam(f) || 'Familia ' + f + '*', ss.sort((a, b) => (ORDEN[b.calif] || 0) - (ORDEN[a.calif] || 0) || a.sid.localeCompare(b.sid)), null]);

  // matriz SID x categoría
  const matriz = conEwa.filter((s) => s.alertas.length).sort((a, b) => b.alertas.length - a.alertas.length);
  const maxCel = Math.max(1, ...matriz.flatMap((s) => CATS.map((c) => s.alertas.filter((a) => a.categoria === c).length)));
  const celda = (n) => n ? `<td class="c" style="background:color-mix(in oklab,var(--brand) ${Math.round(18 + (n / maxCel) * 72)}%,var(--surface-2))" data-tip="${n} hallazgos">${n}</td>` : '<td class="c muted" style="background:var(--surface-2)">·</td>';

  // ciclo de vida próximo
  const eol = SIDS.flatMap(eolDe).filter((e) => e.est && e.est.m <= 18 && e.tipo !== 'Extendido');

  return `
  <div class="pagehead"><div><div class="eyebrow">Resumen ejecutivo · ${esc(fMes(estado.mes))}</div><h1>Estado de salud del landscape SAP</h1>
  <p class="sub">${SIDS.length} sistemas · ${ewasMes} EarlyWatch Alerts procesados del periodo · inventario ${esc(inv.archivo || '—')}</p></div>
  <div class="ctl"><button class="btn" data-print>Imprimir / PDF</button></div></div>

  <div class="grid g-kpi">
    ${kpi('Sistemas monitoreados', SIDS.length, `${conEwa.length} con EWA · ${SIDS.length - conEwa.length} solo inventario`)}
    ${kpi('Críticos', `<span style="color:var(--crit)">${dist[0].n}</span>`, 'Calificación roja')}
    ${kpi('En advertencia', `<span style="color:var(--warn)">${dist[1].n}</span>`, 'Calificación amarilla')}
    ${kpi('Saludables', `<span style="color:var(--good)">${dist[2].n}</span>`, `${dist[3].n} sin calificación`)}
    ${WEB ? kpi('Hallazgos abiertos', totalAl - cerrados, `${enAtencion} en atención · ${cerrados} resueltos o aceptados · ${totalPr} prioritarios`)
      : kpi('Hallazgos del EWA', totalAl, `${totalPr} de atención prioritaria`)}
    ${kpi('Hosts inventariados', inv.hosts.length, `${(inv.infra || []).length} activos de infraestructura`)}
  </div>

  <div class="card section">
    <div class="card-h"><h2>Distribución de calificación</h2><span class="muted">EWA del mes; si el sistema no tiene EWA se usa la calificación del inventario</span></div>
    <div class="stack" role="img" aria-label="Distribución de calificaciones">${dist.filter((d) => d.n).map((d) => `<span style="width:${(d.n / SIDS.length) * 100}%;background:${COLOR[d.c]}" data-tip="${ETQ[d.c]}: ${d.n} sistemas"></span>`).join('')}</div>
    <div class="legend">${dist.map((d) => `${st(d.c)} <span class="muted small">${d.n} (${Math.round((d.n / SIDS.length) * 100)}%)</span>`).join('&nbsp;&nbsp;')}</div>
  </div>

  <div class="card section">
    <div class="card-h"><h2>Mapa de salud</h2><span class="toolbar" style="margin:0">
      <a class="btn ${agrupar === 'estado' ? 'primary' : ''}" href="#/resumen?g=estado" style="display:inline-flex;align-items:center;color:inherit;text-decoration:none;height:30px">Por estado</a>
      <a class="btn ${agrupar === 'landscape' ? 'primary' : ''}" href="#/resumen?g=landscape" style="display:inline-flex;align-items:center;color:inherit;text-decoration:none;height:30px">Por landscape</a></span></div>
    <div class="${agrupar === 'landscape' ? 'fams' : ''}">${grupos.map(([t, ss, c]) => `<div class="${agrupar === 'landscape' ? 'fam' : 'grupo'}"><div class="fam-h"><b>${c ? st(c, t) : esc(t)}</b><span class="muted small">${plural(ss.length, 'sistema')}</span></div>
      <div class="tiles">${ss.map(tile).join('')}</div></div>`).join('')}</div>
    <p class="muted small" style="margin:12px 0 0">Clic en un sistema para ver su detalle. ${agrupar === 'landscape' ? '* Agrupación automática por las dos primeras letras del SID; se ajusta en <span class="mono">motor/config.json</span>.' : 'Calificación del EWA del mes; si no hay EWA, la del inventario.'}</p>
  </div>

  <div class="grid g-2 section">
    <div class="card"><div class="card-h"><h2>Sistemas afectados por categoría</h2><span class="muted">sistemas con ≥1 hallazgo</span></div>${bars(porCat, conEwa.length)}</div>
    <div class="card"><div class="card-h"><h2>Hallazgos más recurrentes</h2><span class="muted">número de sistemas</span></div>${bars(top)}</div>
  </div>

  <div class="card section">
    <div class="card-h"><h2>Concentración de hallazgos</h2><span class="muted">sistema × categoría · más oscuro = más hallazgos</span></div>
    ${matriz.length ? `<div style="overflow:auto"><table class="heat"><thead><tr><th></th>${CATS.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${matriz.map((s) => `<tr><td class="s">${linkSid(s.sid)} ${st(s.calif, ' ')}</td>${CATS.map((c) => celda(s.alertas.filter((a) => a.categoria === c).length)).join('')}<td class="c">${s.alertas.length}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Sin hallazgos en el periodo</div>'}
  </div>

  <div class="card section">
    <div class="card-h"><h2>Fin de soporte en los próximos 18 meses</h2><a href="#/ciclo">Ver ciclo de vida completo →</a></div>
    ${eol.length ? tabla('eolTop', [
      { k: 'sid', t: 'SID', html: (e) => linkSid(e.sid) }, { k: 'componente', t: 'Componente' }, { k: 'ref', t: 'Referencia' },
      { k: 'tipo', t: 'Soporte' }, { k: 'fecha', t: 'Fecha', html: (e) => fFecha(e.fecha) }, { k: 'est', t: 'Estado', html: (e) => st(e.est.c, e.est.t), sort: (e) => e.est.m }, { k: 'fuente', t: 'Fuente' },
    ], eol, { orden: 'fecha' }) : '<div class="empty">Sin vencimientos próximos registrados</div>'}
  </div>`;
};

VISTAS.sistema = (sid) => {
  sid = (sid || '').toUpperCase();
  if (!sid || !SIDS.includes(sid)) {
    return `<div class="pagehead"><div><div class="eyebrow">Sistema</div><h1>Selecciona un sistema</h1><p class="sub">Escribe el SID en el buscador superior o elige uno de la lista.</p></div></div>
      <div class="card"><div class="tiles">${SIDS.map((x) => sis(x)).map((s) => `<a class="tile ${s.calif || ''}" href="#/sistema/${encodeURIComponent(s.sid)}"><div class="sid">${esc(s.sid)} ${st(s.calif, ' ')}</div><div class="p">${esc(s.producto)}</div></a>`).join('')}</div></div>`;
  }
  const s = sis(sid);
  const k = s.kpis, h0 = s.hosts[0] || {};
  const rel = SIDS.filter((x) => x !== sid && familiaDe(x) === s.familia);
  const fuente = (ewa, invv) => (ewa != null ? 'EWA' : invv != null ? 'Inventario' : null);
  const kv = (ewaKey, invKey, transf = (x) => x) => { const e = val(k[ewaKey]); const i = invKey ? val(primero(s.hosts, invKey)) : null; return { v: e ?? (i != null ? transf(i) : null), src: fuente(e, i) }; };
  const disp = kv('disponibilidad', 'dispSemanal', pct), rd = kv('respDialogo', 'respDialogo'), rr = kv('respRFC', 'respRFC'),
    cpu = kv('cpuApp', 'maxCpu', pct), cpub = kv('cpuBD', null), tbd = kv('tamanoBD', 'tamanoBD'), cbd = kv('crecimientoBD', 'crecimientoBD'),
    ua = kv('usuariosActivos', 'usuariosActivos');
  const ut = val(primero(s.hosts, 'usuariosTotales')), dumps = val(primero(s.hosts, 'dumpsSemana')) ?? val(primero(s.hosts, 'dumpsMes'));
  const resp = val(primero(s.hosts, 'respHTTP'));
  const eol = eolDe(sid);
  const porCat = CATS.map((c) => ({ c, a: s.alertas.filter((x) => x.categoria === c) })).filter((x) => x.a.length);
  const hist = {};
  for (const r of s.historia) (hist[r.mes] ||= []).push(r);
  const mesesSid = Object.keys(hist).sort().reverse();
  const areas = {};
  for (const r of s.reportes) for (const a of r.areas || []) { const t = a.tema.replace(new RegExp(`\\b${sid}\\b`, 'g'), '').trim(); (areas[t] ||= new Set()); for (const x of a.sub) areas[t].add(x); }

  return `
  <div class="card hero">
    <div>
      <div class="eyebrow">Sistema · ${esc(fMes(estado.mes))}</div>
      <div class="sidbig" style="margin-top:6px">${esc(sid)}</div>
      <div style="margin-top:6px;font-size:15px">${esc(s.producto || 'Producto no identificado')} ${s.version ? `<span class="muted">· ${esc(s.version)}</span>` : ''}</div>
      <div class="meta">
        <div><span>Ambiente</span><b>${fmt(s.ambiente)}</b></div>
        <div><span>Despliegue</span><b>${fmt(primero(s.hosts, 'despliegue'))}</b></div>
        <div><span>NetWeaver / Kernel</span><b>${fmt([val(primero(s.hosts, 'versionNW')), val(primero(s.hosts, 'kernel'))].filter(Boolean).join(' · '))}</b></div>
        <div><span>Base de datos</span><b>${fmt(val(primero(s.hosts, 'bd')) || (s.principal && s.principal.baseDatos))}</b></div>
        <div><span>Sistema operativo</span><b>${fmt(val(primero(s.hosts, 'osVersion')) || val(primero(s.hosts, 'so')) || (s.reportes.flatMap((r) => r.so || [])[0]))}</b></div>
        <div><span>Periodo EWA</span><b>${s.principal ? `${fFecha(s.principal.desde)} – ${fFecha(s.principal.hasta)}` : '<span class="muted">Sin EWA este mes</span>'}</b></div>
        <div><span>Servidores App / BD</span><b>${fmt([val(primero(s.hosts, 'servidoresApp')), val(primero(s.hosts, 'servidoresBD'))].filter((x) => x != null).join(' / '))}</b></div>
        <div><span>Landscape</span><b>${esc(nombreFam(s.familia) || 'Familia ' + s.familia)}</b></div>
      </div>
      ${rel.length ? `<div style="margin-top:14px"><span class="muted small">Sistemas relacionados: </span>${rel.map((x) => `<a class="chip" href="#/sistema/${encodeURIComponent(x)}">${esc(x)} <span class="st ${sis(x).calif || ''}" style="font-size:10px"><i style="width:7px;height:7px"></i></span></a>`).join('')}</div>` : ''}
    </div>
    <div class="badge-big">
      ${st(s.calif, ETQ[s.calif] || 'Sin calificación')}
      <span class="muted small">${s.fuenteCalif ? 'Fuente: ' + s.fuenteCalif : 'Sin calificación disponible'}</span>
      <span class="pill">${s.alertas.length} hallazgos</span>
      ${s.prioritarias ? `<span class="pill prio">${s.prioritarias} prioritarios</span>` : ''}
    </div>
  </div>

  ${!s.reportes.length ? `<div class="note section">No hay EarlyWatch Alert de <b>${esc(sid)}</b> en ${esc(fMes(estado.mes))}. Se muestra la información del inventario. Agrega el EWA en la carpeta <span class="mono">EWAs\\</span> y ejecuta <b>Actualizar tablero.cmd</b>.</div>` : ''}

  <div class="grid g-kpi section">
    ${kpi('Disponibilidad semanal', fmt(disp.v), null, disp.src)}
    ${kpi('Resp. promedio diálogo', fmt(rd.v), k.respPicoDialogo ? 'Hora pico: ' + esc(k.respPicoDialogo) : null, rd.src)}
    ${kpi('Resp. promedio RFC', fmt(rr.v), k.respPicoRFC ? 'Hora pico: ' + esc(k.respPicoRFC) : null, rr.src)}
    ${kpi('CPU máx. servidor App', fmt(cpu.v), cpub.v ? 'CPU máx. BD: ' + esc(cpub.v) : null, cpu.src)}
    ${kpi('Tamaño de BD', fmt(tbd.v), cbd.v ? 'Crecimiento último mes: ' + esc(cbd.v) : null, tbd.src)}
    ${kpi('Usuarios activos', fmt(ua.v), ut ? 'Usuarios totales: ' + esc(ut) : null, ua.src)}
    ${resp ? kpi('Resp. promedio HTTP', fmt(resp), null, 'Inventario') : ''}
    ${dumps != null ? kpi('Dumps', fmt(dumps), null, 'Inventario') : ''}
  </div>

  <div class="grid g-2 section">
    <div class="card">
      <div class="card-h"><h2>Hallazgos del EarlyWatch Alert</h2><span class="muted">${s.alertas.length} · ● rojo = atención prioritaria</span></div>
      ${porCat.length ? porCat.map((g) => `<div class="cat-h"><b>${esc(g.c)}</b><span class="pill">${g.a.length}</span></div>
        ${g.a.map((a) => `<div class="finding"><span class="dot ${a.prioritaria ? 'p' : ''}" title="${a.prioritaria ? 'Atención prioritaria' : 'Advertencia'}"></span><div>${esc(a.es || a.generico)}${a.objeto ? ` <span class="chip mono">${esc(a.objeto)}</span>` : ''}${a.es ? `<div class="en">${esc(a.generico)}</div>` : ''}${WEB ? `<div style="margin-top:6px">${chipSeg(sid, a)}</div>` : ''}</div></div>`).join('')}`).join('')
        : `<div class="empty">${s.reportes.length ? 'El EWA no reporta hallazgos' : 'Sin EWA en el periodo'}</div>`}
    </div>
    <div class="card">
      <div class="card-h"><h2>Ciclo de vida y soporte</h2><span class="muted">al ${fFecha(HOY.toISOString().slice(0, 10))}</span></div>
      ${eol.length ? `<div class="tbl-wrap"><table><thead><tr><th>Componente</th><th>Soporte</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>${eol.map((e) => `<tr><td>${esc(e.componente)}<div class="muted small">${esc(e.ref || '')}</div></td><td>${esc(e.tipo)} <span class="src">${esc(e.fuente)}</span></td><td class="num">${fFecha(e.fecha)}</td><td>${st(e.est.c, e.est.t)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Sin fechas de fin de soporte registradas</div>'}
      ${['mesesSinKernel', 'mesesSinComponentes', 'mesesSinBD'].some((x) => val(primero(s.hosts, x)) != null) ? `<div class="meta" style="margin-top:16px">
        <div><span>Meses sin actualizar kernel</span><b>${fmt(primero(s.hosts, 'mesesSinKernel'))}</b></div>
        <div><span>Meses sin actualizar componentes</span><b>${fmt(primero(s.hosts, 'mesesSinComponentes'))}</b></div>
        <div><span>Meses sin actualizar BD</span><b>${fmt(primero(s.hosts, 'mesesSinBD'))}</b></div></div>` : ''}
    </div>
  </div>

  ${Object.keys(k).length ? `<div class="card section"><div class="card-h"><h2>Indicadores de rendimiento del EWA</h2><span class="muted">Performance Indicators</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">${Object.entries(KPI_EWA).filter(([x]) => k[x]).map(([x, t]) => `<div style="background:var(--surface-2);border-radius:10px;padding:10px 12px"><div class="muted small">${esc(t)}</div><div style="font-size:18px;font-weight:650">${esc(k[x])}</div></div>`).join('')}</div></div>` : ''}

  <div class="card section">
    <div class="card-h"><h2>Reportes EWA del periodo</h2><span class="muted">un sistema puede tener EWA de aplicación y de base de datos HANA</span></div>
    ${tabla('rep-' + sid, [
      { k: 'tipo', t: 'Tipo' }, { k: 'producto', t: 'Producto' }, { k: 'baseDatos', t: 'Base de datos' },
      { k: 'periodo', t: 'Periodo', html: (r) => `${fFecha(r.desde)} – ${fFecha(r.hasta)}`, sort: (r) => r.desde },
      { k: 'calificacion', t: 'Calificación', html: (r) => st(r.calificacion), sort: (r) => -ORDEN[r.calificacion] },
      { k: 'alertas', t: 'Hallazgos', num: true, html: (r) => r.alertas.length, sort: (r) => r.alertas.length },
      { k: 'recomendaciones', t: 'Recomend.', num: true }, { k: 'sesion', t: 'Sesión', html: (r) => `<span class="mono">${fmt(r.sesion)}</span>` },
      { k: 'archivo', t: 'Archivo', html: (r) => linkArchivo(r) + (r.duplicados ? `<div class="muted small">duplicados: ${esc(r.duplicados.join(', '))}</div>` : '') },
    ], s.reportes)}
  </div>

  <div class="card section">
    <div class="card-h"><h2>Servidores</h2><span class="muted">${s.hosts.length} en inventario${s.infra.length ? ' · ' + s.infra.length + ' en infraestructura' : ''}</span></div>
    ${s.hosts.length ? tabla('hosts-' + sid, [
      { k: 'hostname', t: 'Host', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>${h.componente ? ` <span class="chip">${esc(h.componente)}</span>` : ''}` }, { k: 'ip', t: 'IP', html: (h) => `<span class="mono">${fmt(h.ip)}</span>` },
      { k: 'ambiente', t: 'Ambiente' }, { k: 'cpu', t: 'CPU' }, { k: 'memoria', t: 'Memoria', html: (h) => fmt(memoria(h.memoria)) },
      { k: 'osVersion', t: 'Sistema operativo', html: (h) => fmt(val(h.osVersion) || h.so) }, { k: 'hwTipo', t: 'Hardware', html: (h) => fmt(val(h.hwTipo) || h.hwDescripcion) },
    ], s.hosts) : ''}
    ${s.infra.length ? `<div style="margin-top:12px">${tabla('infra-' + sid, [{ k: 'hostname', t: 'Host (infraestructura)', html: (h) => `<span class="mono">${fmt(h.hostname)}</span>` }, { k: 'ip', t: 'IP' }, { k: 'tipo', t: 'Tipo' }, { k: 'so', t: 'SO' }, { k: 'ramMB', t: 'RAM', html: (h) => fmt(memoria(h.ramMB)) }, { k: 'ubicacion', t: 'Ubicación' }, { k: 'descripcion', t: 'Descripción' }], s.infra)}</div>` : ''}
    ${s.reportes.some((r) => r.hosts && r.hosts.length) ? `<div style="margin-top:12px"><span class="muted small">Hosts detectados en el EWA: </span>${[...new Set(s.reportes.flatMap((r) => r.hosts || []))].map((x) => `<span class="chip mono">${esc(x)}</span>`).join('')}</div>` : ''}
    ${!s.hosts.length && !s.infra.length && !s.reportes.some((r) => r.hosts && r.hosts.length) ? '<div class="empty">Sin servidores registrados</div>' : ''}
  </div>

  <div class="grid g-2 section">
    <div class="card"><div class="card-h"><h2>Histórico mensual</h2><span class="muted">${mesesSid.length} ${mesesSid.length === 1 ? 'mes' : 'meses'}</span></div>
      ${mesesSid.length ? `<div class="tbl-wrap"><table><thead><tr><th>Mes</th><th>Calificación</th><th style="text-align:right">Hallazgos</th><th style="text-align:right">Reportes</th></tr></thead><tbody>${mesesSid.map((m) => { const ss = sistema(sid, m); return `<tr><td>${esc(fMes(m))}</td><td>${st(ss.calif)}</td><td class="num">${ss.alertas.length}</td><td class="num">${hist[m].length}</td></tr>`; }).join('')}</tbody></table></div>
      ${mesesSid.length === 1 ? '<p class="muted small" style="margin-top:10px">La tendencia aparecerá al cargar los EWAs de los siguientes meses.</p>' : ''}` : '<div class="empty">Aún sin EWAs para este sistema</div>'}
    </div>
    <div class="card"><div class="card-h"><h2>Áreas revisadas por el EWA</h2><span class="muted">Check Overview</span></div>
      ${Object.keys(areas).length ? Object.entries(areas).map(([t, subs]) => `<div style="margin-bottom:10px"><b class="small">${esc(t)}</b><div>${[...subs].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>`).join('') : '<div class="empty">Sin detalle</div>'}
    </div>
  </div>
  ${val(primero(s.hosts, 'comentarios')) ? `<div class="note section"><b>Comentarios del inventario:</b> ${esc(primero(s.hosts, 'comentarios'))}</div>` : ''}`;
};

VISTAS.hallazgos = (_, q) => {
  const filas = [];
  for (const sid of SIDS) { const s = sis(sid); for (const a of s.alertas) filas.push({ sid, calif: s.calif, ...a }); }
  const cat = q.get('cat') || '', pr = q.get('prio') || '', sg = q.get('seg') || '', txt = (q.get('q') || '').toLowerCase();
  const f = filas.filter((x) => (!cat || x.categoria === cat) && (!pr || (pr === 'si') === x.prioritaria) && (!sg || estadoSeg(x.sid, x.texto) === sg)
    && (!txt || (x.sid + ' ' + x.texto + ' ' + (x.es || '') + ' ' + ((segDe(x.sid, x.texto) || {}).responsable || '')).toLowerCase().includes(txt)));
  const porCat = CATS.map((c) => ({ t: c, n: filas.filter((x) => x.categoria === c).length, href: '#/hallazgos?cat=' + encodeURIComponent(c) })).sort((a, b) => b.n - a.n);
  return `<div class="pagehead"><div><div class="eyebrow">Hallazgos · ${esc(fMes(estado.mes))}</div><h1>Hallazgos de EarlyWatch Alert</h1><p class="sub">${filas.length} hallazgos en ${new Set(filas.map((x) => x.sid)).size} sistemas · ${filas.filter((x) => x.prioritaria).length} de atención prioritaria</p></div></div>
  <div class="grid g-2"><div class="card"><div class="card-h"><h2>Por categoría</h2><span class="muted">clic para filtrar</span></div>${bars(porCat)}</div>
  <div class="card"><div class="card-h"><h2>Cómo leer esta vista</h2></div><p class="muted" style="margin:0">Cada fila es un hallazgo del <i>Alert Overview</i> del EWA, traducido al español (el texto original de SAP se conserva). La <b>categoría</b> y la marca de <b>atención prioritaria</b> se asignan automáticamente por palabras clave (riesgo de seguridad, soporte vencido, autorizaciones críticas); no sustituyen la calificación de SAP.</p></div></div>
  <div class="card section">
    <div class="toolbar">
      <input class="field" id="fTxt" placeholder="Filtrar por SID o texto…" value="${esc(q.get('q') || '')}" style="min-width:240px">
      <select class="field" id="fCat"><option value="">Todas las categorías</option>${CATS.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select class="field" id="fPrio"><option value="">Toda prioridad</option><option value="si" ${pr === 'si' ? 'selected' : ''}>Atención prioritaria</option><option value="no" ${pr === 'no' ? 'selected' : ''}>Advertencia</option></select>
      ${WEB ? `<select class="field" id="fSeg"><option value="">Todo seguimiento</option>${Object.entries(EST).map(([k, v]) => `<option value="${k}" ${k === sg ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
      <span class="spacer"></span><span class="muted small">${f.length} resultados</span>
      <button class="btn" data-csv="hall" data-n="hallazgos_ewa">Exportar CSV</button>
    </div>
    ${tabla('hall', [
      { k: 'sid', t: 'SID', html: (x) => linkSid(x.sid) }, { k: 'calif', t: 'Sistema', html: (x) => st(x.calif), sort: (x) => -ORDEN[x.calif] },
      { k: 'categoria', t: 'Categoría' }, { k: 'prioritaria', t: 'Prioridad', html: (x) => x.prioritaria ? '<span class="pill prio">Prioritaria</span>' : '<span class="pill">Advertencia</span>', sort: (x) => (x.prioritaria ? 0 : 1) },
      { k: 'es', t: 'Hallazgo', w: 320, html: (x) => `${esc(x.es || x.generico)}${x.es ? `<div class="muted small">${esc(x.generico)}</div>` : ''}`, csv: (x) => x.es || x.generico },
      { k: 'objeto', t: 'Objeto', html: (x) => (x.objeto ? `<span class="mono">${esc(x.objeto)}</span>` : '') }, { k: 'origen', t: 'Reporte', html: (x) => esc([...new Set(x.origen)].join(', ')) },
      ...(WEB ? [{ k: 'seg', t: 'Seguimiento', html: (x) => chipSeg(x.sid, x), sort: (x) => estadoSeg(x.sid, x.texto),
        csv: (x) => { const s = segDe(x.sid, x.texto) || {}; return [EST[s.estado || 'abierto'], s.responsable, s.fecha_compromiso, s.comentario].filter(Boolean).join(' · '); } }] : []),
    ], f, { orden: 'prioritaria' })}
  </div>`;
};

VISTAS.rendimiento = () => {
  const filas = SIDS.map(sis).filter((s) => Object.keys(s.kpis).length).map((s) => ({ sid: s.sid, calif: s.calif, producto: s.producto, ...s.kpis }));
  const inventarioPerf = SIDS.map(sis).filter((s) => !Object.keys(s.kpis).length && s.hosts.length).map((s) => ({
    sid: s.sid, calif: s.calif, disponibilidad: pct(primero(s.hosts, 'dispSemanal')), respDialogo: primero(s.hosts, 'respDialogo'), respRFC: primero(s.hosts, 'respRFC'),
    respHTTP: primero(s.hosts, 'respHTTP'), cpuApp: pct(primero(s.hosts, 'maxCpu')), tamanoBD: primero(s.hosts, 'tamanoBD'), usuariosTotales: primero(s.hosts, 'usuariosTotales'),
  })).filter((x) => Object.entries(x).filter(([k]) => !['sid', 'calif'].includes(k)).some(([, v]) => !vacio(v)));
  const cols = (extra) => [{ k: 'sid', t: 'SID', html: (x) => linkSid(x.sid) }, { k: 'calif', t: 'Estado', html: (x) => st(x.calif), sort: (x) => -ORDEN[x.calif] },
    ...extra.map(([k, t]) => ({ k, t, num: true, sort: (x) => num(x[k]) }))];
  const top = filas.filter((x) => num(x.respDialogo) != null).sort((a, b) => num(b.respDialogo) - num(a.respDialogo));
  const topBD = filas.filter((x) => num(x.tamanoBD) != null).sort((a, b) => num(b.tamanoBD) - num(a.tamanoBD));
  return `<div class="pagehead"><div><div class="eyebrow">Rendimiento · ${esc(fMes(estado.mes))}</div><h1>Indicadores de rendimiento</h1><p class="sub">Performance Indicators de los EWAs de aplicación ABAP; los sistemas sin EWA muestran lo capturado en el inventario.</p></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>Tiempo de respuesta en diálogo</h2><span class="muted">ms · promedio semanal</span></div>${top.length ? bars(top.map((x) => ({ t: x.sid, n: num(x.respDialogo), href: '#/sistema/' + x.sid, tip: `${x.sid}: ${x.respDialogo} (pico ${x.respPicoDialogo || '—'})` }))) : '<div class="empty">Sin datos</div>'}</div>
    <div class="card"><div class="card-h"><h2>Tamaño de base de datos</h2><span class="muted">GB</span></div>${topBD.length ? bars(topBD.map((x) => ({ t: x.sid, n: Math.round(num(x.tamanoBD)), href: '#/sistema/' + x.sid, tip: `${x.sid}: ${x.tamanoBD} · crecimiento ${x.crecimientoBD || '—'}` }))) : '<div class="empty">Sin datos</div>'}</div>
  </div>
  <div class="card section"><div class="card-h"><h2>Detalle por sistema (EWA)</h2><button class="btn" data-csv="perf" data-n="rendimiento_ewa">Exportar CSV</button></div>
  ${tabla('perf', cols([['disponibilidad', 'Disponib.'], ['usuariosActivos', 'Usuarios'], ['respDialogo', 'Resp. diálogo'], ['respPicoDialogo', 'Diálogo pico'], ['respRFC', 'Resp. RFC'], ['cpuApp', 'CPU App'], ['cpuBD', 'CPU BD'], ['bdDialogo', 'BD diálogo'], ['tamanoBD', 'Tamaño BD'], ['crecimientoBD', 'Crec. mes']]), filas, { orden: 'sid' })}</div>
  ${inventarioPerf.length ? `<div class="card section"><div class="card-h"><h2>Detalle por sistema (inventario)</h2><button class="btn" data-csv="perfInv" data-n="rendimiento_inventario">Exportar CSV</button></div>
  ${tabla('perfInv', cols([['disponibilidad', 'Disponib.'], ['respDialogo', 'Resp. diálogo'], ['respRFC', 'Resp. RFC'], ['respHTTP', 'Resp. HTTP'], ['cpuApp', 'CPU máx.'], ['tamanoBD', 'Tamaño BD'], ['usuariosTotales', 'Usuarios totales']]), inventarioPerf, { orden: 'sid' })}</div>` : ''}`;
};

VISTAS.ciclo = (_, q) => {
  const todos = SIDS.flatMap(eolDe);
  const filtro = q.get('e') || '';
  const f = todos.filter((e) => !filtro || e.est.t === filtro);
  const grupos = ['Vencido', '≤ 6 meses', '6–18 meses', '> 18 meses'].map((t) => ({ t, n: todos.filter((e) => e.est.t === t).length }));
  const clr = { 'Vencido': 'rojo', '≤ 6 meses': 'rojo', '6–18 meses': 'amarillo', '> 18 meses': 'verde' };
  return `<div class="pagehead"><div><div class="eyebrow">Ciclo de vida</div><h1>Fin de soporte de componentes</h1><p class="sub">Hardware, sistema operativo, producto SAP y base de datos · fechas del inventario y del EWA · referencia: hoy ${fFecha(HOY.toISOString().slice(0, 10))}</p></div></div>
  <div class="grid g-kpi">${grupos.map((g) => `<a href="#/ciclo?e=${encodeURIComponent(g.t)}" style="color:inherit;text-decoration:none">${kpi(g.t, `<span style="color:${COLOR[clr[g.t]]}">${g.n}</span>`, 'fechas de soporte')}</a>`).join('')}</div>
  <div class="card section"><div class="toolbar"><b>${filtro ? esc(filtro) : 'Todos los vencimientos'}</b>${filtro ? ' <a href="#/ciclo">quitar filtro</a>' : ''}<span class="spacer"></span><button class="btn" data-csv="eol" data-n="ciclo_de_vida">Exportar CSV</button></div>
  ${tabla('eol', [{ k: 'sid', t: 'SID', html: (e) => linkSid(e.sid) }, { k: 'componente', t: 'Componente' }, { k: 'ref', t: 'Referencia' }, { k: 'tipo', t: 'Soporte' },
    { k: 'fecha', t: 'Fecha', html: (e) => fFecha(e.fecha) }, { k: 'est', t: 'Estado', html: (e) => st(e.est.c, e.est.t), sort: (e) => e.est.m, csv: (e) => e.est.t }, { k: 'fuente', t: 'Fuente' }], f, { orden: 'fecha' })}</div>`;
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
    <input class="field" id="fInv" data-v="${vista}" placeholder="Buscar host, IP, SID, SO…" value="${esc(q.get('q') || '')}" style="min-width:260px">
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
const fHora = (t) => (t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
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

// ------------------------------------------------------------------ router y eventos
function ruta() {
  const h = location.hash.replace(/^#\/?/, '') || 'resumen';
  const [p, qs] = h.split('?');
  const [v, arg] = p.split('/');
  return { v: VISTAS[v] ? v : 'resumen', arg: arg ? decodeURIComponent(arg) : '', q: new URLSearchParams(qs || '') };
}
function render() {
  const r = ruta();
  const permitida = !VISTAS[r.v].roles || (YO && VISTAS[r.v].roles.includes(YO.rol));
  app.innerHTML = permitida ? VISTAS[r.v](r.arg, r.q) : '<div class="card empty">No tienes permiso para esta sección.</div>';
  if (permitida && VISTAS[r.v].despues) VISTAS[r.v].despues(r);
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.r === r.v));
  if (r.v === 'sistema' && r.arg) $('#tabs a[data-r=sistema]').href = '#/sistema/' + encodeURIComponent(r.arg);
  document.title = (r.v === 'sistema' && r.arg ? r.arg.toUpperCase() + ' · ' : '') + 'Salud de Sistemas SAP';
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

const selMes = $('#selMes');
selMes.innerHTML = meses.length ? meses.map((m) => `<option value="${m}" ${m === estado.mes ? 'selected' : ''}>EWA ${esc(fMes(m))}</option>`).join('') : '<option>Sin EWAs</option>';
selMes.addEventListener('change', () => { estado.mes = selMes.value; CACHE = {}; try { localStorage.setItem('tablero.mes', estado.mes); } catch {} render(); });

// tema
const aplicarTema = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('tablero.tema', t); } catch {} };
try { aplicarTema(localStorage.getItem('tablero.tema') || 'dark'); } catch { aplicarTema('dark'); }
$('#btnTema').addEventListener('click', () => aplicarTema(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));

// buscador de SID
const busca = $('#buscaSid'), lista = $('#comboList');
let act = 0;
function opciones() {
  const t = busca.value.trim().toLowerCase();
  return SIDS.map(sis).filter((s) => !t || s.sid.toLowerCase().includes(t) || (s.producto || '').toLowerCase().includes(t) || s.hosts.some((h) => String(h.hostname || '').toLowerCase().includes(t)) || s.reportes.some((r) => (r.hosts || []).some((x) => x.includes(t))))
    .sort((a, b) => (b.sid.toLowerCase().startsWith(t) ? 1 : 0) - (a.sid.toLowerCase().startsWith(t) ? 1 : 0)).slice(0, 40);
}
function pintaLista() {
  const o = opciones();
  lista.innerHTML = o.length ? o.map((s, i) => `<a href="#/sistema/${encodeURIComponent(s.sid)}" class="${i === act ? 'act' : ''}" role="option"><span><b>${esc(s.sid)}</b> <span class="muted small">${esc(s.producto || '')}</span></span>${st(s.calif, ' ')}</a>`).join('') : '<div class="muted" style="padding:10px 12px">Sin coincidencias</div>';
  lista.style.display = 'block';
}
busca.addEventListener('focus', () => { act = 0; pintaLista(); });
busca.addEventListener('input', () => { act = 0; pintaLista(); });
busca.addEventListener('keydown', (e) => {
  const o = opciones();
  if (e.key === 'ArrowDown') { act = Math.min(act + 1, o.length - 1); pintaLista(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { act = Math.max(act - 1, 0); pintaLista(); e.preventDefault(); }
  else if (e.key === 'Enter' && o[act]) { location.hash = '#/sistema/' + encodeURIComponent(o[act].sid); busca.value = ''; busca.blur(); }
  else if (e.key === 'Escape') busca.blur();
});
busca.addEventListener('blur', () => setTimeout(() => { lista.style.display = 'none'; }, 150));
lista.addEventListener('mousedown', (e) => { const a = e.target.closest('a'); if (a) { location.hash = a.getAttribute('href'); busca.value = ''; } });

// filtros, orden de tablas, CSV
let tFiltro;
app.addEventListener('input', (e) => {
  const id = e.target.id;
  if (!['fTxt', 'fInv'].includes(id)) return;
  clearTimeout(tFiltro);
  tFiltro = setTimeout(() => {
    const r = ruta(); r.q.set(id === 'fInv' ? 'q' : 'q', e.target.value); if (id === 'fInv') r.q.set('v', e.target.dataset.v);
    if (!e.target.value) r.q.delete('q');
    history.replaceState(null, '', `#/${r.v}?${r.q}`); render();
    const el = document.getElementById(id); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, 250);
});
app.addEventListener('change', (e) => {
  if (!['fCat', 'fPrio', 'fSeg'].includes(e.target.id)) return;
  const r = ruta(); const k = { fCat: 'cat', fPrio: 'prio', fSeg: 'seg' }[e.target.id];
  e.target.value ? r.q.set(k, e.target.value) : r.q.delete(k);
  location.hash = `#/${r.v}?${r.q}`;
});
app.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-t]');
  if (th) { const t = TABLAS[th.dataset.t]; if (!t) return; t.st.dir = t.st.orden === th.dataset.k ? -t.st.dir : 1; t.st.orden = th.dataset.k; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  const b = e.target.closest('[data-csv]');
  if (b) csv(b.dataset.csv, b.dataset.n);
  if (e.target.closest('[data-print]')) window.print();
  const sg = e.target.closest('[data-seg]');
  if (sg && puedeEditar()) editarSeg(sg.dataset.seg, sg.dataset.h);
});

// tooltip
const tip = $('#tip');
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.style.display = 'none'; return; }
  tip.innerHTML = esc(el.dataset.tip).replace(/\n/g, '<br>');
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
  tip.style.top = (e.clientY + 16 + h > innerHeight ? e.clientY - h - 10 : e.clientY + 16) + 'px';
});

$('#pie').innerHTML = WEB
  ? `${D.publicacion ? `Publicación #${esc(D.publicacion.id)} del ${esc(new Date(D.publicacion.publicado_en).toLocaleString('es-MX'))} por ${esc(D.publicacion.publicado_por)} · ` : ''}${D.generado ? 'datos generados el ' + esc(new Date(D.generado).toLocaleString('es-MX')) + ' · ' : ''}${reportes.length} EWAs en histórico · acceso controlado · Información confidencial DXC / KOF`
  : `Datos generados el ${esc(new Date(D.generado).toLocaleString('es-MX'))} · ${reportes.length} EWAs en histórico · procesamiento 100% local en este equipo · Información confidencial DXC / KOF`;
document.querySelectorAll('#tabs a[data-rol]').forEach((a) => { a.hidden = !(YO && a.dataset.rol.split(',').includes(YO.rol)); });
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
