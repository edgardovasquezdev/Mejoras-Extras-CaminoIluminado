package pe.caminoiluminacion.api;

import pe.caminoiluminacion.seguridad.Cripto;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.regex.Pattern;

/** Protección contra bots: campo trampa (honeypot), tiempo mínimo firmado por el servidor y Cloudflare Turnstile opcional. */
final class Bots {
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private static final Pattern EXITO = Pattern.compile("\"success\"\\s*:\\s*true");

    private Bots() {}

    static String token() {
        String t = Long.toString(System.currentTimeMillis());
        return t + "." + Cripto.firmar("ft:" + t);
    }

    static void verificar(Map<String, Object> b, String ip) throws Exception {
        if (!Servidor.cadena(b, "hp").isEmpty()) throw new Servidor.ErrorHttp(400, "Solicitud no válida.");
        String ft = Servidor.cadena(b, "ft");
        int i = ft.indexOf('.');
        if (i < 1 || !Cripto.iguales(ft.substring(i + 1), Cripto.firmar("ft:" + ft.substring(0, i))))
            throw new Servidor.ErrorHttp(400, "Recarga la página e inténtalo de nuevo.");
        long edad;
        try { edad = System.currentTimeMillis() - Long.parseLong(ft.substring(0, i)); }
        catch (NumberFormatException e) { throw new Servidor.ErrorHttp(400, "Recarga la página e inténtalo de nuevo."); }
        if (edad < 2000) throw new Servidor.ErrorHttp(429, "Demasiado rápido. Espera un instante e inténtalo de nuevo.");
        if (edad > 2 * 3600_000L) throw new Servidor.ErrorHttp(400, "La página caducó. Recárgala e inténtalo de nuevo.");
        String secreto = System.getenv("CAI_TURNSTILE_SECRET");
        if (secreto != null && !secreto.isBlank()) turnstile(secreto, Servidor.cadena(b, "cf"), ip);
    }

    private static void turnstile(String secreto, String respuesta, String ip) throws Exception {
        if (respuesta.isEmpty() || respuesta.length() > 2048) throw new Servidor.ErrorHttp(400, "Completa la verificación anti-bots.");
        String form = "secret=" + enc(secreto) + "&response=" + enc(respuesta) + "&remoteip=" + enc(ip);
        HttpRequest rq = HttpRequest.newBuilder(URI.create("https://challenges.cloudflare.com/turnstile/v0/siteverify"))
            .timeout(Duration.ofSeconds(8)).header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form)).build();
        String r = HTTP.send(rq, HttpResponse.BodyHandlers.ofString()).body();
        if (!EXITO.matcher(r).find()) throw new Servidor.ErrorHttp(400, "No pudimos verificar que eres una persona. Inténtalo de nuevo.");
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
}
