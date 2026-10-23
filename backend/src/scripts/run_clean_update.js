import { Client } from 'ssh2';

const updatePhpScript = `<?php
$portalDir = '/home/admin-irg/sistemas/irg-portal';
chdir($portalDir);

echo "=== INICIANDO ACTUALIZACIÓN DEL PORTAL IRG ===\\n";

// 1. Verificar y respaldar
$filesToBackup = [
    'includes/sidebar.php',
    'index.php',
    'config/session.php',
    'admin/permisos_sectores.php',
    'data/permisos_sectores.json'
];

foreach ($filesToBackup as $f) {
    if (file_exists($f)) {
        $bak = $f . '.bak_' . date('Ymd_His');
        copy($f, $bak);
        echo "✓ Respaldo creado: $bak\\n";
    }
}

// 2. modules/control_acceso/index.php
if (!is_dir('modules/control_acceso')) {
    mkdir('modules/control_acceso', 0755, true);
}
$gatewayCode = <<<'PHP'
<?php
// modules/control_acceso/index.php
require_once __DIR__ . '/../../config/session.php';

// Control estricto de acceso por roles y sectores
require_permission(
    ['Administrador', 'Sistemas', 'RRHH', 'Personal'],
    ['Personal', 'SISTEMAS', 'Liquidacion', 'Liquidacion_Sueldos', 'Oficina_Personal']
);

// Redirigir a la SPA de Control de Acceso Anviz CrossChex
header('Location: /');
exit;
PHP;
file_put_contents('modules/control_acceso/index.php', $gatewayCode);
echo "✓ Archivo de seguridad modules/control_acceso/index.php generado.\\n";

// 3. data/permisos_sectores.json
$permFile = 'data/permisos_sectores.json';
if (file_exists($permFile)) {
    $data = json_decode(file_get_contents($permFile), true) ?: [];
    $targetSectors = ['Personal', 'SISTEMAS', 'Liquidacion', 'Liquidacion_Sueldos', 'Oficina_Personal'];
    foreach ($targetSectors as $sec) {
        if (!isset($data[$sec])) {
            $data[$sec] = ['gestor', 'asistente_kb'];
        }
        if (!in_array('control_acceso', $data[$sec])) {
            $data[$sec][] = 'control_acceso';
        }
    }
    file_put_contents($permFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    echo "✓ data/permisos_sectores.json actualizado.\\n";
}

// 4. config/session.php
$sessFile = 'config/session.php';
$sessContent = file_get_contents($sessFile);
if (strpos($sessContent, "'control_acceso'") === false && strpos($sessContent, '"control_acceso"') === false) {
    $search = "'insumos']";
    $replacement = "'insumos', 'control_acceso']";
    if (strpos($sessContent, $search) !== false) {
        $sessContent = str_replace($search, $replacement, $sessContent);
        file_put_contents($sessFile, $sessContent);
        echo "✓ config/session.php actualizado con control_acceso.\\n";
    } else {
        echo "⚠ No se encontró el patrón en config/session.php\\n";
    }
} else {
    echo "ℹ config/session.php ya incluye control_acceso.\\n";
}

// 5. admin/permisos_sectores.php
$admFile = 'admin/permisos_sectores.php';
$admContent = file_get_contents($admFile);
if (strpos($admContent, "'control_acceso'") === false) {
    $search = "'admin'        => ['titulo' => 'Administración',        'icon' => '🧰']";
    $replacement = "'control_acceso' => ['titulo' => 'Control de Acceso (CrossChex)', 'icon' => '⏱️'],\\n    'admin'        => ['titulo' => 'Administración',        'icon' => '🧰']";
    if (strpos($admContent, $search) !== false) {
        $admContent = str_replace($search, $replacement, $admContent);
        file_put_contents($admFile, $admContent);
        echo "✓ admin/permisos_sectores.php actualizado.\\n";
    } else {
        echo "⚠ No se encontró el patrón en admin/permisos_sectores.php\\n";
    }
} else {
    echo "ℹ admin/permisos_sectores.php ya incluye control_acceso.\\n";
}

// 6. includes/sidebar.php
$sideFile = 'includes/sidebar.php';
$sideContent = file_get_contents($sideFile);
if (strpos($sideContent, 'Control de Acceso') === false) {
    $target = '<!-- INTEGRACIÓN DECANO SUELDOS -->';
    $menuSnippet = <<<'PHP'
        <!-- CONTROL DE ACCESO CROSSCHEX (Acceso Restringido: Admin, Sistemas, RRHH, Personal) -->
        <?php if (has_permission(['Administrador', 'Sistemas', 'RRHH', 'Personal'], ['Personal', 'SISTEMAS', 'Liquidacion', 'Liquidacion_Sueldos', 'Oficina_Personal']) && in_array('control_acceso', $sistemas_permitidos)): ?>
            <li class="menu-item <?= ($active_m === 'control_acceso') ? 'active' : '' ?>">
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
    if (strpos($sideContent, $target) !== false) {
        $sideContent = str_replace($target, $menuSnippet . "\\n        " . $target, $sideContent);
        file_put_contents($sideFile, $sideContent);
        echo "✓ includes/sidebar.php actualizado con el nuevo menú.\\n";
    } else {
        echo "⚠ No se encontró el target en includes/sidebar.php\\n";
    }
} else {
    echo "ℹ includes/sidebar.php ya incluye Control de Acceso.\\n";
}

// 7. index.php
$idxFile = 'index.php';
$idxContent = file_get_contents($idxFile);
if (strpos($idxContent, 'Control de Acceso y Asistencia') === false) {
    $target = '<!-- GESTOR DOCUMENTAL -->';
    $cardSnippet = <<<'PHP'
    <!-- MÓDULO CONTROL DE ACCESO (CROSSCHEX) -->
    <?php if (has_permission(['Administrador', 'Sistemas', 'RRHH', 'Personal'], ['Personal', 'SISTEMAS', 'Liquidacion', 'Liquidacion_Sueldos', 'Oficina_Personal']) && in_array('control_acceso', $allowed_systems)): ?>
        <a href="/" target="_blank" class="module-card color-blue" style="border-left: 4px solid #3b82f6;">
            <div class="module-card-icon">⏱️</div>
            <div class="module-card-title">Control de Acceso y Asistencia ↗</div>
            <div class="module-card-desc">Monitoreo de asistencia en tiempo real, dispositivos biométricos Anviz CrossChex, fichadas del personal y estadísticas.</div>
        </a>
    <?php endif; ?>

PHP;
    if (strpos($idxContent, $target) !== false) {
        $idxContent = str_replace($target, $cardSnippet . "\\n    " . $target, $idxContent);
        file_put_contents($idxFile, $idxContent);
        echo "✓ index.php actualizado con la tarjeta de módulo.\\n";
    } else {
        echo "⚠ No se encontró el target en index.php\\n";
    }
} else {
    echo "ℹ index.php ya incluye la tarjeta.\\n";
}

echo "=== ACTUALIZACIÓN COMPLETADA CON ÉXITO ===\\n";
`;

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ Conexión SSH abierta a 10.0.0.10');

  conn.sftp((err, sftp) => {
    if (err) throw err;

    const remoteFile = '/home/admin-irg/sistemas/irg-portal/run_update.php';
    const writeStream = sftp.createWriteStream(remoteFile);

    writeStream.on('close', () => {
      console.log('📤 Script de actualización transferido exitosamente.');

      const cmd = `
        php /home/admin-irg/sistemas/irg-portal/run_update.php
        echo "Verificando sintaxis PHP..."
        php -l /home/admin-irg/sistemas/irg-portal/includes/sidebar.php
        php -l /home/admin-irg/sistemas/irg-portal/index.php
        php -l /home/admin-irg/sistemas/irg-portal/config/session.php
        php -l /home/admin-irg/sistemas/irg-portal/admin/permisos_sectores.php
        php -l /home/admin-irg/sistemas/irg-portal/modules/control_acceso/index.php
        rm -f /home/admin-irg/sistemas/irg-portal/run_update.php
      `;

      conn.exec(cmd, (execErr, stream) => {
        if (execErr) throw execErr;

        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', (code) => {
          console.log(`\nCódigo de finalización: ${code}`);
          conn.end();
        });
      });
    });

    writeStream.end(updatePhpScript);
  });
}).on('error', (err) => {
  console.error('Error SSH:', err);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 10000
});
