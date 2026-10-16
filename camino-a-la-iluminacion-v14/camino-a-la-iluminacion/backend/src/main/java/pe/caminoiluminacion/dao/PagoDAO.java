package pe.caminoiluminacion.dao;

import pe.caminoiluminacion.conexion.Conexion;
import pe.caminoiluminacion.seguridad.Cripto;

import java.math.BigDecimal;
import java.sql.*;
import java.time.LocalDate;
import java.util.*;

/** Pagos Yape, donaciones, solicitudes de sacramento, notificaciones y métricas (JDBC puro). */
public class PagoDAO {
    public record Archivo(String ruta, String sha, String nombre, long bytes) {}

    private static Object valor(Object o) {
        if (o instanceof Timestamp t) return t.toLocalDateTime().toString();
        if (o instanceof java.sql.Date d) return d.toString();
        return o;
    }

    public int actualizar(String sql, Object... p) throws SQLException {
        try (Connection c = Conexion.obtener()) { return ejecutar(c, sql, p); }
    }

    public long insertarClave(String sql, Object... p) throws SQLException {
        try (Connection c = Conexion.obtener(); PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            for (int i = 0; i < p.length; i++) ps.setObject(i + 1, p[i]);
            ps.executeUpdate();
            try (ResultSet k = ps.getGeneratedKeys()) { k.next(); return k.getLong(1); }
        }
    }

