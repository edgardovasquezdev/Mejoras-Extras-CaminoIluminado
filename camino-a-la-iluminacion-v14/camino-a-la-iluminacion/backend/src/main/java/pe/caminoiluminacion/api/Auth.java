package pe.caminoiluminacion.api;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Contraseñas (PBKDF2), sesiones por token y límite de intentos de login. */
public final class Auth {
    private Auth() {}

    private static final int ITERACIONES = 600_000;
    private static final SecureRandom ALEATORIO = new SecureRandom();
    private static final long DURACION_SESION_MS = 30 * 60 * 1000L;

    public record Sesion(int idUsuario, String rol, long expira) {}

    private static final Map<String, Sesion> SESIONES = new ConcurrentHashMap<>();
    private static final Map<String, long[]> INTENTOS = new ConcurrentHashMap<>(); // {fallos, bloqueadoHasta}

    /* ---------- contraseñas ---------- */
    public static String hashear(String clave) {
        byte[] sal = new byte[16];
        ALEATORIO.nextBytes(sal);
        return "pbkdf2$" + ITERACIONES + "$" + Base64.getEncoder().encodeToString(sal)
             + "$" + Base64.getEncoder().encodeToString(derivar(clave, sal, ITERACIONES));
    }

    public static boolean verificar(String clave, String almacenado) {
        try {
            String[] p = almacenado.split("\\$");
            if (p.length != 4 || !p[0].equals("pbkdf2")) return false;
            byte[] esperado = Base64.getDecoder().decode(p[3]);
            byte[] real = derivar(clave, Base64.getDecoder().decode(p[2]), Integer.parseInt(p[1]));
            return MessageDigest.isEqual(esperado, real); // comparación en tiempo constante
        } catch (Exception e) { return false; }
    }

    private static byte[] derivar(String clave, byte[] sal, int iter) {
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(new PBEKeySpec(clave.toCharArray(), sal, iter, 256)).getEncoded();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static final String FALSO = hashear("clave-inexistente");

    /** Evita distinguir "usuario inexistente" de "clave incorrecta" por el tiempo de respuesta. */
    public static void igualarTiempo(String clave) { verificar(clave, FALSO); }

    public static boolean precisaRehash(String almacenado) {
        try { return Integer.parseInt(almacenado.split("\\$")[1]) < ITERACIONES; } catch (Exception e) { return false; }
    }

    /* ---------- sesiones ---------- */
    public static String crearSesion(int idUsuario, String rol) {
        byte[] b = new byte[32];
        ALEATORIO.nextBytes(b);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
        SESIONES.put(token, new Sesion(idUsuario, rol, System.currentTimeMillis() + DURACION_SESION_MS));
        return token;
    }

    /** Devuelve la sesión vigente (y la renueva) o null si no existe / expiró. */
    public static Sesion obtener(String token) {
        if (token == null) return null;
        Sesion s = SESIONES.get(token);
        if (s == null) return null;
        if (System.currentTimeMillis() > s.expira()) { SESIONES.remove(token); return null; }
        Sesion renovada = new Sesion(s.idUsuario(), s.rol(), System.currentTimeMillis() + DURACION_SESION_MS);
        SESIONES.put(token, renovada);
        return renovada;
    }

    public static void cerrar(String token) { if (token != null) SESIONES.remove(token); }

    /* ---------- intentos fallidos: 5 → bloqueo de 5 minutos ---------- */
    public static long minutosBloqueado(String clave) {
        long[] r = INTENTOS.get(clave);
        long resto = r == null ? 0 : r[1] - System.currentTimeMillis();
        return resto > 0 ? (resto + 59_999) / 60_000 : 0;
    }
    public static void registrarFallo(String clave) {
        INTENTOS.compute(clave, (k, r) -> {
            if (r == null) r = new long[]{0, 0};
            if (++r[0] >= 5) { r[0] = 0; r[1] = System.currentTimeMillis() + 5 * 60_000L; }
            return r;
        });
    }
    public static void limpiarFallos(String clave) { INTENTOS.remove(clave); }
}
