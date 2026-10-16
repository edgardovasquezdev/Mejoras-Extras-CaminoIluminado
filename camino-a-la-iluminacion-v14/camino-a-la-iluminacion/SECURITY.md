# Seguridad

| Punto | Implementación |
|---|---|
| Ocultar claves y API keys | Todo secreto se lee de variables de entorno (`.env.example`); el navegador nunca recibe credenciales de la base. Turnstile: solo la clave pública llega al navegador. |
| Eliminar secretos de git | `.gitignore` (`.env`, `.data-key`, `*.pem`…), hook `.githooks/pre-commit`, `gitleaks` en CI y guía de limpieza del historial (abajo). |
| Acceso a la BD con clave pública / mínimo privilegio | Usuario `cai_app` solo con SELECT/INSERT/UPDATE/DELETE (`database/usuario_app.sql`); sin DROP, ALTER ni GRANT. |
| Row-level security | MySQL no la trae: se aplica en el servidor. Cada consulta filtra por `id_usuario` de la sesión; comprobantes y documentos solo los ve su dueño o el personal; el rol nunca viene del cliente. |
| Cifrar datos sensibles | AES-256-GCM (`Cripto`) para DNI, teléfono y celular Yape/Plin; el DNI se busca con huella HMAC. Tarjetas: solo últimos 4 dígitos. Clave en `CAI_DATA_KEY`. |
| Forzar autenticación | Denegar por defecto: toda ruta `/api` exige sesión salvo una lista corta de rutas públicas. |
| Restringir acceso a registros | Roles (feligrés/administrador), propiedad del registro y tabla `auditoria` con las acciones del personal. |
| Bloquear manipulación de campos | `soloCampos()` rechaza campos no previstos; montos y estados salen de la BD, no del cliente. |
| Cookies de sesión | `cai_sid`: HttpOnly, SameSite=Strict, Secure con HTTPS; token aleatorio de 256 bits, 30 min de inactividad; cierre real en `/api/logout`. |
| Anti-CSRF | Mismo origen + cabecera `X-CAI` en toda escritura. |
| Hash de contraseñas | PBKDF2-HMAC-SHA256, 600 000 iteraciones, sal aleatoria; rehash automático al iniciar sesión; tiempo igualado para usuarios inexistentes. |
| Rate limiting | Por IP: 300/min general, 10/min login y registro, 15/min cargas, 60/min escrituras; bloqueo de cuenta tras 5 fallos. |
| Protección contra bots | Campo trampa, token de tiempo firmado por el servidor y Cloudflare Turnstile opcional. |
| Consultas parametrizadas | Todo el acceso a datos usa `PreparedStatement`; los fragmentos dinámicos son constantes del código. |
| Validar entradas | En el navegador y de nuevo en el servidor (DNI, correo, teléfono, fechas, montos, Luhn, tamaños). |
| Sanitizar contenido | El servidor elimina etiquetas HTML y caracteres de control; el navegador escapa o usa `textContent`. |
| Restringir archivos | Solo PDF/JPG/PNG por firma real, 5 MB, PDF sin JavaScript, nombre aleatorio, fuera de la carpeta pública, entrega en sandbox. |
| Devolver lo necesario | Listados con DNI y celular enmascarados; nunca se devuelve el hash de la contraseña ni datos cifrados. |
| Security headers | CSP estricta (sin CDN), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP. |
| Forzar HTTPS | `CAI_FORCE_HTTPS=1` redirige a HTTPS y activa HSTS; `deploy/Caddyfile` da el certificado automático. |
| Escanear dependencias | `npm audit`, OWASP Dependency-Check (`mvn -Pseguridad verify`), CodeQL, gitleaks y Dependabot en `.github/`. |

## Si alguna vez subiste un secreto a git
1. **Rota el secreto primero** (cambia la contraseña de MySQL, genera otra `CAI_DATA_KEY`…). Borrarlo del historial no basta.
2. Crea `reemplazos.txt` con una línea por secreto: `la_clave_vieja==>***ELIMINADO***`
3. `pip install git-filter-repo` y luego `git filter-repo --replace-text reemplazos.txt`
4. `git push --force --all` y pide a los colaboradores que vuelvan a clonar.
5. Verifica: `gitleaks detect --log-opts="--all"`. Activa el hook: `git config core.hooksPath .githooks`.

Reportar una vulnerabilidad: abre un aviso privado en el repositorio o escribe al responsable del proyecto.
