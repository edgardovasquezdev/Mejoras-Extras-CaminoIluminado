package pe.caminoiluminacion.api;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import pe.caminoiluminacion.dao.*;
import pe.caminoiluminacion.dao.impl.*;
import pe.caminoiluminacion.modelo.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import pe.caminoiluminacion.seguridad.Cripto;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;

/**
 * API REST + servidor del frontend (sin frameworks, solo el JDK).
 * Capas: HTTP (esta clase) → DAO → MySQL/MariaDB.
 *
 * Variables de entorno: CAI_PORT (8080), CAI_WEB (carpeta del frontend, "..")
 * CAI_UPLOADS ("uploads"), CAI_CORS (origen permitido, "*"), CAI_ADMIN_PASS,
 * y las de la base de datos (CAI_DB_HOST / PORT / USER / PASS).
 */
public class Servidor {

    static final class ErrorHttp extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final int codigo;
        ErrorHttp(int codigo, String mensaje) { super(mensaje); this.codigo = codigo; }
    }

    private static final String ADMIN_CORREO = "admin@caminoiluminacion.pe";
    private static final int MAX_CUERPO = 30 * 1024 * 1024;     // JSON con archivos en base64 (solo rutas de carga)
    private static final Set<String> RUTAS_PUBLICAS = Set.of("GET /salud", "GET /aranceles", "GET /parroquias", "GET /avisos", "GET /directorio",
        "GET /horarios", "POST /registro", "POST /login", "POST /logout");
    private static final int MAX_CUERPO_NORMAL = 64 * 1024;
    private static final boolean CONFIAR_PROXY = "1".equals(System.getenv("CAI_TRUST_PROXY"));
    private static final boolean FORZAR_HTTPS = "1".equals(System.getenv("CAI_FORCE_HTTPS"));
    private static final String CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data: blob: https://images.pexels.com https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'; "
        + "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
    private static final int MAX_ARCHIVO = 5 * 1024 * 1024;     // 5 MB reales
    private static final Set<String> SACRAMENTOS = Set.of("bautizo", "matrimonio", "primera_comunion", "confirmacion");
    static final Set<String> TIPOS_AVISO = Set.of("santa_cena", "ayuno", "vigilia", "celebracion", "cambio_horario", "evento", "otro");
    static final Pattern NOMBRE = Pattern.compile("^\\p{L}[\\p{L}'.-]+(\\s+\\p{L}[\\p{L}'.-]*)+$");
    static final Pattern CORREO = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    static final Pattern TELEFONO = Pattern.compile("^9\\d{8}$");
    private static final DateTimeFormatter FECHA_ES = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    private static final Set<String> RAICES_PUBLICAS = Set.of("index.html", "login.html", "css", "js", "img", "paginas", "vendor");

    private final UsuarioDAO usuarios = new UsuarioDAOImpl();
    private final ParroquiaDAO parroquias = new ParroquiaDAOImpl();
    private final HorarioDAO horarios = new HorarioDAOImpl();
    private final AvisoDAO avisos = new AvisoDAOImpl();
    private final ReservaDAO reservas = new ReservaDAOImpl();
    private final DocumentoDAO documentos = new DocumentoDAOImpl();
    private final PagoDAO finanzas = new PagoDAO();
    private final Extra extra = new Extra(this, finanzas);

    private final Path web = Paths.get(env("CAI_WEB", "..")).toAbsolutePath().normalize();
    private final Path uploads = Paths.get(env("CAI_UPLOADS", "uploads")).toAbsolutePath().normalize();
    private final String cors = env("CAI_CORS", "");
    private final Limitador limite = new Limitador();

    static String env(String n, String def) {
        String v = System.getenv(n);
        return v == null || v.isBlank() ? def : v;
    }

    /* ======================================================================
       ARRANQUE
       ====================================================================== */
    public static void main(String[] args) throws Exception {
        Servidor s = new Servidor();
        try {
            s.prepararAdministrador();
        } catch (SQLException e) {
            System.err.println("No se pudo conectar a la base de datos: " + e.getMessage());
            System.err.println("Revisa que MySQL esté activo, que hayas cargado database/camino_iluminacion.sql y las variables CAI_DB_*.");
            System.exit(1);
        }
        Migracion.ejecutar(s.finanzas);
        Files.createDirectories(s.uploads);
        int puerto = Integer.parseInt(env("CAI_PORT", "8080"));
        HttpServer http = HttpServer.create(new InetSocketAddress(puerto), 0);
        http.createContext("/", s::manejar);
        http.setExecutor(Executors.newFixedThreadPool(8));
        http.start();
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r); t.setDaemon(true); return t; })
            .scheduleWithFixedDelay(s::enviarNotificaciones, 10, 30, TimeUnit.SECONDS);
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r); t.setDaemon(true); return t; })
            .scheduleWithFixedDelay(s.limite::limpiar, 1, 1, TimeUnit.MINUTES);
        System.out.println("Camino a la Iluminación → http://localhost:" + puerto);
    }

    /** Garantiza que la cuenta del personal parroquial tenga una contraseña real (el SQL trae un marcador). */
    private void prepararAdministrador() throws SQLException {
        Optional<Usuario> a = usuarios.buscarPorCorreo(ADMIN_CORREO);
        if (a.isEmpty() || a.get().getContrasenaHash().startsWith("pbkdf2$")) return;
        String clave = System.getenv("CAI_ADMIN_PASS");
        boolean generada = clave == null || clave.isBlank();
        if (generada) clave = UUID.randomUUID().toString().substring(0, 12) + "Aa1";
        usuarios.actualizarContrasena(a.get().getIdUsuario(), Auth.hashear(clave));
        System.out.println("Administrador listo: " + ADMIN_CORREO + (generada ? "  contraseña inicial: " + clave + "  (anótala y cámbiala)" : ""));
    }

    /* ======================================================================
       MANEJO GENERAL (cabeceras, CORS, errores)
       ====================================================================== */
    private void manejar(HttpExchange ex) throws IOException {
        try {
            Headers h = ex.getResponseHeaders();
            String metodo = ex.getRequestMethod(), ruta = ex.getRequestURI().getPath();
            cabecerasSeguridad(ex, h, ruta);
            if (FORZAR_HTTPS && !esHttps(ex)) {
                String host = ex.getRequestHeaders().getFirst("Host");
                if (host == null || !host.matches("^[A-Za-z0-9.-]+(:\\d+)?$")) throw new ErrorHttp(400, "Solicitud no válida.");
                String q = ex.getRequestURI().getRawQuery();
                h.set("Location", "https://" + host.replaceFirst(":\\d+$", "") + ex.getRequestURI().getRawPath() + (q == null ? "" : "?" + q));
                ex.sendResponseHeaders(308, -1);
                return;
            }
            limitar(ex, h, metodo, ruta);
            String origen = ex.getRequestHeaders().getFirst("Origin");
            if (!cors.isEmpty() && cors.equals(origen)) {
                h.set("Access-Control-Allow-Origin", origen); h.set("Access-Control-Allow-Credentials", "true"); h.set("Vary", "Origin");
                h.set("Access-Control-Allow-Headers", "Content-Type, X-CAI"); h.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            }
            if (metodo.equals("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
            if (ruta.startsWith("/api/")) { verificarOrigen(ex, metodo); api(ex, metodo, ruta.substring(4)); }
            else estatico(ex, metodo, ruta);
        } catch (ErrorHttp e) {
            json(ex, e.codigo, Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            json(ex, 400, Map.of("error", "Solicitud no válida."));
        } catch (java.sql.SQLException e) {
            if ("23000".equals(e.getSQLState())) json(ex, 409, Map.of("error", "Ese comprobante o número de operación ya fue registrado."));
            else { e.printStackTrace(); json(ex, 500, Map.of("error", "Error interno del servidor.")); }
        } catch (Exception e) {
            e.printStackTrace();
            json(ex, 500, Map.of("error", "Error interno del servidor."));
        } finally {
            ex.close();
        }
    }

    private void api(HttpExchange ex, String m, String r) throws Exception {
        Matcher mt;
        if (m.equals("GET") && r.equals("/f")) { json(ex, 200, Map.of("ft", Bots.token())); return; }
        if (m.equals("GET") && r.equals("/config")) { json(ex, 200, Map.of("turnstileSiteKey", env("CAI_TURNSTILE_SITEKEY", ""))); return; }
        if (!RUTAS_PUBLICAS.contains(m + " " + r)) sesion(ex);      // todo lo demás exige sesión (denegar por defecto)
        if (extra.maneja(ex, m, r)) return;
        if (m.equals("GET") && r.equals("/salud")) { json(ex, 200, Map.of("ok", true)); return; }
        if (m.equals("POST") && r.equals("/registro")) { registro(ex, cuerpo(ex)); return; }
        if (m.equals("POST") && r.equals("/login")) { login(ex, cuerpo(ex)); return; }
        if (m.equals("POST") && r.equals("/logout")) {
            Auth.cerrar(token(ex));
            ex.getResponseHeaders().add("Set-Cookie", "cai_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" + (esHttps(ex) || FORZAR_HTTPS ? "; Secure" : ""));
            json(ex, 200, Map.of("ok", true)); return;
        }
        if (m.equals("GET") && r.equals("/parroquias")) { listarParroquias(ex); return; }
        if (m.equals("GET") && r.equals("/avisos")) { listarAvisos(ex); return; }
        if (m.equals("GET") && r.equals("/horarios")) { listarHorarios(ex); return; }

        if (m.equals("POST") && r.equals("/reservas")) { crearReserva(ex, sesion(ex), cuerpo(ex)); return; }
        if (m.equals("GET") && r.equals("/reservas/mias")) { misReservas(ex, sesion(ex)); return; }
        if (m.equals("GET") && r.equals("/documentos/mios")) { misDocumentos(ex, sesion(ex)); return; }
        if (m.equals("POST") && r.equals("/documentos")) { subirDocumento(ex, sesion(ex), cuerpo(ex)); return; }

        if (m.equals("POST") && r.equals("/avisos")) { publicarAviso(ex, admin(ex), cuerpo(ex)); return; }
        if (m.equals("GET") && r.equals("/admin/documentos")) { admin(ex); documentosPendientes(ex); return; }
        if (m.equals("GET") && r.equals("/admin/reservas")) { admin(ex); reservasPorEstado(ex); return; }
        if (m.equals("PUT") && (mt = Pattern.compile("/admin/documentos/(\\d+)").matcher(r)).matches()) {
            admin(ex); resolverDocumento(ex, Integer.parseInt(mt.group(1)), cuerpo(ex)); return;
        }
        if (m.equals("GET") && (mt = Pattern.compile("/admin/documentos/(\\d+)/archivo").matcher(r)).matches()) {
            admin(ex); verArchivo(ex, Integer.parseInt(mt.group(1))); return;
        }
        if (m.equals("PUT") && (mt = Pattern.compile("/admin/reservas/(\\d+)").matcher(r)).matches()) {
            admin(ex); resolverReserva(ex, Integer.parseInt(mt.group(1)), cuerpo(ex)); return;
        }
        if (m.equals("GET") && r.equals("/aranceles")) { json(ex, 200, finanzas.aranceles()); return; }
        if (m.equals("POST") && r.equals("/solicitudes")) { crearSolicitud(ex, sesion(ex), cuerpo(ex)); return; }
        if (m.equals("GET") && r.equals("/solicitudes/mias")) { json(ex, 200, finanzas.solicitudesDe(sesion(ex).idUsuario())); return; }
        if (m.equals("GET") && r.equals("/notificaciones")) { json(ex, 200, finanzas.notificaciones(sesion(ex).idUsuario())); return; }
        if (m.equals("POST") && r.equals("/donaciones")) { crearDonacion(ex, sesion(ex), cuerpo(ex)); return; }
        if (m.equals("GET") && (mt = Pattern.compile("/pagos/(\\d+)/voucher").matcher(r)).matches()) { verVoucher(ex, sesion(ex), Long.parseLong(mt.group(1))); return; }
        if (m.equals("GET") && r.equals("/admin/metricas")) { admin(ex); json(ex, 200, finanzas.metricas()); return; }
        if (m.equals("GET") && r.equals("/admin/pagos")) { admin(ex); json(ex, 200, finanzas.pagosPendientes()); return; }
        if (m.equals("PUT") && (mt = Pattern.compile("/admin/pagos/(\\d+)").matcher(r)).matches()) {
            resolverPago(ex, admin(ex), Long.parseLong(mt.group(1)), cuerpo(ex)); return;
        }
        if (m.equals("GET") && r.equals("/admin/reportes")) { admin(ex); json(ex, 200, finanzas.reportePorSacramento()); return; }
        if (m.equals("GET") && r.equals("/directorio")) { directorio(ex); return; }
        if (m.equals("POST") && r.equals("/admin/horarios")) { crearHorario(ex, admin(ex), cuerpo(ex)); return; }
        if (m.equals("DELETE") && (mt = Pattern.compile("/admin/horarios/(\\d+)").matcher(r)).matches()) {
            admin(ex); if (!horarios.eliminar(Integer.parseInt(mt.group(1)))) throw new ErrorHttp(404, "Horario no encontrado."); json(ex, 200, Map.of("ok", true)); return;
        }
        if (m.equals("DELETE") && (mt = Pattern.compile("/admin/avisos/(\\d+)").matcher(r)).matches()) {
            admin(ex); if (!avisos.eliminar(Integer.parseInt(mt.group(1)))) throw new ErrorHttp(404, "Aviso no encontrado."); json(ex, 200, Map.of("ok", true)); return;
        }
        throw new ErrorHttp(404, "Ruta no encontrada.");
    }

    /* ======================================================================
       CUENTAS
       ====================================================================== */
    private void registro(HttpExchange ex, Map<String, Object> b) throws Exception {
        String nombre = texto(b, "nombre"), correo = texto(b, "correo").toLowerCase();
        String telefono = texto(b, "telefono"), clave = cadena(b, "clave");
        nombre = nombre.replaceAll("\\s+", " ");
        if (!NOMBRE.matcher(nombre).matches() || nombre.length() > 80) throw new ErrorHttp(422, "Ingresa nombre y apellido (solo letras).");
        if (!CORREO.matcher(correo).matches() || correo.length() > 120) throw new ErrorHttp(422, "Correo no válido.");
        if (!TELEFONO.matcher(telefono).matches()) throw new ErrorHttp(422, "El celular debe tener 9 dígitos y empezar con 9.");
        if (clave.length() < 8 || clave.length() > 72 || !clave.matches(".*[a-z].*") || !clave.matches(".*[A-Z].*") || !clave.matches(".*\\d.*"))
            throw new ErrorHttp(422, "La contraseña debe tener 8+ caracteres con mayúscula, minúscula y número.");
        if (usuarios.buscarPorCorreo(correo).isPresent()) throw new ErrorHttp(409, "Ya existe una cuenta con ese correo.");

        String[] partes = nombre.split(" ", 2);
        Usuario u = new Usuario();
        u.setNombre(partes[0]); u.setApellido(partes[1]); u.setCorreo(correo); u.setTelefono(telefono);
        u.setContrasenaHash(Auth.hashear(clave));
        u.setRol("feligres");                      // el rol NUNCA se toma de la solicitud
        usuarios.insertar(u);
        json(ex, 201, respuestaSesion(u));
    }

    private void login(HttpExchange ex, Map<String, Object> b) throws Exception {
        String correo = texto(b, "correo").toLowerCase(), clave = cadena(b, "clave");
        long espera = Auth.minutosBloqueado(correo);
        if (espera > 0) throw new ErrorHttp(429, "Demasiados intentos. Vuelve a intentar en " + espera + " min.");
        Optional<Usuario> u = usuarios.buscarPorCorreo(correo);
        if (u.isEmpty() || !Auth.verificar(clave, u.get().getContrasenaHash())) {
            Auth.registrarFallo(correo);
            throw new ErrorHttp(401, "Correo o contraseña incorrectos.");
        }
        Auth.limpiarFallos(correo);
        json(ex, 200, respuestaSesion(u.get()));
    }

    private Map<String, Object> respuestaSesion(Usuario u) {
        Map<String, Object> us = new LinkedHashMap<>();
        us.put("nombre", u.getNombre() + " " + u.getApellido());
        us.put("correo", u.getCorreo());
        us.put("rol", u.getRol());
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("token", Auth.crearSesion(u.getIdUsuario(), u.getRol()));
        r.put("usuario", us);
        return r;
    }

    /* ======================================================================
       CONSULTAS PÚBLICAS
       ====================================================================== */
    private void listarParroquias(HttpExchange ex) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Parroquia p : parroquias.listarTodas()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getIdParroquia()); m.put("nombre", p.getNombre()); m.put("direccion", p.getDireccion());
            m.put("lat", p.getLatitud()); m.put("lng", p.getLongitud());
            m.put("sacramentos", p.getSacramentosDisponibles() == null ? List.of() : Arrays.asList(p.getSacramentosDisponibles().split(",")));
            lista.add(m);
        }
        json(ex, 200, lista);
    }

    private void listarAvisos(HttpExchange ex) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Parroquia p : parroquias.listarTodas())
            for (Aviso a : avisos.listarPorParroquia(p.getIdParroquia())) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", a.getIdAviso()); m.put("idParroquia", p.getIdParroquia()); m.put("parroquia", p.getNombre()); m.put("titulo", a.getTitulo());
                m.put("descripcion", a.getDescripcion()); m.put("tipo", a.getTipo()); m.put("urgente", a.isUrgente());
                m.put("fecha", a.getFechaEvento() == null ? null : a.getFechaEvento().toString());
                lista.add(m);
            }
        json(ex, 200, lista);
    }

    private void listarHorarios(HttpExchange ex) throws Exception {
        int id = entero(consulta(ex, "parroquia"), "parroquia");
        List<Object> lista = new ArrayList<>();
        for (Horario h : horarios.listarPorParroquia(id)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", h.getIdHorario()); m.put("dia", h.getDiaSemana()); m.put("hora", h.getHora()); m.put("tipo", h.getTipo());
            lista.add(m);
        }
        json(ex, 200, lista);
    }

    /* ======================================================================
       FELIGRÉS: reservas y documentos
       ====================================================================== */
    private void crearReserva(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        String sacramento = normalizar(texto(b, "sacramento"));
        if (!SACRAMENTOS.contains(sacramento)) throw new ErrorHttp(422, "Sacramento no válido.");
        String nombre = texto(b, "nombre").replaceAll("\\s+", " ");
        if (!NOMBRE.matcher(nombre).matches() || nombre.length() > 150) throw new ErrorHttp(422, "Nombre del solicitante no válido.");
        String notas = texto(b, "notas");
        if (notas.length() > 300) throw new ErrorHttp(422, "Las notas no pueden superar 300 caracteres.");
        LocalDate fecha = fecha(texto(b, "fecha"));
        long dias = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), fecha);
        if (dias < 15 || dias > 365) throw new ErrorHttp(422, "La fecha debe estar entre 15 días y 1 año desde hoy.");

        Parroquia p = buscarParroquia(b);
        boolean ofrece = p.getSacramentosDisponibles() != null && Arrays.stream(p.getSacramentosDisponibles().split(","))
            .map(Servidor::normalizar).anyMatch(x -> x.startsWith(sacramento.substring(0, Math.min(sacramento.length(), 6))));
        if (!ofrece) throw new ErrorHttp(422, p.getNombre() + " no ofrece este sacramento.");
        for (Reserva x : reservas.listarPorUsuario(s.idUsuario()))
            if (x.getSacramento().equals(sacramento) && x.getIdParroquia().equals(p.getIdParroquia()) && "pendiente".equals(x.getEstado()))
                throw new ErrorHttp(409, "Ya tienes una solicitud pendiente de este sacramento en esa parroquia.");

        Reserva r = new Reserva();
        r.setIdUsuario(s.idUsuario()); r.setIdParroquia(p.getIdParroquia()); r.setSacramento(sacramento);
        r.setNombreSolicitante(nombre); r.setFechaSolicitada(java.sql.Date.valueOf(fecha));
        r.setNotas(notas.isEmpty() ? null : notas); r.setEstado("pendiente");
        reservas.insertar(r);
        json(ex, 201, Map.of("codigo", "RES-" + r.getIdReserva(), "estado", "pendiente"));
    }

    private void misReservas(HttpExchange ex, Auth.Sesion s) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Reserva r : reservas.listarPorUsuario(s.idUsuario())) lista.add(mapReserva(r));
        json(ex, 200, lista);
    }

    private void subirDocumento(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        soloCampos(b, "nombre", "contenido", "idReserva");
        String original = Paths.get(texto(b, "nombre").replace('\\', '/')).getFileName().toString();
        String limpio = original.replaceAll("[^\\p{L}\\p{N} ._()-]", "_");
        String ext = limpio.contains(".") ? limpio.substring(limpio.lastIndexOf('.') + 1).toLowerCase() : "";
        if (limpio.length() > 150 || !Set.of("pdf", "jpg", "jpeg", "png").contains(ext))
            throw new ErrorHttp(422, "Formato no permitido (usa PDF, JPG o PNG).");
        byte[] datos;
        try { datos = Base64.getDecoder().decode(cadena(b, "contenido")); }
        catch (IllegalArgumentException e) { throw new ErrorHttp(422, "Archivo corrupto."); }
        if (datos.length == 0 || datos.length > MAX_ARCHIVO) throw new ErrorHttp(422, "El archivo debe pesar entre 1 byte y 5 MB.");
        if (!firmaValida(datos, ext)) throw new ErrorHttp(422, "El contenido no coincide con la extensión del archivo.");

        Documento d = new Documento();
        d.setIdUsuario(s.idUsuario());
        if (b.get("idReserva") instanceof Number n) {
            Optional<Reserva> r = reservas.buscarPorId(n.intValue());
            if (r.isEmpty() || r.get().getIdUsuario() != s.idUsuario()) throw new ErrorHttp(403, "Esa reserva no te pertenece.");
            d.setIdReserva(n.intValue());
        }
        String guardado = UUID.randomUUID() + "." + ext;     // nombre interno: nunca el del usuario
        Files.write(uploads.resolve(guardado), datos);
        d.setNombreArchivo(limpio); d.setRutaArchivo(guardado); d.setEstadoValidacion("pendiente");
        documentos.insertar(d);
        json(ex, 201, mapDoc(d));
    }

    private void misDocumentos(HttpExchange ex, Auth.Sesion s) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Documento d : documentos.listarPorUsuario(s.idUsuario())) lista.add(mapDoc(d));
        json(ex, 200, lista);
    }

    /* ======================================================================
       PERSONAL PARROQUIAL
       ====================================================================== */
    private void documentosPendientes(HttpExchange ex) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Documento d : documentos.listarPendientes()) lista.add(mapDoc(d));
        json(ex, 200, lista);
    }

    private void resolverDocumento(HttpExchange ex, int id, Map<String, Object> b) throws Exception {
        soloCampos(b, "accion", "motivo");
        String accion = texto(b, "accion");
        boolean ok;
        if (accion.equals("validar")) ok = documentos.validar(id);
        else if (accion.equals("rechazar")) {
            String motivo = texto(b, "motivo");
            if (motivo.length() < 5 || motivo.length() > 255) throw new ErrorHttp(422, "Indica el motivo del rechazo (5 a 255 caracteres).");
            ok = documentos.rechazar(id, motivo);
        } else throw new ErrorHttp(422, "Acción no válida.");
        if (!ok) throw new ErrorHttp(404, "Documento no encontrado.");
        json(ex, 200, Map.of("ok", true));
    }

    private void verArchivo(HttpExchange ex, int id) throws Exception {
        Documento d = documentos.listarPendientes().stream().filter(x -> x.getIdDocumento() == id).findFirst()
            .orElseThrow(() -> new ErrorHttp(404, "Documento no encontrado."));
        Path ruta = uploads.resolve(d.getRutaArchivo()).normalize();
        if (!ruta.startsWith(uploads) || !Files.isRegularFile(ruta)) throw new ErrorHttp(404, "Archivo no disponible.");
        enviarArchivoPrivado(ex, ruta);
    }

    private void reservasPorEstado(HttpExchange ex) throws Exception {
        String estado = consulta(ex, "estado");
        if (estado == null) estado = "pendiente";
        if (!Set.of("pendiente", "confirmada", "rechazada").contains(estado)) throw new ErrorHttp(422, "Estado no válido.");
        List<Object> lista = new ArrayList<>();
        for (Reserva r : reservas.listarPorEstado(estado)) lista.add(mapReserva(r));
        json(ex, 200, lista);
    }

    private void resolverReserva(HttpExchange ex, int id, Map<String, Object> b) throws Exception {
        soloCampos(b, "estado");
        String estado = texto(b, "estado");
        if (!Set.of("confirmada", "rechazada").contains(estado)) throw new ErrorHttp(422, "Estado no válido.");
        if (!reservas.actualizarEstado(id, estado)) throw new ErrorHttp(404, "Reserva no encontrada.");
        json(ex, 200, Map.of("ok", true));
    }

    private void publicarAviso(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        soloCampos(b, "titulo", "descripcion", "tipo", "fecha", "urgente", "idParroquia");
        String titulo = texto(b, "titulo").replaceAll("\\s+", " "), desc = texto(b, "descripcion");
        if (titulo.length() < 5 || titulo.length() > 100) throw new ErrorHttp(422, "El título debe tener entre 5 y 100 caracteres.");
        if (desc.length() < 10 || desc.length() > 500) throw new ErrorHttp(422, "La descripción debe tener entre 10 y 500 caracteres.");
        String tipo = normalizar(texto(b, "tipo"));
        Aviso a = new Aviso();
        a.setIdParroquia(b.get("idParroquia") instanceof Number n ? n.intValue() : parroquias.listarTodas().get(0).getIdParroquia());
        a.setTitulo(titulo); a.setDescripcion(desc); a.setTipo(TIPOS_AVISO.contains(tipo) ? tipo : "otro");
        a.setUrgente(Boolean.TRUE.equals(b.get("urgente")));
        if (!texto(b, "fecha").isEmpty()) a.setFechaEvento(java.sql.Date.valueOf(fecha(texto(b, "fecha"))));
        avisos.insertar(a);
        json(ex, 201, Map.of("id", a.getIdAviso()));
    }

    /* ======================================================================
       SERIALIZACIÓN
       ====================================================================== */
    /* ======================= DIRECTORIO Y HORARIOS ======================= */
    private void directorio(HttpExchange ex) throws Exception {
        List<Object> lista = new ArrayList<>();
        for (Parroquia p : parroquias.listarTodas()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getIdParroquia()); m.put("nombre", p.getNombre()); m.put("direccion", p.getDireccion());
            m.put("lat", p.getLatitud()); m.put("lng", p.getLongitud());
            m.put("sacramentos", p.getSacramentosDisponibles() == null ? List.of() : Arrays.asList(p.getSacramentosDisponibles().split(",")));
            List<Object> hs = new ArrayList<>();
            for (Horario h : horarios.listarPorParroquia(p.getIdParroquia())) {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("id", h.getIdHorario()); x.put("dia", h.getDiaSemana()); x.put("hora", h.getHora()); x.put("tipo", h.getTipo());
                hs.add(x);
            }
            m.put("horarios", hs);
            lista.add(m);
        }
        json(ex, 200, lista);
    }

    private void crearHorario(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        soloCampos(b, "idParroquia", "parroquia", "dia", "hora", "tipo");
        String dia = texto(b, "dia"), hora = texto(b, "hora"), tipo = texto(b, "tipo");
        if (!Set.of("lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo").contains(dia)) throw new ErrorHttp(422, "Día no válido.");
        if (!Set.of("misa", "confesion", "actividad").contains(tipo)) throw new ErrorHttp(422, "Tipo no válido.");
        if (hora.length() < 3 || hora.length() > 40) throw new ErrorHttp(422, "Indica la hora (ej. 8:00 a.m.).");
        Parroquia p = buscarParroquia(b);
        Horario h = new Horario();
        h.setIdParroquia(p.getIdParroquia()); h.setDiaSemana(dia); h.setHora(hora); h.setTipo(tipo);
        json(ex, 201, Map.of("id", horarios.insertar(h).getIdHorario()));
    }

    /* ======================= SOLICITUD CON PAGO YAPE, DONACIONES, PAGOS ======================= */
    private void crearSolicitud(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        soloCampos(b, "sacramento", "nombre", "idParroquia", "parroquia", "fecha", "notas", "dniSacramentado", "metodo", "numeroOperacion", "yapeOrigen", "tarjetaTitular", "tarjetaNumero", "tarjetaVence", "tarjetaCvv", "voucher", "voucherNombre", "partida", "partidaNombre", "dni", "dniNombre", "acta", "actaNombre");
        String sacramento = normalizar(texto(b, "sacramento"));
        if (!SACRAMENTOS.contains(sacramento)) throw new ErrorHttp(422, "Sacramento no válido.");
        String nombre = texto(b, "nombre").replaceAll("\\s+", " ");
        if (!NOMBRE.matcher(nombre).matches() || nombre.length() > 150) throw new ErrorHttp(422, "Nombre del solicitante no válido.");
        String notas = texto(b, "notas");
        if (notas.length() > 300) throw new ErrorHttp(422, "Las notas no pueden superar 300 caracteres.");
        long dias = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), fecha(texto(b, "fecha")));
        if (dias < 15 || dias > 365) throw new ErrorHttp(422, "La fecha debe estar entre 15 días y 1 año desde hoy.");
        Parroquia p = buscarParroquia(b);
        String prefijo = sacramento.substring(0, 6);
        if (p.getSacramentosDisponibles() == null || Arrays.stream(p.getSacramentosDisponibles().split(",")).map(Servidor::normalizar).noneMatch(x -> x.startsWith(prefijo)))
            throw new ErrorHttp(422, p.getNombre() + " no ofrece este sacramento.");
        String dni = texto(b, "dniSacramentado");
        if (!dni.matches("^\\d{8}$")) throw new ErrorHttp(422, "El DNI del sacramentado debe tener exactamente 8 dígitos.");
        String metodo = texto(b, "metodo").isEmpty() ? "yape" : texto(b, "metodo");
        if (!Set.of("yape", "plin", "tarjeta").contains(metodo)) throw new ErrorHttp(422, "Método de pago no válido.");
        String op, origen = null, ult4 = null, marca = null;
        if (metodo.equals("tarjeta")) {
            String[] t = Extra.validarTarjeta(b);
            ult4 = t[0]; marca = t[1]; op = "TRJ-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
        } else { op = texto(b, "numeroOperacion"); origen = texto(b, "yapeOrigen"); validarYape(op, origen); }
        BigDecimal monto = finanzas.monto(sacramento);               // el monto jamás viene del navegador
        if (monto == null) throw new ErrorHttp(422, "Este sacramento no tiene arancel vigente.");
        for (Reserva x : reservas.listarPorUsuario(s.idUsuario()))
            if (x.getSacramento().equals(sacramento) && x.getIdParroquia().equals(p.getIdParroquia()) && "pendiente".equals(x.getEstado()))
                throw new ErrorHttp(409, "Ya tienes una solicitud pendiente de este sacramento en esa parroquia.");
        if (finanzas.existeOperacion(op)) throw new ErrorHttp(409, "Ese número de operación ya fue registrado.");

        List<Path> escritos = new ArrayList<>();
        try {
            PagoDAO.Archivo voucher = metodo.equals("tarjeta") ? null : archivo(b, "voucher", true, "El voucher de pago", escritos);
            if (voucher != null && finanzas.existeVoucher(voucher.sha())) throw new ErrorHttp(409, "Ese comprobante ya fue utilizado en otro pago.");
            Map<String, PagoDAO.Archivo> docs = new LinkedHashMap<>();
            docs.put("partida", archivo(b, "partida", false, "La partida", escritos));
            docs.put("dni", archivo(b, "dni", false, "El DNI", escritos));
            if (!cadena(b, "acta").isEmpty()) docs.put("acta", archivo(b, "acta", false, "El acta", escritos));
            else if (sacramento.equals("matrimonio")) throw new ErrorHttp(422, "El acta es obligatoria para matrimonio.");
            long id = finanzas.registrarSolicitud(s.idUsuario(), p.getIdParroquia(), sacramento, nombre, LocalDate.parse(texto(b, "fecha")),
                notas.isEmpty() ? null : notas, monto, docs, voucher, op, origen, dni, metodo, ult4, marca);
            json(ex, 201, Map.of("codigo", "RES-" + id, "estado", "pendiente", "monto", monto));
        } catch (Exception e) {
            for (Path f : escritos) Files.deleteIfExists(f);          // sin archivos huérfanos si algo falla
            throw e;
        }
    }

    private void crearDonacion(HttpExchange ex, Auth.Sesion s, Map<String, Object> b) throws Exception {
        soloCampos(b, "concepto", "monto", "numeroOperacion", "yapeOrigen", "voucher", "voucherNombre", "metodo");
        String concepto = texto(b, "concepto");
        if (!Set.of("donacion", "diezmo").contains(concepto)) throw new ErrorHttp(422, "Concepto no válido.");
        BigDecimal monto;
        try { monto = new BigDecimal(String.valueOf(b.get("monto"))).setScale(2, java.math.RoundingMode.HALF_UP); }
        catch (Exception e) { throw new ErrorHttp(422, "Monto no válido."); }
        if (monto.compareTo(BigDecimal.ONE) < 0 || monto.compareTo(new BigDecimal("10000")) > 0) throw new ErrorHttp(422, "El monto debe estar entre S/ 1 y S/ 10,000.");
        String op = texto(b, "numeroOperacion"), origen = texto(b, "yapeOrigen");
        validarYape(op, origen);
        if (finanzas.existeOperacion(op)) throw new ErrorHttp(409, "Ese número de operación ya fue registrado.");
        List<Path> escritos = new ArrayList<>();
        try {
            PagoDAO.Archivo v = archivo(b, "voucher", true, "El voucher de Yape", escritos);
            if (finanzas.existeVoucher(v.sha())) throw new ErrorHttp(409, "Ese comprobante ya fue utilizado.");
            finanzas.registrarDonacion(s.idUsuario(), concepto, monto, op, origen, v, Set.of("plin").contains(texto(b, "metodo")) ? "plin" : "yape");
            json(ex, 201, Map.of("ok", true));
        } catch (Exception e) {
            for (Path f : escritos) Files.deleteIfExists(f);
            throw e;
        }
    }

    private void verVoucher(HttpExchange ex, Auth.Sesion s, long idPago) throws Exception {
        Map<String, Object> v = finanzas.voucherDe(idPago);
        if (v == null) throw new ErrorHttp(404, "Comprobante no encontrado.");
        if (!"administrador".equals(s.rol()) && ((Number) v.get("id_usuario")).intValue() != s.idUsuario()) throw new ErrorHttp(403, "No tienes permisos para ver este comprobante.");
        if ("administrador".equals(s.rol())) auditar(ex, s);
        Path ruta = uploads.resolve(String.valueOf(v.get("ruta_voucher"))).normalize();
        if (!ruta.startsWith(uploads) || !Files.isRegularFile(ruta)) throw new ErrorHttp(404, "Archivo no disponible.");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        enviarArchivoPrivado(ex, ruta);
    }

    private void resolverPago(HttpExchange ex, Auth.Sesion admin, long id, Map<String, Object> b) throws Exception {
        soloCampos(b, "accion", "observacion");
        String accion = texto(b, "accion"), obs = texto(b, "observacion");
        if (!accion.equals("aprobar") && !accion.equals("rechazar")) throw new ErrorHttp(422, "Acción no válida.");
        boolean aprobar = accion.equals("aprobar");
        if (!aprobar && (obs.length() < 5 || obs.length() > 255)) throw new ErrorHttp(422, "Indica la observación del rechazo (5 a 255 caracteres).");
        if (!finanzas.resolver(id, aprobar, obs, admin.idUsuario())) throw new ErrorHttp(404, "El pago no existe o ya fue revisado.");
        json(ex, 200, Map.of("ok", true));
    }

    private static void validarYape(String op, String origen) {
        if (!op.matches("^\\d{6,12}$")) throw new ErrorHttp(422, "El número de operación debe tener de 6 a 12 dígitos.");
        if (!TELEFONO.matcher(origen).matches()) throw new ErrorHttp(422, "El celular Yape debe tener 9 dígitos y empezar con 9.");
    }

    /** Valida y guarda un archivo base64: tamaño, firma real (no extensión), nombre aleatorio. */
    private PagoDAO.Archivo archivo(Map<String, Object> b, String clave, boolean soloImagen, String etiqueta, List<Path> escritos) throws Exception {
        String crudo = cadena(b, clave);
        if (crudo.isEmpty()) throw new ErrorHttp(422, etiqueta + " es obligatorio.");
        byte[] d;
        try { d = Base64.getDecoder().decode(crudo); } catch (IllegalArgumentException e) { throw new ErrorHttp(422, etiqueta + ": archivo corrupto."); }
        if (d.length == 0 || d.length > MAX_ARCHIVO) throw new ErrorHttp(422, etiqueta + " debe pesar entre 1 byte y 5 MB.");
        String ext = firmaValida(d, "pdf") ? "pdf" : firmaValida(d, "png") ? "png" : firmaValida(d, "jpg") ? "jpg" : null;
        if (ext == null || (soloImagen && ext.equals("pdf"))) throw new ErrorHttp(422, etiqueta + ": formato no válido (" + (soloImagen ? "JPG o PNG" : "JPG, PNG o PDF") + ").");
        if (ext.equals("pdf") && contieneActivo(d)) throw new ErrorHttp(422, etiqueta + ": el PDF contiene elementos activos no permitidos.");
        String guardado = UUID.randomUUID() + "." + ext;
        Path ruta = uploads.resolve(guardado);
        Files.write(ruta, d);
        escritos.add(ruta);
        String original = Paths.get(texto(b, clave + "Nombre").replace('\\', '/')).getFileName().toString().replaceAll("[^\\p{L}\\p{N} ._()-]", "_");
        if (original.isBlank()) original = clave + "." + ext;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        return new PagoDAO.Archivo(guardado, HexFormat.of().formatHex(md.digest(d)), original.length() > 150 ? original.substring(0, 150) : original, d.length);
    }

    /** Simulado por consola: reemplazar por JavaMail o un proveedor SMS. */
    void enviarNotificaciones() {
        try {
            for (Map<String, Object> n : finanzas.notificacionesPendientes()) {
                System.out.println("[CORREO SIMULADO] a=" + n.get("correo") + " | " + n.get("asunto") + " | " + n.get("mensaje"));
                finanzas.marcarEnviada(((Number) n.get("id_notificacion")).longValue());
            }
        } catch (Exception e) { System.err.println("Notificaciones: " + e.getMessage()); }
    }

    private Map<String, Object> mapDoc(Documento d) throws SQLException {
        String feligres = usuarios.buscarPorId(d.getIdUsuario()).map(u -> u.getNombre() + " " + u.getApellido()).orElse("—");
        String tramite = "Por confirmar";
        if (d.getIdReserva() != null) {
            Optional<Reserva> r = reservas.buscarPorId(d.getIdReserva());
            if (r.isPresent()) tramite = etiqueta(r.get().getSacramento());
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.getIdDocumento()); m.put("feligres", feligres); m.put("documento", d.getNombreArchivo());
        m.put("tramite", tramite); m.put("estado", d.getEstadoValidacion()); m.put("motivo", d.getMotivoRechazo());
        m.put("fecha", d.getFechaEnvio() == null ? LocalDate.now().format(FECHA_ES) : d.getFechaEnvio().toLocalDateTime().toLocalDate().format(FECHA_ES));
        return m;
    }

    private Map<String, Object> mapReserva(Reserva r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("codigo", "RES-" + r.getIdReserva()); m.put("sacramento", etiqueta(r.getSacramento()));
        m.put("solicitante", r.getNombreSolicitante()); m.put("fecha", r.getFechaSolicitada().toLocalDate().format(FECHA_ES));
        m.put("estado", r.getEstado()); m.put("notas", r.getNotas());
        return m;
    }

    /* ======================================================================
       ESTÁTICOS (el frontend se sirve desde el mismo origen → sin problemas de CORS)
       ====================================================================== */
    private void estatico(HttpExchange ex, String metodo, String ruta) throws IOException {
        if (!metodo.equals("GET")) throw new ErrorHttp(405, "Método no permitido.");
        String rel = ruta.equals("/") ? "index.html" : ruta.substring(1);
        Path archivo = web.resolve(rel).normalize();
        // Se valida la ruta YA normalizada: así "/css/../backend/pom.xml" no puede escapar de las carpetas públicas.
        if (!archivo.startsWith(web) || archivo.equals(web)) throw new ErrorHttp(404, "No encontrado.");
        Path relativa = web.relativize(archivo);
        boolean oculto = false;
        for (Path parte : relativa) if (parte.toString().startsWith(".")) oculto = true;
        if (oculto || !RAICES_PUBLICAS.contains(relativa.getName(0).toString()) || !Files.isRegularFile(archivo))
            throw new ErrorHttp(404, "No encontrado.");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        enviarBytes(ex, 200, tipoMime(archivo.toString()), Files.readAllBytes(archivo));
    }

    /* ======================================================================
       SEGURIDAD: cabeceras, HTTPS, límites, CSRF, IP y archivos privados
       ====================================================================== */
    private void cabecerasSeguridad(HttpExchange ex, Headers h, String ruta) {
        h.set("X-Content-Type-Options", "nosniff");
        h.set("X-Frame-Options", "DENY");
        h.set("Referrer-Policy", "strict-origin-when-cross-origin");
        h.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=(), payment=(), usb=()");
        h.set("Cross-Origin-Opener-Policy", "same-origin");
        h.set("Cross-Origin-Resource-Policy", "same-origin");
        h.set("Content-Security-Policy", CSP);
        if (FORZAR_HTTPS || esHttps(ex)) h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
        if (ruta.startsWith("/api/")) h.set("Cache-Control", "no-store");
    }

    boolean esHttps(HttpExchange ex) {
        return CONFIAR_PROXY && "https".equalsIgnoreCase(ex.getRequestHeaders().getFirst("X-Forwarded-Proto"));
    }

    String ip(HttpExchange ex) {
        if (CONFIAR_PROXY) {
            String f = ex.getRequestHeaders().getFirst("X-Forwarded-For");
            if (f != null) { String primera = f.split(",")[0].trim(); if (primera.matches("^[0-9a-fA-F:.]{3,45}$")) return primera; }
        }
        return ex.getRemoteAddress().getAddress().getHostAddress();
    }

    private void limitar(HttpExchange ex, Headers h, String metodo, String ruta) {
        String ip = ip(ex);
        boolean ok = limite.permitir("g:" + ip, 300, 60_000);
        if (ok && metodo.equals("POST") && (ruta.equals("/api/login") || ruta.equals("/api/registro"))) ok = limite.permitir("a:" + ip, 10, 60_000);
        else if (ok && metodo.equals("POST") && ruta.matches("/api/(solicitudes|donaciones|documentos)")) ok = limite.permitir("u:" + ip, 15, 60_000);
        else if (ok && !metodo.equals("GET") && !metodo.equals("OPTIONS")) ok = limite.permitir("m:" + ip, 60, 60_000);
        if (!ok) { h.set("Retry-After", "60"); throw new ErrorHttp(429, "Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo."); }
    }

    /** Anti-CSRF para las escrituras: mismo origen y cabecera propia (un formulario externo no puede enviarla). */
    private void verificarOrigen(HttpExchange ex, String metodo) {
        if (metodo.equals("GET") || metodo.equals("OPTIONS")) return;
        String origen = ex.getRequestHeaders().getFirst("Origin"), host = ex.getRequestHeaders().getFirst("Host");
        String propio = (esHttps(ex) ? "https://" : "http://") + host;
        if (origen != null && !origen.equals(propio) && !origen.equals(cors)) throw new ErrorHttp(403, "Origen no permitido.");
        if (!"1".equals(ex.getRequestHeaders().getFirst("X-CAI"))) throw new ErrorHttp(403, "Solicitud no válida.");
    }

    private static boolean contieneActivo(byte[] d) {
        String t = new String(d, StandardCharsets.ISO_8859_1);
        return t.contains("/JavaScript") || t.contains("/JS") || t.contains("/Launch") || t.contains("/EmbeddedFile");
    }

    /** Los comprobantes y documentos se sirven aislados: sin ejecutar nada, sin caché y en sandbox. */
    private void enviarArchivoPrivado(HttpExchange ex, Path ruta) throws IOException {
        Headers h = ex.getResponseHeaders();
        h.set("Content-Security-Policy", "default-src 'none'; sandbox");
        h.set("Cache-Control", "no-store");
        h.set("Content-Disposition", "inline; filename=\"archivo\"");
        enviarBytes(ex, 200, tipoMime(ruta.toString()), Files.readAllBytes(ruta));
    }

    /* ======================================================================
       UTILIDADES
       ====================================================================== */
    private Auth.Sesion sesion(HttpExchange ex) {
        Auth.Sesion s = Auth.obtener(token(ex));
        if (s == null) throw new ErrorHttp(401, "Inicia sesión para continuar.");
        return s;
    }

    Auth.Sesion admin(HttpExchange ex) {
        Auth.Sesion s = sesion(ex);
        if (!"administrador".equals(s.rol())) throw new ErrorHttp(403, "No tienes permisos para esta acción.");
        String metodo = ex.getRequestMethod(), ruta = ex.getRequestURI().getPath();
        if (!metodo.equals("GET") || ruta.contains("/archivo")) auditar(ex, s);
        return s;
    }

    private void auditar(HttpExchange ex, Auth.Sesion s) {
        try {
            String ruta = ex.getRequestURI().getPath();
            finanzas.actualizar("INSERT INTO auditoria (id_usuario, metodo, ruta, ip) VALUES (?,?,?,?)", s.idUsuario(), ex.getRequestMethod(), ruta.length() > 200 ? ruta.substring(0, 200) : ruta, ip(ex));
        } catch (Exception e) { /* la auditoría nunca bloquea la operación */ }
    }

    private String token(HttpExchange ex) {
        String c = ex.getRequestHeaders().getFirst("Cookie");
        if (c == null) return null;
        for (String parte : c.split(";")) {
            String[] kv = parte.trim().split("=", 2);
            if (kv.length == 2 && kv[0].equals("cai_sid")) return kv[1];
        }
        return null;
    }

    /** Cookie de sesión: HttpOnly (JS no puede leerla), SameSite=Strict (anti-CSRF) y Secure cuando hay HTTPS. */
    void ponerCookie(HttpExchange ex, String token) {
        ex.getResponseHeaders().add("Set-Cookie", "cai_sid=" + token + "; Path=/; HttpOnly; SameSite=Strict" + (esHttps(ex) || FORZAR_HTTPS ? "; Secure" : ""));
    }

    Map<String, Object> cuerpo(HttpExchange ex) throws IOException {
        String ct = ex.getRequestHeaders().getFirst("Content-Type");
        if (ct == null || !ct.toLowerCase().startsWith("application/json")) throw new ErrorHttp(415, "Tipo de contenido no soportado.");
        int max = ex.getRequestURI().getPath().matches("/api/(solicitudes|donaciones|documentos)") ? MAX_CUERPO : MAX_CUERPO_NORMAL;
        try (InputStream in = ex.getRequestBody()) {
            byte[] datos = in.readNBytes(max + 1);
            if (datos.length > max) throw new ErrorHttp(413, "La solicitud es demasiado grande.");
            return Json.leerObjeto(new String(datos, StandardCharsets.UTF_8));
        }
    }

    String consulta(HttpExchange ex, String clave) {
        String q = ex.getRequestURI().getQuery();
        if (q == null) return null;
        for (String par : q.split("&")) {
            String[] kv = par.split("=", 2);
            if (kv[0].equals(clave) && kv.length == 2) return kv[1];
        }
        return null;
    }

    private Parroquia buscarParroquia(Map<String, Object> b) throws SQLException {
        if (b.get("idParroquia") instanceof Number n)
            return parroquias.buscarPorId(n.intValue()).orElseThrow(() -> new ErrorHttp(422, "Parroquia no encontrada."));
        String nombre = texto(b, "parroquia");
        return parroquias.listarTodas().stream().filter(p -> p.getNombre().equalsIgnoreCase(nombre)).findFirst()
            .orElseThrow(() -> new ErrorHttp(422, "Selecciona una parroquia válida."));
    }

    private static boolean firmaValida(byte[] d, String ext) {
        if (d.length < 4) return false;
        return switch (ext) {
            case "pdf" -> d[0] == '%' && d[1] == 'P' && d[2] == 'D' && d[3] == 'F';
            case "png" -> (d[0] & 0xFF) == 0x89 && d[1] == 'P' && d[2] == 'N' && d[3] == 'G';
            default -> (d[0] & 0xFF) == 0xFF && (d[1] & 0xFF) == 0xD8 && (d[2] & 0xFF) == 0xFF;   // jpg / jpeg
        };
    }

    static String texto(Map<String, Object> b, String k) { return limpiarTexto(cadena(b, k)); }

    /** Sanitiza texto libre: sin caracteres de control ni etiquetas HTML (defensa en profundidad contra XSS almacenado). */
    static String limpiarTexto(String s) { return s.replaceAll("[\\p{Cc}&&[^\\n\\t]]", "").replaceAll("<[^>]*>", "").trim(); }

    /** Rechaza campos que el cliente no debería enviar (evita asignación masiva: rol, estado, monto, etc.). */
    static void soloCampos(Map<String, Object> b, String... permitidos) {
        Set<String> ok = Set.of(permitidos);
        for (String k : b.keySet()) if (!ok.contains(k)) throw new ErrorHttp(400, "Campo no permitido: " + k);
    }
    static String cadena(Map<String, Object> b, String k) { return b.get(k) instanceof String s ? s : ""; }

    private static int entero(String v, String campo) {
        try { return Integer.parseInt(v); } catch (Exception e) { throw new ErrorHttp(422, "Falta el parámetro '" + campo + "'."); }
    }

    static LocalDate fecha(String v) {
        try { return LocalDate.parse(v); } catch (DateTimeParseException e) { throw new ErrorHttp(422, "Fecha no válida (use AAAA-MM-DD)."); }
    }

    static String normalizar(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase().trim().replaceAll("\\s+", "_");
    }

    private static String etiqueta(String s) {
        return switch (s) {
            case "primera_comunion" -> "Primera Comunión";
            case "confirmacion" -> "Confirmación";
            case "matrimonio" -> "Matrimonio";
            default -> "Bautizo";
        };
    }

    private static String tipoMime(String nombre) {
        String n = nombre.toLowerCase();
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    void json(HttpExchange ex, int codigo, Object cuerpo) throws IOException {
        enviarBytes(ex, codigo, "application/json; charset=utf-8", Json.escribir(cuerpo).getBytes(StandardCharsets.UTF_8));
    }

    private void enviarBytes(HttpExchange ex, int codigo, String tipo, byte[] datos) throws IOException {
        ex.getResponseHeaders().set("Content-Type", tipo);
        ex.sendResponseHeaders(codigo, datos.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(datos); }
    }
}
