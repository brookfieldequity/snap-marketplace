const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;
const PHOTOS_BUCKET = process.env.AWS_S3_BUCKET_PHOTOS || BUCKET;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

async function uploadToS3(buffer, mimetype, key, bucket = BUCKET) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

// ── Provider profile photo ────────────────────────────────────────────────────

router.post('/provider-photo', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!PHOTOS_BUCKET) return res.status(500).json({ error: 'S3 not configured — set AWS_S3_BUCKET_PHOTOS env var' });

    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!provider) return res.status(400).json({ error: 'Provider not found' });

    const ext = req.file.mimetype.split('/')[1] || 'jpg';
    const key = `providers/${provider.id}/${crypto.randomUUID()}.${ext}`;
    const url = await uploadToS3(req.file.buffer, req.file.mimetype, key, PHOTOS_BUCKET);

    await prisma.providerProfile.update({
      where: { id: provider.id },
      data: { photoUrl: url },
    });

    res.json({ url });
  } catch (err) {
    console.error('Provider photo upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── Facility photos (up to 5 per upload, max 10 total) ────────────────────────

router.post('/facility-photos', facilityAuth, upload.array('photos', 5), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    if (!BUCKET) return res.status(500).json({ error: 'S3 not configured — set AWS_S3_BUCKET env var' });

    const newUrls = await Promise.all(
      req.files.map(async (file) => {
        const ext = file.mimetype.split('/')[1] || 'jpg';
        const key = `facilities/${req.facility.id}/${crypto.randomUUID()}.${ext}`;
        return uploadToS3(file.buffer, file.mimetype, key);
      })
    );

    const existing = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { photoUrls: true },
    });
    const allPhotos = [...(existing?.photoUrls || []), ...newUrls].slice(0, 10);

    await prisma.facility.update({
      where: { id: req.facility.id },
      data: { photoUrls: allPhotos },
    });

    res.json({ urls: newUrls, allPhotos });
  } catch (err) {
    console.error('Facility photo upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── Delete a facility photo ───────────────────────────────────────────────────

router.delete('/facility-photos', facilityAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const existing = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { photoUrls: true },
    });
    const updated = (existing?.photoUrls || []).filter((u) => u !== url);

    await prisma.facility.update({
      where: { id: req.facility.id },
      data: { photoUrls: updated },
    });

    res.json({ allPhotos: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

module.exports = router;
