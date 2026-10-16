import rateLimit from 'express-rate-limit';

// 1. Rate Limiting general para la API (Anti-DoS y prevención de abusos)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // Máximo 1000 peticiones por ventana de 15 min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes desde esta dirección IP. Por favor intente más tarde.'
  }
});

// 2. Rate Limiting estricto para operaciones pesadas (Sincronización con base Access)
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 6, // Máximo 6 sincronizaciones por minuto por IP para evitar saturación de CPU y disco
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Frecuencia de sincronización excedida. Espere un momento antes de volver a sincronizar.'
  }
});

// 3. Middleware de autenticación opcional para endpoints sensibles (sync y push)
export const requireApiKey = (req, res, next) => {
  const configuredKey = process.env.API_KEY || process.env.SYNC_API_KEY;
  
  // Si no se configuró clave en el entorno (.env), se permite en modo permisivo / desarrollo local
  if (!configuredKey) {
    return next();
  }

  const clientKey = req.headers['x-api-key'] || req.query.apiKey || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

  if (!clientKey || clientKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'Acceso no autorizado: Se requiere una clave de API válida (x-api-key).'
    });
  }

  next();
};

// 4. Sanitización y validación estricta de parámetros de consulta (Anti-Injection & ReDoS)
export const validateQueryParams = (req, res, next) => {
  try {
    const q = req.query;

    // Sanitizar y limitar paginación para prevenir OOM (Out Of Memory)
    if (q.limit !== undefined) {
      const parsedLimit = parseInt(q.limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        req.query.limit = 50;
      } else if (parsedLimit > 500) {
        req.query.limit = 500; // Máximo permitido por página
      } else {
        req.query.limit = parsedLimit;
      }
    }

    if (q.page !== undefined) {
      const parsedPage = parseInt(q.page, 10);
      req.query.page = (isNaN(parsedPage) || parsedPage < 1) ? 1 : parsedPage;
    }

    // Sanitizar filtros de texto para prevenir caracteres de control o inyecciones
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return '';
      // Elimina caracteres nulos y caracteres de control potencialmente peligrosos
      return str.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '').trim().substring(0, 100);
    };

    if (q.empleado) req.query.empleado = sanitizeString(q.empleado);
    if (q.legajo) req.query.legajo = sanitizeString(q.legajo);
    if (q.estado) req.query.estado = sanitizeString(q.estado);
    if (q.tipoHorario) req.query.tipoHorario = sanitizeString(q.tipoHorario);
    if (q.tipoRegistro) req.query.tipoRegistro = sanitizeString(q.tipoRegistro).toUpperCase();

    // Validar formato de fechas (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (q.fecha && !dateRegex.test(q.fecha)) {
      return res.status(400).json({ success: false, error: 'Parámetro fecha inválido. Formato esperado: YYYY-MM-DD' });
    }
    if (q.fechaDesde && !dateRegex.test(q.fechaDesde)) {
      return res.status(400).json({ success: false, error: 'Parámetro fechaDesde inválido. Formato esperado: YYYY-MM-DD' });
    }
    if (q.fechaHasta && !dateRegex.test(q.fechaHasta)) {
      return res.status(400).json({ success: false, error: 'Parámetro fechaHasta inválido. Formato esperado: YYYY-MM-DD' });
    }

    next();
  } catch (err) {
    return res.status(400).json({ success: false, error: 'Error en la validación de parámetros.' });
  }
};

// 5. Manejador centralizado de errores (Evita fuga de rutas internas / stack traces en producción)
export const errorHandler = (err, req, res, next) => {
  console.error('💥 Error no controlado en la aplicación:', err);

  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    success: false,
    error: isProduction ? 'Ocurrió un error interno en el servidor.' : (err.message || 'Error interno')
  });
};
