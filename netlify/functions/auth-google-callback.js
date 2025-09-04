import jwt from 'jsonwebtoken';
import { db, tenants, users, memberships } from '../../db/index.js';
import { eq, and } from 'drizzle-orm';

export const handler = async (event, context) => {
  console.log('=== GOOGLE SSO CALLBACK ===');
  
  const code = event.queryStringParameters?.code;
  const siteUrl = process.env.SITE_URL || process.env.URL || '{{SITE_URL}}';
  
  if (!code) {
    console.log('No authorization code provided');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Authorization code missing' })
    };
  }

  try {
    console.log('Exchanging code for token...');
    
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${siteUrl}/.netlify/functions/auth-google-callback`,
      }),
    });

    const tokens = await tokenResponse.json();
    
    if (!tokens.access_token) {
      throw new Error('Failed to get access token: ' + JSON.stringify(tokens));
    }

    // Get user information from Google
    console.log('Fetching user info...');
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const googleUser = await userResponse.json();
    
    if (!googleUser.email) {
      throw new Error('Failed to get user email');
    }

    // Check for blocked email domains
    const domain = googleUser.email.split('@')[1];
    const blockedDomains = (process.env.BLOCKED_DOMAINS || '{{BLOCKED_DOMAINS}}').split(',').map(d => d.trim());
    
    if (blockedDomains.includes(domain.toLowerCase())) {
      console.log(`Blocking email domain: ${domain}`);
      
      const errorUrl = new URL('/auth-error', siteUrl);
      errorUrl.searchParams.set('reason', 'blocked-domain');
      errorUrl.searchParams.set('domain', domain);
      
      return {
        statusCode: 302,
        headers: {
          'Location': errorUrl.toString(),
        },
      };
    }

    // Create or find tenant based on domain
    console.log('Finding or creating tenant for domain:', domain);
    let [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.googleDomain, domain))
      .limit(1);
    
    if (!tenant) {
      console.log('Creating new tenant for domain:', domain);
      [tenant] = await db
        .insert(tenants)
        .values({
          name: domain.split('.')[0].toUpperCase() + ' Organization',
          slug: domain.split('.')[0].toLowerCase(),
          googleDomain: domain
        })
        .returning();
    }

    // Create or update user
    console.log('Finding or creating user:', googleUser.email);
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleUser.id))
      .limit(1);
    
    if (!user) {
      console.log('Creating new user:', googleUser.email);
      [user] = await db
        .insert(users)
        .values({
          googleId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture
        })
        .returning();
    } else {
      // Update user info
      [user] = await db
        .update(users)
        .set({
          name: googleUser.name,
          avatar: googleUser.picture,
          updatedAt: new Date()
        })
        .where(eq(users.id, user.id))
        .returning();
    }

    // Create membership if it doesn't exist
    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(
        eq(memberships.tenantId, tenant.id),
        eq(memberships.userId, user.id)
      ))
      .limit(1);
    
    if (!membership) {
      console.log('Creating membership for user in tenant');
      await db
        .insert(memberships)
        .values({
          tenantId: tenant.id,
          userId: user.id,
          role: 'analyst' // Default role for domain users
        });
    }

    // Generate JWT token
    console.log('Generating JWT token...');
    const jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-key';
    const token = jwt.sign({
      userId: user.id,
      googleId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
      domain: domain,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      loginTime: new Date().toISOString()
    }, jwtSecret, { expiresIn: '24h' });
    
    // Redirect to frontend with token
    const redirectUrl = new URL('/auth-success', siteUrl);
    redirectUrl.searchParams.set('token', token);
    
    return {
      statusCode: 302,
      headers: {
        'Location': redirectUrl.toString(),
      },
    };
    
  } catch (error) {
    console.error('Google SSO error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Authentication failed', 
        message: error.message 
      })
    };
  }
};
