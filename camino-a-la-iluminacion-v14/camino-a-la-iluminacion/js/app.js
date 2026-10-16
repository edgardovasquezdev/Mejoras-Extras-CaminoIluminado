/* app.js — interfaz Bootstrap: navegación, solicitud con pago Yape, mis solicitudes, donaciones y panel. */
(() => {
  const R = location.pathname.includes('/paginas/admin/') ? '../../' : location.pathname.includes('/paginas/') ? '../' : '';
  const YAPE = '908502563';
  const ETQ = { bautizo: 'Bautizo', matrimonio: 'Matrimonio', primera_comunion: 'Primera Comunión', confirmacion: 'Confirmación', arancel: 'Arancel', donacion: 'Ofrenda', diezmo: 'Diezmo', partida: 'Partida', dni: 'DNI', acta: 'Acta' };
  const luhn = (n) => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d) { x *= 2; if (x > 9) x -= 9; } s += x; d = !d; } return s % 10 === 0; };
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined && x !== null) e.textContent = x; return e; };
  const soles = (n) => 'S/ ' + Number(n || 0).toFixed(2);
  const fecha = (s) => (s ? new Date(s).toLocaleDateString('es-PE', { timeZone: 'UTC' }) : '');
  const fechaHora = (s) => (s ? new Date(s).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ESTADOS = { pendiente: ['warning', 'Pendiente de verificación'], aprobado: ['success', 'Verificado'], validado: ['success', 'Validado'],
    rechazado: ['danger', 'Rechazado'], confirmada: ['success', 'Confirmada'], rechazada: ['danger', 'Rechazada'], sin_pago: ['secondary', 'Sin pago'] };
  const badge = (e) => { const m = ESTADOS[e] || ['secondary', e || '—']; return el('span', 'badge text-bg-' + m[0], m[1]); };

  /* ---------- toasts y diálogos ---------- */
  const toast = (msg, tipo = 'success') => {
    let c = $('#toasts');
    if (!c) { c = el('div', 'toast-container position-fixed top-0 end-0 p-3'); c.id = 'toasts'; document.body.append(c); }
    const t = el('div', `toast align-items-center text-bg-${tipo} border-0`); t.setAttribute('role', 'alert');
    const f = el('div', 'd-flex'); const x = el('button', 'btn-close btn-close-white me-2 m-auto'); x.dataset.bsDismiss = 'toast';
    f.append(el('div', 'toast-body', msg), x); t.append(f); c.append(t); new bootstrap.Toast(t, { delay: 4500 }).show();
  };
  const dialogo = (titulo, cuerpo, ok = 'Confirmar', conMotivo = false) => new Promise((res) => {
    const m = el('div', 'modal fade'); m.tabIndex = -1;
    const d = el('div', 'modal-dialog modal-dialog-centered'), c = el('div', 'modal-content');
    const h = el('div', 'modal-header'), b = el('div', 'modal-body'), f = el('div', 'modal-footer');
    h.append(el('h2', 'modal-title h5', titulo)); b.append(cuerpo);
    let ta; if (conMotivo) { ta = el('textarea', 'form-control mt-3'); ta.rows = 3; ta.maxLength = 255; ta.placeholder = 'Observación (mínimo 5 caracteres)'; b.append(ta); }
    const no = el('button', 'btn btn-outline-secondary', 'Cancelar'); no.dataset.bsDismiss = 'modal';
    const si = el('button', 'btn btn-gold', ok); f.append(no, si); c.append(h, b, f); d.append(c); m.append(d); document.body.append(m);
    const bm = new bootstrap.Modal(m); let valor = null;
    si.onclick = () => { if (conMotivo && ta.value.trim().length < 5) { ta.classList.add('is-invalid'); return; } valor = conMotivo ? ta.value.trim() : true; bm.hide(); };
    m.addEventListener('hidden.bs.modal', () => { m.remove(); res(valor); }); bm.show();
  });
  const texto = (t) => el('p', 'mb-0', t);

  /* ---------- navegación ---------- */
  const nav = () => {
    const s = Sesion.obtener(), n = $('#nav');
    n.className = 'navbar navbar-expand-lg app-nav sticky-top';
    const cont = el('div', 'container'), marca = el('a', 'navbar-brand', '✝ Camino a la Iluminación'); marca.href = R + 'index.html';
    const tog = el('button', 'navbar-toggler'); tog.type = 'button'; tog.dataset.bsToggle = 'collapse'; tog.dataset.bsTarget = '#menu'; tog.setAttribute('aria-label', 'Menú');
    tog.append(el('span', 'navbar-toggler-icon'));
    const menu = el('div', 'collapse navbar-collapse'); menu.id = 'menu';
    const ul = el('ul', 'navbar-nav ms-auto align-items-lg-center gap-lg-2');
    const enlace = (t, h, c = 'nav-link') => { const li = el('li', 'nav-item'), a = el('a', c, t); a.href = h; li.append(a); ul.append(li); };
    enlace('Iglesias', R + 'paginas/mapa.html'); enlace('Avisos', R + 'paginas/avisos.html');
    if (s) { enlace('Nueva solicitud', R + 'paginas/reservas.html'); enlace('Mis solicitudes', R + 'paginas/mis-solicitudes.html'); enlace('Donar', R + 'paginas/donaciones.html'); }
    if (s && s.rol === 'administrador') { enlace('Panel', R + 'paginas/admin/panel.html'); enlace('Avisos (admin)', R + 'paginas/admin/avisos.html'); enlace('Horarios (admin)', R + 'paginas/admin/horarios.html'); }
    if (s) {
      const li = el('li', 'nav-item d-flex align-items-center gap-2 ms-lg-2'), out = el('button', 'btn btn-outline-light btn-sm', 'Salir');
      out.onclick = async () => { try { await Api.post('/logout'); } catch (e) { /* sesión ya cerrada */ } Sesion.cerrar(); location.href = R + 'paginas/login.html'; };
      li.append(el('span', 'text-white-50 small', s.nombre.split(' ')[0]), out); ul.append(li);
    } else { enlace('Ingresar', R + 'paginas/login.html'); enlace('Crear cuenta', R + 'paginas/registro.html', 'btn btn-gold btn-sm'); }
    menu.append(ul); cont.append(marca, tog, menu); n.append(cont);
  };

  const b64 = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
  const archivoOk = (inp) => {
    const a = inp.files[0]; if (!a) { inp.setCustomValidity(''); return; }
    const re = inp.dataset.img ? /\.(jpe?g|png)$/i : /\.(jpe?g|png|pdf)$/i;
    inp.setCustomValidity(re.test(a.name) && a.size <= 5 * 1024 * 1024 ? '' : 'Formato no válido o supera 5 MB.'); inp.reportValidity();
  };
  const yapeCopiar = () => document.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(YAPE); b.textContent = '¡Copiado!'; setTimeout(() => (b.textContent = 'Copiar'), 1500);
  }));

  /* ---------- solicitud de sacramento (asistente de 4 pasos) ---------- */
  async function solicitud() {
    const f = $('#wizard'), pasos = [...f.querySelectorAll('.paso')], barra = $('#barra'); let i = 0, monto = 0;
    const [aranceles, parroquias] = await Promise.all([Api.get('/aranceles'), Api.get('/parroquias')]);
    aranceles.forEach((a) => {
      const col = el('div', 'col-6 col-md-3'), r = el('input', 'btn-check'); r.type = 'radio'; r.name = 'sacramento'; r.id = 's-' + a.sacramento; r.value = a.sacramento; r.required = true; r.dataset.monto = a.monto;
      const l = el('label', 'opcion w-100'); l.htmlFor = r.id; l.append(el('strong', '', ETQ[a.sacramento]), el('span', 'd-block text-secondary small', 'Arancel'), el('span', 'd-block fw-semibold', soles(a.monto)));
      col.append(r, l); $('#aranceles').append(col);
      r.addEventListener('change', () => { monto = Number(a.monto); $('#acta').required = a.sacramento === 'matrimonio'; });
    });
    parroquias.forEach((p) => { const o = el('option', '', p.nombre); o.value = p.id; $('#parroquia').append(o); });
    $('#nombre').value = Sesion.obtener().nombre; $('#fecha').min = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    const ir = (n) => { i = n; pasos.forEach((p, k) => p.classList.toggle('d-none', k !== i)); barra.style.width = ((i + 1) / pasos.length * 100) + '%'; $('#etiqueta-paso').textContent = `Paso ${i + 1} de ${pasos.length}`; scrollTo({ top: 0, behavior: 'smooth' }); };
    const valido = () => [...pasos[i].querySelectorAll('input,select,textarea')].every((c) => c.reportValidity());
    f.querySelectorAll('[data-sig]').forEach((b) => b.addEventListener('click', () => { if (valido()) { ir(i + 1); $('#monto-total').textContent = soles(monto); } }));
    f.querySelectorAll('[data-ant]').forEach((b) => b.addEventListener('click', () => ir(i - 1)));
    f.querySelectorAll('input[type=file]').forEach((x) => x.addEventListener('change', () => {
      archivoOk(x); if (x.id === 'voucher' && x.files[0] && x.checkValidity()) { const v = $('#vista-voucher'); v.src = URL.createObjectURL(x.files[0]); v.classList.remove('d-none'); }
    }));
    let metodo = 'yape';
    const setMetodo = (m) => {
      metodo = m;
      f.querySelectorAll('[data-metodo]').forEach((b) => b.classList.toggle('activo', b.dataset.metodo === m));
      $('#panel-qr').classList.toggle('d-none', m === 'tarjeta'); $('#panel-tarjeta').classList.toggle('d-none', m !== 'tarjeta');
      $('#panel-qr').querySelectorAll('input').forEach((x) => (x.required = m !== 'tarjeta'));
      (m === 'tarjeta' ? $('#panel-qr') : $('#panel-tarjeta')).querySelectorAll('input').forEach((x) => x.setCustomValidity(''));
      $('#panel-tarjeta').querySelectorAll('input').forEach((x) => (x.required = m === 'tarjeta'));
      $('#qr-img').src = R + 'img/' + (m === 'plin' ? 'plin' : 'yape') + '-qr.png';
      $('#qr-titulo').textContent = m === 'plin' ? 'Plinea a este número' : 'Yapea a este número';
    };
    f.querySelectorAll('[data-metodo]').forEach((b) => b.addEventListener('click', () => setMetodo(b.dataset.metodo)));
    $('#tc-numero').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 19); e.target.value = d.replace(/(.{4})/g, '$1 ').trim(); e.target.setCustomValidity(d.length >= 13 && luhn(d) ? '' : 'Número de tarjeta no válido.'); });
    $('#tc-vence').addEventListener('input', (e) => {
      let d = e.target.value.replace(/\D/g, '').slice(0, 4); if (d.length > 2) d = d.slice(0, 2) + '/' + d.slice(2); e.target.value = d;
      const hoy = new Date(), ok = /^(0[1-9]|1[0-2])\/\d{2}$/.test(d) && new Date(2000 + Number(d.slice(3)), Number(d.slice(0, 2)), 0) >= new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      e.target.setCustomValidity(ok ? '' : 'Vencimiento no válido (MM/AA).');
    });
    $('#dniSac').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); e.target.setCustomValidity(e.target.value.length === 8 ? '' : 'El DNI debe tener exactamente 8 dígitos.'); });
    setMetodo('yape'); yapeCopiar(); ir(0);

    $('#btn-revisar').addEventListener('click', async () => {
      if (!valido()) return;
      const dl = el('dl', 'row mb-0');
      [['Sacramento', ETQ[f.sacramento.value]], ['Parroquia', $('#parroquia').selectedOptions[0].text], ['Solicitante', $('#nombre').value.trim()], ['Fecha deseada', fecha($('#fecha').value)],
        ['DNI sacramentado', $('#dniSac').value], ['Método de pago', { yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta' }[metodo]], ['Monto', soles(monto)]].forEach(([k, v]) => { const a = el('dt', 'col-5', k), b = el('dd', 'col-7', v); dl.append(a, b); });
      if (!(await dialogo('Confirma tu solicitud', dl, 'Enviar solicitud'))) return;
      const btn = $('#btn-revisar'); btn.disabled = true;
      try {
        const body = { sacramento: f.sacramento.value, idParroquia: Number($('#parroquia').value), nombre: $('#nombre').value, dniSacramentado: $('#dniSac').value, fecha: $('#fecha').value, notas: $('#notas').value, metodo };
        if (metodo === 'tarjeta') Object.assign(body, { tarjetaTitular: $('#tc-titular').value, tarjetaNumero: $('#tc-numero').value, tarjetaVence: $('#tc-vence').value, tarjetaCvv: $('#tc-cvv').value });
        else Object.assign(body, { numeroOperacion: $('#numeroOperacion').value, yapeOrigen: $('#yapeOrigen').value });
        for (const k of ['voucher', 'partida', 'dni', 'acta']) { const a = $('#' + k).files[0]; if (a) { body[k] = await b64(a); body[k + 'Nombre'] = a.name; } }
        const r = await Api.post('/solicitudes', body);
        const ok = el('div', 'card cai-card p-4 text-center'), h = el('h1', 'h3', '¡Solicitud enviada!'), a = el('a', 'btn btn-gold mt-3', 'Ver mis solicitudes'); a.href = R + 'paginas/mis-solicitudes.html';
        ok.append(el('div', 'display-4', '✅'), h, el('p', 'fs-5 mb-1', `Código ${r.codigo}`), el('p', 'text-secondary', 'Tu pago de Yape está pendiente de verificación. Te avisaremos cuando sea revisado.'), a);
        $('#app').replaceChildren(ok);
      } catch (e) { toast(e.message, 'danger'); btn.disabled = false; }
    });
  }

  /* ---------- mis solicitudes + notificaciones (se actualiza solo) ---------- */
  async function mis() {
    const pintar = async () => {
      const [sol, nots] = await Promise.all([Api.get('/solicitudes/mias'), Api.get('/notificaciones')]);
      const lista = $('#lista'); lista.replaceChildren();
      if (!sol.length) { const p = el('p', 'text-secondary', 'Aún no tienes solicitudes. '), a = el('a', '', 'Crear una'); a.href = R + 'paginas/reservas.html'; p.append(a); lista.append(p); }
      sol.forEach((s) => {
        const col = el('div', 'col-12 col-lg-6'), c = el('div', 'card cai-card p-3 h-100'), top = el('div', 'd-flex justify-content-between align-items-start gap-2');
        const t = el('div'); t.append(el('div', 'fw-semibold', ETQ[s.sacramento]), el('div', 'small text-secondary', `RES-${s.id_reserva} · ${s.nombre_solicitante}`), el('div', 'small text-secondary', s.parroquia + (s.metodo ? ' · ' + { yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta' }[s.metodo] : '')));
        top.append(t, badge(s.pago_estado || 'sin_pago')); c.append(top, el('div', 'small mt-2', `Fecha deseada: ${fecha(s.fecha_solicitada)} · Monto: ${soles(s.monto)}`), el('div', 'small', `Documentos validados: ${s.docs_ok} de ${s.docs_total}`));
        if (s.observacion) c.append(el('div', 'alert alert-danger small mt-2 mb-0', 'Observación: ' + s.observacion));
        if (s.id_pago) { const b = el('button', 'btn btn-sm btn-outline-secondary mt-2 align-self-start', 'Ver voucher'); b.onclick = () => Api.abrirArchivo(`/pagos/${s.id_pago}/voucher`).catch((e) => toast(e.message, 'danger')); c.append(b); }
        col.append(c); lista.append(col);
      });
      const nl = $('#notas'); nl.replaceChildren();
      if (!nots.length) nl.append(el('p', 'text-secondary small', 'No tienes notificaciones.'));
      nots.forEach((n) => { const d = el('div', 'border-bottom py-2'); d.append(el('div', 'fw-semibold small', n.asunto), el('div', 'small', n.mensaje), el('div', 'small text-secondary', fechaHora(n.creada_en))); nl.append(d); });
    };
    await pintar(); setInterval(() => pintar().catch(() => {}), 15000);
  }

  /* ---------- donaciones y diezmos ---------- */
  function donaciones() {
    const f = $('#donacion'); yapeCopiar();
    $('#voucher').addEventListener('change', (e) => archivoOk(e.target));
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!f.reportValidity()) return;
      const b = $('#enviar'); b.disabled = true;
      try {
        await Api.post('/donaciones', { concepto: $('#concepto').value, metodo: $('#metodo').value, monto: $('#monto').value, numeroOperacion: $('#numeroOperacion').value, yapeOrigen: $('#yapeOrigen').value, voucher: await b64($('#voucher').files[0]) });
        f.reset(); toast('¡Gracias por tu aporte! Será verificado por la parroquia.');
      } catch (err) { toast(err.message, 'danger'); }
      b.disabled = false;
    });
  }

  /* ---------- panel administrativo: resumen, fieles, iglesias, anuncios, pagos y documentos ---------- */
  const SACS = ['bautizo', 'matrimonio', 'primera_comunion', 'confirmacion'].map((k) => [k, ETQ[k]]);
  const METODO = { yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta' };
  async function panel() {
    const vista = $('#vista'), igs = await Api.get('/parroquias'), IGS = igs.map((i) => [i.id, i.nombre]);
    const tabla = (cols, filas, vacio) => {
      const w = el('div', 'table-responsive cai-card bg-white'), t = el('table', 'table align-middle mb-0'), h = el('thead'), hr = el('tr');
      cols.forEach((c) => hr.append(el('th', '', c))); h.append(hr); const b = el('tbody');
      if (!filas.length) { const r = el('tr'), td = el('td', 'text-secondary', vacio); td.colSpan = cols.length; r.append(td); b.append(r); }
      filas.forEach((f) => { const r = el('tr'); f.forEach((c) => { const td = el('td'); td.append(c instanceof Node ? c : document.createTextNode(c ?? '')); r.append(td); }); b.append(r); });
      t.append(h, b); w.append(t); return w;
    };
    const boton = (txt, cls, fn) => { const b = el('button', 'btn btn-sm ' + cls, txt); b.type = 'button'; b.onclick = fn; return b; };
    const acciones = (...bs) => { const d = el('div', 'd-flex gap-1 flex-wrap'); d.append(...bs); return d; };
    const campo = (id, etiqueta, tipo = 'text', attrs = {}) => {
      const d = el('div', 'ios-campo'), l = el('label', '', etiqueta); l.htmlFor = id;
      const i = el(tipo === 'textarea' ? 'textarea' : tipo === 'select' ? 'select' : 'input', 'ios-input'); i.id = id;
      if (tipo !== 'textarea' && tipo !== 'select') i.type = tipo; Object.assign(i, attrs); d.append(l, i); return d;
    };
    const llenar = (cont, lista, vacio) => { const s = $('select', cont); if (vacio) s.append(new Option(vacio, '')); lista.forEach(([v, t]) => s.append(new Option(t, v))); return cont; };
    const intentar = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, 'danger'); } };
    const marcar = (cont, id, msg) => { cont.classList.toggle('con-error', !!msg); let e = $('.error-campo', cont); if (!e) { e = el('span', 'error-campo'); cont.append(e); } e.textContent = msg || ''; return !msg; };
    const pagoBadge = (estado, metodo) => { const s = el('span'); s.append(badge(estado)); if (metodo) s.append(document.createTextNode(' ' + METODO[metodo])); return s; };
    const resolver = async (url, ok, rot, accion, clave) => {
      const r = await dialogo(ok ? rot[0] : rot[1], texto(ok ? 'El feligrés será notificado.' : 'Indica el motivo; el feligrés lo verá.'), ok ? 'Confirmar' : 'Rechazar', !ok);
      if (r) await intentar(async () => { await Api.put(url, ok ? { accion: accion[0] } : { accion: accion[1], [clave]: r }); await mostrar(actual); }, 'Actualizado.');
    };
    let actual = 'resumen';

    const vistas = {
      async resumen() {
        const k = await Api.get('/admin/kpis'), g = el('div', 'row g-3');
        [['Sacramentos este mes', k.sacramentos_mes], ['Fieles registrados', k.creyentes], ['Iglesias', k.iglesias], ['Anuncios y eventos', k.anuncios], ['Pagos por verificar', k.pagos_pendientes],
          ['Recaudado con Yape', soles(k.yape)], ['Recaudado con Plin', soles(k.plin)], ['Recaudado con tarjeta', soles(k.tarjeta)]].forEach(([t, v]) => {
          const col = el('div', 'col-6 col-lg-3'), c = el('div', 'ios-kpi'); c.append(el('div', 'ios-kpi-t', t), el('div', 'ios-kpi-v', v)); col.append(c); g.append(col);
        });
        vista.replaceChildren(g);
      },

      async creyentes() {
        const est = { pagina: 1 }, filtros = el('div', 'ios-panel'), grid = el('div', 'ios-filtros');
        grid.append(campo('f-q', 'Buscar nombre o DNI'), llenar(campo('f-sac', 'Sacramento', 'select'), SACS, 'Todos'), llenar(campo('f-ig', 'Iglesia', 'select'), IGS, 'Todas'), campo('f-d', 'Desde', 'date'), campo('f-h', 'Hasta', 'date'));
        const resultado = el('div'), info = el('span', 'small text-secondary'), prev = boton('‹ Anterior', 'btn-outline-secondary', () => { est.pagina--; intentar(cargar); }), sig = boton('Siguiente ›', 'btn-outline-secondary', () => { est.pagina++; intentar(cargar); });
        const cargar = async () => {
          const p = new URLSearchParams({ q: $('#f-q').value, sacramento: $('#f-sac').value, parroquia: $('#f-ig').value, desde: $('#f-d').value, hasta: $('#f-h').value, pagina: est.pagina, tam: 10 });
          const r = await Api.get('/admin/creyentes?' + p), paginas = Math.max(1, Math.ceil(r.total / r.tam));
          resultado.replaceChildren(tabla(['Fiel', 'DNI', 'Sacramento', 'Iglesia', 'Fecha', 'Pago', 'Origen', ''], r.filas.map((c) => [c.nombre, c.dni, ETQ[c.sacramento], c.parroquia, fecha(c.fecha_sacramento),
            c.pago_estado ? pagoBadge(c.pago_estado, c.metodo) : '—', c.origen === 'web' ? 'Web' : 'Manual',
            c.origen === 'manual' ? boton('Eliminar', 'btn-outline-danger', async () => { if (await dialogo('¿Eliminar registro?', texto('Esta acción no se puede deshacer.'), 'Eliminar')) intentar(async () => { await Api.del('/admin/creyentes/' + c.id_creyente); await cargar(); }, 'Eliminado.'); }) : '']), 'No hay resultados.'));
          info.textContent = `${r.total} fieles · Página ${r.pagina} de ${paginas}`; prev.disabled = r.pagina <= 1; sig.disabled = r.pagina >= paginas;
        };
        filtros.append(grid);
        const nuevo = el('details', 'ios-panel'), g2 = el('div', 'ios-filtros'), btn = el('button', 'btn btn-gold', 'Registrar fiel');
        nuevo.append(el('summary', 'fw-semibold mb-2', '＋ Registrar fiel manualmente'));
        g2.append(campo('n-nombre', 'Nombre y apellido', 'text', { maxLength: 150 }), campo('n-dni', 'DNI', 'text', { maxLength: 8, inputMode: 'numeric' }), llenar(campo('n-sac', 'Sacramento', 'select'), SACS), llenar(campo('n-ig', 'Iglesia', 'select'), IGS), campo('n-f', 'Fecha del sacramento', 'date'));
        nuevo.append(g2, btn);
        vista.replaceChildren(filtros, nuevo, resultado, (() => { const d = el('div', 'd-flex justify-content-between align-items-center mt-3'); d.append(prev, info, sig); return d; })());
        $('#n-dni').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); marcar(e.target.parentElement, 'n-dni', e.target.value.length === 8 ? '' : 'El DNI debe tener exactamente 8 dígitos.'); });
        btn.onclick = () => {
          const ok = [marcar($('#n-nombre').parentElement, 'n-nombre', Validar.nombre($('#n-nombre').value)), marcar($('#n-dni').parentElement, 'n-dni', /^\d{8}$/.test($('#n-dni').value) ? '' : 'El DNI debe tener exactamente 8 dígitos.'),
            marcar($('#n-f').parentElement, 'n-f', $('#n-f').value ? '' : 'Elige una fecha.')].every(Boolean);
          if (ok) intentar(async () => { await Api.post('/admin/creyentes', { nombre: Validar.limpiar($('#n-nombre').value), dni: $('#n-dni').value, sacramento: $('#n-sac').value, idParroquia: Number($('#n-ig').value), fecha: $('#n-f').value });
            ['#n-nombre', '#n-dni', '#n-f'].forEach((i) => ($(i).value = '')); await cargar(); }, 'Fiel registrado.');
        };
        let t; $('#f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { est.pagina = 1; intentar(cargar); }, 300); });
        ['#f-sac', '#f-ig', '#f-d', '#f-h'].forEach((i) => $(i).addEventListener('change', () => { est.pagina = 1; intentar(cargar); }));
        await cargar();
      },

      async iglesias() {
        const lista = await Api.get('/parroquias'), form = el('div', 'ios-panel'); let editando = 0;
        const checks = el('div', 'd-flex flex-wrap gap-3 mb-3'); SACS.forEach(([k, t]) => { const l = el('label', 'd-flex align-items-center gap-2'), c = el('input'); c.type = 'checkbox'; c.value = t; l.append(c, document.createTextNode(t)); checks.append(l); });
        const g = el('div', 'ios-filtros'); g.append(campo('i-nombre', 'Nombre de la iglesia', 'text', { maxLength: 120 }), campo('i-dir', 'Dirección', 'text', { maxLength: 200 }), campo('i-lat', 'Latitud', 'number', { step: 'any' }), campo('i-lng', 'Longitud', 'number', { step: 'any' }));
        const guardar = el('button', 'btn btn-gold', 'Guardar iglesia'), cancelar = boton('Cancelar edición', 'btn-outline-secondary d-none', () => limpiar());
        const titulo = el('div', 'fw-semibold mb-2', 'Nueva iglesia');
        const limpiar = () => { editando = 0; titulo.textContent = 'Nueva iglesia'; ['#i-nombre', '#i-dir', '#i-lat', '#i-lng'].forEach((i) => ($(i).value = '')); checks.querySelectorAll('input').forEach((c) => (c.checked = false)); cancelar.classList.add('d-none'); };
        form.append(titulo, g, el('div', 'small text-secondary mb-2', 'Sacramentos disponibles'), checks, el('div', 'd-flex gap-2', ''), guardar, cancelar);
        guardar.onclick = () => {
          const ok = [marcar($('#i-nombre').parentElement, 'i-nombre', Validar.texto($('#i-nombre').value, 3, 120, 'El nombre')), marcar($('#i-dir').parentElement, 'i-dir', Validar.texto($('#i-dir').value, 5, 200, 'La dirección'))].every(Boolean);
          if (!ok) return;
          const body = { nombre: Validar.limpiar($('#i-nombre').value), direccion: $('#i-dir').value.trim(), latitud: $('#i-lat').value, longitud: $('#i-lng').value, sacramentos: [...checks.querySelectorAll('input:checked')].map((c) => c.value).join(',') };
          intentar(async () => { editando ? await Api.put('/admin/parroquias/' + editando, body) : await Api.post('/admin/parroquias', body); await mostrar('iglesias'); }, 'Iglesia guardada.');
        };
        vista.replaceChildren(form, tabla(['Iglesia', 'Dirección', 'Sacramentos', ''], lista.map((i) => [i.nombre, i.direccion, i.sacramentos.join(', '),
          acciones(boton('Editar', 'btn-outline-secondary', () => { editando = i.id; titulo.textContent = 'Editar: ' + i.nombre; $('#i-nombre').value = i.nombre; $('#i-dir').value = i.direccion; $('#i-lat').value = i.lat ?? ''; $('#i-lng').value = i.lng ?? '';
            checks.querySelectorAll('input').forEach((c) => (c.checked = i.sacramentos.map((x) => x.trim()).includes(c.value))); cancelar.classList.remove('d-none'); scrollTo({ top: 0, behavior: 'smooth' }); }),
            boton('Eliminar', 'btn-outline-danger', async () => { if (await dialogo('¿Eliminar iglesia?', texto(i.nombre), 'Eliminar')) intentar(async () => { await Api.del('/admin/parroquias/' + i.id); await mostrar('iglesias'); }, 'Iglesia eliminada.'); }))]), 'No hay iglesias registradas.'));
      },

      async anuncios() {
        const lista = await Api.get('/avisos'), form = el('div', 'ios-panel'); let editando = 0;
        const TIPOS = [['evento', 'Evento'], ['otro', 'Aviso general'], ['santa_cena', 'Santa cena'], ['ayuno', 'Ayuno'], ['vigilia', 'Vigilia'], ['celebracion', 'Celebración'], ['cambio_horario', 'Cambio de horario']];
        const g = el('div', 'ios-filtros'); g.append(llenar(campo('a-ig', 'Iglesia', 'select'), IGS), llenar(campo('a-tipo', 'Tipo', 'select'), TIPOS), campo('a-f', 'Fecha del evento', 'date'));
        const urg = el('label', 'd-flex align-items-center gap-2 mb-3'), uc = el('input'); uc.type = 'checkbox'; uc.id = 'a-urg'; urg.append(uc, document.createTextNode('Marcar como urgente'));
        const guardar = el('button', 'btn btn-gold', 'Publicar'), cancelar = boton('Cancelar edición', 'btn-outline-secondary d-none', () => limpiar()), titulo = el('div', 'fw-semibold mb-2', 'Nuevo anuncio o evento');
        const limpiar = () => { editando = 0; titulo.textContent = 'Nuevo anuncio o evento'; ['#a-t', '#a-d', '#a-f'].forEach((i) => ($(i).value = '')); uc.checked = false; cancelar.classList.add('d-none'); guardar.textContent = 'Publicar'; };
        form.append(titulo, g, campo('a-t', 'Título', 'text', { maxLength: 100 }), campo('a-d', 'Descripción', 'textarea', { rows: 3, maxLength: 500 }), urg, guardar, cancelar);
        guardar.onclick = () => {
          const ok = [marcar($('#a-t').parentElement, 'a-t', Validar.texto($('#a-t').value, 5, 100, 'El título')), marcar($('#a-d').parentElement, 'a-d', Validar.texto($('#a-d').value, 10, 500, 'La descripción'))].every(Boolean);
          if (!ok) return;
          const body = { idParroquia: Number($('#a-ig').value), tipo: $('#a-tipo').value, fecha: $('#a-f').value, titulo: Validar.limpiar($('#a-t').value), descripcion: Validar.limpiar($('#a-d').value), urgente: uc.checked };
          intentar(async () => { editando ? await Api.put('/admin/avisos/' + editando, body) : await Api.post('/avisos', body); await mostrar('anuncios'); }, 'Anuncio guardado.');
        };
        vista.replaceChildren(form, tabla(['Anuncio', 'Iglesia', 'Tipo', 'Fecha', ''], lista.map((a) => [a.urgente ? '⚠️ ' + a.titulo : a.titulo, a.parroquia, (TIPOS.find((t) => t[0] === a.tipo) || [0, 'General'])[1], a.fecha ? fecha(a.fecha) : '—',
          acciones(boton('Editar', 'btn-outline-secondary', () => { editando = a.id; titulo.textContent = 'Editar anuncio'; guardar.textContent = 'Guardar cambios'; $('#a-ig').value = a.idParroquia; $('#a-tipo').value = a.tipo || 'otro'; $('#a-f').value = a.fecha || '';
            $('#a-t').value = a.titulo; $('#a-d').value = a.descripcion; uc.checked = !!a.urgente; cancelar.classList.remove('d-none'); scrollTo({ top: 0, behavior: 'smooth' }); }),
            boton('Eliminar', 'btn-outline-danger', async () => { if (await dialogo('¿Eliminar anuncio?', texto(a.titulo), 'Eliminar')) intentar(async () => { await Api.del('/admin/avisos/' + a.id); await mostrar('anuncios'); }, 'Anuncio eliminado.'); }))]), 'No hay anuncios.'));
      },

      async pagos() {
        const pagos = await Api.get('/admin/pagos'), rot = ['¿Verificar pago?', '¿Rechazar pago?'];
        vista.replaceChildren(tabla(['Fiel', 'Concepto', 'Método', 'Monto', 'Operación', 'Fecha', 'Acción'], pagos.map((p) => [p.feligres, ETQ[p.concepto], METODO[p.metodo] || '', soles(p.monto), p.numero_operacion + (p.yape_origen ? ' · ' + p.yape_origen : ''), fechaHora(p.creado_en),
          acciones(p.metodo !== 'tarjeta' ? boton('Ver comprobante', 'btn-outline-secondary', () => Api.abrirArchivo(`/pagos/${p.id_pago}/voucher`).catch((e) => toast(e.message, 'danger'))) : el('span'),
            boton('Verificar', 'btn-success', () => resolver(`/admin/pagos/${p.id_pago}`, true, rot, ['aprobar', 'rechazar'], 'observacion')),
            boton('Rechazar', 'btn-danger', () => resolver(`/admin/pagos/${p.id_pago}`, false, rot, ['aprobar', 'rechazar'], 'observacion')))]), 'No hay pagos pendientes.'));
      },

      async documentos() {
        const docs = await Api.get('/admin/documentos'), rot = ['¿Validar documento?', '¿Rechazar documento?'];
        vista.replaceChildren(tabla(['Fiel', 'Documento', 'Trámite', 'Fecha', 'Acción'], docs.map((d) => [d.feligres, d.documento, d.tramite, d.fecha,
          acciones(boton('Abrir', 'btn-outline-secondary', () => Api.abrirArchivo(`/admin/documentos/${d.id}/archivo`).catch((e) => toast(e.message, 'danger'))),
            boton('Validar', 'btn-success', () => resolver(`/admin/documentos/${d.id}`, true, rot, ['validar', 'rechazar'], 'motivo')),
            boton('Rechazar', 'btn-danger', () => resolver(`/admin/documentos/${d.id}`, false, rot, ['validar', 'rechazar'], 'motivo')))]), 'No hay documentos pendientes.'));
      },
    };

    const NOMBRES = { resumen: 'Resumen', creyentes: 'Fieles', iglesias: 'Iglesias', anuncios: 'Anuncios y eventos', pagos: 'Pagos', documentos: 'Documentos' };
    const mostrar = async (v) => {
      actual = v; $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.v === v));
      try { await vistas[v](); } catch (e) { toast(e.message, 'danger'); }
    };
    Object.entries(NOMBRES).forEach(([k, t]) => { const b = el('button', '', t); b.type = 'button'; b.dataset.v = k; b.onclick = () => mostrar(k); $('#tabs').append(b); });
    await mostrar('resumen');
  }

  /* ---------- directorio: mapa, geolocalización y horarios ---------- */
  const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  async function directorio() {
    const data = await Api.get('/directorio');
    const mapa = L.map('mapa').setView([-6.77, -79.84], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    const items = [], puntos = [];
    data.forEach((p) => {
      const col = el('div', 'col-12 col-lg-6'), c = el('article', 'card cai-card p-3 h-100'), dist = el('div', 'small fw-semibold text-success');
      c.append(el('h2', 'h5', p.nombre), el('div', 'small text-secondary', p.direccion), dist);
      const sac = el('div', 'mt-2'); p.sacramentos.forEach((x) => sac.append(el('span', 'badge text-bg-light border me-1', x))); c.append(sac);
      [['misa', 'Misas'], ['confesion', 'Confesiones'], ['actividad', 'Otras actividades']].forEach(([tipo, titulo]) => {
        const hs = p.horarios.filter((h) => h.tipo === tipo).sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia));
        if (!hs.length) return;
        const ul = el('ul', 'small mb-0 ps-3'); hs.forEach((h) => ul.append(el('li', '', `${cap(h.dia)}: ${h.hora}`)));
        c.append(el('div', 'fw-semibold small mt-3', titulo), ul);
      });
      const ver = el('button', 'btn btn-sm btn-outline-secondary mt-3 align-self-start', 'Ver en el mapa');
      const hay = p.lat != null && p.lng != null;
      if (hay) { const m = L.marker([p.lat, p.lng]).addTo(mapa).bindPopup(el('b', '', p.nombre)); puntos.push([p.lat, p.lng]); ver.onclick = () => { mapa.flyTo([p.lat, p.lng], 16); m.openPopup(); scrollTo({ top: 0, behavior: 'smooth' }); }; } else ver.disabled = true;
      c.append(ver); col.append(c); $('#lista').append(col); items.push({ p, col, dist });
    });
    if (puntos.length) mapa.fitBounds(puntos, { padding: [30, 30] });
    $('#buscar').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); items.forEach((i) => i.col.classList.toggle('d-none', !i.p.nombre.toLowerCase().includes(q))); });
    $('#btn-cerca').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Tu navegador no permite geolocalización.', 'danger');
      navigator.geolocation.getCurrentPosition(({ coords: { latitude: la, longitude: lo } }) => {
        const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
        items.forEach((i) => { i.d = i.p.lat == null ? Infinity : km(la, lo, i.p.lat, i.p.lng); i.dist.textContent = isFinite(i.d) ? `A ${i.d.toFixed(1)} km de ti` : ''; });
        items.sort((a, b) => a.d - b.d).forEach((i) => $('#lista').append(i.col));
        L.circleMarker([la, lo], { radius: 8 }).addTo(mapa).bindPopup(el('b', '', 'Tu ubicación'));
      }, () => toast('No se pudo obtener tu ubicación. Revisa los permisos del navegador.', 'danger'));
    });
  }

  /* ---------- avisos públicos ---------- */
  async function avisos() {
    const lista = await Api.get('/avisos'); const cont = $('#lista');
    lista.sort((a, b) => Number(b.urgente) - Number(a.urgente) || String(b.fecha).localeCompare(String(a.fecha)));
    if (!lista.length) cont.append(el('p', 'text-secondary', 'No hay avisos publicados.'));
    lista.forEach((a) => {
      const c = el('div', 'card cai-card p-3 mb-3' + (a.urgente ? ' border-danger' : '')), top = el('div', 'd-flex justify-content-between flex-wrap gap-1');
      top.append(el('h2', 'h6 mb-0', a.titulo)); if (a.urgente) top.append(el('span', 'badge text-bg-danger', 'Urgente'));
      c.append(top, el('div', 'small text-secondary', a.parroquia + (a.fecha ? ' · ' + fecha(a.fecha) : '')), el('p', 'mb-0 mt-2', a.descripcion)); cont.append(c);
    });
  }

  /* ---------- administración de avisos y horarios ---------- */
  const llenarParroquias = async (sel) => { (await Api.get('/parroquias')).forEach((p) => { const o = el('option', '', p.nombre); o.value = p.id; sel.append(o); }); };
  const borrar = async (url, titulo, recargar) => { if (!(await dialogo(titulo, texto('Esta acción no se puede deshacer.'), 'Eliminar'))) return; try { await Api.del(url); toast('Eliminado.'); await recargar(); } catch (e) { toast(e.message, 'danger'); } };
  async function adminAvisos() {
    const f = $('#form'); await llenarParroquias($('#parroquia'));
    const pintar = async () => {
      const lista = await Api.get('/avisos'), c = $('#lista'); c.replaceChildren();
      if (!lista.length) c.append(el('p', 'text-secondary', 'No hay avisos.'));
      lista.forEach((a) => { const d = el('div', 'card cai-card p-3 mb-2 d-flex flex-row justify-content-between align-items-start gap-2'), t = el('div');
        t.append(el('div', 'fw-semibold', a.titulo), el('div', 'small text-secondary', a.parroquia + (a.fecha ? ' · ' + fecha(a.fecha) : '')), el('div', 'small', a.descripcion));
        d.append(t, (() => { const b = el('button', 'btn btn-sm btn-outline-danger', 'Eliminar'); b.onclick = () => borrar(`/admin/avisos/${a.id}`, '¿Eliminar aviso?', pintar); return b; })()); c.append(d); });
    };
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (!f.reportValidity()) return;
      try { await Api.post('/avisos', { idParroquia: Number($('#parroquia').value), titulo: $('#titulo').value, descripcion: $('#descripcion').value, tipo: $('#tipo').value, fecha: $('#fecha').value, urgente: $('#urgente').checked });
        f.reset(); toast('Aviso publicado.'); await pintar(); } catch (err) { toast(err.message, 'danger'); } });
    await pintar();
  }
  async function adminHorarios() {
    const f = $('#form'); await llenarParroquias($('#parroquia'));
    const pintar = async () => {
      const data = await Api.get('/directorio'), c = $('#lista'); c.replaceChildren();
      data.forEach((p) => { const card = el('div', 'card cai-card p-3 mb-3'); card.append(el('h2', 'h6', p.nombre));
        if (!p.horarios.length) card.append(el('div', 'small text-secondary', 'Sin horarios.'));
        p.horarios.sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia)).forEach((h) => { const r = el('div', 'd-flex justify-content-between align-items-center border-top py-1 small');
          r.append(el('span', '', `${cap(h.dia)} · ${h.hora} · ${cap(h.tipo)}`), (() => { const b = el('button', 'btn btn-sm btn-outline-danger', 'Eliminar'); b.onclick = () => borrar(`/admin/horarios/${h.id}`, '¿Eliminar horario?', pintar); return b; })()); card.append(r); });
        c.append(card); });
    };
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (!f.reportValidity()) return;
      try { await Api.post('/admin/horarios', { idParroquia: Number($('#parroquia').value), dia: $('#dia').value, hora: $('#hora').value, tipo: $('#tipo').value });
        $('#hora').value = ''; toast('Horario agregado.'); await pintar(); } catch (err) { toast(err.message, 'danger'); } });
    await pintar();
  }

  /* ---------- inicio, login y registro ---------- */
  async function inicio() {
    const sesion = Sesion.obtener(), cta = $('#cta');
    cta.href = sesion ? R + 'paginas/reservas.html' : R + 'paginas/registro.html'; cta.textContent = sesion ? 'Nueva solicitud' : 'Crear mi cuenta';
    (await Api.get('/aranceles')).forEach((a) => {
      const col = el('div', 'col-6 col-lg-3'), c = el('div', 'card cai-card p-3 text-center h-100');
      c.append(el('div', 'fw-semibold', ETQ[a.sacramento]), el('div', 'small text-secondary', 'Arancel administrativo'), el('div', 'fs-4 fw-bold text-gold', soles(a.monto)));
      col.append(c); $('#aranceles').append(col);
    });
  }
  const irTras = (rol) => {
    const sig = new URLSearchParams(location.search).get('next');
    location.href = sig && /^[\w\-\/]+\.html$/.test(sig) ? R + 'paginas/' + sig : rol === 'administrador' ? R + 'paginas/admin/panel.html' : R + 'paginas/reservas.html';
  };
  function login() {
    const f = $('#form'), alerta = $('#alerta');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const okC = Validar.campo($('#correo'), Validar.correo($('#correo').value));
      const okP = Validar.campo($('#clave'), Validar.requerido($('#clave').value, 'Ingresa tu contraseña.'));
      if (!okC || !okP) return;
      const b = $('#enviar'); b.disabled = true; alerta.classList.add('d-none');
      try {
        const r = await Api.post('/login', { correo: $('#correo').value.trim().toLowerCase(), clave: $('#clave').value });
        Sesion.iniciar({ ...r.usuario }); irTras(r.usuario.rol);
      } catch (err) { alerta.textContent = err.message; alerta.classList.remove('d-none'); b.disabled = false; }
    });
  }
  function registro() {
    const f = $('#form'), alerta = $('#alerta'), ids = ['nombre', 'correo', 'telefono', 'clave', 'clave2'];
    const reglas = () => ({ nombre: Validar.nombre($('#nombre').value), correo: Validar.correo($('#correo').value), telefono: Validar.telefono($('#telefono').value),
      clave: Validar.clave($('#clave').value), clave2: $('#clave2').value && $('#clave2').value === $('#clave').value ? '' : 'Las contraseñas no coinciden.' });
    ids.forEach((k) => $('#' + k).addEventListener('blur', () => Validar.campo($('#' + k), reglas()[k])));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = reglas(); let ok = true; ids.forEach((k) => { if (!Validar.campo($('#' + k), r[k])) ok = false; });
      if (!ok) return;
      const b = $('#enviar'); b.disabled = true; alerta.classList.add('d-none');
      try {
        const res = await Api.post('/registro', { nombre: Validar.limpiar($('#nombre').value), correo: $('#correo').value.trim(), telefono: $('#telefono').value.trim(), clave: $('#clave').value });
        Sesion.iniciar({ ...res.usuario }); location.href = R + 'paginas/reservas.html';
      } catch (err) { alerta.textContent = err.message; alerta.classList.remove('d-none'); b.disabled = false; }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if ($('#nav')) nav();
    const pagina = document.body.dataset.page;
    if (!(await Api.activa())) { $('#app').replaceChildren(el('div', 'alert alert-warning', 'Esta sección requiere el servidor activo. Ejecuta el backend (mvn compile exec:java) y abre http://localhost:8080.')); return; }
    try { await ({ solicitud, mis, donaciones, panel, directorio, avisos, adminAvisos, adminHorarios, inicio, login, registro }[pagina])(); } catch (e) { toast(e.message, 'danger'); }
  });
})();
