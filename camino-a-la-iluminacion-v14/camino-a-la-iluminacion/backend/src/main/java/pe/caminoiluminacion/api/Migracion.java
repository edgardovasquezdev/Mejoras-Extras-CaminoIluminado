package pe.caminoiluminacion.api;

import pe.caminoiluminacion.dao.PagoDAO;
import pe.caminoiluminacion.seguridad.Cripto;

import java.sql.SQLException;
import java.util.Map;

/** Cifra al arrancar los datos que quedaron en claro (DNI, teléfono, celular Yape/Plin). Es idempotente. */
final class Migracion {
    private Migracion() {}

    static void ejecutar(PagoDAO db) {
        try {
            for (Map<String, Object> u : db.consultar("SELECT id_usuario, dni, telefono FROM usuario WHERE CHAR_LENGTH(dni) = 8 OR (telefono IS NOT NULL AND telefono NOT LIKE 'v1:%')")) {
                String dni = String.valueOf(u.get("dni")), tel = u.get("telefono") == null ? null : String.valueOf(u.get("telefono"));
                boolean claro = dni.length() == 8;
                db.actualizar("UPDATE usuario SET dni = ?, dni_enc = COALESCE(?, dni_enc), telefono = ? WHERE id_usuario = ?",
                    claro ? Cripto.indice(dni) : dni, claro ? Cripto.cifrar(dni) : null, tel == null || tel.startsWith("v1:") ? tel : Cripto.cifrar(tel), u.get("id_usuario"));
            }
            for (Map<String, Object> c : db.consultar("SELECT id_creyente, dni FROM creyente WHERE CHAR_LENGTH(dni) = 8")) {
                String dni = String.valueOf(c.get("dni"));
                db.actualizar("UPDATE creyente SET dni = ?, dni_enc = ? WHERE id_creyente = ?", Cripto.indice(dni), Cripto.cifrar(dni), c.get("id_creyente"));
            }
            for (Map<String, Object> p : db.consultar("SELECT id_pago, yape_origen FROM pago WHERE yape_origen IS NOT NULL AND yape_origen NOT LIKE 'v1:%'"))
                db.actualizar("UPDATE pago SET yape_origen = ? WHERE id_pago = ?", Cripto.cifrar(String.valueOf(p.get("yape_origen"))), p.get("id_pago"));
        } catch (SQLException e) {
            System.err.println("No se pudo cifrar los datos sensibles: " + e.getMessage());
            System.err.println("Ejecuta database/04_seguridad.sql en MySQL y vuelve a arrancar.");
            System.exit(1);
        }
    }
}
