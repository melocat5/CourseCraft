const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const multer = require('multer');
const path = require('path');
const { Op } = require('sequelize');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');

// S3 Configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Use S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    acl: 'public-read', 
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'uploads/' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images and documents are allowed'));
  }
});

// GET all events
router.get('/', async (req, res) => {
  try {
    const events = await Event.findAll({
      order: [['date', 'ASC']],
      raw: false
    });
    
    const transformedEvents = events.map(event => ({
      id: event.id,
      title: event.title,
      date: event.date,
      description: event.description,
      attachmentUrl: event.attachmentUrl, 
      attachmentFilename: event.attachmentFilename,
      attachmentContentType: event.attachmentContentType,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt
    }));
    
    res.json(transformedEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET events by date (for busy day analyzer) - MUST come before /:id route
router.get('/analyze/date', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const events = await Event.findAll({
      where: {
        date: {
          [Op.between]: [startDate, endDate]
        }
      },
      order: [['date', 'ASC']]
    });

    res.json({
      count: events.length,
      events: events
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single event
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST new event
router.post('/', upload.single('attachment'), async (req, res) => {
  try {
    console.log('Received POST request:', req.body);
    
    const eventData = {
      title: req.body.title,
      date: new Date(req.body.date),
      description: req.body.description || ''
    };

    if (req.file) {
      eventData.attachmentFilename = req.file.key; // S3 Key (filename)
      eventData.attachmentUrl = req.file.location; // Full S3 URL
      eventData.attachmentContentType = req.file.mimetype;
    }

    const newEvent = await Event.create(eventData);
    console.log('Event saved successfully:', newEvent);
    res.status(201).json(newEvent);
  } catch (error) {
    console.error('Error saving event:', error);
    res.status(400).json({ message: error.message });
  }
});

// PUT update event
router.put('/:id', upload.single('attachment'), async (req, res) => {
  try {
    console.log('Received PUT request for ID:', req.params.id, req.body);
    
    const event = await Event.findByPk(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const updateData = {
      title: req.body.title || event.title,
      date: req.body.date ? new Date(req.body.date) : event.date,
      description: req.body.description !== undefined ? req.body.description : event.description
    };

    if (req.file) {
      updateData.attachmentFilename = req.file.key;
      updateData.attachmentUrl = req.file.location;
      updateData.attachmentContentType = req.file.mimetype;
    }

    await event.update(updateData);
    console.log('Event updated successfully:', event);
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(400).json({ message: error.message });
  }
});

// DELETE event
router.delete('/:id', async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    await event.destroy();
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
