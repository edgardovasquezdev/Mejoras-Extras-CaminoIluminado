// Prototipo estático — no hay servidor detrás.
// Estas funciones simulan la respuesta del sistema para la demo final.

/* ==================== AVISOS (para las ventanas flotantes) ==================== */
const AVISOS = [
  { fecha: "29 AGO", titulo: "Cambio de horario — misa de la tarde", texto: "La misa de las 7:00 p.m. del viernes se traslada a las 6:00 p.m.", urgente: true },
  { fecha: "01 SEP", titulo: "Inicio de novena", texto: "Novena en honor a la Virgen, todos los días a las 7:00 p.m.", urgente: false },
  { fecha: "05 SEP", titulo: "Vigilia de oración", texto: "Vigilia nocturna desde las 9:00 p.m. hasta la misa de las 6:00 a.m.", urgente: false },
  { fecha: "14 SEP", titulo: "Ayuno y abstinencia", texto: "Confesiones de 4:00 p.m. a 6:00 p.m. en la parroquia.", urgente: true }
];

/* ==================== ALMACÉN COMPARTIDO (panel admin ↔ pantallas del feligrés) ====================
   Usa localStorage para que las acciones del panel de administrador (aprobar un
   documento, publicar un aviso, cambiar un horario) se reflejen en las pantallas
   del feligrés dentro del MISMO navegador. Simulación para la demo: en la versión
   final esto lo haría la base de datos real. */
const Almacen = {
  get(clave, porDefecto) {
    try {
      const guardado = localStorage.getItem('cai_' + clave);
      return guardado ? JSON.parse(guardado) : JSON.parse(JSON.stringify(porDefecto));
    } catch (e) { return porDefecto; }
  },
  set(clave, valor) {
    try { localStorage.setItem('cai_' + clave, JSON.stringify(valor)); } catch (e) {}
  },
  reiniciar() {
    ['documentos', 'avisos_nuevos', 'horarios'].forEach((k) => {
      try { localStorage.removeItem('cai_' + k); } catch (e) {}
    });
  },
};

const DOCUMENTOS_SEMILLA = [
  { id: 'doc1', feligres: 'María Fernández', documento: 'Partida de nacimiento', tramite: 'Bautizo', fecha: '12/08/2026', estado: 'validado' },
  { id: 'doc2', feligres: 'Jorge Ramírez', documento: 'DNI del padrino', tramite: 'Bautizo', fecha: '18/08/2026', estado: 'pendiente' },
  { id: 'doc3', feligres: 'Lucía y Pedro Vega', documento: 'Certificado prematrimonial', tramite: 'Matrimonio', fecha: '20/08/2026', estado: 'pendiente' },
  { id: 'doc4', feligres: 'Ana Torres', documento: 'Constancia de catequesis', tramite: 'Primera Comunión', fecha: '22/08/2026', estado: 'pendiente' },
];

function insigniaHtml(estado) {
  const etiquetas = { validado: 'Validado', pendiente: 'Pendiente', rechazado: 'Rechazado' };
  return `<span class="insignia ${estado}">${etiquetas[estado]}</span>`;
}

/* ==================== SESIÓN / AUTENTICACIÓN ==================== */
const obtenerUsuarios = () => Usuarios.todos();
const guardarUsuarios = (l) => Usuarios.guardar(l);
const obtenerSesion = () => Sesion.obtener();
const iniciarSesion = (u) => Sesion.iniciar(u);
async function cerrarSesion() { try { await Api.post('/logout'); } catch (e) { /* ya cerrada */ } Sesion.cerrar(); window.location.href = raiz() + 'login.html'; }
function estaEnPaginas() {
  return window.location.pathname.includes('/paginas/');
}
function raiz() {
  return estaEnPaginas() ? '' : 'paginas/';
}

function pintarNavCuenta() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks || document.getElementById('nav-cuenta')) return;
  if (document.body.dataset.paginaAuth === 'true') return;

  const sesion = obtenerSesion();
  const li = document.createElement('li');
  li.id = 'nav-cuenta';

  if (sesion) {
    const panel = sesion.rol === 'administrador' ? `<a href="${raiz()}admin/panel.html">Panel</a> · ` : '';
    li.innerHTML = `<span class="nav-saludo">${panel}Hola, <span class="nav-nombre">${Seguridad.escapar(sesion.nombre.split(' ')[0])}</span> <button type="button" class="nav-salir" id="btn-salir">Salir</button></span>`;
  } else {
    li.innerHTML = `<a href="${raiz()}login.html" class="nav-cuenta-link">Iniciar sesión</a>`;
  }
  navLinks.appendChild(li);

  const btnSalir = document.getElementById('btn-salir');
  if (btnSalir) btnSalir.addEventListener('click', cerrarSesion);
}

/* Protege una página: si no hay sesión, redirige a login guardando a dónde volver */
function protegerPagina(destinoLogin, nombrePaginaActual) {
  if (!obtenerSesion()) {
    window.location.href = `${destinoLogin}?next=${encodeURIComponent(nombrePaginaActual)}`;
  }
}

