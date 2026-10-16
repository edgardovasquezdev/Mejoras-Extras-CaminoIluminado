/* ============================================================================
   nucleo.js — Seguridad, validaciones, sesión con roles y control de acceso.
   Se carga ANTES de main.js en todas las páginas.
   ============================================================================ */

/* ---------- Seguridad ---------- */
const Seguridad = {
  /** Escapa texto para insertarlo con seguridad en innerHTML (evita XSS). */
  escapar(t) {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(t ?? '').replace(/[&<>"']/g, (c) => mapa[c]);
  },
  /** Hash SHA-256 de la contraseña (nunca se guarda la clave en texto plano). */
  async hash(clave) {
    const texto = 'cai-2026::' + clave;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; // respaldo para contextos sin crypto.subtle
    for (const c of texto) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
    return 'f' + (h >>> 0).toString(16);
  },
};

/* ---------- Validaciones (devuelven '' si es válido, o el mensaje de error) ---------- */
const Validar = {
  limpiar: (v) => String(v ?? '').replace(/\s+/g, ' ').trim(),
  nombre(v) {
    return /^\p{L}[\p{L}'.-]+(\s+\p{L}[\p{L}'.-]*)+$/u.test(this.limpiar(v)) && this.limpiar(v).length <= 80
      ? '' : 'Ingresa nombre y apellido (solo letras, máx. 80 caracteres).';
  },
  correo: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) && v.trim().length <= 120
    ? '' : 'Ingresa un correo válido (ej. nombre@correo.com).',
  telefono: (v) => /^9\d{8}$/.test(v.trim()) ? '' : 'Ingresa un celular de 9 dígitos que empiece con 9.',
  clave(v) {
    if (v.length < 8) return 'Debe tener al menos 8 caracteres.';
    if (!/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/\d/.test(v)) return 'Usa mayúscula, minúscula y un número.';
    return '';
  },
  requerido: (v, msg = 'Este campo es obligatorio.') => v && String(v).trim() ? '' : msg,
  texto(v, min, max, etiqueta = 'El texto') {
    const n = this.limpiar(v).length;
    return n < min ? `${etiqueta} debe tener al menos ${min} caracteres.`
      : n > max ? `${etiqueta} no puede superar ${max} caracteres.` : '';
  },
  /** Fecha de sacramento: entre 15 días y 1 año desde hoy. */
  fechaReserva(v) {
    if (!v) return 'Elige una fecha.';
    const f = new Date(v + 'T00:00:00'), hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((f - hoy) / 86400000);
    if (isNaN(dias)) return 'Fecha no válida.';
    if (dias < 15) return 'La fecha debe ser al menos 15 días después de hoy.';
    if (dias > 365) return 'La fecha no puede superar un año desde hoy.';
    return '';
  },
  /** Archivos de trámite: PDF/JPG/PNG de hasta 5 MB. */
  archivo(f) {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return 'formato no permitido (usa PDF, JPG o PNG).';
    if (f.size > 5 * 1024 * 1024) return 'supera los 5 MB.';
    if (f.size === 0) return 'el archivo está vacío.';
    return '';
  },
  /** Muestra u oculta el error de un campo. Devuelve true si el campo es válido. */
  campo(input, mensaje) {
    const caja = input.closest('.campo') || input.parentElement;
    let span = caja.querySelector('.error-campo');
    if (!span) { span = document.createElement('span'); span.className = 'error-campo'; caja.appendChild(span); }
    span.textContent = mensaje || '';
    span.setAttribute('role', 'alert');
    caja.classList.toggle('con-error', !!mensaje);
    input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    return !mensaje;
  },
};

/* ---------- Sesión con rol y expiración (30 min de inactividad) ---------- */
const Sesion = {
  CLAVE: 'cai_sesion',
  DURACION: 30 * 60 * 1000,
  obtener() {
    try {
      const s = JSON.parse(localStorage.getItem(this.CLAVE));
      if (!s) return null;
      if (Date.now() > s.expira) { localStorage.removeItem(this.CLAVE); return null; }
      return s;
    } catch (e) { return null; }
  },
  iniciar(u) {
    const s = { nombre: u.nombre, correo: u.correo, rol: u.rol || 'feligres', ubicacion: u.ubicacion || null, expira: Date.now() + this.DURACION };
    localStorage.setItem(this.CLAVE, JSON.stringify(s));
  },
  renovar() { const s = this.obtener(); if (s) this.iniciar(s); },
  cerrar() { localStorage.removeItem(this.CLAVE); },
};

