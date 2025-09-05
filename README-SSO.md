# Google SSO Implementation Guide

## Quick Start

1. **Set up Google OAuth**
   - Visit [Google Cloud Console](https://console.cloud.google.com)
   - Create OAuth 2.0 credentials
   - Add redirect URIs

2. **Configure Netlify Environment Variables**
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   JWT_SECRET=random_secret_key
   SITE_URL={{SITE_URL}}
   ```

3. **Install Dependencies**
   ```bash
   npm install jsonwebtoken
   ```

4. **Deploy**
   ```bash
   git add .
   git commit -m "Add Google SSO"
   git push
   ```

## Testing

### Local Development
```bash
netlify dev
```
Visit http://localhost:8888/login.html

### Production
Visit {{SITE_URL}}/login.html

## Authentication Flow

1. User clicks "Sign in with Google" on /login.html
2. Redirected to Google OAuth consent screen
3. After approval, redirected to auth-google-callback function
4. Function validates user and generates JWT token
5. User redirected to /auth-success.html with token
6. Token stored in localStorage for subsequent API calls

## Security Considerations

- **Domain Restrictions**: Blocks free email providers by default
- **JWT Expiration**: Tokens expire after 24 hours
- **HTTPS Only**: Ensure production uses HTTPS
- **Secret Management**: Never commit secrets to git

## Customization Options

### Modify Blocked Domains
Edit the `BLOCKED_DOMAINS` environment variable or modify the array in auth-google-callback.js

### Change Token Expiration
In auth-google-callback.js, modify:
```javascript
{ expiresIn: '24h' } // Change to desired duration
```

### Add Database Integration
After successful authentication, you can:
- Store user in database
- Create/update user profile
- Track login history

## Troubleshooting

### Common Issues

1. **"Authorization code missing"**
   - Ensure redirect URI matches exactly in Google Console

2. **"Failed to get access token"**
   - Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

3. **"Blocked domain" error**
   - User is using a personal email address

4. **CORS errors**
   - Ensure Netlify Functions are properly deployed

## API Integration

Use the JWT token for API authentication:

```javascript
fetch('/api/protected-endpoint', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
  }
})
```

## Support

For issues or questions:
- Check Netlify Function logs
- Review Google OAuth documentation
- Ensure all environment variables are set correctly
