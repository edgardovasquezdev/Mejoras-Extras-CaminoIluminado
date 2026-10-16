package pe.caminoiluminacion.api;

import com.sun.net.httpserver.HttpExchange;
import pe.caminoiluminacion.dao.PagoDAO;
import pe.caminoiluminacion.seguridad.Cripto;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Acceso por DNI, tarjeta, KPIs y CRUD administrativo (creyentes, iglesias, anuncios). */
final class Extra {
    private static final Set<String> SAC = Set.of("bautizo", "matrimonio", "primera_comunion", "confirmacion");
    private static final Set<String> SAC_ETQ = Set.of("Bautizo", "Matrimonio", "Primera Comunión", "Confirmación");
    private final Servidor s;
    private final PagoDAO db;

    Extra(Servidor s, PagoDAO db) { this.s = s; this.db = db; }

    boolean maneja(HttpExchange ex, String m, String r) throws Exception {
        Matcher mt;
        if (m.equals("POST") && r.equals("/registro")) { registro(ex); return true; }
        if (m.equals("POST") && r.equals("/login")) { login(ex); return true; }
        if (m.equals("GET") && r.equals("/admin/kpis")) { s.admin(ex); s.json(ex, 200, kpis()); return true; }
        if (r.equals("/admin/creyentes") && m.equals("GET")) { s.admin(ex); creyentes(ex); return true; }
        if (r.equals("/admin/creyentes") && m.equals("POST")) { s.admin(ex); crearCreyente(ex, s.cuerpo(ex)); return true; }
        if (m.equals("DELETE") && (mt = Pattern.compile("/admin/creyentes/(\\d+)").matcher(r)).matches()) {
            s.admin(ex);
            if (db.actualizar("DELETE FROM creyente WHERE id_creyente = ? AND origen = 'manual'", Long.parseLong(mt.group(1))) == 0)
                throw new Servidor.ErrorHttp(409, "Solo se pueden eliminar registros manuales; los de la web se gestionan desde las solicitudes.");
            s.json(ex, 200, Map.of("ok", true)); return true;
        }
        if (r.equals("/admin/parroquias") && m.equals("POST")) { s.admin(ex); guardarParroquia(ex, s.cuerpo(ex), 0); return true; }
        if (m.equals("PUT") && (mt = Pattern.compile("/admin/parroquias/(\\d+)").matcher(r)).matches()) {
            s.admin(ex); guardarParroquia(ex, s.cuerpo(ex), Long.parseLong(mt.group(1))); return true;
        }
        if (m.equals("DELETE") && (mt = Pattern.compile("/admin/parroquias/(\\d+)").matcher(r)).matches()) {
            s.admin(ex);
            try {
                if (db.actualizar("DELETE FROM parroquia WHERE id_parroquia = ?", Long.parseLong(mt.group(1))) == 0) throw new Servidor.ErrorHttp(404, "Iglesia no encontrada.");
            } catch (SQLException e) { throw new Servidor.ErrorHttp(409, "La iglesia tiene reservas o creyentes asociados y no puede eliminarse."); }
            s.json(ex, 200, Map.of("ok", true)); return true;
        }
        if (m.equals("PUT") && (mt = Pattern.compile("/admin/avisos/(\\d+)").matcher(r)).matches()) {
            s.admin(ex); editarAviso(ex, s.cuerpo(ex), Long.parseLong(mt.group(1))); return true;
        }
        return false;
    }

