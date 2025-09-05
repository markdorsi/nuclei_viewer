const jwt = require('jsonwebtoken');

function verifyJWT(token) {
  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-key';
    return jwt.verify(token, jwtSecret);
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

function getUserFromRequest(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = extractBearerToken(authHeader);
  
  if (!token) {
    return null;
  }
  
  return verifyJWT(token);
}

export {
  verifyJWT,
  extractBearerToken,
  getUserFromRequest
};