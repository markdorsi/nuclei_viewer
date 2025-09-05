export const handler = async (event, context) => {
  // Use environment variable or fallback to site URL
  const siteUrl = process.env.SITE_URL || process.env.URL || '{{SITE_URL}}';
  
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
  googleAuthUrl.searchParams.set('redirect_uri', `${siteUrl}/.netlify/functions/auth-google-callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');

  return {
    statusCode: 302,
    headers: {
      'Location': googleAuthUrl.toString(),
    },
  };
};
