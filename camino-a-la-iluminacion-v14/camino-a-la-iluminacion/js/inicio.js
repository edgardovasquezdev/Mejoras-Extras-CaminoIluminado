(async () => {
  if (!(await Api.activa())) return;
  try {
    const lista = (await Api.get('/avisos')).sort((a, b) => Number(b.urgente) - Number(a.urgente) || String(b.fecha).localeCompare(String(a.fecha))).slice(0, 6);
    if (!lista.length) return;
    const corta = (f) => new Date(f + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).toUpperCase().replace('.', '');
    document.getElementById('anuncios-lista').innerHTML = lista.map((a) => `
      <div class="aviso ${a.urgente ? 'urgente' : ''}">
        <span class="aviso-fecha">${a.fecha ? Seguridad.escapar(corta(a.fecha)) : (a.tipo === 'evento' ? 'EVENTO' : 'AVISO')}</span>
        <div><h4>${Seguridad.escapar(a.titulo)}</h4><p>${Seguridad.escapar(a.descripcion)}</p></div>
      </div>`).join('');
    document.getElementById('anuncios-inicio').hidden = false;
  } catch (e) { /* sin servidor */ }
})();