    /* ---------- cuentas: DNI obligatorio, correo opcional, datos sensibles cifrados ---------- */
    private void registro(HttpExchange ex) throws Exception {
        Map<String, Object> b = s.cuerpo(ex);
        Servidor.soloCampos(b, "nombre", "dni", "correo", "telefono", "clave", "hp", "ft", "cf");
        Bots.verificar(b, s.ip(ex));
        String nombre = Servidor.texto(b, "nombre").replaceAll("\\s+", " "), dni = Servidor.texto(b, "dni");
        String correo = Servidor.texto(b, "correo").toLowerCase(), tel = Servidor.texto(b, "telefono"), clave = Servidor.cadena(b, "clave");
        if (!Servidor.NOMBRE.matcher(nombre).matches() || nombre.length() > 160) throw new Servidor.ErrorHttp(422, "Ingresa nombre y apellido (solo letras).");
        if (!dni.matches("^\\d{8}$")) throw new Servidor.ErrorHttp(422, "El DNI debe tener exactamente 8 dígitos.");
        if (!correo.isEmpty() && (!Servidor.CORREO.matcher(correo).matches() || correo.length() > 120)) throw new Servidor.ErrorHttp(422, "Correo no válido.");
        if (!Servidor.TELEFONO.matcher(tel).matches()) throw new Servidor.ErrorHttp(422, "El celular debe tener 9 dígitos y empezar con 9.");
        if (clave.length() < 8 || clave.length() > 72 || !clave.matches(".*[a-z].*") || !clave.matches(".*[A-Z].*") || !clave.matches(".*\\d.*"))
            throw new Servidor.ErrorHttp(422, "La contraseña debe tener 8+ caracteres con mayúscula, minúscula y número.");
        String idx = Cripto.indice(dni);
        if (!db.consultar("SELECT 1 FROM usuario WHERE dni = ?", idx).isEmpty()) throw new Servidor.ErrorHttp(409, "Ya existe una cuenta con ese DNI.");
        if (!correo.isEmpty() && !db.consultar("SELECT 1 FROM usuario WHERE correo = ?", correo).isEmpty()) throw new Servidor.ErrorHttp(409, "Ya existe una cuenta con ese correo.");
        String[] p = nombre.split(" ", 2);
        long id = db.insertarClave("INSERT INTO usuario (nombre, apellido, correo, telefono, contrasena_hash, rol, dni, dni_enc) VALUES (?,?,?,?,?, 'feligres', ?, ?)",
            p[0], p[1], correo.isEmpty() ? null : correo, Cripto.cifrar(tel), Auth.hashear(clave), idx, Cripto.cifrar(dni));
        s.json(ex, 201, sesion(ex, (int) id, "feligres", nombre, correo, dni));
    }

    private void login(HttpExchange ex) throws Exception {
        Map<String, Object> b = s.cuerpo(ex);
        Servidor.soloCampos(b, "identificador", "clave", "hp", "ft", "cf");
        Bots.verificar(b, s.ip(ex));
        String id = Servidor.texto(b, "identificador").toLowerCase(), clave = Servidor.cadena(b, "clave");
        boolean porDni = id.matches("^\\d{8}$");
        if (!porDni && !Servidor.CORREO.matcher(id).matches()) throw new Servidor.ErrorHttp(422, "Ingresa tu DNI (8 dígitos) o un correo válido.");
        long espera = Auth.minutosBloqueado(id);
        if (espera > 0) throw new Servidor.ErrorHttp(429, "Demasiados intentos. Vuelve a intentar en " + espera + " min.");
        List<Map<String, Object>> f = db.consultar("SELECT id_usuario, nombre, apellido, correo, dni_enc, rol, contrasena_hash FROM usuario WHERE "
            + (porDni ? "dni" : "correo") + " = ?", porDni ? Cripto.indice(id) : id);
        if (f.isEmpty()) Auth.igualarTiempo(clave);
        if (f.isEmpty() || !Auth.verificar(clave, String.valueOf(f.get(0).get("contrasena_hash")))) {
            Auth.registrarFallo(id);
            throw new Servidor.ErrorHttp(401, "DNI/correo o contraseña incorrectos.");
        }
        Map<String, Object> u = f.get(0);
        Auth.limpiarFallos(id);
        if (Auth.precisaRehash(String.valueOf(u.get("contrasena_hash"))))
            db.actualizar("UPDATE usuario SET contrasena_hash = ? WHERE id_usuario = ?", Auth.hashear(clave), u.get("id_usuario"));
        s.json(ex, 200, sesion(ex, ((Number) u.get("id_usuario")).intValue(), String.valueOf(u.get("rol")), u.get("nombre") + " " + u.get("apellido"),
            u.get("correo") == null ? "" : String.valueOf(u.get("correo")), u.get("dni_enc") == null ? "" : Cripto.descifrar(String.valueOf(u.get("dni_enc")))));
    }

