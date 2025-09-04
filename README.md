# ScanVault - Multi-tenant Security Scanner Dashboard

ScanVault is a Netlify-native, multi-tenant system for managing and viewing Nuclei and Nmap security scan results with Linear and Jira integration.

## Features

- **Multi-tenant Architecture**: Complete tenant isolation with Row-Level Security (RLS)
- **Google SSO Authentication**: Via Netlify Identity with domain restrictions
- **Scan Management**: Upload and parse Nuclei JSONL and Nmap scan files
- **Issue Tracking Integration**: Link findings to Linear and Jira issues
- **BYOK Token Support**: Users can bring their own API tokens for issue creation
- **Role-based Access Control**: Owner, admin, analyst, uploader, and viewer roles

## Tech Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Netlify Functions (serverless)
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Netlify Identity with Google SSO
- **Storage**: Netlify Blobs (or S3/GCS)

## Getting Started

### Prerequisites

- Node.js 18+
- [Neon Database](https://neon.tech/) account (free tier available)
- Netlify CLI (`npm install -g netlify-cli`)
- Google Cloud Console account for OAuth setup

### Installation

1. Clone the repository:
```bash
git clone <repo-url>
cd scanvault
```

2. Install dependencies:
```bash
npm install
```

3. Set up Google OAuth credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable the Google+ API
   - Create OAuth 2.0 credentials:
     - Application type: Web application
     - Authorized redirect URIs: `http://localhost:5173/auth/callback` (dev), `https://scanvault.netlify.app/auth/callback` (prod)
   - Copy Client ID and Client Secret

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database and Google OAuth credentials
```

5. Set up your Neon database:
   1. Go to [Neon Console](https://console.neon.tech/) and sign up
   2. Create a new project called "ScanVault"
   3. Select your preferred region (us-east-1 recommended for Netlify)
   4. Create a database named `scanvault_db`
   5. Copy the connection string from the dashboard
      - Format: `postgresql://username:password@ep-xxx-xxx.us-east-1.aws.neon.tech/scanvault_db?sslmode=require`
   6. Update your `.env` file with the Neon connection string

6. Run database migrations:
```bash
# Generate migrations (first time setup)
npm run db:generate

# Apply migrations to your Neon database
npm run db:migrate
```

7. Start the development server:
```bash
npm run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- API: http://localhost:9999/.netlify/functions/

## Deployment

### Deploy to Netlify

1. **Connect Repository**: Link your GitHub repository to Netlify
2. **Configure Build Settings**:
   - Build command: `npm run build`
   - Publish directory: `dist` 
   - Functions directory: `netlify/functions`

3. **Set Environment Variables** in Netlify Dashboard:
   ```
   DATABASE_URL=your_neon_connection_string
   GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_REDIRECT_URI=https://scanvault.netlify.app/auth/callback
   JWT_SECRET=your_secure_jwt_secret_32_chars_minimum
   ENCRYPTION_KEY=your_32_char_encryption_key
   ```

4. **Deploy**: Netlify will automatically build and deploy your app

### Database Migrations in Production
After deployment, run migrations against your Neon database:
```bash
# Set your Neon DATABASE_URL locally
export DATABASE_URL="your_neon_connection_string"

# Run migrations against Neon
npm run db:migrate
```

**Why Neon?**
- ✅ **Serverless PostgreSQL** - Perfect for Netlify Functions
- ✅ **Free tier** - 10GB storage, 1 database
- ✅ **Branch-like databases** - Create dev/staging branches
- ✅ **Auto-scaling** - Scales to zero when not in use
- ✅ **Built-in connection pooling** - Optimized for serverless