/* ---------- Usuarios (en la versión final: tabla `usuario` en MySQL) ---------- */
const Usuarios = {
  todos() { try { return JSON.parse(localStorage.getItem('cai_usuarios') || '[]'); } catch (e) { return []; } },
  guardar(l) { localStorage.setItem('cai_usuarios', JSON.stringify(l)); },
  buscar(correo) { return this.todos().find((u) => u.correo === correo.trim().toLowerCase()); },
  agregar(u) { const l = this.todos(); l.push(u); this.guardar(l); },
  actualizar(u) { this.guardar(this.todos().map((x) => (x.correo === u.correo ? u : x))); },
  /** Cuenta de personal parroquial de demostración. Cambiar antes de producción. */
  async asegurarAdmin() {
    if (this.buscar('admin@caminoiluminacion.pe')) return;
    this.agregar({ nombre: 'Personal Parroquial', correo: 'admin@caminoiluminacion.pe', dni: '00000000', telefono: '',
      claveHash: await Seguridad.hash('Admin2026!'), rol: 'administrador', ubicacion: null });
  },
};

/* ---------- Bloqueo por intentos fallidos (5 intentos → 5 minutos) ---------- */
const Intentos = {
  leer() { try { return JSON.parse(localStorage.getItem('cai_intentos') || '{}'); } catch (e) { return {}; } },
  restante(correo) {
    const r = this.leer()[correo];
    return r && r.hasta && Date.now() < r.hasta ? Math.ceil((r.hasta - Date.now()) / 60000) : 0;
  },
  fallo(correo) {
    const d = this.leer(), r = d[correo] || { n: 0 };
    r.n += 1;
    if (r.n >= 5) { r.hasta = Date.now() + 5 * 60000; r.n = 0; }
    d[correo] = r; localStorage.setItem('cai_intentos', JSON.stringify(d));
  },
  limpiar(correo) { const d = this.leer(); delete d[correo]; localStorage.setItem('cai_intentos', JSON.stringify(d)); },
};

/* ---------- Control de acceso por ruta ---------- */
(function guardiaDeRutas() {
  const ruta = location.pathname;
  const enAdmin = ruta.includes('/paginas/admin/');
  const protegida = enAdmin || /\/paginas\/(reservas|documentos|mis-solicitudes|donaciones)\.html$/.test(ruta);
  if (!protegida) return;

  const base = enAdmin ? '../login.html' : 'login.html';
  const sesion = Sesion.obtener();
  const destino = (enAdmin ? 'admin/' : '') + ruta.split('/').pop();

  if (!sesion) { document.documentElement.style.visibility = 'hidden'; location.replace(`${base}?next=${encodeURIComponent(destino)}`); return; }
  if (enAdmin && sesion.rol !== 'administrador') { document.documentElement.style.visibility = 'hidden'; location.replace('../../index.html'); return; }
  Sesion.renovar(); // actividad → extiende la sesión
})();

/* ---------- Enlaces de las secciones nuevas en la navegación original ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const ul = document.querySelector('.nav-links');
  if (!ul) return;
  const R = location.pathname.includes('/paginas/admin/') ? '../../' : location.pathname.includes('/paginas/') ? '../' : '';
  const enlaces = [['Mis solicitudes', 'mis-solicitudes.html'], ['Donar', 'donaciones.html']];
  const s = Sesion.obtener();
  if (s && s.rol === 'administrador') enlaces.push(['Panel', 'admin/panel.html']);
  enlaces.forEach(([t, h]) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = R + 'paginas/' + h; a.textContent = t;
    if (location.pathname.endsWith('/' + h.split('/').pop())) a.className = 'activo';
    li.append(a); ul.append(li);
  });
});

/* ---------- La cuenta (Iniciar sesión / Hola, nombre · Salir) va en su propia píldora, fuera del menú ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const ul = document.querySelector('.nav-links'), cab = document.querySelector('.sitio-header');
  if (!ul || !cab) return;
  const mover = () => { const c = document.getElementById('nav-cuenta'); if (c && c.parentElement === ul) cab.append(c); };
  new MutationObserver(mover).observe(ul, { childList: true });
  mover();
});
