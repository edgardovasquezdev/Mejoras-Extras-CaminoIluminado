USE camino_iluminacion;

-- Datos sensibles cifrados por la aplicación (AES-256-GCM). El DNI se busca con una huella HMAC (columna dni).
ALTER TABLE usuario MODIFY dni CHAR(64) NOT NULL, ADD dni_enc VARCHAR(200) NULL, MODIFY telefono VARCHAR(255) NULL;
ALTER TABLE creyente MODIFY dni CHAR(64) NOT NULL, ADD dni_enc VARCHAR(200) NULL;
ALTER TABLE pago MODIFY yape_origen VARCHAR(255) NULL;

-- Registro de auditoría: quién accede a qué datos administrativos
CREATE TABLE auditoria (
  id_auditoria BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_usuario   INT UNSIGNED NULL,
  metodo       VARCHAR(8)   NOT NULL,
  ruta         VARCHAR(200) NOT NULL,
  ip           VARCHAR(45)  NULL,
  creado_en    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_usuario (id_usuario, creado_en)
) ENGINE=InnoDB;
