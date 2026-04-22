const { v2: cloudinary } = require('cloudinary');

const hasCloudinaryConfig = () => (
  Boolean(process.env.CLOUDINARY_CLOUD_NAME)
  && Boolean(process.env.CLOUDINARY_API_KEY)
  && Boolean(process.env.CLOUDINARY_API_SECRET)
);

if (hasCloudinaryConfig()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const uploadReceiptImage = async ({ buffer, tripId, communityId }) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Receipt buffer is required.');
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      secureUrl: `https://example.test/receipts/${String(tripId)}.jpg`,
      publicId: `test/receipts/${String(tripId)}`,
    };
  }

  if (!hasCloudinaryConfig()) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  const folderPrefix = String(process.env.CLOUDINARY_FOLDER || 'goshuttle').trim().replace(/\/+$/, '') || 'goshuttle';
  const folder = `${folderPrefix}/remittance-receipts/${String(communityId)}`;
  const publicId = `receipt_${String(tripId)}_${Date.now()}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload failed.'));
          return;
        }
        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.end(buffer);
  });
};

module.exports = {
  uploadReceiptImage,
};
