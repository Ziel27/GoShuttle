/**
 * Zod-inspired validation schemas for API requests
 * Provides type-safe input validation across endpoints
 */

const validator = require('validator');

/**
 * Validate string input: non-empty, trim optional, length limits
 */
const validateString = (value, options = {}) => {
  const { minLength = 1, maxLength = 500, trim = true, allowHtml = false } = options;
  
  if (typeof value !== 'string') {
    throw new Error('Input must be a string');
  }
  
  let str = trim ? value.trim() : value;
  
  if (str.length < minLength) {
    throw new Error(`String must be at least ${minLength} characters`);
  }
  
  if (str.length > maxLength) {
    throw new Error(`String must not exceed ${maxLength} characters`);
  }
  
  if (!allowHtml && (str.includes('<') || str.includes('>'))) {
    throw new Error('HTML tags are not allowed');
  }
  
  return str;
};

/**
 * Validate email
 */
const validateEmail = (email) => {
  if (!validator.isEmail(email)) {
    throw new Error('Invalid email address');
  }
  return email.toLowerCase();
};

/**
 * Validate MongoDB ObjectId
 */
const validateMongoId = (id) => {
  if (!validator.isMongoId(String(id))) {
    throw new Error('Invalid MongoDB ID');
  }
  return String(id);
};

/**
 * Validate password: min 8 chars, mix of upper/lower/numbers/special
 */
const validatePassword = (password) => {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  if (!hasUpper || !hasLower || !hasNumber) {
    throw new Error('Password must contain uppercase, lowercase, and numbers');
  }
  
  return password;
};

/**
 * Validate coordinate (latitude/longitude)
 */
const validateCoordinate = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  
  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error('Coordinates must be valid numbers');
  }
  
  if (latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be between -90 and 90');
  }
  
  if (longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be between -180 and 180');
  }
  
  return { latitude, longitude };
};

/**
 * Validate polygon coordinates (GeoJSON)
 */
const validatePolygonCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }
  
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error('Each point must be [longitude, latitude]');
    }
    
    const [lng, lat] = point;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid coordinate bounds');
    }
  }
  
  // Check if polygon is closed (first and last points match)
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push(first); // Auto-close polygon
  }
  
  return coordinates;
};

/**
 * Validate positive number
 */
const validatePositiveNumber = (value, maxValue = null) => {
  const num = parseFloat(value);
  
  if (isNaN(num) || num <= 0) {
    throw new Error('Value must be a positive number');
  }
  
  if (maxValue !== null && num > maxValue) {
    throw new Error(`Value cannot exceed ${maxValue}`);
  }
  
  return num;
};

/**
 * Validate ride request object
 */
const validateRideRequest = (data) => {
  const { email, phone, pickupLocation, firstName, lastName } = data;
  
  if (!validateString(email)) {
    throw new Error('Email is required');
  }
  validateEmail(email);
  
  if (phone && !validator.isMobilePhone(String(phone))) {
    throw new Error('Invalid phone number');
  }
  
  if (!pickupLocation || typeof pickupLocation !== 'object') {
    throw new Error('Pickup location is required');
  }
  
  const { latitude, longitude } = pickupLocation;
  validateCoordinate(latitude, longitude);
  
  validateString(firstName, { minLength: 1, maxLength: 100 });
  validateString(lastName, { minLength: 1, maxLength: 100 });
  
  return { email, phone, pickupLocation, firstName, lastName };
};

module.exports = {
  validateString,
  validateEmail,
  validateMongoId,
  validatePassword,
  validateCoordinate,
  validatePolygonCoordinates,
  validatePositiveNumber,
  validateRideRequest,
};
