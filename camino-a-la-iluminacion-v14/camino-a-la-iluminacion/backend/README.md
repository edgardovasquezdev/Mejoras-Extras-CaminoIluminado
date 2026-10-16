# Backend — Camino a la Iluminación

Backend en Java (JDBC + patrón DAO) para el proyecto. Arquitectura en capas
según el Capítulo 8.1 del informe: Presentación → Lógica de negocio → DAO → BD.
Esta etapa cubre Modelo + DAO; la capa de Servicios (lógica de negocio) y los
controladores web se agregan en una etapa posterior del curso.

## Requisitos
- JDK 17 o superior
- Maven
- Base de datos ya creada: correr primero `../database/camino_iluminacion.sql`

## Configurar
Abre `src/main/java/pe/caminoiluminacion/conexion/Conexion.java` y cambia:
```java
private static final String CONTRASENA = "CAMBIAR_POR_TU_CONTRASENA";
```
por la contraseña real de tu MySQL/MariaDB.

## Compilar y correr
```bash
mvn compile
mvn exec:java
```
o desde tu IDE: clic derecho sobre `PruebaConexion.java` → Run.

`PruebaConexion.java` conecta a la base de datos, lista parroquias, horarios
y avisos, crea una reserva y un documento de prueba, y simula la aprobación
del documento por el panel de administración — para confirmar que las 6
tablas y sus relaciones funcionan de punta a punta.

## Estructura
```
src/main/java/pe/caminoiluminacion/
├── conexion/     Conexion.java (punto único de conexión JDBC)
├── modelo/       Usuario, Parroquia, Horario, Aviso, Reserva, Documento
├── dao/          Interfaces (contrato de cada DAO)
├── dao/impl/     Implementaciones con JDBC puro
└── PruebaConexion.java   Clase de demostración end-to-end
```

## API REST + sitio web (v2)

El servidor (`pe.caminoiluminacion.api.Servidor`) usa solo el JDK: expone la API en `/api/*` y además
sirve el frontend, así que todo corre en un único comando.

### Puesta en marcha
```bash
# 1. Crear la base de datos
mysql -u root -p --default-character-set=utf8mb4 < ../database/camino_iluminacion.sql
mysql -u root -p --default-character-set=utf8mb4 < ../database/02_pagos_yape.sql

# 2. Variables de entorno (Linux/Mac; en Windows usa `set` o `$env:`)
export CAI_DB_PASS="tu_contraseña_de_mysql"
export CAI_ADMIN_PASS="UnaClaveSegura2026"     # contraseña del personal parroquial

# 3. Arrancar
mvn compile exec:java
# 4. Abrir http://localhost:8080
```
Si no defines `CAI_ADMIN_PASS`, el servidor genera una y la imprime una sola vez en la consola.
Otras variables: `CAI_PORT` (8080), `CAI_DB_HOST`, `CAI_DB_PORT`, `CAI_DB_USER`, `CAI_UPLOADS` (uploads), `CAI_CORS` (*).

### Endpoints
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/registro`, `/api/login`, `/api/logout` | público |
| GET | `/api/parroquias`, `/api/avisos`, `/api/horarios?parroquia=ID` | público |
| POST | `/api/reservas` · GET `/api/reservas/mias` | feligrés |
| POST | `/api/documentos` (JSON con archivo en base64) · GET `/api/documentos/mios` | feligrés |
| GET/PUT | `/api/admin/documentos`, `/api/admin/documentos/{id}`, `/api/admin/documentos/{id}/archivo` | personal |
| GET/PUT | `/api/admin/reservas`, `/api/admin/reservas/{id}` | personal |
| POST | `/api/avisos` | personal |

### Seguridad implementada
- Contraseñas con PBKDF2-HMAC-SHA256 (120 000 iteraciones, sal aleatoria); verificación en tiempo constante.
- Sesiones por token aleatorio (30 min, se renueva con la actividad); 5 intentos fallidos → bloqueo de 5 min.
- El rol siempre lo decide el servidor: nadie puede registrarse como administrador.
- Todas las consultas SQL usan `PreparedStatement` (DAO) → sin inyección SQL.
- Validación en el servidor de todos los campos (no se confía en el navegador).
- Archivos: solo PDF/JPG/PNG ≤ 5 MB, se verifica la firma real del archivo y se guardan con nombre aleatorio.
- El servidor de archivos solo entrega `index.html`, `login.html`, `css/`, `js/` y `paginas/`, con protección contra salida de ruta.

### Pendiente / siguientes pasos
HTTPS (detrás de Nginx o un proxy), guardar sesiones en BD o Redis para soportar reinicios, pantalla del
administrador para gestionar reservas (la API ya existe), avisos y horarios conectados a la API,
y pruebas automatizadas.

### Pagos Yape (v4)
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/aranceles` | público |
| POST | `/api/solicitudes` (reserva + documentos + voucher) · GET `/api/solicitudes/mias` | feligrés |
| POST | `/api/donaciones` · GET `/api/notificaciones` · GET `/api/pagos/{id}/voucher` | feligrés (dueño) / personal |
| GET/PUT | `/api/admin/metricas`, `/api/admin/pagos`, `/api/admin/pagos/{id}` | personal |

Antifraude: monto desde `arancel`; `UNIQUE(numero_operacion)` y `UNIQUE(voucher_sha256)`; firma real del archivo; vouchers fuera del web root; aprobación atómica con auditoría.
Yape destino: 908502563 · QR en `img/yape-qr.png`.
