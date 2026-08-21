require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const db = require('./db');

const app = express();

// Global safety catchers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// Middleware
app.use(cors());
app.use(express.json());

// Root Health Check Endpoint
app.get('/', (req, res) => {
  res.send('Elite Tailor API is running');
});

// Nodemailer transport setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: Number(process.env.EMAIL_PORT) === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function cleanPhoneNumber(phone) {
  return phone.replace(/\D/g, '');
}

// POST: Handle new booking submissions
app.post('/api/bookings', async (req, res) => {
  const { client_name, phone, email, service_type, booking_date, booking_time, notes } = req.body;

  // Validate required inputs
  if (!client_name || !phone || !service_type) {
    return res.status(400).json({ error: 'Please provide all required fields.' });
  }

  // Fallback to today's date and 10:00 AM if empty
  const now = new Date();
  const finalDate = booking_date || now.toISOString().split('T')[0];
  const finalTime = booking_time || '10:00';

  try {
    // 1. Save appointment to PostgreSQL
    const insertQuery = `
      INSERT INTO bookings (client_name, phone, email, service_type, booking_date, booking_time, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
      RETURNING id, created_at;
    `;
    const values = [
      client_name,
      phone,
      email || null,
      service_type,
      finalDate,
      finalTime,
      notes || '',
    ];

    const { rows } = await db.query(insertQuery, values);
    const bookingId = rows[0].id;

    // 2. Dispatch email notification (background)
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const mailOptions = {
        from: `"Elite Tailor Bookings" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `New Fitting Request #${bookingId} - ${client_name}`,
        html: `
          <h2>New Fitting Consultation</h2>
          <p><strong>Booking ID:</strong> #${bookingId}</p>
          <p><strong>Client:</strong> ${client_name}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Email:</strong> ${email || 'Not provided'}</p>
          <p><strong>Service:</strong> ${service_type}</p>
          <p><strong>Preferred Date & Time:</strong> ${finalDate} at ${finalTime}</p>
          <p><strong>Notes:</strong> ${notes || 'None'}</p>
        `,
      };

      transporter.sendMail(mailOptions).catch((err) => {
        console.error('Email dispatch error:', err.message);
      });
    }

    // 3. Dynamic Twilio WhatsApp dispatch using Pre-Approved Content Template
    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const fromNumber = (process.env.TWILIO_WHATSAPP_NUMBER || '').trim();
    const toNumber = (process.env.STUDIO_WHATSAPP_NUMBER || '').trim();

    if (sid && token && fromNumber && toNumber) {
      try {
        const twilioClient = twilio(sid, token);
        const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
        const formattedTo = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;

        // Uses Twilio's standard pre-approved appointment template to bypass ContentSid errors
        twilioClient.messages
          .create({
            from: formattedFrom,
            to: formattedTo,
            contentSid: 'HXb5b62578e6e4ff925d6d900662333174',
            contentVariables: JSON.stringify({
              1: client_name,
              2: `${finalDate} at ${finalTime} (${service_type})`,
            }),
          })
          .then((msg) => {
            console.log(`WhatsApp notification dispatched successfully! Message SID: ${msg.sid}`);
          })
          .catch((err) => {
            console.error('Twilio WhatsApp dispatch error:', err.message);
          });
      } catch (clientErr) {
        console.error('Failed to initialize Twilio client:', clientErr.message);
      }
    } else {
      console.log('Skipping Twilio: Missing or incomplete Twilio env variables.');
    }

    // 4. Return confirmation payload
    return res.status(201).json({
      message: 'Booking created successfully',
      bookingId,
    });
  } catch (error) {
    console.error('DATABASE INSERT ERROR:', error);
    return res.status(500).json({ error: error.message || 'Internal server error processing booking.' });
  }
});

// GET: Fetch all bookings (for Admin view)
app.get('/api/bookings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bookings ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    res.status(500).json({ error: 'Failed to retrieve bookings.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Elite Tailor server running on port ${PORT}`);
});