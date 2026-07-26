import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

/**
 * Validates that a file is actually an image by checking its magic numbers
 * @param {Buffer} buffer - The file buffer to validate
 * @returns {Promise<boolean>} True if valid image, false otherwise
 */
export async function validateImageFile(buffer) {
  try {
    const type = await fileTypeFromBuffer(buffer);
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    return type && allowedTypes.includes(type.mime);
  } catch (error) {
    console.error('Error validating image file:', error);
    return false;
  }
}

/**
 * Generates a thumbnail from an uploaded image buffer
 * @param {Buffer} imageBuffer - The original image buffer
 * @param {number} width - Thumbnail width (default: 300)
 * @param {number} height - Thumbnail height (default: 300)
 * @returns {Promise<string>} Base64 encoded thumbnail data URL
 */
export async function generateThumbnail(imageBuffer, width = 300, height = 300) {
  try {
    // Resize image to thumbnail size while maintaining aspect ratio
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(width, height, {
        fit: "inside", // Maintain aspect ratio, fit within bounds
        withoutEnlargement: true, // Don't enlarge smaller images
      })
      .jpeg({ quality: 80 }) // Convert to JPEG with good quality
      .toBuffer();

    // Convert to base64 data URL
    const base64Thumbnail = thumbnailBuffer.toString("base64");
    return `data:image/jpeg;base64,${base64Thumbnail}`;
  } catch (error) {
    console.error("Error generating thumbnail:", error);
    throw error;
  }
}

/**
 * Optimizes a full-size image
 * @param {Buffer} imageBuffer - The original image buffer
 * @param {string} mimeType - The original mime type
 * @returns {Promise<string>} Base64 encoded optimized image data URL
 */
export async function optimizeImage(imageBuffer, mimeType) {
  try {
    // Determine output format
    const isJpeg = mimeType.includes("jpeg") || mimeType.includes("jpg");
    const isPng = mimeType.includes("png");

    let optimizedBuffer;

    if (isJpeg) {
      optimizedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 85 })
        .toBuffer();
    } else if (isPng) {
      optimizedBuffer = await sharp(imageBuffer)
        .png({ quality: 85 })
        .toBuffer();
    } else {
      // Convert other formats to JPEG
      optimizedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 85 })
        .toBuffer();
    }

    const base64Image = optimizedBuffer.toString("base64");
    const outputMimeType = (isJpeg || !isPng) ? "image/jpeg" : "image/png";
    return `data:${outputMimeType};base64,${base64Image}`;
  } catch (error) {
    console.error("Error optimizing image:", error);
    throw error;
  }
}
