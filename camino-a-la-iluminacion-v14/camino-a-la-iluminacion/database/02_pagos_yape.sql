USE camino_iluminacion;

CREATE TABLE arancel (
  id_arancel  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sacramento  ENUM('bautizo','matrimonio','primera_comunion','confirmacion') NOT NULL,
  monto       DECIMAL(8,2) NOT NULL CHECK (monto >= 0),
  vigente     BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_arancel_sacramento UNIQUE (sacramento)
) ENGINE=InnoDB;
INSERT INTO arancel (sacramento, monto) VALUES ('bautizo',50),('primera_comunion',60),('confirmacion',70),('matrimonio',250);

ALTER TABLE reserva
  ADD monto       DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD estado_pago ENUM('sin_pago','pendiente','aprobado','rechazado') NOT NULL DEFAULT 'sin_pago';

ALTER TABLE documento
  ADD tipo         ENUM('partida','acta','dni','otro') NOT NULL DEFAULT 'otro',
  ADD sha256       CHAR(64) NULL,
  ADD tamano_bytes INT UNSIGNED NULL;

-- Pagos: arancel de sacramentos, donaciones y diezmos (id_reserva NULL para estos dos últimos)
CREATE TABLE pago (
  id_pago          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_usuario       INT UNSIGNED NOT NULL,
  id_reserva       INT UNSIGNED NULL,
  concepto         ENUM('arancel','donacion','diezmo') NOT NULL DEFAULT 'arancel',
  monto            DECIMAL(8,2) NOT NULL CHECK (monto > 0),
  metodo           ENUM('yape','transferencia') NOT NULL DEFAULT 'yape',
  yape_destino     CHAR(9) NOT NULL DEFAULT '908502563',
  yape_origen      CHAR(9) NULL,
  numero_operacion VARCHAR(20) NOT NULL,
  ruta_voucher     VARCHAR(255) NOT NULL,
  voucher_sha256   CHAR(64) NOT NULL,
  estado           ENUM('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
  observacion      VARCHAR(255) NULL,
  revisado_por     INT UNSIGNED NULL,
  creado_en        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_en      TIMESTAMP NULL,
  CONSTRAINT uq_pago_operacion UNIQUE (numero_operacion),      -- anti-fraude: operación irrepetible
  CONSTRAINT uq_pago_voucher   UNIQUE (voucher_sha256),        -- anti-fraude: mismo voucher no se reutiliza
  CONSTRAINT fk_pago_usuario  FOREIGN KEY (id_usuario)   REFERENCES usuario (id_usuario) ON DELETE CASCADE,
  CONSTRAINT fk_pago_reserva  FOREIGN KEY (id_reserva)   REFERENCES reserva (id_reserva) ON DELETE SET NULL,
  CONSTRAINT fk_pago_revisor  FOREIGN KEY (revisado_por) REFERENCES usuario (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_pago_estado ON pago (estado, creado_en);

CREATE TABLE notificacion (
  id_notificacion INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_usuario      INT UNSIGNED NOT NULL,
  asunto          VARCHAR(120) NOT NULL,
  mensaje         VARCHAR(500) NOT NULL,
  canal           ENUM('correo','sms','app') NOT NULL DEFAULT 'correo',
  enviada         BOOLEAN NOT NULL DEFAULT FALSE,
  leida           BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX idx_notif_pendientes ON notificacion (enviada, creada_en);

-- Métricas del dashboard administrativo (mes en curso)
CREATE OR REPLACE VIEW v_metricas_mes AS SELECT
  (SELECT COUNT(*) FROM reserva WHERE sacramento='bautizo'
     AND YEAR(creado_en)=YEAR(CURDATE()) AND MONTH(creado_en)=MONTH(CURDATE()))        AS bautizos_solicitados,
  (SELECT COALESCE(SUM(monto),0) FROM pago WHERE estado='aprobado'
     AND YEAR(revisado_en)=YEAR(CURDATE()) AND MONTH(revisado_en)=MONTH(CURDATE()))     AS ingresos_yape,
  (SELECT COALESCE(SUM(monto),0) FROM pago WHERE estado='aprobado' AND concepto IN ('donacion','diezmo')
     AND YEAR(revisado_en)=YEAR(CURDATE()) AND MONTH(revisado_en)=MONTH(CURDATE()))     AS ofrendas,
  (SELECT COUNT(*) FROM documento WHERE estado_validacion='pendiente')                  AS documentos_por_revisar,
  (SELECT COUNT(*) FROM pago WHERE estado='pendiente')                                  AS pagos_por_verificar;

-- Horarios de confesión
ALTER TABLE horario MODIFY tipo ENUM('misa','confesion','actividad') NOT NULL DEFAULT 'misa';
INSERT INTO horario (id_parroquia, dia_semana, hora, tipo) SELECT id_parroquia, 'sabado', '4:00 p.m. a 5:30 p.m.', 'confesion' FROM parroquia;