    /** La sesión viaja en una cookie HttpOnly; el cuerpo solo devuelve los datos públicos del usuario. */
    private Map<String, Object> sesion(HttpExchange ex, int id, String rol, String nombre, String correo, String dni) {
        s.ponerCookie(ex, Auth.crearSesion(id, rol));
        Map<String, Object> us = new LinkedHashMap<>();
        us.put("nombre", nombre); us.put("correo", correo); us.put("dni", dni); us.put("rol", rol);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("usuario", us);
        return r;
    }

    /* ---------- tarjeta: Luhn, vencimiento y CVV; nunca se guarda el número completo ---------- */
    static String[] validarTarjeta(Map<String, Object> b) {
        String num = Servidor.texto(b, "tarjetaNumero").replaceAll("[\\s-]", ""), venc = Servidor.texto(b, "tarjetaVence");
        String cvv = Servidor.texto(b, "tarjetaCvv"), titular = Servidor.texto(b, "tarjetaTitular");
        if (!num.matches("^\\d{13,19}$") || !luhn(num)) throw new Servidor.ErrorHttp(422, "Número de tarjeta no válido.");
        Matcher m = Pattern.compile("^(0[1-9]|1[0-2])/(\\d{2})$").matcher(venc);
        if (!m.matches()) throw new Servidor.ErrorHttp(422, "Vencimiento no válido (MM/AA).");
        if (YearMonth.of(2000 + Integer.parseInt(m.group(2)), Integer.parseInt(m.group(1))).isBefore(YearMonth.now())) throw new Servidor.ErrorHttp(422, "La tarjeta está vencida.");
        if (!cvv.matches("^\\d{3,4}$")) throw new Servidor.ErrorHttp(422, "CVV no válido.");
        if (titular.length() < 3 || titular.length() > 80) throw new Servidor.ErrorHttp(422, "Ingresa el nombre del titular.");
        String marca = num.startsWith("4") ? "Visa" : num.matches("^(5[1-5]|2[2-7]).*") ? "Mastercard" : num.matches("^3[47].*") ? "Amex" : "Tarjeta";
        return new String[]{num.substring(num.length() - 4), marca};
    }

    static boolean luhn(String n) {
        int suma = 0; boolean doble = false;
        for (int i = n.length() - 1; i >= 0; i--) {
            int d = n.charAt(i) - '0';
            if (doble) { d *= 2; if (d > 9) d -= 9; }
            suma += d; doble = !doble;
        }
        return suma % 10 == 0;
    }

    /* ---------- panel ---------- */
    private Map<String, Object> kpis() throws SQLException {
        return db.consultar("SELECT "
            + "(SELECT COUNT(*) FROM creyente WHERE YEAR(fecha_sacramento) = YEAR(CURDATE()) AND MONTH(fecha_sacramento) = MONTH(CURDATE())) AS sacramentos_mes, "
            + "(SELECT COUNT(*) FROM creyente) AS creyentes, (SELECT COUNT(*) FROM parroquia) AS iglesias, (SELECT COUNT(*) FROM aviso) AS anuncios, "
            + "(SELECT COUNT(*) FROM pago WHERE estado = 'pendiente') AS pagos_pendientes, "
            + "(SELECT COALESCE(SUM(monto), 0) FROM pago WHERE estado = 'aprobado' AND metodo = 'yape') AS yape, "
            + "(SELECT COALESCE(SUM(monto), 0) FROM pago WHERE estado = 'aprobado' AND metodo = 'plin') AS plin, "
            + "(SELECT COALESCE(SUM(monto), 0) FROM pago WHERE estado = 'aprobado' AND metodo = 'tarjeta') AS tarjeta").get(0);
    }

    private String param(HttpExchange ex, String k) {
        String v = s.consulta(ex, k);
        return v == null ? "" : URLDecoder.decode(v, StandardCharsets.UTF_8).trim();
    }

