// Importamos el paquete jsonwebtoken para verificar tokens JWT
import jwt from 'jsonwebtoken'; 

// Importamos dotenv para poder leer las variables de entorno desde un archivo .env
import dotenv from 'dotenv';

// Ejecutamos la configuración de dotenv para habilitar el uso de process.env
dotenv.config();

// Middleware para verificar si el token JWT es válido
export function verifyToken(req, res, next) {
  // Obtenemos el encabezado de autorización de la solicitud
  const authHeader = req.headers.authorization;

  // Si no existe el header o no empieza con "Bearer ", se rechaza el acceso
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  // Extraemos el token quitando la palabra "Bearer "
  const token = authHeader.split(' ')[1];

  try {
    // Verificamos el token con la clave secreta definida en el archivo .env
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Guardamos la información del usuario decodificada en el objeto request
    req.user = decoded;

    // Si todo está bien, continúa con el siguiente middleware o ruta
    next();
  } catch (err) {
    // Si el token es inválido o expiró, se devuelve un error 403
    res.status(403).json({ error: 'Token inválido' });
  }
}

// Middleware que permite el acceso solo a usuarios con rol de administrador (4) o organizador (2)
export function requireAdminOrOrganizer(req, res, next) {
  const { rol_id } = req.user; // Obtenemos el rol del usuario desde el token decodificado

  // Si el rol es 4 (admin) o 2 (organizador), permitimos el acceso
  if (rol_id === 4 || rol_id === 2) {
    return next();
  }

  // Si no es ninguno de esos roles, denegamos el acceso
  return res.status(403).json({ error: 'Acceso denegado: requiere permisos de administrador u organizador' });
}

// Middleware que permite el acceso solo a usuarios con rol de asistente (5)
export function requireAsistente(req, res, next) {
  const { rol_id } = req.user; // Obtenemos el rol del usuario desde el token decodificado

  // Si el rol es 5 (asistente), permitimos el acceso
  if ( rol_id === 5) {
    return next();
  }

  // Si no es asistente, devolvemos un mensaje de error
  return res.status(403).json({ error: 'Solo los asistentes pueden inscribirse' });
}
