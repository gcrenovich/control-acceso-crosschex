import { Client } from 'ssh2';

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ SSH Conectado a 10.0.0.10');

  const remoteScript = `
set -e
PORTAL_DIR="/home/admin-irg/sistemas/irg-portal"
cd "$PORTAL_DIR"

echo "1. Realizando copias de seguridad..."
cp -n includes/sidebar.php includes/sidebar.php.bak_\$(date +%Y%m%d%H%M%S) || true
cp -n index.php index.php.bak_\$(date +%Y%m%d%H%M%S) || true
cp -n config/session.php config/session.php.bak_\$(date +%Y%m%d%H%M%S) || true
cp -n admin/permisos_sectores.php admin/permisos_sectores.php.bak_\$(date +%Y%m%d%H%M%S) || true
cp -n data/permisos_sectores.json data/permisos_sectores.json.bak_\$(date +%Y%m%d%H%M%S) || true

echo "2. Creando carpeta y redirección protegida en modules/control_acceso/index.php..."
mkdir -p modules/control_acceso
cat << 'EOF' > modules/control_acceso/index.php
<?php
// modules/control_acceso/index.php
require_once __DIR__ . '/../../config/session.php';

// Restringir acceso solo a roles y sectores autorizados
require_permission(
    ['Administrador', 'Sistemas', 'RRHH', 'Personal'],
    ['Personal', 'SISTEMAS', 'Liquidacion', 'Liquidacion_Sueldos', 'Oficina_Personal']
);

// Redirigir al sistema de Control de Acceso Anviz CrossChex
header('Location: /');
exit;
EOF

echo "3. Actualizando data/permisos_sectores.json con control_acceso..."
php -r '
$file = "data/permisos_sectores.json";
if (file_exists($file)) {
    $data = json_decode(file_get_contents($file), true) ?: [];
    $target_sectors = ["Personal", "SISTEMAS", "Liquidacion", "Liquidacion_Sueldos", "Oficina_Personal"];
    foreach ($target_sectors as $sec) {
        if (!isset($data[$sec])) {
            $data[$sec] = ["gestor", "asistente_kb"];
        }
        if (!in_array("control_acceso", $data[$sec])) {
            $data[$sec][] = "control_acceso";
        }
    }
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    echo "Permisos de sectores actualizados.\n";
}
'

echo "4. Actualizando config/session.php..."
php -r '
$file = "config/session.php";
$content = file_get_contents($file);
if (strpos($content, "control_acceso") === false) {
    $content = str_replace(
        "\"insumos\"]",
        "\"insumos\", \"control_acceso\"]",
        $content
    );
    $content = str_replace(
        "'\''insumos'\'']",
        "'\''insumos\'', '\''control_acceso\'']",
        $content
    );
    file_put_contents($file, $content);
    echo "session.php actualizado con control_acceso.\n";
} else {
    echo "session.php ya contenia control_acceso.\n";
}
'

echo "5. Actualizando admin/permisos_sectores.php..."
php -r '
$file = "admin/permisos_sectores.php";
$content = file_get_contents($file);
if (strpos($content, "control_acceso") === false) {
    $search = "\x27admin\x27        => [\x27titulo\x27 => \x27Administración\x27,        \x27icon\x27 => \x27🧰\x27]";
    $replacement = "\x27control_acceso\x27 => [\x27titulo\x27 => \x27Control de Acceso (CrossChex)\x27, \x27icon\x27 => \x27⏱️\x27],\n    " . $search;
    if (strpos($content, $search) !== false) {
        $content = str_replace($search, $replacement, $content);
        file_put_contents($file, $content);
        echo "permisos_sectores.php actualizado.\n";
    } else {
        echo "No se encontro patron en permisos_sectores.php.\n";
    }
} else {
    echo "permisos_sectores.php ya contenia control_acceso.\n";
}
'

echo "6. Agregando enlace al menu lateral en includes/sidebar.php..."
php -r '
$file = "includes/sidebar.php";
$content = file_get_contents($file);
if (strpos($content, "Control de Acceso") === false) {
    $target = "<!-- INTEGRACIÓN DECANO SUELDOS -->";
    $menu_snippet = <<<PHP
        <!-- CONTROL DE ACCESO CROSSCHEX (Acceso Restringido: Admin, Sistemas, RRHH, Personal) -->
        <?php if (has_permission([\x27Administrador\x27, \x27Sistemas\x27, \x27RRHH\x27, \x27Personal\x27], [\x27Personal\x27, \x27SISTEMAS\x27, \x27Liquidacion\x27, \x27Liquidacion_Sueldos\x27, \x27Oficina_Personal\x27]) && in_array(\x27control_acceso\x27, \$sistemas_permitidos)): ?>
            <li class="menu-item <?= (\$active_m === \x27control_acceso\x27) ? \x27active\x27 : \x27\x27 ?>">
                <a href="/" target="_blank" class="menu-link" style="background: rgba(59, 130, 246, 0.12); border-left: 3px solid #3b82f6;">
                    <div class="menu-link-content">
                        <span class="menu-icon">⏱️</span>
                        <span style="color: #60a5fa; font-weight: 600;">Control de Acceso</span>
                    </div>
                    <span style="font-size: 0.75rem; color: #94a3b8; margin-left: auto;" title="Abrir en pestaña nueva">↗</span>
                </a>
            </li>
        <?php endif; ?>

PHP;
    if (strpos($content, $target) !== false) {
        $content = str_replace($target, $menu_snippet . "\n        " . $target, $content);
        file_put_contents($file, $content);
        echo "sidebar.php actualizado correctamente.\n";
    } else {
        echo "No se encontro el target en sidebar.php.\n";
    }
} else {
    echo "sidebar.php ya contenia Control de Acceso.\n";
}
'

echo "7. Agregando tarjeta de modulo en index.php..."
php -r '
$file = "index.php";
$content = file_get_contents($file);
if (strpos($content, "Control de Acceso y Asistencia") === false) {
    $target = "<!-- GESTOR DOCUMENTAL -->";
    $card_snippet = <<<PHP
    <!-- MÓDULO CONTROL DE ACCESO (CROSSCHEX) -->
    <?php if (has_permission([\x27Administrador\x27, \x27Sistemas\x27, \x27RRHH\x27, \x27Personal\x27], [\x27Personal\x27, \x27SISTEMAS\x27, \x27Liquidacion\x27, \x27Liquidacion_Sueldos\x27, \x27Oficina_Personal\x27]) && in_array(\x27control_acceso\x27, \$allowed_systems)): ?>
        <a href="/" target="_blank" class="module-card color-blue" style="border-left: 4px solid #3b82f6;">
            <div class="module-card-icon">⏱️</div>
            <div class="module-card-title">Control de Acceso y Asistencia ↗</div>
            <div class="module-card-desc">Monitoreo de asistencia en tiempo real, dispositivos biométricos Anviz CrossChex, fichadas del personal y estadísticas.</div>
        </a>
    <?php endif; ?>

PHP;
    if (strpos($content, $target) !== false) {
        $content = str_replace($target, $card_snippet . "\n    " . $target, $content);
        file_put_contents($file, $content);
        echo "index.php actualizado correctamente.\n";
    } else {
        echo "No se encontro el target en index.php.\n";
    }
} else {
    echo "index.php ya contenia el modulo.\n";
}
'

echo "8. Verificando permisos del directorio..."
chown -R admin-irg:www-data "$PORTAL_DIR"
chmod -R 775 "$PORTAL_DIR/data"
chmod -R 755 "$PORTAL_DIR/modules/control_acceso"

echo "=== ¡PROCESO DE ACTUALIZACIÓN FINALIZADO CON ÉXITO! ==="
`;

  conn.exec(remoteScript, (err, stream) => {
    if (err) {
      console.error('❌ Error al ejecutar script:', err);
      conn.end();
      return;
    }

    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('close', (code) => {
      console.log(`\nCódigo de salida: ${code}`);
      conn.end();
    });
  });
}).on('error', (err) => {
  console.error('❌ Error de conexión:', err);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 10000
});