    private void creyentes(HttpExchange ex) throws Exception {
        StringBuilder w = new StringBuilder(" WHERE 1 = 1");
        List<Object> p = new ArrayList<>();
        String q = param(ex, "q"), sac = param(ex, "sacramento"), par = param(ex, "parroquia"), d = param(ex, "desde"), h = param(ex, "hasta");
        if (!q.isEmpty()) {
            String like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            if (q.matches("^\\d{8}$")) { w.append(" AND (c.nombre LIKE ? OR c.dni = ?)"); p.add(like); p.add(Cripto.indice(q)); }
            else { w.append(" AND c.nombre LIKE ?"); p.add(like); }
        }
        if (!sac.isEmpty()) { if (!SAC.contains(sac)) throw new Servidor.ErrorHttp(422, "Sacramento no válido."); w.append(" AND c.sacramento = ?"); p.add(sac); }
        if (!par.isEmpty()) { w.append(" AND c.id_parroquia = ?"); p.add(Long.parseLong(par)); }
        if (!d.isEmpty()) { w.append(" AND c.fecha_sacramento >= ?"); p.add(java.sql.Date.valueOf(Servidor.fecha(d))); }
        if (!h.isEmpty()) { w.append(" AND c.fecha_sacramento <= ?"); p.add(java.sql.Date.valueOf(Servidor.fecha(h))); }
        int tam = Math.max(5, Math.min(50, par(param(ex, "tam"), 10))), pagina = Math.max(1, par(param(ex, "pagina"), 1));
        long total = ((Number) db.consultar("SELECT COUNT(*) AS n FROM creyente c" + w, p.toArray()).get(0).get("n")).longValue();
        List<Object> pf = new ArrayList<>(p); pf.add(tam); pf.add((pagina - 1) * tam);
        List<Map<String, Object>> filas = db.consultar("SELECT c.id_creyente, c.nombre, c.dni_enc, c.sacramento, c.fecha_sacramento, c.origen, pa.nombre AS parroquia, "
            + "p.estado AS pago_estado, p.metodo, p.monto FROM creyente c JOIN parroquia pa ON pa.id_parroquia = c.id_parroquia "
            + "LEFT JOIN pago p ON p.id_reserva = c.id_reserva" + w + " ORDER BY c.fecha_sacramento DESC, c.id_creyente DESC LIMIT ? OFFSET ?", pf.toArray());
        for (Map<String, Object> f : filas) { f.put("dni", Cripto.enmascarar(Cripto.descifrar(String.valueOf(f.get("dni_enc"))), 4)); f.remove("dni_enc"); }
        s.json(ex, 200, Map.of("total", total, "pagina", pagina, "tam", tam, "filas", filas));
    }

    private static int par(String v, int def) { try { return Integer.parseInt(v); } catch (Exception e) { return def; } }

    private void crearCreyente(HttpExchange ex, Map<String, Object> b) throws Exception {
        Servidor.soloCampos(b, "nombre", "dni", "sacramento", "idParroquia", "fecha");
        String nombre = Servidor.texto(b, "nombre").replaceAll("\\s+", " "), dni = Servidor.texto(b, "dni"), sac = Servidor.texto(b, "sacramento");
        if (!Servidor.NOMBRE.matcher(nombre).matches() || nombre.length() > 150) throw new Servidor.ErrorHttp(422, "Nombre no válido (nombre y apellido).");
        if (!dni.matches("^\\d{8}$")) throw new Servidor.ErrorHttp(422, "El DNI debe tener exactamente 8 dígitos.");
        if (!SAC.contains(sac)) throw new Servidor.ErrorHttp(422, "Sacramento no válido.");
        long idPar = entero(b.get("idParroquia"));
        if (db.consultar("SELECT 1 FROM parroquia WHERE id_parroquia = ?", idPar).isEmpty()) throw new Servidor.ErrorHttp(422, "Iglesia no válida.");
        LocalDate f = Servidor.fecha(Servidor.texto(b, "fecha"));
        long id = db.insertarClave("INSERT INTO creyente (nombre, dni, dni_enc, sacramento, id_parroquia, fecha_sacramento, origen) VALUES (?,?,?,?,?,?, 'manual')",
            nombre, Cripto.indice(dni), Cripto.cifrar(dni), sac, idPar, java.sql.Date.valueOf(f));
        s.json(ex, 201, Map.of("id", id));
    }

