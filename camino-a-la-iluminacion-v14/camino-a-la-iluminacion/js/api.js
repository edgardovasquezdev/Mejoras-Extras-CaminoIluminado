/* api.js — cliente de la API. La sesión viaja en una cookie HttpOnly: JavaScript nunca ve el token. */
const Api = {
  _activa: null,

  async activa() {
    if (this._activa !== null) return this._activa;
    if (location.protocol === 'file:') return (this._activa = false);
    try {
      const r = await fetch('/api/salud', { cache: 'no-store', credentials: 'same-origin' });
      this._activa = r.ok && (await r.json()).ok === true;
    } catch (e) { this._activa = false; }
    return this._activa;
  },

  async pedir(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetch('/api' + ruta, {
        method: metodo, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CAI': '1' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) { throw new Error('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    let datos = null;
    try { datos = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (r.status === 401 && Sesion.obtener()) Sesion.cerrar();
    if (!r.ok) throw new Error((datos && datos.error) || 'Ocurrió un error inesperado.');
    return datos;
  },

  get(ruta) { return this.pedir('GET', ruta); },
  post(ruta, cuerpo) { return this.pedir('POST', ruta, cuerpo); },
  put(ruta, cuerpo) { return this.pedir('PUT', ruta, cuerpo); },
  del(ruta) { return this.pedir('DELETE', ruta); },

  /** Abre un archivo privado (la cookie de sesión autoriza la descarga). */
  async abrirArchivo(ruta) {
    const ventana = window.open('', '_blank');
    try {
      const r = await fetch('/api' + ruta, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('No se pudo abrir el archivo.');
      ventana.location = URL.createObjectURL(await r.blob());
    } catch (e) { if (ventana) ventana.close(); throw e; }
  },
};