/* ==================== GEOLOCALIZACIÓN ==================== */
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pedirUbicacion(alExito, alFallo) {
  if (!navigator.geolocation) { alFallo && alFallo(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => alExito(pos.coords.latitude, pos.coords.longitude),
    () => alFallo && alFallo(),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ==================== INICIO ==================== */
document.addEventListener('DOMContentLoaded', () => {

  pintarNavCuenta();

  /* ---------- menú móvil ---------- */
  const toggle = document.getElementById('menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => navLinks.classList.toggle('abierto'));
  }

  /* ---------- avisos flotantes (toasts) al entrar a la página ---------- */
  if (!sessionStorage.getItem('cai_avisos_vistos')) {
    sessionStorage.setItem('cai_avisos_vistos', '1');
    let contenedor = document.getElementById('toast-contenedor');
    if (!contenedor) {
      contenedor = document.createElement('div');
      contenedor.id = 'toast-contenedor';
      contenedor.className = 'toast-contenedor';
      document.body.appendChild(contenedor);
    }
    let i = 0;
    function mostrarSiguiente() {
      if (i >= AVISOS.length) return;
      const aviso = AVISOS[i];
      const toast = document.createElement('div');
      toast.className = 'toast' + (aviso.urgente ? ' urgente' : '');
      toast.innerHTML = `<span class="toast-fecha">${aviso.fecha}</span><h5>${aviso.titulo}</h5><p>${aviso.texto}</p>`;
      contenedor.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('mostrar'));
      setTimeout(() => {
        toast.classList.remove('mostrar');
        setTimeout(() => toast.remove(), 350);
      }, 2600);
      i++;
      setTimeout(mostrarSiguiente, 3000);
    }
    setTimeout(mostrarSiguiente, 600);
  }

  /* ---------- contador animado (hero de inicio) ---------- */
  document.querySelectorAll('.stat-num[data-hasta]').forEach((el) => {
    const meta = parseInt(el.dataset.hasta, 10);
    let actual = 0;
    const paso = Math.max(1, Math.round(meta / 40));
    const intervalo = setInterval(() => {
      actual += paso;
      if (actual >= meta) { actual = meta; clearInterval(intervalo); }
      el.textContent = actual.toLocaleString('es-PE') + (el.dataset.sufijo || '');
    }, 25);
  });

  /* ---------- registro y login: validados, con contraseña cifrada ---------- */
  const alertar = (el, msg, tipo) => { el.textContent = msg; el.className = 'alerta-auth visible ' + tipo; el.setAttribute('role', 'alert'); };
  const rutaSegura = (r) => (r && /^[\w\-\/]+\.html$/.test(r) ? r : null); // evita redirecciones abiertas

  const formRegistro = document.getElementById('form-registro');
  if (formRegistro) {
    const f = {
      nombre: document.getElementById('reg-nombre'), correo: document.getElementById('reg-correo'),
      telefono: document.getElementById('reg-telefono'), clave: document.getElementById('reg-clave'),
      clave2: document.getElementById('reg-clave2'),
    };
    const terminos = document.getElementById('reg-terminos');
    const alerta = document.getElementById('alerta-registro');
    const reglas = () => ({
      nombre: Validar.nombre(f.nombre.value), correo: Validar.correo(f.correo.value),
      telefono: Validar.telefono(f.telefono.value), clave: Validar.clave(f.clave.value),
      clave2: f.clave2.value && f.clave2.value === f.clave.value ? '' : 'Las contraseñas no coinciden.',
    });
    f.clave.placeholder = 'Mín. 8 caracteres, mayúscula y número';
    f.telefono.setAttribute('maxlength', '9'); f.telefono.setAttribute('inputmode', 'numeric');
    Object.entries(f).forEach(([k, el]) => el.addEventListener('blur', () => Validar.campo(el, reglas()[k])));

    formRegistro.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errores = reglas();
      let ok = true;
      Object.entries(f).forEach(([k, el]) => { if (!Validar.campo(el, errores[k])) ok = false; });
      if (!terminos.checked) ok = false;
      if (!ok) {
        alertar(alerta, terminos.checked ? 'Revisa los campos marcados.' : 'Debes aceptar el uso de tu ubicación para continuar.', 'error');
        return;
      }
      if (await Api.activa()) {
        try {
          const r = await Api.post('/registro', { nombre: Validar.limpiar(f.nombre.value), correo: f.correo.value.trim(),
            telefono: f.telefono.value.trim(), clave: f.clave.value });
          iniciarSesion({ ...r.usuario });
          window.location.href = 'mapa.html';
        } catch (err) { alertar(alerta, err.message, 'error'); }
        return;
      }
      if (Usuarios.buscar(f.correo.value)) {
        Validar.campo(f.correo, 'Ya existe una cuenta con este correo.');
        alertar(alerta, 'Ya existe una cuenta registrada con ese correo.', 'error');
        return;
      }
      const boton = formRegistro.querySelector('button[type="submit"]');
      boton.disabled = true;
      const usuario = {
        nombre: Validar.limpiar(f.nombre.value), correo: f.correo.value.trim().toLowerCase(),
        telefono: f.telefono.value.trim(), claveHash: await Seguridad.hash(f.clave.value),
        rol: 'feligres', ubicacion: null,
      };
      Usuarios.agregar(usuario);
      iniciarSesion(usuario);
      alertar(alerta, 'Cuenta creada. Solicitando tu ubicación para mostrarte las iglesias más cercanas…', 'exito');
      const ir = () => setTimeout(() => (window.location.href = 'mapa.html'), 900);
      pedirUbicacion((lat, lng) => { usuario.ubicacion = { lat, lng }; Usuarios.actualizar(usuario); iniciarSesion(usuario); ir(); }, ir);
    });
  }

  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    const correo = document.getElementById('log-correo');
    const clave = document.getElementById('log-clave');
    const alerta = document.getElementById('alerta-login');
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const okC = Validar.campo(correo, Validar.correo(correo.value));
      const okP = Validar.campo(clave, Validar.requerido(clave.value, 'Ingresa tu contraseña.'));
      if (!okC || !okP) { alertar(alerta, 'Completa correo y contraseña para continuar.', 'error'); return; }

      const id = correo.value.trim().toLowerCase();
      const espera = Intentos.restante(id);
      if (espera) { alertar(alerta, `Demasiados intentos fallidos. Vuelve a intentar en ${espera} min.`, 'error'); return; }

      if (await Api.activa()) {
        try {
          const r = await Api.post('/login', { correo: id, clave: clave.value });
          iniciarSesion({ ...r.usuario });
          const sig = rutaSegura(new URLSearchParams(window.location.search).get('next'));
          window.location.href = sig || (r.usuario.rol === 'administrador' ? 'admin/documentos.html' : 'reservas.html');
        } catch (err) { alertar(alerta, err.message, 'error'); }
        return;
      }
      await Usuarios.asegurarAdmin();
      const usuario = Usuarios.buscar(id);
      const hash = await Seguridad.hash(clave.value);
      if (!usuario || usuario.claveHash !== hash) {
        Intentos.fallo(id);
        alertar(alerta, 'Correo o contraseña incorrectos.', 'error');
        return;
      }
      Intentos.limpiar(id);
      iniciarSesion(usuario);
      const siguiente = rutaSegura(new URLSearchParams(window.location.search).get('next'));
      window.location.href = siguiente || (usuario.rol === 'administrador' ? 'admin/documentos.html' : 'reservas.html');
    });
  }

  /* ---------- formulario de reserva (stepper) con validación por paso ---------- */
  const formReserva = document.getElementById('form-reserva');
  if (formReserva) {
    const pasos = document.querySelectorAll('.paso-item');
    const paneles = document.querySelectorAll('.panel-paso');
    const tarjetas = document.querySelectorAll('.tarjeta-sacramento');
    const campoSacramento = document.getElementById('sacramento');
    const c = {
      parroquia: document.getElementById('parroquia'), nombre: document.getElementById('nombre'),
      fecha: document.getElementById('fecha'), notas: document.getElementById('notas'),
    };
    const sesion = obtenerSesion();
    if (sesion && !c.nombre.value) c.nombre.value = sesion.nombre;
    const manana = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    c.fecha.min = manana;
    c.notas.maxLength = 300;
    let pasoActual = 0;

    const errorSacramento = document.createElement('p');
    errorSacramento.className = 'error-global'; errorSacramento.setAttribute('role', 'alert');
    campoSacramento.after(errorSacramento);

    tarjetas.forEach((t) => {
      t.setAttribute('tabindex', '0'); t.setAttribute('role', 'button');
      const elegir = () => {
        tarjetas.forEach((x) => x.classList.remove('elegido'));
        t.classList.add('elegido'); campoSacramento.value = t.dataset.valor; errorSacramento.textContent = '';
      };
      t.addEventListener('click', elegir);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(); } });
    });

    const reglasPaso2 = () => ({
      parroquia: Validar.requerido(c.parroquia.value, 'Selecciona una parroquia.'),
      nombre: Validar.nombre(c.nombre.value),
      fecha: Validar.fechaReserva(c.fecha.value),
      notas: Validar.texto(c.notas.value || '          ', 0, 300, 'Las notas'),
    });
    Object.entries(c).forEach(([k, el]) => el.addEventListener('blur', () => Validar.campo(el, reglasPaso2()[k])));

    function validarPaso(i) {
      if (i === 0) {
        errorSacramento.textContent = campoSacramento.value ? '' : 'Elige un sacramento para continuar.';
        return !!campoSacramento.value;
      }
      if (i === 1) {
        const r = reglasPaso2(); let ok = true;
        Object.entries(c).forEach(([k, el]) => { if (!Validar.campo(el, r[k])) ok = false; });
        return ok;
      }
      return true;
    }

    function resumen() {
      const caja = document.getElementById('resumen-reserva') || (() => {
        const d = document.createElement('dl'); d.id = 'resumen-reserva'; d.className = 'resumen-reserva';
        paneles[2].prepend(d); return d;
      })();
      const filas = [['Sacramento', campoSacramento.value], ['Parroquia', c.parroquia.value], ['Solicitante', Validar.limpiar(c.nombre.value)],
        ['Fecha deseada', new Date(c.fecha.value + 'T00:00:00').toLocaleDateString('es-PE', { dateStyle: 'full' })], ['Notas', c.notas.value.trim() || '—']];
      caja.innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${Seguridad.escapar(v)}</dd>`).join('');
    }

    function mostrarPaso(i) {
      paneles.forEach((p, idx) => (p.style.display = idx === i ? 'block' : 'none'));
      pasos.forEach((p, idx) => { p.classList.toggle('activo', idx === i); p.classList.toggle('hecho', idx < i); });
      if (i === 2) resumen();
    }
    document.querySelectorAll('[data-siguiente]').forEach((btn) => btn.addEventListener('click', () => {
      if (!validarPaso(pasoActual)) return;
      pasoActual = Math.min(pasoActual + 1, paneles.length - 1); mostrarPaso(pasoActual);
    }));
    document.querySelectorAll('[data-anterior]').forEach((btn) => btn.addEventListener('click', () => {
      pasoActual = Math.max(pasoActual - 1, 0); mostrarPaso(pasoActual);
    }));
    mostrarPaso(0);

    formReserva.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validarPaso(0) || !validarPaso(1)) { pasoActual = validarPaso(0) ? 1 : 0; mostrarPaso(pasoActual); return; }
      const mensaje = document.getElementById('mensaje-reserva');
      if (await Api.activa()) {
        try {
          const r = await Api.post('/reservas', { sacramento: campoSacramento.value, parroquia: c.parroquia.value,
            nombre: Validar.limpiar(c.nombre.value), fecha: c.fecha.value, notas: c.notas.value.trim() });
          mensaje.textContent = `Solicitud registrada con el código ${r.codigo}. La parroquia se comunicará contigo para confirmar la fecha.`;
          formReserva.querySelector('button[type="submit"]').disabled = true;
        } catch (err) { mensaje.textContent = err.message; }
        mensaje.classList.add('visible');
        return;
      }
      const reservas = Almacen.get('reservas', []);
      const correo = sesion ? sesion.correo : '';
      if (reservas.some((r) => r.correo === correo && r.sacramento === campoSacramento.value && r.parroquia === c.parroquia.value && r.estado === 'pendiente')) {
        mensaje.classList.add('visible'); mensaje.textContent = 'Ya tienes una solicitud pendiente de este sacramento en esa parroquia.';
        return;
      }
      const codigo = 'RES-' + Date.now().toString(36).toUpperCase().slice(-6);
      reservas.unshift({ id: codigo, correo, sacramento: campoSacramento.value, parroquia: c.parroquia.value,
        solicitante: Validar.limpiar(c.nombre.value), fecha: c.fecha.value, notas: c.notas.value.trim(), estado: 'pendiente', creada: new Date().toISOString() });
      Almacen.set('reservas', reservas);
      mensaje.classList.add('visible');
      mensaje.textContent = `Solicitud registrada con el código ${codigo}. La parroquia se comunicará contigo para confirmar la fecha.`;
      formReserva.querySelector('button[type="submit"]').disabled = true;
    });
  }

  /* ---------- zona de carga de documentos ---------- */
  const zonaCarga = document.getElementById('zona-carga');
  const inputArchivo = document.getElementById('input-archivo');
  const listaArchivos = document.getElementById('lista-archivos');
  const subirApi = async (f) => {
    const mensaje = document.getElementById('mensaje-documento');
    try {
      const base64 = await new Promise((ok, fallo) => {
        const l = new FileReader(); l.onload = () => ok(l.result.split(',')[1]); l.onerror = fallo; l.readAsDataURL(f);
      });
      await Api.post('/documentos', { nombre: f.name, contenido: base64 });
      if (listaArchivos) {
        const li = document.createElement('li');
        li.innerHTML = `<span>📄 ${Seguridad.escapar(f.name)}</span><span class="insignia pendiente">Pendiente</span>`;
        listaArchivos.appendChild(li);
      }
      mensaje.textContent = 'Documento enviado. La parroquia lo revisará en breve.';
      if (window.recargarDocsFeligres) window.recargarDocsFeligres();
    } catch (err) { mensaje.textContent = `${f.name}: ${err.message}`; }
    mensaje.classList.add('visible');
  };
  const procesarArchivos = async (archivos) => {
    const usarApi = await Api.activa();
    const errores = [];
    const existentes = new Set(Almacen.get('documentos', DOCUMENTOS_SEMILLA).map((d) => d.documento));
    archivos.forEach((f) => {
      const err = Validar.archivo(f) || (!usarApi && existentes.has(f.name) ? 'ya fue enviado.' : '');
      if (err) errores.push(`${f.name}: ${err}`); else if (usarApi) subirApi(f); else agregarArchivo(f.name);
    });
    if (errores.length) {
      const mensaje = document.getElementById('mensaje-documento');
      mensaje.classList.add('visible'); mensaje.textContent = 'No se pudo cargar → ' + errores.join(' · ');
    }
  };
  function agregarArchivo(nombre) {
    if (!listaArchivos) return;
    const li = document.createElement('li');
    li.innerHTML = `<span>📄 ${Seguridad.escapar(nombre)}</span><span class="insignia pendiente">Pendiente</span>`;
    listaArchivos.appendChild(li);
    const mensaje = document.getElementById('mensaje-documento');
    mensaje.classList.add('visible');
    mensaje.textContent = 'Documento recibido (simulación). Ya aparece como pendiente en el panel de administración.';

    // Se agrega como trámite pendiente para que el administrador lo vea y lo valide.
    const sesion = obtenerSesion();
    const documentos = Almacen.get('documentos', DOCUMENTOS_SEMILLA);
    documentos.unshift({
      id: 'doc' + Date.now(),
      feligres: sesion ? sesion.nombre : 'Feligrés (invitado)',
      documento: nombre,
      tramite: 'Por confirmar',
      fecha: new Date().toLocaleDateString('es-PE'),
      estado: 'pendiente',
    });
    Almacen.set('documentos', documentos);
  }
  if (zonaCarga) {
    zonaCarga.addEventListener('click', () => inputArchivo && inputArchivo.click());
    zonaCarga.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputArchivo && inputArchivo.click(); } });
    if (inputArchivo) inputArchivo.accept = '.pdf,.jpg,.jpeg,.png';
    zonaCarga.addEventListener('dragover', (e) => { e.preventDefault(); zonaCarga.classList.add('sobre'); });
    zonaCarga.addEventListener('dragleave', () => zonaCarga.classList.remove('sobre'));
    zonaCarga.addEventListener('drop', (e) => {
      e.preventDefault();
      zonaCarga.classList.remove('sobre');
      procesarArchivos([...e.dataTransfer.files]);
    });
  }
  if (inputArchivo) {
    inputArchivo.addEventListener('change', (e) => {
      procesarArchivos([...e.target.files]); e.target.value = '';
    });
  }

  /* ---------- tabla de documentos: feligrés (solo lectura) ---------- */
  const tablaDocFeligres = document.getElementById('tabla-documentos-feligres');
  if (tablaDocFeligres) {
    const esc = Seguridad.escapar;
    const pintar = async () => {
      let docs;
      try { docs = (await Api.activa()) ? await Api.get('/documentos/mios') : Almacen.get('documentos', DOCUMENTOS_SEMILLA); }
      catch (err) { docs = []; }
      tablaDocFeligres.innerHTML = docs.length ? docs.map((d) => `
        <tr><td>${esc(d.documento)}</td><td>${esc(d.tramite)}</td><td>${esc(d.fecha)}</td>
        <td>${insigniaHtml(d.estado)}${d.motivo ? `<br><small>${esc(d.motivo)}</small>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="4">Aún no has enviado documentos.</td></tr>';
    };
    window.recargarDocsFeligres = pintar;
    pintar();
  }

  /* ---------- tabla de documentos: administrador (ver / aprobar / rechazar) ---------- */
  const tablaDocAdmin = document.getElementById('tabla-documentos-admin');
  if (tablaDocAdmin) {
    const esc = Seguridad.escapar;
    const pintarTablaAdmin = async () => {
      const api = await Api.activa();
      let docs;
      try { docs = api ? await Api.get('/admin/documentos') : Almacen.get('documentos', DOCUMENTOS_SEMILLA); }
      catch (err) { docs = []; }
      tablaDocAdmin.innerHTML = docs.length ? docs.map((d) => {
        const resuelto = d.estado !== 'pendiente';
        return `<tr>
          <td>${esc(d.feligres)}</td><td>${esc(d.documento)}</td><td>${esc(d.tramite)}</td><td>${esc(d.fecha)}</td>
          <td>${insigniaHtml(d.estado)}</td>
          <td class="fila-accion">
            ${api ? `<button class="boton-mini" data-ver="${esc(d.id)}">Ver</button>` : ''}
            <button class="boton-mini aprobar" data-id="${esc(d.id)}" data-accion="aprobar" ${resuelto ? 'disabled' : ''}>Aprobar</button>
            <button class="boton-mini rechazar" data-id="${esc(d.id)}" data-accion="rechazar" ${resuelto ? 'disabled' : ''}>Rechazar</button>
          </td></tr>`;
      }).join('') : '<tr><td colspan="6">No hay documentos pendientes.</td></tr>';

      tablaDocAdmin.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
        try { await Api.abrirArchivo(`/admin/documentos/${b.dataset.ver}/archivo`); } catch (err) { alert(err.message); }
      }));
      tablaDocAdmin.querySelectorAll('[data-accion]').forEach((boton) => boton.addEventListener('click', async () => {
        const id = boton.dataset.id, aprobar = boton.dataset.accion === 'aprobar';
        if (api) {
          try {
            if (aprobar) await Api.put(`/admin/documentos/${id}`, { accion: 'validar' });
            else {
              const motivo = prompt('Motivo del rechazo (obligatorio, mínimo 5 caracteres):');
              if (motivo === null) return;
              await Api.put(`/admin/documentos/${id}`, { accion: 'rechazar', motivo });
            }
          } catch (err) { alert(err.message); return; }
        } else {
          const lista = Almacen.get('documentos', DOCUMENTOS_SEMILLA);
          const item = lista.find((x) => x.id === id);
          if (item) { item.estado = aprobar ? 'validado' : 'rechazado'; Almacen.set('documentos', lista); }
        }
        pintarTablaAdmin();
      }));
    };
    pintarTablaAdmin();
  }

  /* ---------- avisos publicados por el administrador (visibles del lado feligrés) ---------- */
  const contenedorAvisosNuevos = document.getElementById('avisos-nuevos');
  if (contenedorAvisosNuevos) {
    const avisosNuevos = Almacen.get('avisos_nuevos', []);
    contenedorAvisosNuevos.innerHTML = avisosNuevos.map((a) => `
      <div class="aviso ${a.urgente ? 'urgente' : ''}">
        <span class="aviso-fecha">${Seguridad.escapar(a.fecha)}</span>
        <div>
          <h4>${Seguridad.escapar(a.titulo)}</h4>
          <p>${Seguridad.escapar(a.descripcion)}</p>
        </div>
      </div>
    `).join('');
  }

  if (contenedorAvisosNuevos) {
    Api.activa().then(async (activa) => {
      if (!activa) return;
      try {
        const lista = await Api.get('/avisos');
        if (!lista.length) return;
        lista.sort((a, b) => Number(b.urgente) - Number(a.urgente));
        contenedorAvisosNuevos.innerHTML = lista.map((a) => `
          <div class="aviso ${a.urgente ? 'urgente' : ''}">
            <span class="aviso-fecha">${a.fecha ? Seguridad.escapar(new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).toUpperCase().replace('.', '')) : ''}</span>
            <div>
              <h4>${Seguridad.escapar(a.titulo)}</h4>
              <p>${Seguridad.escapar(a.descripcion)}</p>
            </div>
          </div>`).join('');
      } catch (e) { /* se conservan los avisos locales */ }
    });
  }

  /* ---------- formulario del admin: publicar aviso ---------- */
  const formAviso = document.getElementById('form-aviso');
  if (formAviso) {
    formAviso.addEventListener('submit', async (e) => {
      e.preventDefault();
      const campoT = document.getElementById('titulo-aviso');
      const campoD = document.getElementById('descripcion-aviso');
      const okT = Validar.campo(campoT, Validar.texto(campoT.value, 5, 100, 'El título'));
      const okD = Validar.campo(campoD, Validar.texto(campoD.value, 10, 500, 'La descripción'));
      if (!okT || !okD) return;
      if (await Api.activa()) {
        const m = document.getElementById('mensaje-aviso');
        try {
          await Api.post('/avisos', { titulo: Validar.limpiar(campoT.value), descripcion: Validar.limpiar(campoD.value),
            fecha: document.getElementById('fecha-aviso').value, urgente: document.getElementById('urgente-aviso').checked });
          m.textContent = 'Aviso publicado en la base de datos. Ya aparece en la pantalla de avisos del feligrés.'; formAviso.reset();
        } catch (err) { m.textContent = err.message; }
        m.classList.add('visible');
        return;
      }
      const fecha = document.getElementById('fecha-aviso').value;
      const fechaCorta = fecha
        ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).toUpperCase().replace('.', '')
        : '';
      const avisosNuevos = Almacen.get('avisos_nuevos', []);
      avisosNuevos.unshift({
        fecha: fechaCorta,
        titulo: Validar.limpiar(campoT.value),
        descripcion: Validar.limpiar(campoD.value),
        urgente: document.getElementById('urgente-aviso').checked,
      });
      Almacen.set('avisos_nuevos', avisosNuevos);

      const mensaje = document.getElementById('mensaje-aviso');
      mensaje.classList.add('visible');
      mensaje.textContent = 'Aviso publicado. Ya aparece en la pantalla de avisos del feligrés.';
      formAviso.reset();
    });
  }

  /* ---------- horarios: si el administrador guardó cambios, se reflejan aquí ---------- */
  const elSemana = document.getElementById('horario-semana');
  const elSabado = document.getElementById('horario-sabado');
  const elDomingo = document.getElementById('horario-domingo');
  if (elSemana && elSabado && elDomingo) {
    const horarios = Almacen.get('horarios', null);
    if (horarios) {
      elSemana.textContent = horarios.semana;
      elSabado.textContent = horarios.sabado;
      elDomingo.textContent = horarios.domingo;
    }
  }

  /* ---------- formulario del admin: guardar horarios ---------- */
  const formHorarios = document.getElementById('form-horarios');
  if (formHorarios) {
    formHorarios.addEventListener('submit', (e) => {
      e.preventDefault();
      Almacen.set('horarios', {
        semana: document.getElementById('h-semana').value,
        sabado: document.getElementById('h-sabado').value,
        domingo: document.getElementById('h-domingo').value,
      });
      const mensaje = document.getElementById('mensaje-horarios');
      mensaje.classList.add('visible');
      mensaje.textContent = 'Horarios actualizados. Ya se reflejan en la pantalla de horarios del feligrés.';
    });
  }

  /* ---------- reportes con datos reales ---------- */
  const tablaReportes = document.getElementById('tabla-reportes');
  if (tablaReportes) {
    Api.activa().then(async (activa) => {
      if (!activa) return;
      try {
        const [filas, m] = await Promise.all([Api.get('/admin/reportes'), Api.get('/admin/metricas')]);
        const por = Object.fromEntries(filas.map((f) => [f.sacramento, f]));
        const nombres = { bautizo: 'Bautizo', matrimonio: 'Matrimonio', primera_comunion: 'Primera Comunión', confirmacion: 'Confirmación' };
        tablaReportes.innerHTML = Object.entries(nombres).map(([k, n]) => {
          const f = por[k] || { total: 0, validadas: 0, pendientes: 0 };
          return `<tr><td>${n}</td><td>${Number(f.total)}</td><td>${Number(f.validadas)}</td><td>${Number(f.pendientes)}</td></tr>`;
        }).join('');
        const poner = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        poner('rep-ingresos', 'S/ ' + Number(m.ingresos_yape).toFixed(2)); poner('rep-ofrendas', 'S/ ' + Number(m.ofrendas).toFixed(2));
        poner('rep-docs', m.documentos_por_revisar); poner('rep-pagos', m.pagos_por_verificar);
        poner('nota-reportes', 'Datos en tiempo real desde la base de datos.');
      } catch (e) { /* se conservan los datos de ejemplo */ }
    });
  }

  /* ---------- botón de reiniciar datos de demostración ---------- */
  const btnReiniciar = document.getElementById('reiniciar-demo');
  if (btnReiniciar) {
    btnReiniciar.addEventListener('click', () => {
      Almacen.reiniciar();
      btnReiniciar.textContent = 'Datos reiniciados ✓';
      setTimeout(() => { btnReiniciar.textContent = 'Reiniciar datos de demostración'; }, 2000);
    });
  }

  /* ---------- buscador de iglesias (mapa.html) ---------- */
  const buscador = document.getElementById('buscador-iglesias');
  const sinResultados = document.getElementById('sin-resultados');
  if (buscador) {
    buscador.addEventListener('input', (e) => {
      const termino = e.target.value.toLowerCase();
      let visibles = 0;
      document.querySelectorAll('.tarjeta-iglesia').forEach((tarjeta) => {
        const texto = tarjeta.textContent.toLowerCase();
        const coincide = texto.includes(termino);
        tarjeta.style.display = coincide ? '' : 'none';
        if (coincide) visibles++;
      });
      if (sinResultados) sinResultados.classList.toggle('visible', visibles === 0);
    });
  }

  /* ---------- chips de avisos ---------- */
  const chips = document.querySelectorAll('.chip[data-filtro]');
  if (chips.length) {
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('activo'));
        chip.classList.add('activo');
        const filtro = chip.dataset.filtro;
        document.querySelectorAll('.aviso').forEach((aviso) => {
          aviso.style.display = (filtro === 'todos' || aviso.classList.contains(filtro)) ? '' : 'none';
        });
      });
    });
  }

  /* ---------- pestañas de día (horarios) ---------- */
  const pestanas = document.querySelectorAll('.pestana-dia');
  if (pestanas.length) {
    pestanas.forEach((p) => {
      p.addEventListener('click', () => {
        pestanas.forEach((x) => x.classList.remove('activo'));
        p.classList.add('activo');
        const dia = p.dataset.dia;
        document.querySelectorAll('.fila-horario').forEach((fila) => {
          fila.style.display = (dia === 'todos' || fila.dataset.dia === dia) ? '' : 'none';
        });
      });
    });
  }

  /* ---------- mapa real con Leaflet: iglesias cercanas + geolocalización ---------- */
  const contenedorMapa = document.getElementById('mapa-iglesias');
  if (contenedorMapa && typeof L !== 'undefined' && typeof IGLESIAS !== 'undefined') {
    const centroChiclayo = [-6.7714, -79.8409];
    const mapa = L.map('mapa-iglesias').setView(centroChiclayo, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(mapa);

    const iconoUsuario = L.divIcon({ className: 'marcador-usuario', iconSize: [18, 18] });
    let marcadorUsuario = L.marker(centroChiclayo, { icon: iconoUsuario }).addTo(mapa)
      .bindPopup('<div class="popup-iglesia"><h4>Ubicación aproximada</h4></div>');

    const marcadoresIglesia = {};
    function pintarIglesias(latRef, lngRef) {
      IGLESIAS.forEach((ig) => {
        const dist = latRef ? distanciaKm(latRef, lngRef, ig.lat, ig.lng).toFixed(1) + ' km' : ig.distancia;
        if (!marcadoresIglesia[ig.id]) {
          marcadoresIglesia[ig.id] = L.marker([ig.lat, ig.lng]).addTo(mapa);
        }
        marcadoresIglesia[ig.id].bindPopup(`
          <div class="popup-iglesia">
            <h4>${ig.nombre}</h4>
            <p>A ${dist} — ${ig.sacramentos.join(', ')}</p>
            <a href="iglesia.html?id=${ig.id}">Ver ficha completa →</a>
          </div>
        `);
        const tarjeta = document.querySelector(`.tarjeta-iglesia[href*="${ig.id}"] .distancia-real`);
        if (tarjeta) tarjeta.textContent = 'A ' + dist;
      });
    }
    pintarIglesias(null, null);

    const permisoUbicacion = document.getElementById('permiso-ubicacion');
    function activarUbicacionReal() {
      pedirUbicacion(
        (lat, lng) => {
          marcadorUsuario.setLatLng([lat, lng]).setPopupContent('<div class="popup-iglesia"><h4>Tú estás aquí</h4></div>');
          mapa.setView([lat, lng], 14);
          pintarIglesias(lat, lng);
          if (permisoUbicacion) permisoUbicacion.style.display = 'none';
        },
        () => { if (permisoUbicacion) permisoUbicacion.querySelector('p').textContent = 'No pudimos acceder a tu ubicación. Mostrando iglesias con distancia referencial.'; }
      );
    }
    const sesion = obtenerSesion();
    if (sesion && sesion.ubicacion) {
      marcadorUsuario.setLatLng([sesion.ubicacion.lat, sesion.ubicacion.lng]).setPopupContent('<div class="popup-iglesia"><h4>Tú estás aquí</h4></div>');
      mapa.setView([sesion.ubicacion.lat, sesion.ubicacion.lng], 14);
      pintarIglesias(sesion.ubicacion.lat, sesion.ubicacion.lng);
      if (permisoUbicacion) permisoUbicacion.style.display = 'none';
    } else if (permisoUbicacion) {
      const btn = document.getElementById('btn-permiso-ubicacion');
      if (btn) btn.addEventListener('click', activarUbicacionReal);
    }
  }

  /* ---------- mapa chico en ficha de iglesia ---------- */
  const mapaChico = document.getElementById('mapa-chico');
  if (mapaChico && typeof L !== 'undefined' && typeof IGLESIAS !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const iglesia = IGLESIAS.find((i) => i.id === params.get('id')) || IGLESIAS[0];
    const mapa = L.map('mapa-chico').setView([iglesia.lat, iglesia.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(mapa);
    L.marker([iglesia.lat, iglesia.lng]).addTo(mapa)
      .bindPopup(`<div class="popup-iglesia"><h4>${iglesia.nombre}</h4></div>`).openPopup();
  }

  /* ---------- ficha de iglesia dinámica ---------- */
  const fichaIglesia = document.getElementById('ficha-iglesia');
  if (fichaIglesia && typeof IGLESIAS !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const iglesia = IGLESIAS.find((i) => i.id === params.get('id')) || IGLESIAS[0];

    document.title = `Camino a la Iluminación — ${iglesia.nombre}`;
    document.getElementById('nombre-iglesia').textContent = iglesia.nombre;
    document.getElementById('direccion-iglesia').textContent = `${iglesia.direccion} — A ${iglesia.distancia} de tu ubicación actual.`;
    document.getElementById('foto-iglesia').src = iglesia.foto;
    document.getElementById('foto-iglesia').alt = iglesia.nombre;
    document.getElementById('foto-interior').src = iglesia.fotoInterior;

    document.getElementById('horario-misas').innerHTML = iglesia.horarioMisas
      .map((h) => `${h.dia}: ${h.detalle}`).join('<br>');
    const elConf = document.getElementById('horario-confesiones');
    if (elConf) elConf.innerHTML = (iglesia.horarioConfesiones || []).map((h) => `${h.dia}: ${h.detalle}`).join('<br>') || 'Consulta en la oficina parroquial.';
    document.getElementById('sacramentos-iglesia').textContent = iglesia.sacramentos.join(', ') + '.';
    document.getElementById('tramites-iglesia').textContent = iglesia.tramites;
  }
});