    private void guardarParroquia(HttpExchange ex, Map<String, Object> b, long id) throws Exception {
        Servidor.soloCampos(b, "nombre", "direccion", "latitud", "longitud", "sacramentos");
        String nombre = Servidor.texto(b, "nombre").replaceAll("\\s+", " "), dir = Servidor.texto(b, "direccion"), sac = Servidor.texto(b, "sacramentos");
        if (nombre.length() < 3 || nombre.length() > 120) throw new Servidor.ErrorHttp(422, "El nombre debe tener entre 3 y 120 caracteres.");
        if (dir.length() < 5 || dir.length() > 200) throw new Servidor.ErrorHttp(422, "La dirección debe tener entre 5 y 200 caracteres.");
        for (String x : sac.isEmpty() ? new String[0] : sac.split(",")) if (!SAC_ETQ.contains(x.trim())) throw new Servidor.ErrorHttp(422, "Sacramento no válido: " + x);
        Double lat = coord(b.get("latitud"), 90), lng = coord(b.get("longitud"), 180);
        Object[] v = {nombre, dir, lat, lng, sac.isEmpty() ? null : sac};
        if (id == 0) s.json(ex, 201, Map.of("id", db.insertarClave("INSERT INTO parroquia (nombre, direccion, latitud, longitud, sacramentos_disponibles) VALUES (?,?,?,?,?)", v)));
        else {
            if (db.actualizar("UPDATE parroquia SET nombre = ?, direccion = ?, latitud = ?, longitud = ?, sacramentos_disponibles = ? WHERE id_parroquia = ?",
                nombre, dir, lat, lng, v[4], id) == 0 && db.consultar("SELECT 1 FROM parroquia WHERE id_parroquia = ?", id).isEmpty()) throw new Servidor.ErrorHttp(404, "Iglesia no encontrada.");
            s.json(ex, 200, Map.of("ok", true));
        }
    }

    private void editarAviso(HttpExchange ex, Map<String, Object> b, long id) throws Exception {
        Servidor.soloCampos(b, "idParroquia", "tipo", "fecha", "titulo", "descripcion", "urgente");
        String titulo = Servidor.texto(b, "titulo").replaceAll("\\s+", " "), desc = Servidor.texto(b, "descripcion"), tipo = Servidor.normalizar(Servidor.texto(b, "tipo"));
        if (titulo.length() < 5 || titulo.length() > 100) throw new Servidor.ErrorHttp(422, "El título debe tener entre 5 y 100 caracteres.");
        if (desc.length() < 10 || desc.length() > 500) throw new Servidor.ErrorHttp(422, "La descripción debe tener entre 10 y 500 caracteres.");
        String f = Servidor.texto(b, "fecha");
        if (db.actualizar("UPDATE aviso SET id_parroquia = ?, titulo = ?, descripcion = ?, tipo = ?, urgente = ?, fecha_evento = ? WHERE id_aviso = ?",
            entero(b.get("idParroquia")), titulo, desc, Servidor.TIPOS_AVISO.contains(tipo) ? tipo : "otro", Boolean.TRUE.equals(b.get("urgente")),
            f.isEmpty() ? null : java.sql.Date.valueOf(Servidor.fecha(f)), id) == 0) throw new Servidor.ErrorHttp(404, "Anuncio no encontrado.");
        s.json(ex, 200, Map.of("ok", true));
    }

    private static long entero(Object o) {
        if (o instanceof Number n) return n.longValue();
        throw new Servidor.ErrorHttp(422, "Falta seleccionar la iglesia.");
    }

    private static Double coord(Object o, double max) {
        if (o == null || String.valueOf(o).isBlank()) return null;
        try { double v = Double.parseDouble(String.valueOf(o)); if (Math.abs(v) <= max) return v; } catch (NumberFormatException e) { /* abajo */ }
        throw new Servidor.ErrorHttp(422, "Coordenada no válida.");
    }
}
