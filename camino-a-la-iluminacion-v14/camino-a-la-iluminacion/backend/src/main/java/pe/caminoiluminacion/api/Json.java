package pe.caminoiluminacion.api;

import java.math.BigDecimal;
import java.util.*;

/** JSON mínimo (sin dependencias): lee objetos planos y escribe mapas/listas. */
public final class Json {
    private Json() {}

    /** Lee un objeto JSON plano (valores: texto, número, booleano o null). */
    public static Map<String, Object> leerObjeto(String s) {
        P p = new P(s);
        Map<String, Object> m = new LinkedHashMap<>();
        p.ws(); p.esperar('{'); p.ws();
        if (p.i < s.length() && s.charAt(p.i) == '}') { p.i++; return m; }
        while (true) {
            p.ws(); String k = p.cadena(); p.ws(); p.esperar(':'); p.ws();
            m.put(k, p.valor()); p.ws();
            char c = p.leer();
            if (c == '}') break;
            if (c != ',') throw new IllegalArgumentException("JSON inválido");
        }
        return m;
    }

    private static final class P {
        final String s; int i = 0;
        P(String s) { this.s = s == null ? "" : s; }
        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        char leer() { if (i >= s.length()) throw new IllegalArgumentException("JSON incompleto"); return s.charAt(i++); }
        void esperar(char c) { if (leer() != c) throw new IllegalArgumentException("Se esperaba '" + c + "'"); }

        String cadena() {
            esperar('"');
            StringBuilder b = new StringBuilder();
            while (true) {
                char c = leer();
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                char e = leer();
                switch (e) {
                    case 'n' -> b.append('\n'); case 't' -> b.append('\t'); case 'r' -> b.append('\r');
                    case 'b' -> b.append('\b'); case 'f' -> b.append('\f');
                    case '"', '\\', '/' -> b.append(e);
                    case 'u' -> {
                        if (i + 4 > s.length()) throw new IllegalArgumentException("Escape inválido");
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4;
                    }
                    default -> throw new IllegalArgumentException("Escape inválido");
                }
            }
        }

        Object valor() {
            if (i >= s.length()) throw new IllegalArgumentException("JSON incompleto");
            char c = s.charAt(i);
            if (c == '"') return cadena();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int ini = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            if (ini == i) throw new IllegalArgumentException("Valor no soportado");
            String n = s.substring(ini, i);
            return n.matches("-?\\d+") ? (Object) Long.valueOf(n) : (Object) Double.valueOf(n);
        }
    }

    public static String escribir(Object o) {
        StringBuilder b = new StringBuilder();
        escribir(o, b);
        return b.toString();
    }

    private static void escribir(Object o, StringBuilder b) {
        if (o == null) b.append("null");
        else if (o instanceof Boolean) b.append(o);
        else if (o instanceof BigDecimal d) b.append(d.toPlainString());
        else if (o instanceof Number) b.append(o);
        else if (o instanceof Map<?, ?> m) {
            b.append('{'); boolean primero = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!primero) b.append(','); primero = false;
                texto(String.valueOf(e.getKey()), b); b.append(':'); escribir(e.getValue(), b);
            }
            b.append('}');
        } else if (o instanceof Collection<?> c) {
            b.append('['); boolean primero = true;
            for (Object x : c) { if (!primero) b.append(','); primero = false; escribir(x, b); }
            b.append(']');
        } else texto(String.valueOf(o), b);
    }

    private static void texto(String s, StringBuilder b) {
        b.append('"');
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\""); case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n"); case '\r' -> b.append("\\r"); case '\t' -> b.append("\\t");
                default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        b.append('"');
    }
}
