import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import inscripcionRoutes from './routes/inscripciones.js';
import scheduleRoutes from './routes/schedule.js';
import notificationRoutes from './routes/notification.js';
import expositoresRoutes from './routes/expositores.js';

// 🟡 Cargar variables de entorno
dotenv.config();

// 🟢 Inicializar app
const app = express();
app.use(cors());
app.use(express.json());

// 🧩 Importar rutas
app.use('/auth', authRoutes);
app.use('/eventos', eventRoutes);
app.use('/inscripciones', inscripcionRoutes); 
app.use('/actividades', scheduleRoutes);
app.use('/notificaciones', notificationRoutes);
app.use('/expositores', expositoresRoutes);

// ✅ Importar el job automático de recordatorios
import './jobs/recordatorios.js';

// 🚀 Levantar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Registration Service listening on port ${PORT}`);
});
