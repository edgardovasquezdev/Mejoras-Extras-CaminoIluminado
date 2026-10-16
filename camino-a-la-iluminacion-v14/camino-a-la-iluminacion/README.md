# Camino a la Iluminación

Plataforma parroquial: sacramentos con pago (Yape, Plin o tarjeta), fieles, iglesias, anuncios y eventos, donaciones y panel administrativo. Estilo iOS.

**Stack:** HTML + CSS + JavaScript · Java 17 (`HttpServer`) + JDBC · MySQL/MariaDB · Maven.

## Ejecución
```bash
mysql -u root -p --default-character-set=utf8mb4 < database/camino_iluminacion.sql
mysql -u root -p --default-character-set=utf8mb4 < database/02_pagos_yape.sql
mysql -u root -p --default-character-set=utf8mb4 < database/03_ios_dni_pagos.sql
mysql -u root -p --default-character-set=utf8mb4 < database/04_seguridad.sql
cp .env.example .env          # completa CAI_DB_PASS y CAI_ADMIN_PASS (el archivo .env no se sube a git)
./scripts/iniciar.sh          # Windows: .\scripts\iniciar.ps1   → http://localhost:8080
```
Opcional (recomendado): crea el usuario de BD de mínimo privilegio con `database/usuario_app.sql` y úsalo en `CAI_DB_USER`.
Seguridad: ver `SECURITY.md`.
- Administrador: DNI `00000000` o correo `admin@caminoiluminacion.pe` + `CAI_ADMIN_PASS`.
- Acceso: DNI (8 dígitos, obligatorio al registrarse) o correo (opcional). Contraseña con PBKDF2.
- Pagos: Yape y Plin (QR + n.º de operación + comprobante) y tarjeta (Luhn, vencimiento, CVV; solo se guardan los últimos 4 dígitos). Estados: Pendiente, Verificado, Rechazado.
- Sin servidor, `index.html` funciona en modo demostración; Reservar, Mis solicitudes, Donar y el Panel requieren `http://localhost:8080`.
- Endpoints y seguridad: `backend/README.md`.
