-- Usuario de la aplicación con MÍNIMO privilegio (sin DROP, ALTER, GRANT ni acceso a otras bases).
-- Ejecútalo como root DESPUÉS de los scripts 01–04. Cambia TU_CLAVE_LARGA por una clave propia y NO la subas a git.
CREATE USER IF NOT EXISTS 'cai_app'@'localhost' IDENTIFIED BY 'TU_CLAVE_LARGA';
GRANT SELECT, INSERT, UPDATE, DELETE ON camino_iluminacion.* TO 'cai_app'@'localhost';
FLUSH PRIVILEGES;
-- Luego arranca el servidor con: CAI_DB_USER=cai_app  CAI_DB_PASS=<esa clave>
