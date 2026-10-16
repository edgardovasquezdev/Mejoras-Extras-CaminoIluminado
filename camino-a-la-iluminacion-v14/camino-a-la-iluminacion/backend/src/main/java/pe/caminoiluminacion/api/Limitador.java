package pe.caminoiluminacion.api;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Límite de solicitudes por clave (ventana fija). */
final class Limitador {
    private final Map<String, long[]> contadores = new ConcurrentHashMap<>();

    boolean permitir(String clave, int max, long ventanaMs) {
        long ahora = System.currentTimeMillis();
        long[] c = contadores.compute(clave, (k, v) -> {
            if (v == null || ahora - v[1] >= ventanaMs) return new long[]{1, ahora};
            v[0]++;
            return v;
        });
        return c[0] <= max;
    }

    void limpiar() {
        long limite = System.currentTimeMillis() - 10 * 60_000L;
        contadores.entrySet().removeIf((e) -> e.getValue()[1] < limite);
    }
}