    public List<Map<String, Object>> consultar(String sql, Object... p) throws SQLException {
        try (Connection c = Conexion.obtener(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < p.length; i++) ps.setObject(i + 1, p[i]);
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData md = rs.getMetaData();
                List<Map<String, Object>> out = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    for (int i = 1; i <= md.getColumnCount(); i++) m.put(md.getColumnLabel(i), valor(rs.getObject(i)));
                    out.add(m);
                }
                return out;
            }
        }
    }

    private int ejecutar(Connection c, String sql, Object... p) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < p.length; i++) ps.setObject(i + 1, p[i]);
            return ps.executeUpdate();
        }
    }

    private long contar(String sql, String v) throws SQLException {
        return ((Number) consultar(sql, v).get(0).values().iterator().next()).longValue();
    }

    public List<Map<String, Object>> aranceles() throws SQLException {
        return consultar("SELECT sacramento, monto FROM arancel WHERE vigente ORDER BY monto");
    }

    /** Monto oficial del arancel; null si el sacramento no tiene arancel vigente. */
    public BigDecimal monto(String sacramento) throws SQLException {
        List<Map<String, Object>> r = consultar("SELECT monto FROM arancel WHERE sacramento = ? AND vigente", sacramento);
        return r.isEmpty() ? null : (BigDecimal) r.get(0).get("monto");
    }

    public boolean existeOperacion(String op) throws SQLException { return contar("SELECT COUNT(*) FROM pago WHERE numero_operacion = ?", op) > 0; }
    public boolean existeVoucher(String sha) throws SQLException { return contar("SELECT COUNT(*) FROM pago WHERE voucher_sha256 = ?", sha) > 0; }

    /** Reserva + documentos + pago en una sola transacción. */
    public long registrarSolicitud(int uid, int idParroquia, String sacramento, String nombre, LocalDate fecha, String notas,
                                   BigDecimal monto, Map<String, Archivo> docs, Archivo voucher, String op, String origen,
                                   String dni, String metodo, String ult4, String marca) throws SQLException {
        try (Connection c = Conexion.obtener()) {
            c.setAutoCommit(false);
            try {
                long idReserva;
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO reserva (id_usuario, id_parroquia, sacramento, nombre_solicitante, "
                        + "fecha_solicitada, notas, estado, monto, estado_pago) VALUES (?,?,?,?,?,?, 'pendiente', ?, 'pendiente')", Statement.RETURN_GENERATED_KEYS)) {
                    ps.setInt(1, uid); ps.setInt(2, idParroquia); ps.setString(3, sacramento); ps.setString(4, nombre);
                    ps.setDate(5, java.sql.Date.valueOf(fecha)); ps.setString(6, notas); ps.setBigDecimal(7, monto);
                    ps.executeUpdate();
                    try (ResultSet k = ps.getGeneratedKeys()) { k.next(); idReserva = k.getLong(1); }
                }
                for (Map.Entry<String, Archivo> e : docs.entrySet())
                    ejecutar(c, "INSERT INTO documento (id_reserva, id_usuario, nombre_archivo, ruta_archivo, tipo, sha256, tamano_bytes) VALUES (?,?,?,?,?,?,?)",
                        idReserva, uid, e.getValue().nombre(), e.getValue().ruta(), e.getKey(), e.getValue().sha(), e.getValue().bytes());
                ejecutar(c, "INSERT INTO pago (id_usuario, id_reserva, concepto, monto, metodo, numero_operacion, yape_origen, ruta_voucher, voucher_sha256, "
                    + "tarjeta_ultimos4, tarjeta_marca) VALUES (?,?, 'arancel', ?,?,?,?,?,?,?,?)", uid, idReserva, monto, metodo, op, origen == null ? null : Cripto.cifrar(origen),
                    voucher == null ? null : voucher.ruta(), voucher == null ? null : voucher.sha(), ult4, marca);
                ejecutar(c, "INSERT INTO creyente (nombre, dni, dni_enc, sacramento, id_parroquia, fecha_sacramento, id_reserva, origen) VALUES (?,?,?,?,?,?,?, 'web')",
                    nombre, Cripto.indice(dni), Cripto.cifrar(dni), sacramento, idParroquia, java.sql.Date.valueOf(fecha), idReserva);
                c.commit();
                return idReserva;
            } catch (SQLException e) { c.rollback(); throw e; }
        }
    }

    public void registrarDonacion(int uid, String concepto, BigDecimal monto, String op, String origen, Archivo v, String metodo) throws SQLException {
        try (Connection c = Conexion.obtener()) {
            ejecutar(c, "INSERT INTO pago (id_usuario, concepto, monto, metodo, numero_operacion, yape_origen, ruta_voucher, voucher_sha256) VALUES (?,?,?,?,?,?,?,?)",
                uid, concepto, monto, metodo, op, Cripto.cifrar(origen), v.ruta(), v.sha());
        }
    }

    public List<Map<String, Object>> solicitudesDe(int uid) throws SQLException {
        return consultar("SELECT r.id_reserva, r.sacramento, r.nombre_solicitante, r.fecha_solicitada, r.monto, r.estado, pa.nombre AS parroquia, "
            + "p.id_pago, p.estado AS pago_estado, p.metodo, p.observacion, "
            + "(SELECT COUNT(*) FROM documento d WHERE d.id_reserva = r.id_reserva AND d.estado_validacion = 'validado') AS docs_ok, "
            + "(SELECT COUNT(*) FROM documento d WHERE d.id_reserva = r.id_reserva) AS docs_total "
            + "FROM reserva r JOIN parroquia pa ON pa.id_parroquia = r.id_parroquia LEFT JOIN pago p ON p.id_reserva = r.id_reserva "
            + "WHERE r.id_usuario = ? ORDER BY r.creado_en DESC", uid);
    }

    public Map<String, Object> voucherDe(long idPago) throws SQLException {
        List<Map<String, Object>> r = consultar("SELECT ruta_voucher, id_usuario FROM pago WHERE id_pago = ?", idPago);
        return r.isEmpty() ? null : r.get(0);
    }

    public List<Map<String, Object>> pagosPendientes() throws SQLException {
        List<Map<String, Object>> r = consultar("SELECT p.id_pago, p.concepto, p.monto, p.metodo, p.numero_operacion, p.yape_origen, p.creado_en, CONCAT(u.nombre, ' ', u.apellido) AS feligres "
            + "FROM pago p JOIN usuario u ON u.id_usuario = p.id_usuario WHERE p.estado = 'pendiente' ORDER BY p.creado_en");
        for (Map<String, Object> f : r) if (f.get("yape_origen") != null) f.put("yape_origen", Cripto.enmascarar(Cripto.descifrar(String.valueOf(f.get("yape_origen"))), 3));
        return r;
    }

    public List<Map<String, Object>> reportePorSacramento() throws SQLException {
        return consultar("SELECT sacramento, COUNT(*) AS total, SUM(estado_pago = 'aprobado') AS validadas, SUM(estado_pago <> 'aprobado') AS pendientes "
            + "FROM reserva WHERE YEAR(creado_en) = YEAR(CURDATE()) AND MONTH(creado_en) = MONTH(CURDATE()) GROUP BY sacramento");
    }

    public Map<String, Object> metricas() throws SQLException { return consultar("SELECT * FROM v_metricas_mes").get(0); }

    /** Aprueba o rechaza un pago pendiente y notifica al feligrés. false si ya fue revisado o no existe. */
    public boolean resolver(long idPago, boolean aprobar, String obs, int idAdmin) throws SQLException {
        String estado = aprobar ? "aprobado" : "rechazado";
        try (Connection c = Conexion.obtener()) {
            c.setAutoCommit(false);
            try {
                int n = ejecutar(c, "UPDATE pago SET estado = ?, observacion = ?, revisado_por = ?, revisado_en = NOW() WHERE id_pago = ? AND estado = 'pendiente'",
                    estado, aprobar ? null : obs, idAdmin, idPago);
                if (n == 0) { c.rollback(); return false; }
                ejecutar(c, "UPDATE reserva r JOIN pago p ON p.id_reserva = r.id_reserva SET r.estado_pago = ? WHERE p.id_pago = ?", estado, idPago);
                ejecutar(c, "INSERT INTO notificacion (id_usuario, asunto, mensaje, canal) SELECT id_usuario, ?, ?, 'correo' FROM pago WHERE id_pago = ?",
                    aprobar ? "Pago verificado" : "Pago observado",
                    aprobar ? "Tu pago por Yape fue verificado con éxito." : "Tu pago por Yape fue rechazado. Observación: " + obs, idPago);
                c.commit();
                return true;
            } catch (SQLException e) { c.rollback(); throw e; }
        }
    }

    public void notificar(int uid, String asunto, String mensaje) throws SQLException {
        try (Connection c = Conexion.obtener()) { ejecutar(c, "INSERT INTO notificacion (id_usuario, asunto, mensaje, canal) VALUES (?,?,?, 'correo')", uid, asunto, mensaje); }
    }

    public List<Map<String, Object>> notificaciones(int uid) throws SQLException {
        return consultar("SELECT asunto, mensaje, creada_en FROM notificacion WHERE id_usuario = ? ORDER BY creada_en DESC LIMIT 50", uid);
    }

    public List<Map<String, Object>> notificacionesPendientes() throws SQLException {
        return consultar("SELECT n.id_notificacion, n.asunto, n.mensaje, u.correo FROM notificacion n JOIN usuario u ON u.id_usuario = n.id_usuario "
            + "WHERE n.enviada = FALSE ORDER BY n.creada_en LIMIT 50");
    }

    public void marcarEnviada(long id) throws SQLException {
        try (Connection c = Conexion.obtener()) { ejecutar(c, "UPDATE notificacion SET enviada = TRUE WHERE id_notificacion = ?", id); }
    }
}
