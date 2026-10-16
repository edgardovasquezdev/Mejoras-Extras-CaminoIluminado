USE camino_iluminacion;

ALTER TABLE usuario MODIFY correo VARCHAR(120) NULL, ADD dni CHAR(8) NULL;
UPDATE usuario SET dni = '00000000' WHERE correo = 'admin@caminoiluminacion.pe';
UPDATE usuario SET dni = LPAD(id_usuario, 8, '0') WHERE dni IS NULL;
ALTER TABLE usuario MODIFY dni CHAR(8) NOT NULL, ADD CONSTRAINT uq_usuario_dni UNIQUE (dni);

ALTER TABLE pago
  MODIFY metodo ENUM('yape','plin','tarjeta') NOT NULL DEFAULT 'yape',
  MODIFY ruta_voucher VARCHAR(255) NULL,
  MODIFY voucher_sha256 CHAR(64) NULL,
  ADD tarjeta_ultimos4 CHAR(4) NULL,
  ADD tarjeta_marca VARCHAR(20) NULL;

ALTER TABLE aviso MODIFY tipo ENUM('santa_cena','ayuno','vigilia','celebracion','cambio_horario','evento','otro') NOT NULL DEFAULT 'otro';

CREATE TABLE creyente (
  id_creyente      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre           VARCHAR(150) NOT NULL,
  dni              CHAR(8) NOT NULL,
  sacramento       ENUM('bautizo','matrimonio','primera_comunion','confirmacion') NOT NULL,
  id_parroquia     INT UNSIGNED NOT NULL,
  fecha_sacramento DATE NOT NULL,
  id_reserva       INT UNSIGNED NULL,
  origen           ENUM('web','manual') NOT NULL DEFAULT 'web',
  creado_en        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_creyente_parroquia FOREIGN KEY (id_parroquia) REFERENCES parroquia (id_parroquia) ON DELETE RESTRICT,
  CONSTRAINT fk_creyente_reserva   FOREIGN KEY (id_reserva)   REFERENCES reserva (id_reserva) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_creyente_busqueda ON creyente (dni, nombre);
CREATE INDEX idx_creyente_fecha ON creyente (fecha_sacramento);

INSERT INTO creyente (nombre, dni, sacramento, id_parroquia, fecha_sacramento, id_reserva, origen)
SELECT r.nombre_solicitante, u.dni, r.sacramento, r.id_parroquia, r.fecha_solicitada, r.id_reserva, 'web'
FROM reserva r JOIN usuario u ON u.id_usuario = r.id_usuario;
