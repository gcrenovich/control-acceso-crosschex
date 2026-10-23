#!/bin/bash
# ==============================================================================
# SCRIPT DE INSTALACIÓN AUTOMATIZADA - CONTROL DE ACCESO CROSSCHEX
# Para Ubuntu Server 20.04 / 22.04 / 24.04 (Servidor 10.0.0.10)
# ==============================================================================
set -e

echo "=========================================================="
echo " Instalador Control de Acceso Anviz CrossChex en Ubuntu   "
echo "=========================================================="

# 1. Comprobar permisos de root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Por favor ejecute este script con privilegios de root (sudo bash instalar_servidor.sh)"
  exit 1
fi

DEST_DIR="/var/www/control-acceso-crosschex"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📂 Directorio origen del proyecto: $PROJECT_ROOT"
echo "🎯 Directorio de instalación: $DEST_DIR"

# 2. Instalar dependencias del sistema (Node.js LTS, Apache2, curl, git)
echo "📦 Verificando paquetes del sistema..."
apt update -y
apt install -y curl ufw apache2

# Instalar Node.js 20 LTS si no está instalado
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
    echo "⬇️ Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

echo "✅ Node.js $(node -v) y npm $(npm -v) instalados."

# 3. Crear estructura de directorios en /var/www
echo "📁 Preparando $DEST_DIR ..."
mkdir -p "$DEST_DIR/backend"
mkdir -p "$DEST_DIR/frontend/dist"
mkdir -p "$DEST_DIR/backend/data"

# 4. Copiar archivos del proyecto
echo "📋 Copiando archivos de Backend, Frontend compilado y Base de Datos..."
cp -r "$PROJECT_ROOT/backend/src" "$DEST_DIR/backend/"
cp "$PROJECT_ROOT/backend/package.json" "$DEST_DIR/backend/"
if [ -f "$PROJECT_ROOT/backend/package-lock.json" ]; then
    cp "$PROJECT_ROOT/backend/package-lock.json" "$DEST_DIR/backend/"
fi

# Copiar configuración de variables de entorno de producción
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    cp "$PROJECT_ROOT/backend/.env" "$DEST_DIR/backend/.env"
else
    cat <<EOF > "$DEST_DIR/backend/.env"
PORT=3005
NODE_ENV=production
ALLOWED_ORIGINS=http://10.0.0.10,http://localhost
API_KEY=mi_clave_secreta_crosschex_2026
AUTO_SYNC_INTERVAL_SEC=0
EOF
fi

# Asegurar que en Ubuntu el AUTO_SYNC_INTERVAL_SEC sea 0 (modo ingesta/push)
sed -i 's/AUTO_SYNC_INTERVAL_SEC=.*/AUTO_SYNC_INTERVAL_SEC=0/' "$DEST_DIR/backend/.env" 2>/dev/null || true

# Copiar archivos compilados del Frontend
if [ -d "$PROJECT_ROOT/frontend/dist" ]; then
    cp -r "$PROJECT_ROOT/frontend/dist/"* "$DEST_DIR/frontend/dist/"
else
    echo "⚠️ Advertencia: No se encontró frontend/dist. Se copiarán los archivos si existen."
fi

# Copiar la base de datos completa (fichadas, empleados, turnos)
if [ -d "$PROJECT_ROOT/backend/data" ]; then
    echo "💾 Copiando base de datos inicial (~165 MB)..."
    cp -r "$PROJECT_ROOT/backend/data/"* "$DEST_DIR/backend/data/" || true
fi

# 5. Instalar dependencias npm del Backend
echo "📦 Instalando dependencias de Node.js en backend..."
cd "$DEST_DIR/backend"
npm install --omit=dev

# 6. Configurar permisos
echo "🔒 Asignando permisos al usuario www-data..."
chown -R www-data:www-data "$DEST_DIR"
chmod -R 755 "$DEST_DIR"
chmod -R 775 "$DEST_DIR/backend/data"

# 7. Configurar servicio systemd para el Backend
echo "⚙️ Configurando servicio systemd (control-acceso-backend)..."
cp "$PROJECT_ROOT/deploy/control-acceso-backend.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable control-acceso-backend
systemctl restart control-acceso-backend

# 8. Configurar Apache 2.4 con ProxyPass
echo "🌐 Configurando Apache 2..."
a2enmod proxy proxy_http rewrite headers
cp "$PROJECT_ROOT/deploy/control-acceso-apache.conf" /etc/apache2/sites-available/control-acceso.conf
a2dissite 000-default.conf 2>/dev/null || true
a2ensite control-acceso.conf
systemctl reload apache2 || systemctl restart apache2

# 9. Configuración de firewall ufw (opcional)
if command -v ufw &> /dev/null; then
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 22/tcp 2>/dev/null || true
fi

echo "=========================================================="
echo "🎉 ¡INSTALACIÓN COMPLETADA CON ÉXITO!"
echo "=========================================================="
echo "🌐 URL de acceso: http://10.0.0.10"
echo "🔌 Estado del Backend: systemctl status control-acceso-backend"
echo "📊 Estado de Apache:  systemctl status apache2"
echo "=========================================================="
