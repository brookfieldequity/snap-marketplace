/**
 * Region-aware S3 clients (2026-07-22).
 *
 * Presigned URLs are signed for a specific regional endpoint — sign with the
 * wrong region and S3 answers PermanentRedirect instead of the file (hit in
 * prod: document bucket lives in us-east-2, AWS_REGION default was
 * us-east-1; SDK requests auto-follow the redirect, browser-opened presigned
 * links cannot). Resolve each bucket's real region once, cache it, and hand
 * out clients pinned to it.
 */

const { S3Client, GetBucketLocationCommand } = require('@aws-sdk/client-s3')

const regionCache = new Map()

async function regionForBucket(bucket) {
  if (regionCache.has(bucket)) return regionCache.get(bucket)

  // Explicit override wins — a guaranteed path when the IAM key lacks
  // s3:GetBucketLocation. Set AWS_S3_BUCKET_REGION (documents bucket) on
  // Railway to pin it directly.
  const explicit =
    (bucket === process.env.AWS_S3_BUCKET && process.env.AWS_S3_BUCKET_REGION) ||
    (bucket === process.env.AWS_S3_BUCKET_PHOTOS && process.env.AWS_S3_BUCKET_PHOTOS_REGION)
  if (explicit) {
    regionCache.set(bucket, explicit)
    return explicit
  }

  let region = process.env.AWS_REGION || 'us-east-1'
  try {
    const probe = new S3Client({ region: 'us-east-1', followRegionRedirects: true })
    const loc = await probe.send(new GetBucketLocationCommand({ Bucket: bucket }))
    // LocationConstraint is empty/undefined for us-east-1 by S3 convention.
    region = loc.LocationConstraint || 'us-east-1'
  } catch (err) {
    console.error(`[s3Buckets] region lookup failed for ${bucket} (using ${region}):`, err.message)
  }
  regionCache.set(bucket, region)
  return region
}

/** S3 client pinned to the bucket's actual region — safe for presigning. */
async function clientForBucket(bucket) {
  const region = await regionForBucket(bucket)
  return new S3Client({ region, followRegionRedirects: true })
}

module.exports = { clientForBucket, regionForBucket }
