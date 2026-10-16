/* Inicio de sesión y registro: DNI obligatorio (8 dígitos), correo opcional, validación en tiempo real. */
(() => {
  const f = document.getElementById('form-acceso');
  if (!f) return;
  const $ = (i) => document.getElementById(i), modo = f.dataset.modo, alerta = $('alerta');
  let ft = '', cf = '';
  const anti = () => ({ hp: $('hp') ? $('hp').value : '', ft, cf });
  (async () => {
    if (!(await Api.activa())) return;
    try { ft = (await Api.get('/f')).ft; } catch (e) { /* se reintenta al enviar */ }
    try {
      const cfg = await Api.get('/config');
      if (!cfg.turnstileSiteKey) return;
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true;
      sc.onload = () => { const c = document.createElement('div'); f.insertBefore(c, $('enviar')); turnstile.render(c, { sitekey: cfg.turnstileSiteKey, callback: (t) => { cf = t; } }); };
      document.head.append(sc);
    } catch (e) { /* sin verificación adicional */ }
  })();
  const aviso = (m) => { alerta.textContent = m; alerta.className = 'alerta-auth visible error'; alerta.setAttribute('role', 'alert'); };
  const reglasLogin = () => {
    const v = $('identificador').value.trim();
    return { identificador: !v ? 'Ingresa tu DNI o tu correo.' : /^\d+$/.test(v) ? (v.length === 8 ? '' : 'El DNI debe tener exactamente 8 dígitos.') : Validar.correo(v),
      clave: Validar.requerido($('clave').value, 'Ingresa tu contraseña.') };
  };
  const reglasReg = () => ({
    nombre: Validar.nombre($('nombre').value),
    dni: /^\d{8}$/.test($('dni').value) ? '' : 'El DNI debe tener exactamente 8 dígitos.',
    correo: $('correo').value.trim() ? Validar.correo($('correo').value) : '',
    telefono: Validar.telefono($('telefono').value), clave: Validar.clave($('clave').value),
    clave2: $('clave2').value && $('clave2').value === $('clave').value ? '' : 'Las contraseñas no coinciden.',
  });
  const reglas = modo === 'login' ? reglasLogin : reglasReg;
  const validar = () => { let ok = true; Object.entries(reglas()).forEach(([k, m]) => { if (!Validar.campo($(k), m)) ok = false; }); return ok; };
  if ($('dni')) $('dni').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); });
  Object.keys(reglas()).forEach((k) => {
    const enVivo = ['dni', 'identificador', 'correo'].includes(k);
    $(k).addEventListener(enVivo ? 'input' : 'blur', () => Validar.campo($(k), reglas()[k]));
  });

  const demo = async () => {
    await Usuarios.asegurarAdmin();
    const lista = Usuarios.todos();
    if (modo === 'login') {
      const id = $('identificador').value.trim().toLowerCase(), u = lista.find((x) => x.dni === id || (x.correo || '').toLowerCase() === id);
      if (!u || u.claveHash !== await Seguridad.hash($('clave').value)) throw new Error('DNI/correo o contraseña incorrectos.');
      return u;
    }
    const dni = $('dni').value, correo = $('correo').value.trim().toLowerCase();
    if (lista.some((x) => x.dni === dni)) throw new Error('Ya existe una cuenta con ese DNI.');
    if (correo && lista.some((x) => x.correo === correo)) throw new Error('Ya existe una cuenta con ese correo.');
    const u = { nombre: Validar.limpiar($('nombre').value), dni, correo, telefono: $('telefono').value.trim(), claveHash: await Seguridad.hash($('clave').value), rol: 'feligres', ubicacion: null };
    Usuarios.agregar(u);
    return u;
  };

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validar()) { aviso('Revisa los campos marcados en rojo.'); return; }
    const b = $('enviar'); b.disabled = true;
    try {
      let usuario;
      if (await Api.activa()) {
        const r = modo === 'login'
          ? await Api.post('/login', { identificador: $('identificador').value.trim(), clave: $('clave').value, ...anti() })
          : await Api.post('/registro', { nombre: Validar.limpiar($('nombre').value), dni: $('dni').value, correo: $('correo').value.trim(), telefono: $('telefono').value.trim(), clave: $('clave').value, ...anti() });
        usuario = { ...r.usuario };
      } else usuario = await demo();
      Sesion.iniciar(usuario);
      const sig = new URLSearchParams(location.search).get('next');
      location.href = sig && /^[\w\-\/]+\.html$/.test(sig) ? sig : usuario.rol === 'administrador' ? 'admin/panel.html' : 'reservas.html';
    } catch (err) { aviso(err.message); b.disabled = false; }
  });
})();
